// Small native preflight: exercise the real screenshot backdrop before a long build.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

if (process.platform !== "win32") throw new Error("QWS-112: Windows backdrop preflight requires Windows");
const root = await mkdtemp(path.join(tmpdir(), "quodex-backdrop-"));
const readyPath = path.join(root, "ready.json");
const started = Date.now();
const child = spawn("pwsh.exe", ["-NoProfile", "-File", path.resolve("scripts/task-status-native.ps1"),
  "-RequestBase64", Buffer.from(JSON.stringify({ op: "background", readyPath })).toString("base64")], { windowsHide: true });
let stdout = "", stderr = "", spawnError;
const closed = new Promise(resolve => child.once("close", resolve));
child.stdout.on("data", chunk => { stdout += chunk; });
child.stderr.on("data", chunk => { stderr += chunk; });
child.on("error", error => { spawnError = error.message; });
let ready, readError;
try {
  while (Date.now() - started < 30000) {
    if (spawnError || child.exitCode !== null) break;
    try { ready = JSON.parse(await readFile(readyPath, "utf8")); }
    catch (error) {
      readError = error.message;
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) break;
    }
    if (ready?.visible) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const elapsedMs = Date.now() - started;
  child.kill();
  await closed;
  const result = { elapsedMs, ready, exitCode: child.exitCode, spawnError, readError, stdout, stderr };
  await writeFile(path.join(root, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if (!ready?.visible) throw new Error(`QWS-112: Native backdrop not ready; evidence: ${root}`);
} finally { child.kill(); }
