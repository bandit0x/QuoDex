// Native release smoke: real SQLite -> Desktop-shaped pipe -> Rust commands -> production UI.
// Fictional chats only. No browser entry, React mocks, or frontend state injection.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
const executable = path.resolve(process.env.QUODEX_EXECUTABLE || "src-tauri/target/release/codex-credits-view.exe");
const output = path.resolve(process.env.QUODEX_TASK_REVIEW_DIR || ".impeccable/review/task-status");
await mkdir(output, { recursive: true });
await mkdir(".scratch", { recursive: true });
const root = await mkdtemp(path.resolve(".scratch/task-status-native-"));
const home = path.join(root, "codex");
const config = path.join(root, "config");
await mkdir(home); await mkdir(config);
await writeFile(path.join(config, "display-preferences.json"), JSON.stringify({ opacity: .92, reducedMotion: false, source: "codex", x: 400, y: 500 }));
const state = new DatabaseSync(path.join(home, "state_5.sqlite"));
state.exec("CREATE TABLE threads(id TEXT,title TEXT,source TEXT,originator TEXT,archived INTEGER,updated_at INTEGER); CREATE TABLE thread_spawn_edges(child_thread_id TEXT);");
const history = new DatabaseSync(path.join(home, "thread_history_1.sqlite"));
history.exec("CREATE TABLE thread_turns(thread_id TEXT,turn_id TEXT,status TEXT,started_at INTEGER,completed_at INTEGER,error_json TEXT,rollout_ordinal INTEGER);");
const endpoint = `\\\\.\\pipe\\quodex-native-${randomUUID()}`;
const connections = new Set();
let chats = [];
let revision = 0;
const methods = new Set();
const errors = [];
const checks = [];
const screenshots = [];
let nativePid;
let nativeProcess;
const send = (socket, message) => {
  const bytes = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4); header.writeUInt32LE(bytes.length);
  socket.write(Buffer.concat([header, bytes]));
};
const emit = (socket, chat) => send(socket, {
  type: "broadcast", method: "thread-stream-state-changed", version: 11,
  sourceClientId: "fixture-owner", targetClientIds: ["fixture-observer"],
  params: { hostId: "local", conversationId: chat.id, change: { type: "snapshot", revision: ++revision,
    conversationState: { id: chat.id, title: chat.title, requests: [], turns: [],
      threadRuntimeStatus: { type: ["running", "waiting", "unknown"].includes(chat.status) ? "active" : "idle", activeFlags: chat.status === "waiting" ? ["waitingOnUserInput"] : chat.status === "unknown" ? ["unsupportedFlag"] : [] },
      turnHistory: { kind: "canonical", history: { entitiesByKey: { latest: { turnId: chat.turnId, status: ["running", "waiting"].includes(chat.status) ? "inProgress" : chat.status === "cancelled" ? "interrupted" : chat.status, turnStartedAtMs: chat.started * 1000 } }, islands: [] } },
    },
  } },
});
const server = createServer(socket => {
  socket.followed = new Set(); connections.add(socket);
  socket.on("close", () => connections.delete(socket));
  socket.on("error", error => errors.push(`fixture pipe: ${error.code}`));
  let buffer = Buffer.alloc(0);
  socket.on("data", chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const size = buffer.readUInt32LE(); if (buffer.length < size + 4) break;
      const message = JSON.parse(buffer.subarray(4, size + 4)); buffer = buffer.subarray(size + 4);
      methods.add(message.method || message.type);
      if (message.method === "initialize") send(socket, { type: "response", method: "initialize", requestId: message.requestId, resultType: "success", result: { clientId: "fixture-observer" } });
      else if (message.method === "thread-owner-discovery") send(socket, { type: "response", method: message.method, requestId: message.requestId, resultType: "success", handledByClientId: "fixture-owner", result: {} });
      else if (message.method === "thread-stream-following-changed") {
        const id = message.params.conversationId;
        if (!message.params.following) socket.followed.delete(id);
        else { socket.followed.add(id); const chat = chats.find(chat => chat.id === id); if (chat) emit(socket, chat); }
      } else if (message.type !== "client-discovery-response") errors.push(`unauthorized fixture method: ${message.method}`);
    }
  });
});
await new Promise(resolve => server.listen(endpoint, resolve));

function setChats(statuses, age = 10) {
  state.exec("DELETE FROM threads;"); history.exec("DELETE FROM thread_turns;");
  const seconds = Math.floor(Date.now() / 1000);
  chats = statuses.map((status, index) => {
    const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    const ended = seconds - age * 60;
    const chat = { id, title: ["整理项目文档", "修复窗口布局", "更新发布说明"][index] || `示例聊天 ${index + 1}`, turnId: `turn-${index}`, status, started: ended - 60 };
    state.prepare("INSERT INTO threads VALUES(?,?,'vscode','Codex Desktop',0,?)").run(id, chat.title, seconds);
    history.prepare("INSERT INTO thread_turns VALUES(?,?,?,?,?,?,1)").run(id, chat.turnId, status === "cancelled" ? "interrupted" : status, chat.started, ["completed", "failed"].includes(status) ? ended : null, status === "failed" ? JSON.stringify({ message: "示例网络超时；请打开聊天重试" }) : null);
    return chat;
  });
  for (const socket of connections) for (const chat of chats) if (socket.followed.has(chat.id)) emit(socket, chat);
}

