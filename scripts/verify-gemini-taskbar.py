import argparse, base64, ctypes, datetime, json, os, pathlib, shutil, sqlite3, subprocess, tempfile, time, tkinter as tk
import win32api, win32con, win32gui, win32process
from PIL import ImageChops, ImageGrab

ctypes.windll.user32.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))
repo=pathlib.Path(__file__).resolve().parents[1]
exe=pathlib.Path(os.environ.get('QUODEX_EXECUTABLE', repo/'src-tauri/target/release/codex-credits-view.exe')).resolve()
out=pathlib.Path(os.environ.get('QUODEX_TASK_REVIEW_DIR', repo/'.scratch/gemini-taskbar-native')).resolve()
out.mkdir(parents=True, exist_ok=True)
root=pathlib.Path(tempfile.mkdtemp(prefix='quodex-orbs-'))
parser=argparse.ArgumentParser()
parser.add_argument('--reduced-motion',action='store_true',help='Verify a running task with the app motion preference enabled.')
options=parser.parse_args()
config=root/'config'
config.mkdir()
(config/'display-preferences.json').write_text(json.dumps(dict(source='codex',x=185,y=98,opacity=.96,alwaysOnTop=True,reducedMotion=options.reduced_motion)))
data=root/'.gemini/antigravity'
data.mkdir(parents=True)
stamp=datetime.datetime.now(datetime.timezone.utc).isoformat()
with sqlite3.connect(data/'conversation_summaries.db') as db:
    db.execute('CREATE TABLE conversation_summaries(conversation_id TEXT PRIMARY KEY,title TEXT,status TEXT,not_fully_idle INTEGER,last_user_input_time TEXT,last_user_input_step_index INTEGER,last_modified_time TEXT,parent_conversation_id TEXT,nesting_depth INTEGER,killed INTEGER)')
    db.executemany('INSERT INTO conversation_summaries VALUES(?,?,?,?,?,?,?,?,?,?)',[(f'10000000-0000-4000-8000-00000000000{i}',title,status,1,stamp,4,stamp,'',0,0) for i,(title,status) in enumerate([('匿名桌面运行','CASCADE_RUN_STATUS_RUNNING'),('匿名桌面等待','CASCADE_RUN_STATUS_WAITING_FOR_USER_INPUT'),('匿名桌面报错','CASCADE_RUN_STATUS_ERROR')])])
zcode=root/'.zcode'
(zcode/'v2').mkdir(parents=True)
(zcode/'cli/db').mkdir(parents=True)
with sqlite3.connect(zcode/'v2/tasks-index.sqlite') as index:
    index.execute('CREATE TABLE tasks(workspace_key TEXT,workspace_path TEXT,workspace_identity TEXT,task_id TEXT,title TEXT,task_status TEXT,deleted INTEGER,meta_json TEXT)')
    index.execute("INSERT INTO tasks VALUES('sample','sample',NULL,'ses-sample','匿名完成','completed',0,'{}')")
with sqlite3.connect(zcode/'cli/db/db.sqlite') as agent:
    agent.executescript("CREATE TABLE session(id TEXT,parent_id TEXT,task_type TEXT); CREATE TABLE turn_usage(session_id TEXT,turn_id TEXT,status TEXT,started_at INTEGER,completed_at INTEGER,error_code TEXT); CREATE TABLE message(id TEXT,session_id TEXT,time_created INTEGER,data TEXT); CREATE TABLE part(id TEXT,message_id TEXT,session_id TEXT,time_updated INTEGER,data TEXT);")
    agent.execute("INSERT INTO session VALUES('ses-sample',NULL,'interactive')")
    now=int(time.time()*1000)
    agent.execute("INSERT INTO turn_usage VALUES('ses-sample','turn-sample','completed',?,?,NULL)",(now-60000,now-5000))
