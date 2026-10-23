// Run with the Computer Use sky client in node_repl, against the actual installed window.
// An HTTP usage-server check cannot establish that the Tauri main webview loaded.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export async function verifyInstalledWindow(sky, executable, output) {
  const app = `process:${executable}`;
  const windows = (await sky.list_windows()).filter(w => w.app.toLowerCase() === app.toLowerCase() && w.title === "QuoDex");
  assert.equal(windows.length, 1, "QAS-001: expected one installed QuoDex main window");
  const window = await sky.get_window({ id: windows[0].id, app: windows[0].app });
  const state = await sky.get_window_state({ window, include_screenshot: true, include_text: true });
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "main-window.json"), JSON.stringify(state.accessibility, null, 2));
  for (const [index, screenshot] of state.screenshots.entries()) {
    await writeFile(path.join(output, `main-window-${index}.png`), Buffer.from(screenshot.url.split(",")[1], "base64"));
  }
  const text = JSON.stringify(state.accessibility);
  assert.doesNotMatch(text, /ERR_CONNECTION_REFUSED|无法访问此页面|chrome-error:\/\//, "QAS-001: main window displays a browser error page");
  assert.match(text, /http:\/\/tauri\.localhost\//, "QAS-002: main window did not load the embedded production origin");
  assert.match(text, /quota|额度|剩余|WEEK/i, "QAS-003: QuoDex quota interface did not render");
  return state;
}
