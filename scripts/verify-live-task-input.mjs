// Read-only task hover verification against an already running user installation.
// Real chat labels are used only in memory; evidence records geometry and counts.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const pid=Number(process.argv[2]);
assert(Number.isInteger(pid)&&pid>0,"QWI-150: provide the running QuoDex process ID");
const output=path.resolve(process.env.QUODEX_INPUT_REVIEW_DIR||".scratch/windows-input/live");
await mkdir(output,{recursive:true});
const root=await mkdtemp(path.join(output,"receiver-"));
const pwsh=execFileSync("where.exe",["pwsh.exe"],{encoding:"utf8"}).trim().split(/\r?\n/)[0];
const nativeScript=path.resolve("scripts/task-status-native.ps1");
const request=value=>Buffer.from(JSON.stringify(value)).toString("base64");
const bridge=(op,extra={})=>{
  let output;
  try {
    output=execFileSync(pwsh,["-NoProfile","-File",nativeScript,"-RequestBase64",request({pid,op,...extra})],{encoding:"utf8",windowsHide:true,stdio:["ignore","pipe","pipe"]});
  } catch(error) {
    // Child diagnostics can contain a real task label. Report the boundary and
    // actionable reason without copying that private label into the test log.
    const diagnostic=String(error.stderr||"");
    if(diagnostic.includes("Button not found"))throw new Error("QWI-156: task changed before hover; rerun while a visible task is stable");
    if(diagnostic.includes("Native window not available"))throw new Error("QWI-157: show the running QuoDex window before verification");
    throw new Error(`QWI-158: Windows native ${op} command failed (exit ${error.status ?? error.code}); verify the process is running in this desktop session`);
  }
  try { return JSON.parse(output); }
  catch { throw new Error(`QWI-159: native ${op} command returned invalid JSON`); }
};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(test,label) {
  const deadline=Date.now()+15000;
  while(Date.now()<deadline) { const data=bridge("read"); if(test(data))return data; await pause(150); }
  throw new Error(`QWI-151: ${label}`);
}
const initial=bridge("read");
const clickPath=path.join(root,"clicks.json");
const readyPath=path.join(root,"ready.json");
const backdrop=spawn(pwsh,["-NoProfile","-File",nativeScript,"-RequestBase64",request({op:"background",readyPath,clickPath})],{windowsHide:true});
const samples=[];
try {
  let ready;
  for(let attempt=0;attempt<50;attempt++) { try { ready=JSON.parse(await readFile(readyPath,"utf8")); if(ready.visible)break; }catch{} await pause(100); }
  assert(ready?.visible,"QWI-152: native click receiver must be visible");
  const count=async()=>JSON.parse(await readFile(clickPath,"utf8")).count;
  const controlBefore=await count();
  bridge("clickPoint",{x:initial.x-30,y:initial.y-30,delayMs:0});
  await pause(200);
  assert.equal(await count(),controlBefore+1,"QWI-153: unobstructed control click must reach the receiver");
  const isTask=item=>/ · (运行中|等待你操作|执行报错|状态未知|已完成 · \d+ 分钟前)$/.test(item.name);
  await waitFor(data=>data.buttonBounds.some(isTask),"actual tasks did not become available");
  for(let cycle=1;cycle<=2;cycle++) {
    const data=bridge("read");
    const task=data.buttonBounds.find(isTask);
    assert(task,"QWI-154: an actual task must be available for the hover check");
    bridge("hover",{name:task.name});
    const opened=await waitFor(next=>next.names.includes("聊天详情"),"actual task details did not open");
    bridge("leave");
    const closed=await waitFor(next=>!next.names.includes("聊天详情"),"actual task details did not close");
    const point={x:opened.x+Math.floor(opened.width/2),y:opened.y+20};
    const before=await count();
    bridge("clickPoint",{...point,delayMs:0});
    await pause(200);
    const after=await count();
    samples.push({cycle,point,closedSize:{width:closed.width,height:closed.height},before,after,passed:after===before+1});
  }
  const result={status:samples.every(sample=>sample.passed)?"Verified":"Blocked",scenario:"actual local tasks: hover detail, leave, first transparent-area click",version:initial.version,executableSha256:createHash("sha256").update(await readFile(initial.executable)).digest("hex"),dpi:initial.dpi,samples,privacy:"No chat names, identifiers, account data, or task payloads recorded."};
  await writeFile(path.join(output,"result.json"),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
  assert(samples.every(sample=>sample.passed),"QWI-155: actual-task transparent-area first click did not reach the native receiver");
} finally {
  backdrop.kill();
  bridge("zorder",{topmost:initial.topmost});
  bridge("movePoint",initial.cursor);
}
