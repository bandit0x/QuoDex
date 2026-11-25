// Compare Chromium's final composition, including SVG glyphs and shadows, at
// the production task buttons' screen coordinates against the approved study.
// Usage: node scripts/verify-task-ring-pixels.mjs [path/to/playwright/index.mjs]
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const project = fileURLToPath(new URL("../", import.meta.url));
const scratch = path.join(project, ".scratch");
await mkdir(scratch, { recursive: true });
const output = await mkdtemp(path.join(scratch, "ring-pixels-"));
const { chromium } = await import(process.argv[2] ? pathToFileURL(path.resolve(process.argv[2])).href : "playwright");
const states = ["running", "waiting", "completed", "failed", "unknown", "mixed", "idle"];

// Real strip, layout and colors. A healthy source without tasks is hidden by
// the strip, so the idle material is exercised separately by its real component.
const fixture = `
import {createRoot} from "react-dom/client";
import "./src/App.css";
import {TaskStatusStrip} from "./src/TaskStatusStrip";
import {AgentTaskRing} from "./src/AgentTaskRing";
import "./src/GeminiQuotaSurface.css";
const q = new URLSearchParams(location.search);
const state = q.get("state"), now = 1890000000000;
const narrow = q.get("size") === "25", gemini = q.get("layout") === "gemini";
const sources = ["codex", "zcode", "antigravity"];
const agents = ["Codex", "ZCode", "Gemini"];
const tasks = state === "idle" ? [] : sources.flatMap(source =>
  (state === "mixed" ? ["failed", "running"] : [state]).map(status => ({
    source, id: source + status, turnId: "turn", title: "Sample", state: status,
    completedAtMs: status === "completed" ? now - 180000 : null, detail: null
  })));
document.body.style.background = "#a5b2b9";
createRoot(document.getElementById("root")).render(
  <main className={"app-frame app-frame--has-tasks" + (narrow ? " app-frame--collapsed" : "") + (gemini ? " app-frame--gemini" : "")}>
    <TaskStatusStrip tasks={tasks} now={now} compact={narrow} onOpen={()=>{}} onDismiss={()=>{}} />
    {state === "idle" && <div className={"task-strip" + (narrow ? " task-strip--compact" : "")}>
      {agents.map(agent => <button className="task-agent-orb" data-agent={agent} key={agent}>
        <AgentTaskRing agent={agent} state="idle" running={false} minutes={null} reducedMotion={false} />
      </button>)}
    </div>}
  </main>);
`;
await build({
  stdin: { contents: fixture, resolveDir: project, loader: "jsx" }, bundle: true, jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' }, outfile: path.join(output, "fixture.js")
});
await writeFile(path.join(output, "index.html"), '<!doctype html><meta charset=utf-8><link rel=stylesheet href=fixture.css><div id=root></div><script src=fixture.js></script>');

const browser = await chromium.launch({ channel: "chrome", headless: true });
let strips = 0, frames = 0;
try {
  for (const dpr of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 360, height: 265 }, deviceScaleFactor: dpr });
    // Advance both renderers from an identical origin. A screenshot must never
    // let the stream advance between reference and product.
    await context.addInitScript(() => {
      let clock = 0, id = 0;
      const pending = new Map();
      window.requestAnimationFrame = callback => { pending.set(++id, callback); return id; };
      window.cancelAnimationFrame = handle => pending.delete(handle);
      Object.defineProperty(performance, "now", { value: () => clock });
      window.advanceRingClock = ms => {
        clock = ms;
        const callbacks = [...pending.values()];
        pending.clear();
        callbacks.forEach(callback => callback(clock));
        return pending.size;
      };
    });
    const live = await context.newPage(), reference = await context.newPage();
    for (const size of [29, 25]) for (const layout of ["standard", "gemini"]) for (const state of states) {
      const key = [dpr, size, layout, state].join("-");
      const url = pathToFileURL(path.join(output, "index.html"));
      url.search = new URLSearchParams({ size: String(size), state, layout }).toString();
      await live.goto(url.href);
      await live.waitForSelector(".task-agent-orb canvas");
      const slots = await live.locator(".task-agent-orb").evaluateAll(buttons => buttons.map(button => {
        const { x, y, width } = button.getBoundingClientRect();
        return { agent: button.dataset.agent, x, y, width };
      }));
      assert.deepEqual(slots.map(s => s.width), [size, size, size], key);
      await reference.goto(new URL("../docs/design/gemini-taskbar/v0410-reference/index.html", import.meta.url).href);
      await reference.evaluate(({ size, state, slots }) => {
        const stage = document.createElement("div");
        stage.style.cssText = "position:absolute;inset:0;z-index:1000;background:#a5b2b9";
        stage.style.setProperty("--size", size + "px");
        document.querySelector("#sheet").append(stage);
        for (const { agent, x, y } of slots) {
          const ring = document.querySelector('#examples .ring.' + agent.toLowerCase() + '[data-state="' + state + '"]');
          ring.style.cssText = "display:grid;position:absolute;margin:0;left:" + x + "px;top:" + y + "px";
          stage.append(ring);
        }
        stage.id = "pixel-reference";
        refresh();
      }, { size, state, slots });
      const clip = {
        x: Math.floor(slots[0].x) - 3, y: Math.floor(slots[0].y) - 3,
        width: Math.ceil(slots[2].x + size - slots[0].x) + 6, height: size + 7
      };
      const crop = { clip, type: "png" };
      const expected = await reference.screenshot(crop), actual = await live.screenshot(crop);
      if (!expected.equals(actual)) {
        await writeFile(path.join(output, key + "-expected.png"), expected);
        await writeFile(path.join(output, key + "-actual.png"), actual);
        assert.fail("QDR-101: compare the mismatching strip screenshots in " + output + " (" + key + ")");
      }
      strips++;
      const canvasPixels = () => live.locator(".task-agent-orb canvas").evaluateAll(nodes => nodes.map(n => n.toDataURL()));
      const initial = await canvasPixels();
      const moving = state === "running" || state === "mixed";
      for (const ms of [125, 645, 1825]) {
        assert.equal(await live.evaluate(ms => window.advanceRingClock(ms), ms), moving ? 3 : 0, key + ": pending animation callbacks");
        const wanted = await reference.evaluate(ms => {
          time = ms / 1000;
          refresh();
          return [...document.querySelectorAll("#pixel-reference canvas")].map(n => n.toDataURL());
        }, ms);
        const received = await canvasPixels();
        for (let i = 0; i < received.length; i++) {
          assert.ok(received[i] === wanted[i], key + ": water surface differs at " + ms + " ms for " + slots[i].agent);
          assert.equal(received[i] !== initial[i], moving, key + ": unexpected motion at " + ms + " ms");
          frames++;
        }
      }
    }
    await context.close();
  }
} finally { await browser.close(); }
console.log("Pixel-identical task strip screenshots:", strips, "Matched ring frames:", frames);
