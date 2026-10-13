// Windows QA: launch the compiled Tauri product with anonymous, isolated local sources.
// Never supplies cloud credentials or calls the connect command with valid inputs.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, open } from "node:fs/promises";
import { createHash } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createUsageFixture, repo } from "./usage-ui-fixture.mjs";

const output = path.resolve(process.env.QUODEX_QA_OUTPUT ?? path.join(repo, "docs/verification/remote-record"));
const executable = path.resolve(process.env.QUODEX_QA_APP ?? path.join(repo, "src-tauri/target/debug/codex-credits-view.exe"));
const playwright = process.env.QUODEX_QA_PLAYWRIGHT ?? "C:/Users/bandit/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
const { chromium } = await import(pathToFileURL(playwright).href);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [];
const errors = [];
await mkdir(output, { recursive: true });
const fixture = await createUsageFixture();
const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const urlFile = path.join(fixture.root, "usage-url.txt");
const log = await open(path.join(fixture.root, "app.log"), "w");
const app = spawn(executable, [], { cwd: repo, windowsHide: true, env: { ...fixture.env,
  // The debug product supplies settings-window arguments and data directory via API.
  // A global WEBVIEW2_USER_DATA_FOLDER would force it into the main window's existing browser process.
  QUODEX_USAGE_URL_FILE: urlFile, QUODEX_QA_CDP_PORT: String(port) }, stdio: ["ignore", log.fd, log.fd] });
let browser, native;
async function until(fn, label, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const result = await fn(); if (result) return result; } catch {} await delay(150); }
  throw new Error(`Timed out: ${label}`);
}
async function check(name, run) { await run(); results.push({ name, status: "Verified" }); }
let fatal;
try {
  const base = await until(async () => (await readFile(urlFile, "utf8")).trim(), "native usage server");
  const snapshot = await until(async () => { const s = await (await fetch(`${base}api/usage`)).json(); return s.codex.state === "ready" && s.zcode.state === "ready" ? s : null; }, "source import");
  await check("Fresh desktop product imports isolated Codex and ZCode; sync remains disconnected", async () => {
    assert.equal(snapshot.sync.state, "disconnected");
    for (const key of ["codex", "zcode"]) { assert.deepEqual(snapshot[key].daily, fixture.expected.daily[key]); assert.deepEqual(snapshot.allDevices[key].daily, fixture.expected.daily[key]); }
    assert.equal(snapshot.sync.authorizationUrl, null); assert.equal(snapshot.sync.appKey, "");
  });
  await check("Local mutation bridge refuses foreign Origin and missing capability", async () => {
    assert.equal((await fetch(`${base}api/sync/settings`, { method: "POST" })).status, 403);
    assert.equal((await fetch(`${base}api/usage`, { headers: { Origin: "https://untrusted.example" } })).status, 403);
  });
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1 });
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(base); await page.locator("#totals-number").filter({ hasNotText: "—" }).waitFor();
  await check("Scope switch preserves exact total and works by keyboard", async () => {
    const local = await page.locator("#totals-number").innerText();
    await page.locator("#scope-all").focus(); await page.keyboard.press("Enter");
    assert.equal(await page.locator("#scope-all").getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("#totals-number").innerText(), local);
    assert.match(await page.locator("#scope-label").innerText(), /全部设备/);
  });
  await page.screenshot({ path: path.join(output, "usage-desktop.png"), fullPage: true });
  await page.locator("#sync-details-open").click();
  await page.screenshot({ path: path.join(output, "sync-details.png") });
  await page.locator("#sync-settings").click();
  await until(async () => (await fetch(`http://127.0.0.1:${port}/json/version`)).ok, "native WebView debugger");
  native = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const settings = await until(() => native.contexts().flatMap(c => c.pages()).find(p => p.url().includes("view=sync")), "native settings window");
  settings.on("pageerror", e => errors.push(e.message));
  await settings.getByLabel("AppKey", { exact: true }).waitFor();
  assert.equal(await page.locator("#sync-now").isDisabled(), true, "Opening settings must preserve disconnected action state");
  await settings.screenshot({ path: path.join(output, "connection-native.png") });
  await check("Native settings uses masked secrets and rejects invalid folder before networking", async () => {
    assert.equal(await settings.getByLabel("SecretKey", { exact: true }).getAttribute("type"), "password");
    await settings.getByLabel("AppKey", { exact: true }).fill("synthetic-key");
    await settings.getByLabel("SecretKey", { exact: true }).fill("synthetic-secret");
    await settings.getByLabel("应用文件夹").fill("../invalid");
    await settings.getByRole("button", { name: "连接并同步" }).click();
    await settings.getByRole("alert").filter({ hasText: "QDS-102" }).waitFor();
    const s = await (await fetch(`${base}api/usage`)).json();assert.equal(s.sync.state, "disconnected");
    assert.ok(!JSON.stringify(s).includes("synthetic-secret"));
  });
  await settings.screenshot({ path: path.join(output, "connection-validation-native.png") });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await check("390px usage page stays within viewport", async () => {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  });
  await page.screenshot({ path: path.join(output, "usage-narrow.png"), fullPage: true });
  await check("Disconnect from native settings retains collected history", async () => {
    await settings.evaluate(() => window.__TAURI_INTERNALS__.invoke("sync_disconnect"));
    await delay(500);
    const after = await (await fetch(`${base}api/usage`)).json();
    assert.deepEqual(after.allDevices.codex.daily, snapshot.allDevices.codex.daily);
    assert.equal(after.sync.state, "disconnected");
  });
  assert.deepEqual(errors, []);
} catch (e) { fatal = e; }
finally {
  if (browser) await browser.close();
  // Do not call Browser.close on native CDP: kill only the isolated QA product below.
  if (app.exitCode === null) app.kill();
  await log.close();
  const report = { status: fatal ? "Blocked" : "Verified", scope: "Windows native product, synthetic local records, no cloud account", date: new Date().toISOString(),
    node: process.version, executableSha256: createHash("sha256").update(await readFile(executable)).digest("hex"), checks: results, browserErrors: errors,
    limitation: "Baidu authorization, real transfer, OS credential rotation and two physical PCs are not verified.", error: fatal?.message ?? null };
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (native) await native.disconnect?.();
}
if (fatal) throw fatal;
