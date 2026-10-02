// Native release smoke: real SQLite -> Desktop-shaped pipe -> Rust commands -> production UI.
// Fictional chats only. No browser entry, React mocks, or frontend state injection.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, copyFile } from "node:fs/promises";
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
let zcodeRuntime;
let zcodeIndex;
let zcodeAgent;
let projectProtocolInstalled=false;
const protocolScript=path.resolve("scripts/task-project-protocol.ps1");
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
    USERPROFILE: root, ZCODE_DATA_BASE_DIR: root, APPDATA: path.join(root, "Roaming"), LOCALAPPDATA: path.join(root, "Local"),
    CODEX_CREDITS_ZCODE_QUOTA_RESPONSE_FILE:path.resolve("fixtures/zcode-quota-fixture.json"),
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
async function button(name, op = "click") { await waitFor(data => data.buttons.includes(name), name); const result=bridge(op,{name,movePointerAway:op==="click" && name==="关闭设置"}); await writeFile(path.join(root,op==="hover"?"hover-trace.json":"click-trace.json"),JSON.stringify(result,null,2)); }
async function measureCpu() {
  const before=bridge("cpu"), started=Date.now(); await pause(6000); const after=bridge("cpu");
  return {cpuSeconds:after.cpuSeconds-before.cpuSeconds,wallSeconds:(Date.now()-started)/1000,processesBefore:before.processCount,processesAfter:after.processCount,scope:"owned app and descendants, including quota animation and backend; not isolated renderer cost"};
}
async function toggleReducedMotion() {
  await button("展开重置详情"); await dimensions(196); await button("设置"); await dimensions(356);
  bridge("toggle",{name:"减少动效"}); await button("关闭设置"); await dimensions(196); await button("收起重置详情"); await dimensions(166);
}
const brightTravel = frames => Math.max(...frames.map(frame=>Math.hypot(frame.brightX-frames[0].brightX,frame.brightY-frames[0].brightY)));
async function settingsRoundTrip() {
  await button("展开重置详情"); await dimensions(196);
  await button("设置"); await dimensions(356); await capture("settings-windows");
  await button("关闭设置"); await dimensions(196); await pause(300);
  await button("收起重置详情"); await dimensions(166);
}
const background = spawn(pwsh,["-NoProfile","-File",bridgePath,"-RequestBase64",Buffer.from(JSON.stringify({op:"background"})).toString("base64")],{windowsHide:true});
const shortcutBackup = path.join(root,"original-QuoDex.lnk");
const shortcut = bridge("shortcut",{action:"save",backup:shortcutBackup});
const protocol = action => JSON.parse(execFileSync(pwsh,["-NoProfile","-File",protocolScript,"-Action",action,"-Root",root],{encoding:"utf8",windowsHide:true}));
async function setZcodeChats(statuses,age=10) {
  if(!zcodeIndex) {
    const zhome=path.join(root,".zcode");
    await mkdir(path.join(zhome,"v2"),{recursive:true}); await mkdir(path.join(zhome,"cli/db"),{recursive:true});
    zcodeIndex=new DatabaseSync(path.join(zhome,"v2/tasks-index.sqlite"));
    zcodeAgent=new DatabaseSync(path.join(zhome,"cli/db/db.sqlite"));
    zcodeIndex.exec("CREATE TABLE tasks(workspace_key TEXT,workspace_path TEXT,workspace_identity TEXT,task_id TEXT,title TEXT,task_status TEXT,deleted INTEGER,meta_json TEXT);");
    zcodeAgent.exec("CREATE TABLE session(id TEXT,parent_id TEXT,task_type TEXT); CREATE TABLE turn_usage(session_id TEXT,turn_id TEXT,status TEXT,started_at INTEGER,completed_at INTEGER,error_code TEXT); CREATE TABLE message(id TEXT,session_id TEXT,time_created INTEGER,data TEXT); CREATE TABLE part(id TEXT,message_id TEXT,session_id TEXT,time_updated INTEGER,data TEXT);");
  }
  zcodeIndex.exec("DELETE FROM tasks;");zcodeAgent.exec("DELETE FROM session;DELETE FROM turn_usage;DELETE FROM message;DELETE FROM part;");
  const now=Date.now();
  for(const [index,status]of statuses.entries()) {
    const id=`ses-example-${index}`,title=`项目任务 ${index+1}`,project=path.join(root,`示例 项目 ${index+1}`);
    await mkdir(project,{recursive:true});
    zcodeIndex.prepare("INSERT INTO tasks VALUES(?,?,NULL,?,?,?,0,'{}')").run(project,project,id,title,status==="failed"?"error":"completed");
    zcodeAgent.prepare("INSERT INTO session VALUES(?,NULL,'interactive')").run(id);
    zcodeAgent.prepare("INSERT INTO turn_usage VALUES(?,?,?, ?,?,NULL)").run(id,`turn-${index}`,status==="waiting"||status==="permission"?"running":status==="failed"?"error":status,now,["completed","failed","cancelled"].includes(status)?now-age*60000:null);
    if(status==="waiting"||status==="permission") {
      zcodeAgent.prepare("INSERT INTO message VALUES(?,?,?,'{}')").run(`message-${index}`,id,now);
      zcodeAgent.prepare("INSERT INTO part VALUES(?,?,?,?,?)").run(`part-${index}`,`message-${index}`,id,now,JSON.stringify({type:"tool",tool:status==="waiting"?"AskUserQuestion":"Bash",state:{status:"pending"}}));
    }
  }
}
try {
  setChats(["running", "running", "completed"]); await start();
  if(process.argv.includes("--mixed-only")) {
    // OS-shaped runtime fixture; never claim this is a real ZCode execution.
    const runtimeExe=path.join(root,"ZCode.exe");await copyFile(process.execPath,runtimeExe);
    zcodeRuntime=spawn(runtimeExe,["-e","setInterval(()=>{},1000)"],{windowsHide:true});await pause(250);
    setChats(["running","completed"]);await setZcodeChats(["running","completed","waiting","failed","permission","cancelled"]);
    await waitFor(data=>data.buttons.includes("项目任务 1 · 运行中")&&data.buttons.includes("项目任务 3 · 等待你操作"),"mixed source tasks");
    assert(bridge("read").buttons.includes("整理项目文档 · 运行中"));
    assert(!bridge("read").buttons.some(name=>name.startsWith("项目任务 6")));
    await dimensions(166);await capture("mixed-codex-quota-windows");
    await button("展开重置详情");await dimensions(196);await button("设置");await dimensions(356);
    await button("Zcode");await button("关闭设置");await dimensions(196);await button("收起重置详情");await dimensions(166);
    await waitFor(data=>data.texts.includes("ZCode"),"ZCode quota selected");
    assert(bridge("read").buttons.includes("整理项目文档 · 运行中"));assert(bridge("read").buttons.includes("项目任务 1 · 运行中"));
    await capture("mixed-zcode-quota-windows");checks.push("both applications mixed under both quota selections; cancellation removed; waiting question and unknown permission shown");
    await button("项目任务 2 · 已完成 · 10 分钟前","hover");await dimensions(326);await capture("project-details-windows");
    assert(bridge("read").texts.includes("点击圆圈打开项目"));bridge("escape");await dimensions(166);
    const installed=protocol("install");projectProtocolInstalled=installed.installed;assert(projectProtocolInstalled);
    await button("项目任务 2 · 已完成 · 10 分钟前");
    let launched;for(let attempt=0;attempt<30;attempt++){try{launched=JSON.parse(await readFile(path.join(root,"project-launch.json"),"utf8"));break;}catch{await pause(150);}}
    assert(launched,"native project dispatch delivered");const url=new URL(launched.url);assert.equal(url.protocol,"zcode:");assert.equal(url.hostname,"workspace");assert.equal(url.searchParams.get("path"),path.join(root,"示例 项目 2"));
    await writeFile(path.join(output,"project-dispatch.json"),JSON.stringify({protocol:url.protocol,host:url.hostname,path:url.pathname,ownedProjectDecodedCorrectly:true},null,2));
    assert(protocol("restore").restored);projectProtocolInstalled=false;checks.push("real native circle click reaches OS protocol handler with correctly encoded owned project path; handler restored");
    await button("项目任务 4 · 执行报错","hover");await button("移除提醒");bridge("escape");await pause(1300);assert(!bridge("read").buttons.includes("项目任务 4 · 执行报错"));
    await stop();await start();assert(!bridge("read").buttons.includes("项目任务 4 · 执行报错"));checks.push("ZCode failure reminder dismisses through shared command and stays dismissed across restart");
    setChats(Array(5).fill("running"));await setZcodeChats(Array(8).fill("completed"));await button("其余 4 个聊天");await dimensions(326);await capture("mixed-overflow-windows");
    assert.equal(bridge("read").buttons.filter(name=>name.includes("分钟前")).length,8);bridge("escape");checks.push("mixed 13 chats use nine circles plus ellipsis; all remaining ZCode entries accessible");
    setChats(["running"]);await setZcodeChats(["running"]);await waitFor(data=>data.buttons.includes("项目任务 1 · 运行中"),"ZCode running before Codex loss");for(const socket of connections)socket.destroy();
    await waitFor(data=>!data.buttons.includes("整理项目文档 · 运行中")&&data.buttons.includes("项目任务 1 · 运行中"),"Codex failure isolated");await capture("codex-disconnected-zcode-running-windows");checks.push("Codex disconnect never invalidates ZCode execution");
    zcodeAgent.exec("ALTER TABLE turn_usage RENAME TO unavailable;");await waitFor(data=>data.buttons.includes("项目任务 1 · 状态未知"),"ZCode schema loss unknown");zcodeAgent.exec("ALTER TABLE unavailable RENAME TO turn_usage;");await waitFor(data=>data.buttons.includes("项目任务 1 · 运行中"),"ZCode recovers");checks.push("ZCode source failure invalidates only its source and recovers");
    zcodeRuntime.kill();await new Promise(resolve=>zcodeRuntime.once("exit",resolve));zcodeRuntime=null;await waitFor(data=>data.buttons.includes("项目任务 1 · 状态未知"),"stopped ZCode runtime unknown");checks.push("OS runtime disappearance stops ZCode water animation");
    setChats([]);await setZcodeChats(["completed"],30);await dimensions(130);await capture("mixed-empty-windows");checks.push("expired ZCode success restores original cockpit height");
  } else if(process.argv.includes("--layout-only")) {
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
  const taskLayout = bridge("read");
  const firstRunning = taskLayout.buttonBounds.find(button=>button.name.endsWith("运行中"));
  const circleCenterY = firstRunning.y-taskLayout.y+firstRunning.height/2;
  const visibleGap = 47-circleCenterY-20.4/2;
  assert(Math.abs(visibleGap-7.4)<1,"visible task-to-cockpit gap must be half the previous 14.8px gap");
  await writeFile(path.join(output,"layout-metrics.json"),JSON.stringify({circleCenterY,quotaShellTop:47,visibleCircleDiameter:20.4,visibleGap,targetGap:7.4,previousGap:14.8,nativeRoundingTolerance:1},null,2));
  checks.push("native release startup, two active chats and actual persisted ten-minute finish; 300x166 window");
  const pulse=bridge("pulse",{name:"整理项目文档 · 运行中",path:output,samples:61,saveAll:true}).pulse;
  await writeFile(path.join(root,"motion-boundary.json"),JSON.stringify(bridge("read"),null,2));
  await writeFile(path.join(output,"pulse.json"),JSON.stringify(pulse,null,2));
  assert(pulse.every(frame=>frame.ringPixels>0 && frame.brightWeight>0),"native water rim must have visible moving highlights");
  assert(Math.max(...pulse.map(frame=>frame.greenMean))-Math.min(...pulse.map(frame=>frame.greenMean))>1);
  assert(brightTravel(pulse)>2,"water crest must travel along the edge, not merely fade in place");
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
  const activeCpu=await measureCpu();
  await toggleReducedMotion(); await capture("reduced-motion-windows");
  const reduced=bridge("pulse",{name:"整理项目文档 · 运行中",path:root,samples:15}).pulse;
  assert(brightTravel(reduced)<1.5,"reduced motion must keep water position stable while breathing");
  await writeFile(path.join(output,"reduced-motion.json"),JSON.stringify(reduced,null,2));
  await toggleReducedMotion();
  setChats(Array(10).fill("completed")); await waitFor(data=>data.buttons.filter(name=>name.includes("已完成 ·")).length===10,"static baseline");
  const staticCpu=await measureCpu(); await writeFile(path.join(output,"performance.json"),JSON.stringify({tenRunning:activeCpu,tenCompleted:staticCpu},null,2));
  checks.push("native reduced-motion setting holds water position; aggregate app CPU samples with ten running and ten completed chats");
  checks.push("0m and overflow29m native layouts; ten simultaneous water circles");
  await button("展开重置详情"); await dimensions(196);
  await button("收起为窄条"); await dimensions(84); await capture("narrow-windows");
  const narrowLayout = bridge("read");
  const firstNarrow = narrowLayout.buttonBounds.find(button=>button.name.includes("已完成 ·"));
  const narrowGap = 40-(firstNarrow.y-narrowLayout.y+firstNarrow.height/2)-20.4/2;
  assert(Math.abs(narrowGap-3.9)<1,"narrow task-to-cockpit gap must be half the previous 7.8px gap");
  checks.push("visible task-to-cockpit gap halved in compact and narrow layouts, measured from native hit-target centers");
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
  const mixed = process.argv.includes("--mixed-only");
  const result = {status:"Verified",executable,sha256:createHash("sha256").update(await readFile(executable)).digest("hex"),environment:"Windows native release + real window API/UI Automation; isolated SQLite and Desktop-protocol fixture; no browser preview or injected frontend state; plain native verification backdrop",checks,screenshots,errors,methods:[...methods],limitations:mixed ? ["ZCode execution metadata and ZCode.exe process are fixtures, not a real active ZCode turn.","Project click reaches a temporary OS protocol capture handler; the original registered handler is restored. This does not prove a real ZCode project window opened.","Ordinary pending tools remain unknown because the persisted format cannot distinguish queuing from approval."] : ["Fixture does not prove live Desktop waiting requests or chat navigation."]};
  await writeFile(path.join(output,"result.json"),JSON.stringify(result,null,2)); console.log(JSON.stringify(result));
} finally {
  try {
    if(projectProtocolInstalled)assert(protocol("restore").restored);
  } finally {
    zcodeRuntime?.kill();zcodeIndex?.close();zcodeAgent?.close();
    await stop();
    try { bridge("shortcut",{action:"restore",backup:shortcutBackup,existed:shortcut.exists,executable}); }
    finally { background.kill();for(const socket of connections)socket.destroy();await new Promise(resolve=>server.close(resolve));state.close();history.close(); }
  }
}
