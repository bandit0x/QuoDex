"""Launch the real packaged app with isolated local protocol and SQLite fixtures."""
import argparse,os,json,sqlite3,socket,struct,threading,subprocess,time,tempfile,shutil,plistlib
from pathlib import Path
repo=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--app',type=Path,default=repo/'release/macos/QuoDex.app')
parser.add_argument('--output',type=Path,default=repo/'.scratch/task-source-design')
parser.add_argument('--empty',action='store_true')
parser.add_argument('--tasks-per-source',type=int,help='Anonymous task count for each source (1–99)')
parser.add_argument('--common-diagnostic',action='store_true')
parser.add_argument('--y',type=int,default=800,help='Initial physical desktop Y coordinate')
parser.add_argument('--launch-services',action='store_true',help='Launch an independently identified QA bundle for native UI automation')
args=parser.parse_args()
if args.tasks_per_source is not None and not 1 <= args.tasks_per_source <= 99:parser.error('--tasks-per-source must be between 1 and 99')
out=args.output;out.mkdir(parents=True,exist_ok=True)
node=shutil.which('node')
if not node:parser.error('Node must be available on PATH')
root=Path(tempfile.mkdtemp(prefix='qdx-caps-'))
(root/'config').mkdir();(root/'.zcode/v2').mkdir(parents=True);(root/'.zcode/cli/db').mkdir(parents=True)
(root/'project').mkdir()
(root/'config/display-preferences.json').write_text(json.dumps({'opacity':.92,'reducedMotion':False,'x':700,'y':args.y,'source':'codex','zcodePlan':'coding'}))
if args.common_diagnostic:(root/'config/task-reminders.json').write_text('corrupted-test-fixture')
now=int(time.time()*1000)
state=sqlite3.connect(root/'state_5.sqlite');state.executescript('CREATE TABLE threads(id TEXT,title TEXT,source TEXT,originator TEXT,archived INTEGER,updated_at INTEGER); CREATE TABLE thread_spawn_edges(child_thread_id TEXT);')
history=sqlite3.connect(root/'thread_history_1.sqlite');history.executescript('CREATE TABLE thread_turns(thread_id TEXT,turn_id TEXT,status TEXT,started_at INTEGER,completed_at INTEGER,error_json TEXT,rollout_ordinal INTEGER);')
for i in range(0 if args.empty else args.tasks_per_source if args.tasks_per_source is not None else 6):
 state.execute('INSERT INTO threads VALUES(?,?,?, ?,0,?)',(f'codex-demo-{i}',f'示例任务 {i+1}','vscode','Codex Desktop',now//1000))
 history.execute('INSERT INTO thread_turns VALUES(?,?,?,?,?,?,1)',(f'codex-demo-{i}',f'turn-{i}','completed' if i>1 else 'inProgress',(now-130000)//1000,(now-120000)//1000 if i>1 else None,None))
state.commit();state.close();history.commit();history.close()
index=sqlite3.connect(root/'.zcode/v2/tasks-index.sqlite');index.executescript('CREATE TABLE tasks(workspace_key TEXT,workspace_path TEXT,workspace_identity TEXT,task_id TEXT,title TEXT,task_status TEXT,deleted INTEGER,meta_json TEXT);')
agent=sqlite3.connect(root/'.zcode/cli/db/db.sqlite');agent.executescript('CREATE TABLE session(id TEXT,parent_id TEXT,task_type TEXT); CREATE TABLE turn_usage(session_id TEXT,turn_id TEXT,status TEXT,started_at INTEGER,completed_at INTEGER,error_code TEXT); CREATE TABLE message(id TEXT,session_id TEXT,time_created INTEGER,data TEXT); CREATE TABLE part(id TEXT,message_id TEXT,session_id TEXT,time_updated INTEGER,data TEXT);')
zcode_states=['running','error','completed']
if args.tasks_per_source is not None:zcode_states=(zcode_states+['completed']*args.tasks_per_source)[:args.tasks_per_source]
for i,st in enumerate([] if args.empty else zcode_states):
 id=f'zcode-demo-{i}';index.execute('INSERT INTO tasks VALUES(?,?,NULL,?,?,?,0,?)',(str(root/'project'),str(root/'project'),id,f'示例项目任务 {i+1}',st,'{}'))
 agent.execute('INSERT INTO session VALUES(?,NULL,?)',(id,'interactive'));agent.execute('INSERT INTO turn_usage VALUES(?,?,?,?,?,NULL)',(id,f'turn-z-{i}',st,now-1000,now-500 if st!='running' else None))
index.commit();index.close();agent.commit();agent.close()
(root/'quota.json').write_text(json.dumps({'code':200,'success':True,'data':{'limits':[{'type':'CREDIT_LIMIT','unit':3,'number':5,'usage':2000,'currentValue':480,'remaining':1520,'percentage':24,'nextResetTime':now+7200000},{'type':'CREDIT_LIMIT','unit':6,'number':1,'usage':10000,'currentValue':5800,'remaining':4200,'percentage':58,'nextResetTime':now+86400000}],'level':'pro'}}))
(root/'resets.json').write_text(json.dumps({'code':0,'data':{'available_five_hour_resets':[{'expire_at':now+86400000}]*6,'available_week_resets':[{'expire_at':now+86400000}]*5}}))
endpoint=root/'ipc.sock';listener=socket.socket(socket.AF_UNIX);listener.bind(str(endpoint));listener.listen()
def send(c,m):
 raw=json.dumps(m).encode();c.sendall(struct.pack('<I',len(raw))+raw)
def serve(c):
 try:
  buf=bytearray()
  while True:
   data=c.recv(16384)
   if not data:break
   buf.extend(data)
   while len(buf)>=4:
    n=struct.unpack('<I',buf[:4])[0]
    if len(buf)<n+4:break
    m=json.loads(buf[4:n+4]);del buf[:n+4];method=m.get('method')
    if method=='initialize':send(c,{'type':'response','requestId':m['requestId'],'method':method,'resultType':'success','result':{'clientId':'observer'}})
    elif method=='thread-owner-discovery':send(c,{'type':'response','requestId':m['requestId'],'method':method,'resultType':'success','handledByClientId':'sample-owner','result':{}})
    elif method=='thread-stream-following-changed' and m['params']['following']:
     id=m['params']['conversationId'];i=int(id.rsplit('-',1)[1])
     with sqlite3.connect(root/'thread_history_1.sqlite') as db:
      row=db.execute('SELECT turn_id,status,started_at,completed_at FROM thread_turns WHERE thread_id=? ORDER BY rollout_ordinal DESC,started_at DESC LIMIT 1',(id,)).fetchone()
     if row is None:continue
     turn_id,status,started,ended=row;runtime='active' if status=='inProgress' else 'idle'
     turn={'turnId':turn_id,'status':status,'turnStartedAtMs':started*1000,'durationMs':(ended-started)*1000 if ended is not None else None}
     send(c,{'type':'broadcast','method':'thread-stream-state-changed','version':11,'sourceClientId':'sample-owner','targetClientIds':['observer'],'params':{'hostId':'local','conversationId':id,'change':{'type':'snapshot','revision':int(time.monotonic()*1000),'conversationState':{'id':id,'title':f'示例任务 {i+1}','requests':[],'threadRuntimeStatus':{'type':runtime,'activeFlags':['waitingOnUserInput'] if i==1 else []},'turns':[turn]}}}})
 except (ConnectionError,OSError):pass
 finally:c.close()
def accept():
 while True:
  c,_=listener.accept();threading.Thread(target=serve,args=(c,),daemon=True).start()
threading.Thread(target=accept,daemon=True).start()
fixture_env=dict(CODEX_CREDITS_CONFIG_DIR=str(root/'config'),CODEX_SQLITE_HOME=str(root),QUODEX_TASK_IPC_ENDPOINT=str(endpoint),ZCODE_DATA_BASE_DIR=str(root),CODEX_CREDITS_APP_SERVER_EXECUTABLE=node,CODEX_CREDITS_APP_SERVER_ARGS=json.dumps([str(repo/'fixtures/app-server-fixture.mjs')]),CODEX_CREDITS_ZCODE_QUOTA_RESPONSE_FILE=str(root/'quota.json'),CODEX_CREDITS_ZCODE_RESET_RESPONSE_FILE=str(root/'resets.json'))
env=dict(os.environ,**fixture_env)
app_path=args.app.resolve()
command=[str(app_path/'Contents/MacOS/codex-credits-view')]
if args.launch_services:
 qa_app=root/'QuoDex Settings QA.app'
 shutil.copytree(app_path,qa_app)
 plist_path=qa_app/'Contents/Info.plist'
 with plist_path.open('rb') as f:info=plistlib.load(f)
 info.update(CFBundleIdentifier='io.github.bandit.quodex.settingsqa',CFBundleName='QuoDex Settings QA',CFBundleDisplayName='QuoDex Settings QA',LSEnvironment=fixture_env)
 with plist_path.open('wb') as f:plistlib.dump(info,f)
 subprocess.run(['codesign','--force','--deep','--sign','-',str(qa_app)],check=True)
 app_path=qa_app
 command=['open','-n','-W','-a',str(app_path)]
with (out/'native-app.log').open('w') as f:
 app=subprocess.Popen(command,env=env,stdout=f,stderr=subprocess.STDOUT)
 (out/'native-ready.json').write_text(json.dumps({'pid':app.pid,'processKind':'launcher' if args.launch_services else 'app','root':str(root),'app':str(app_path),'fixture':True}))
 print(json.dumps({'pid':app.pid,'root':str(root)}),flush=True)
 try:app.wait()
 finally:
  if app.poll() is None:app.terminate();app.wait()
  listener.close();endpoint.unlink(missing_ok=True)