const pwsh = process.env.QUODEX_PWSH || execFileSync("where.exe", ["pwsh.exe"], { encoding: "utf8" }).trim().split(/\r?\n/)[0];
const bridgePath = path.resolve("scripts/task-status-native.ps1");
const bridge = (op, extra = {}) => JSON.parse(execFileSync(pwsh, ["-NoProfile", "-File", bridgePath, "-RequestBase64", Buffer.from(JSON.stringify({ pid: nativePid, op, ...extra })).toString("base64")], { encoding: "utf8", windowsHide: true }).trim());
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function waitFor(test, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { const data = bridge("read"); if (test(data)) return data; await pause(150); }
  const data = bridge("read");
  await writeFile(path.join(root,"last-ui.json"), JSON.stringify(data,null,2));
  bridge("capture",{path:path.join(root,"failure.png")});
  throw new Error(`Native check failed: ${label}; see ${root}/last-ui.json`);
}
async function start(scenario = "healthy") {
  nativeProcess = spawn(executable, [], { windowsHide: true, env: {
    ...process.env, CODEX_SQLITE_HOME: home, CODEX_HOME: home, CODEX_CREDITS_CONFIG_DIR: config,
    USERPROFILE: root, APPDATA: path.join(root, "Roaming"), LOCALAPPDATA: path.join(root, "Local"),
    QUODEX_TASK_IPC_ENDPOINT: endpoint,
    CODEX_CREDITS_APP_SERVER_EXECUTABLE: process.execPath,
    CODEX_CREDITS_APP_SERVER_ARGS: JSON.stringify([path.resolve("fixtures/app-server-fixture.mjs")]),
    CODEX_CREDITS_FIXTURE_SCENARIO: scenario, WEBVIEW2_USER_DATA_FOLDER: path.join(root, `webview-${randomUUID()}`),
  } });
  nativePid = nativeProcess.pid; nativeProcess.stderr.on("data", () => {});
  await pause(1800);
  await waitFor(data => data.buttons.includes("展开重置详情"), "production window startup");
  bridge("position");
}
async function stop() {
  if (nativeProcess && nativeProcess.exitCode === null) { nativeProcess.kill(); await new Promise(resolve => nativeProcess.once("exit",resolve)); }
  nativePid = null; await pause(300);
}
async function dimensions(height) { return waitFor(data => data.height === height, `native height ${height}`); }
async function capture(name) {
  await pause(300);
  const filename = `${name}.png`; bridge("capture", { path: path.join(output, filename) }); screenshots.push(filename);
}
async function button(name, op = "click") { await waitFor(data => data.buttons.includes(name), name); const result=bridge(op,{name}); await writeFile(path.join(root,op==="hover"?"hover-trace.json":"click-trace.json"),JSON.stringify(result,null,2)); }
async function settingsRoundTrip() {
  await button("展开重置详情"); await dimensions(196);
  await button("设置"); await dimensions(356); await capture("settings-windows");
  await button("关闭设置"); await dimensions(196); await pause(300);
  await button("收起重置详情"); await dimensions(166);
}
const background = spawn(pwsh,["-NoProfile","-File",bridgePath,"-RequestBase64",Buffer.from(JSON.stringify({op:"background"})).toString("base64")],{windowsHide:true});
const shortcutBackup = path.join(root,"original-QuoDex.lnk");
const shortcut = bridge("shortcut",{action:"save",backup:shortcutBackup});
try {
  setChats(["running", "running", "completed"]); await start();
  if(process.argv.includes("--layout-only")) {
    await settingsRoundTrip();
    setChats(["completed"],29);
    await waitFor(data => data.buttons.some(name => name.endsWith("29 分钟前")), "29m after settings");
    await pause(1000);
    const data = bridge("read");
    await writeFile(path.join(root,"layout-repro.json"),JSON.stringify(data,null,2));
    await capture("age-29m-windows");
    const task = data.buttonBounds.find(button => button.name.endsWith("29 分钟前"));
    assert(task.y >= data.y && task.y + task.height <= data.y + data.height, "task circle must remain within the native viewport after settings closes");
    checks.push("native task bounds after settings and source update");
  } else if(process.argv.includes("--settings-only")) {
    await settingsRoundTrip();
    checks.push("minimal native settings round trip with task row");
  } else {
  await waitFor(data => data.buttons.some(name => name.endsWith("10 分钟前")), "10m completed circle");
  assert.equal(bridge("read").buttons.filter(name => name.endsWith("运行中")).length,2);
  await dimensions(166); await capture("compact-daily-windows");
  checks.push("native release startup, two active chats and actual persisted ten-minute finish; 300x166 window");
  const pulse=bridge("pulse",{name:"整理项目文档 · 运行中",path:output,samples:61,saveAll:true}).pulse;
  assert(Math.max(...pulse.map(frame=>frame.greenMean))-Math.min(...pulse.map(frame=>frame.greenMean))>1);
  await writeFile(path.join(output,"pulse.json"),JSON.stringify(pulse,null,2));
  checks.push("native water pixels change across multiple 2.8-second breaths and changing waves; measured frame times in pulse.json and flow frames");
  await button("整理项目文档 · 运行中", "hover"); await dimensions(326); await capture("hover-windows");
  bridge("escape"); await dimensions(166);
  setChats(["waiting", "failed", "unknown"]);
  await waitFor(data => data.buttons.some(name => name.endsWith("等待你操作")), "waiting source"); await capture("attention-windows");
  await button("修复窗口布局 · 执行报错", "hover"); await dimensions(326); await capture("failure-details-windows");
  await button("移除提醒"); bridge("escape"); await dimensions(166);
  assert(!bridge("read").buttons.some(name => name.endsWith("执行报错")));
  checks.push("waiting, failure and unknown; actual native dismissal command");
  await stop(); await start();
  assert(!bridge("read").buttons.some(name => name.endsWith("执行报错")));
  checks.push("failure dismissal persists after native restart");
  setChats(Array(10).fill("completed"));
  await waitFor(data => data.buttons.filter(name => name.includes("已完成 ·")).length === 10, "ten slots"); await capture("ten-slots-windows");
  setChats(Array(13).fill("completed")); await button("其余 4 个聊天"); await dimensions(326); await capture("overflow-windows");
  assert.equal(bridge("read").buttons.filter(name => name.includes("已完成 ·")).length,13);
  bridge("escape"); await dimensions(166);
  checks.push("ten slots; nine + ellipsis; four remaining native list buttons");
  setChats(Array(13).fill("completed"),29); await button("其余 4 个聊天"); await dimensions(326); await capture("overflow-29m-windows");
  bridge("escape"); await dimensions(166);
  setChats(["completed"],0); await waitFor(data=>data.buttons.some(name=>name.endsWith("0 分钟前")),"0m"); await capture("age-0m-windows");
  setChats(Array(10).fill("running")); await waitFor(data=>data.buttons.filter(name=>name.endsWith("运行中")).length===10,"ten running circles"); await capture("ten-running-windows");
  checks.push("0m and overflow29m native layouts; ten simultaneous water circles");
  await button("展开重置详情"); await dimensions(196);
  await button("收起为窄条"); await dimensions(84); await capture("narrow-windows");
  await button("恢复标准视图"); await dimensions(166);
  await settingsRoundTrip();
  checks.push("expanded, narrow and settings native dimensions and round trip");
  setChats(["completed"],29); await waitFor(data => data.buttons.some(name => name.endsWith("29 分钟前")), "29m");
  const aged = bridge("read");
  const agedCircle = aged.buttonBounds.find(button => button.name.endsWith("29 分钟前"));
  assert(agedCircle.y >= aged.y && agedCircle.y + agedCircle.height <= aged.y + aged.height, "completed task remains inside native viewport after settings");
  await capture("age-29m-windows");
  setChats(["completed"],30); await dimensions(130); await capture("empty-windows");
  checks.push("29m visible, actual finish +30m expires and original130 height restored");
  setChats(["cancelled"]); await pause(2300); assert.equal(bridge("read").height,130);
  checks.push("cancelled chat absent");
  setChats(["running"]); await waitFor(data => data.buttons.some(name => name.endsWith("运行中")),"active before disconnect");
  for (const socket of connections) socket.destroy();
  await waitFor(data => !data.buttons.some(name => name.endsWith("运行中")),"disconnect invalidates running");
  checks.push("disconnect invalidates active circle");
  await stop(); setChats(["running","completed"]); await start("pro-weekly"); await dimensions(166); await capture("pro-windows");
  checks.push("Pro quota material retains independent chat row");
  }
  assert.deepEqual(errors,[]);
  assert([...methods].every(method => ["initialize", "thread-owner-discovery", "thread-stream-following-changed", "client-discovery-response"].includes(method)));
  const result = {status:"Verified",executable,sha256:createHash("sha256").update(await readFile(executable)).digest("hex"),environment:"Windows native release + real window API/UI Automation; isolated SQLite and Desktop-protocol fixture; no browser preview or injected frontend state; plain native verification backdrop",checks,screenshots,errors,methods:[...methods],limitations:["Fixture does not prove live Desktop waiting requests or chat navigation."]};
  await writeFile(path.join(output,"result.json"),JSON.stringify(result,null,2)); console.log(JSON.stringify(result));
} finally {
  await stop(); bridge("shortcut",{action:"restore",backup:shortcutBackup,existed:shortcut.exists,executable}); background.kill(); for(const socket of connections)socket.destroy(); await new Promise(resolve=>server.close(resolve)); state.close();history.close();
}