app=None
back=None
cursor=win32api.GetCursorPos()
try:
    back=tk.Tk()
    back.overrideredirect(True)
    back.geometry('1050x710+0+0')
    back.configure(bg='#eff2f6')
    back.attributes('-topmost',True)
    back.update()
    env={**os.environ,'USERPROFILE':str(root),'WEBVIEW2_USER_DATA_FOLDER':str(root/'webview'),'CODEX_CREDITS_CONFIG_DIR':str(config),
        'CODEX_HOME':str(root/'codex'),'CODEX_SQLITE_HOME':str(root/'codex'),'QUODEX_TASK_IPC_ENDPOINT':r'\\.\pipe\quodex-prism-fixture-unavailable',
        'ZCODE_DATA_BASE_DIR':str(root),'APPDATA':str(root/'Roaming'),'LOCALAPPDATA':str(root/'Local'),
        'CODEX_CREDITS_HEALTH_ENDPOINT':'http://127.0.0.1:9/none','CODEX_CREDITS_COUNTRY_ENDPOINT':'http://127.0.0.1:9/none',
        'CODEX_CREDITS_APP_SERVER_EXECUTABLE':shutil.which('node.exe'),
        'CODEX_CREDITS_APP_SERVER_ARGS':json.dumps([str(repo/'fixtures/app-server-fixture.mjs')])}
    app=subprocess.Popen([str(exe)],env=env,creationflags=subprocess.CREATE_NO_WINDOW)
    def call(op='read',**kwargs):
        data=base64.b64encode(json.dumps(dict(pid=app.pid,op=op,**kwargs),ensure_ascii=False).encode()).decode()
        return json.loads(subprocess.check_output(['pwsh.exe','-NoProfile','-File',str(repo/'scripts/task-status-native.ps1'),'-RequestBase64',data],encoding='utf-8'))
    def ready(test):
        last={}
        for _ in range(26):
            try:
                back.update()
                last=call()
                if test(last):return last
            except subprocess.CalledProcessError: pass
            time.sleep(.3)
        raise RuntimeError(str(last))
    def find(contains):
        info=ready(lambda x:any(contains in b for b in x['buttons']))
        return next(b for b in info['buttons'] if contains in b)
    def click(contains):
        return call('click',name=find(contains))
    def grab_window(extra):
        l,t,r,b=win32gui.GetWindowRect(hwnd)
        dpi=ctypes.windll.user32.GetDpiForWindow(hwnd)/96
        return ImageGrab.grab(bbox=(l,b-round(extra*dpi),r,b),all_screens=True).convert('RGB')
    def capture(name,extra):
        back.update()
        time.sleep(.25)
        shot=grab_window(extra)
        shot.save(out/(name+'.png'))
        print(name,shot.size,flush=True)
    found=[]
    def visit(h,_):
        if win32process.GetWindowThreadProcessId(h)[1]==app.pid and win32gui.GetWindowText(h)=='QuoDex':found.append(h)
    for _ in range(60):
        win32gui.EnumWindows(visit,None)
        if found:break
        time.sleep(.2)
    hwnd=found[0]
    win32gui.SetWindowPos(hwnd,win32con.HWND_TOPMOST,215,92,0,0,win32con.SWP_NOSIZE|win32con.SWP_SHOWWINDOW)
    orb_name=find('查看 Gemini 全部')
    info=call()
    orbs=[item for item in info['buttonBounds'] if item['name'].startswith('查看 ') and ' 全部 ' in item['name']]
    assert len(orbs)==3, orbs
    assert all(abs(item['height']-item['width']) <= 1 for item in orbs)
    win32api.SetCursorPos((30,40))
    if options.reduced_motion:
        assert ' 3 个任务' in orb_name, orb_name
        item=next(b for b in orbs if b['name']==orb_name)
        x,y=round(item['x']),round(item['y'])
        bounds=(x,y,x+round(item['width']),y+round(item['height']))
        fixed=ImageGrab.grab(bbox=bounds,all_screens=True).convert('RGB')
        time.sleep(.45)
        later=ImageGrab.grab(bbox=bounds,all_screens=True).convert('RGB')
        assert sum(c==(208,183,204) for c in fixed.get_flattened_data())>fixed.width*fixed.height/2, 'Missing solid Gemini face'
        assert ImageChops.difference(fixed,later).getbbox() is None,'Reduced motion face moved'
        capture('reduced',174)
        print('Running Gemini task stayed solid with reduced motion')
        raise SystemExit(0)
    capture('standard',174)
    call('hover',name=orb_name)
    ready(lambda x:any('等待你操作 · Gemini / Antigravity' in b for b in x['buttons']) and
          any('匿名桌面报错' in b for b in x['buttons']))
    capture('origins',334)
    win32api.SetCursorPos((30,40))
    closed=ready(lambda x:not any('匿名桌面报错' in b for b in x['buttons']))
    orb=next(item for item in closed['buttonBounds'] if item['name']==orb_name)
    left,top=round(orb['x']),round(orb['y'])
    box=(left,top,left+round(orb['width']),top+round(orb['height']))
    samples=[]
    for _ in range(5):
        samples.append(ImageGrab.grab(bbox=box,all_screens=True).convert('RGB'))
        time.sleep(.125)
    changed=max(sum(max(px)>4 for px in ImageChops.difference(samples[0],frame).get_flattened_data())
                for frame in samples[1:])
    assert changed>12, f'Running ring did not move: {changed}'
    print('moving pixels in Gemini ring:',changed)
    # Sample the inner face on either side of the fixed exclamation mark.
    def face_strength(image):
        cx,cy=image.width/2,image.height/2
        distance=[max(abs(c-ref) for c,ref in zip(image.getpixel((x,y)),(208,183,204)))
                  for y in range(image.height) for x in range(image.width)
                  if abs(x+.5-cx)>.13*image.width and
                  (x+.5-cx)**2+(y+.5-cy)**2<(.34*image.width)**2]
        return sum(distance)/len(distance)
    def change_running(running):
        with sqlite3.connect(data/'conversation_summaries.db') as fixture:
            status='CASCADE_RUN_STATUS_RUNNING' if running else 'CASCADE_RUN_STATUS_WAITING_FOR_USER_INPUT'
            fixture.execute("UPDATE conversation_summaries SET status=? WHERE title='匿名桌面运行'",(status,))
        l,_,_,b=win32gui.GetWindowRect(hwnd)
        crop_top=b-round(174*ctypes.windll.user32.GetDpiForWindow(hwnd)/96)
        local_box=tuple(value-offset for value,offset in zip(box,(l,crop_top,l,crop_top)))
        frames=[]
        crossed=None
        start=time.monotonic()
        while time.monotonic()-start<10:
            now=time.monotonic()
            image=grab_window(174)
            strength=face_strength(image.crop(local_box))
            frames.append((now,image,strength))
            reached=strength>5 if running else strength==0
            if reached:
                if crossed is None: crossed=len(frames)-1
                if now-frames[crossed][0]>.8: break
            else:
                crossed=None
            time.sleep(max(0,.08-(time.monotonic()-now)))
        assert crossed is not None and frames[-1][0]-frames[crossed][0]>.8, ('Gemini face transition timed out',running)
        assert any(.15<s<4.5 for _,_,s in frames), ('No intermediate shade',running)
        return [frame for frame in frames if frame[0]>=frames[crossed][0]-1.25]
    stopped=change_running(False)
    stopped[-1][1].save(out/'idle.png')
    started=change_running(True)
    frames=stopped+started
    durations=[round((b[0]-a[0])*1000) for a,b in zip(frames,frames[1:])]
    durations[len(stopped)-1]=450
    frames[0][1].save(out/'motion.webp',save_all=True,append_images=[frame[1] for frame in frames[1:]],
                      duration=durations+[180],lossless=True,loop=0)
    print('Gemini inner face faded to solid #d0b7cc and back to motion through intermediate shades',flush=True)
    call('settings')
    click('收起为窄条')
    ready(lambda x:x['width']==260 and any(24 <= b['width'] <= 26 and abs(b['height']-b['width'])<=1
          for b in x['buttonBounds'] if b['name'].startswith('查看 Gemini 全部')))
    win32api.SetCursorPos((30,40))
    capture('narrow',92)
    print('native brand rings, hover task list, pointer exit and narrow layout passed')

finally:
    win32api.SetCursorPos(cursor)
    if app and app.poll() is None: app.terminate();app.wait(timeout=10)
    if back:back.destroy()
