// Launch the production macOS bundle with fictional tasks and a fresh data directory.
// Mouse input stays manual: this fixture never injects desktop events or touches user data.
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { openFixtureDatabase } from "./native-fixture-db.mjs";

if (process.platform !== "darwin") throw new Error("This native review requires macOS");
const root = await mkdtemp(path.join(tmpdir(), "qdi-"));
// Keep the Unix socket path below macOS's 104-byte limit even with long TMPDIR paths.
const socketRoot = await mkdtemp("/tmp/qdi-");
const endpoint = path.join(socketRoot, "ipc.sock");
const config = path.join(root, "config");
const home = path.join(root, "codex");
const zcode = path.join(root, "zcode");
await Promise.all([mkdir(config), mkdir(home), mkdir(zcode)]);
await writeFile(path.join(config, "display-preferences.json"), JSON.stringify({ opacity: .92, reducedMotion: false, source: "codex", x: 500, y: 300 }));
const now = Math.floor(Date.now() / 1000);
const id = "00000000-0000-4000-8000-000000000001";
const state = openFixtureDatabase(path.join(home, "state_5.sqlite"));
state.exec("CREATE TABLE threads(id TEXT,title TEXT,source TEXT,originator TEXT,archived INTEGER,updated_at INTEGER); CREATE TABLE thread_spawn_edges(child_thread_id TEXT);");
state.prepare("INSERT INTO threads VALUES(?,?,'vscode','Codex Desktop',0,?)").run(id, "鼠标穿透验收任务", now);
const history = openFixtureDatabase(path.join(home, "thread_history_1.sqlite"));
history.exec("CREATE TABLE thread_turns(thread_id TEXT,turn_id TEXT,status TEXT,started_at INTEGER,completed_at INTEGER,error_json TEXT,rollout_ordinal INTEGER);");
history.prepare("INSERT INTO thread_turns VALUES(?,'review-turn','completed',?,?,NULL,1)").run(id, now - 120, now - 60);
const send = (socket, message) => {
  const body = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
  socket.write(Buffer.concat([header, body]));
};
const server = createServer(socket => {
  let buffer = Buffer.alloc(0);
  socket.on("error", error => console.error(`QDI-001: fixture socket ${error.code}`));
  socket.on("data", chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE();
      if (buffer.length < length + 4) break;
      const request = JSON.parse(buffer.subarray(4, length + 4));
      buffer = buffer.subarray(length + 4);
      if (request.method === "initialize") send(socket, { type: "response", requestId: request.requestId, method: request.method, resultType: "success", result: { clientId: "review-observer" } });
      else if (request.method === "thread-owner-discovery") send(socket, { type: "response", requestId: request.requestId, method: request.method, resultType: "success", handledByClientId: "review-owner", result: {} });
      else if (request.method === "thread-stream-following-changed" && request.params.following) send(socket, {
        type: "broadcast", method: "thread-stream-state-changed", version: 11,
        sourceClientId: "review-owner", targetClientIds: ["review-observer"],
        params: { hostId: "local", conversationId: id, change: { type: "snapshot", revision: 1,
          conversationState: { id, title: "鼠标穿透验收任务", requests: [], threadRuntimeStatus: { type: "idle", activeFlags: [] },
            turns: [{ turnId: "review-turn", status: "completed", turnStartedAtMs: (now - 120) * 1000, durationMs: 60000 }] } } },
      });
    }
  });
});
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(endpoint, resolve); });
const executable = path.resolve(process.argv[2] || "src-tauri/target/release/bundle/macos/QuoDex.app/Contents/MacOS/codex-credits-view");
const app = spawn(executable, [], { stdio: "inherit", env: { ...process.env,
  CODEX_SQLITE_HOME: home, CODEX_CREDITS_CONFIG_DIR: config, ZCODE_DATA_BASE_DIR: zcode,
  QUODEX_TASK_IPC_ENDPOINT: endpoint, CODEX_CREDITS_APP_SERVER_EXECUTABLE: process.execPath,
  CODEX_CREDITS_APP_SERVER_ARGS: JSON.stringify([path.resolve("fixtures/app-server-fixture.mjs")]),
} });
console.log(JSON.stringify({ pid: app.pid, executable, dataDirectory: root }));
app.on("error", error => { console.error(`QDI-002: launch failed: ${error.message}`); server.close(); });
app.on("exit", code => { state.close(); history.close(); server.close(); process.exitCode = code ?? 0; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => app.kill("SIGTERM"));
