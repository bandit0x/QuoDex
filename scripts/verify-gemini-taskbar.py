import base64, ctypes, datetime, json, os, pathlib, shutil, sqlite3, subprocess, tempfile, time, tkinter as tk
import win32api, win32con, win32gui, win32process
from PIL import ImageGrab

ctypes.windll.user32.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))
repo=pathlib.Path(__file__).resolve().parents[1]
exe=pathlib.Path(os.environ.get('QUODEX_EXECUTABLE', repo/'src-tauri/target/release/codex-credits-view.exe')).resolve()
out=pathlib.Path(os.environ.get('QUODEX_TASK_REVIEW_DIR', repo/'.scratch/gemini-taskbar-native')).resolve()
out.mkdir(parents=True, exist_ok=True)
root=pathlib.Path(tempfile.mkdtemp(prefix='quodex-prism-'))
config=root/'config'
config.mkdir()
(config/'display-preferences.json').write_text(json.dumps(dict(source='gemini',geminiInCarousel=True,x=185,y=98,opacity=.96,alwaysOnTop=True,reducedMotion=False)))
data=root/'.gemini/antigravity'
data.mkdir(parents=True)
stamp=datetime.datetime.now(datetime.timezone.utc).isoformat()
with sqlite3.connect(data/'conversation_summaries.db') as db:
    db.execute('CREATE TABLE conversation_summaries(conversation_id TEXT PRIMARY KEY,title TEXT,status TEXT,not_fully_idle INTEGER,last_user_input_time TEXT,last_user_input_step_index INTEGER,last_modified_time TEXT,parent_conversation_id TEXT,nesting_depth INTEGER,killed INTEGER)')
    db.executemany('INSERT INTO conversation_summaries VALUES(?,?,?,?,?,?,?,?,?,?)',[(f'10000000-0000-4000-8000-00000000000{i}',title,status,1,stamp,4,stamp,'',0,0) for i,(title,status) in enumerate([('匿名桌面运行','CASCADE_RUN_STATUS_RUNNING'),('匿名桌面等待','CASCADE_RUN_STATUS_WAITING_FOR_USER_INPUT'),('匿名桌面报错','CASCADE_RUN_STATUS_ERROR')])])
backend=subprocess.Popen(['node',str(repo/'scripts/gemini-taskbar-fixture.mjs')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,encoding='utf-8')
app=None
back=None
cursor=win32api.GetCursorPos()
try:
    assert backend.stdout.readline().strip()=='READY'
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
    def capture(name,extra):
        back.update()
        time.sleep(.25)
        l,t,r,b=win32gui.GetWindowRect(hwnd)
        dpi=ctypes.windll.user32.GetDpiForWindow(hwnd)/96
        shot=ImageGrab.grab(bbox=(l,b-round(extra*dpi),r,b),all_screens=True)
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
    info=ready(lambda x:any('查看 Gemini 全部 4 个任务' in b for b in x['buttons']))
    assert '查看 2 项已知报错和等待' in info['buttons'],info['buttons']
    capture('standard',174)
    click('查看 Gemini 全部')
    info=ready(lambda x:any('运行中 · Gemini / Web' in b for b in x['buttons']) and any('等待你操作 · Gemini / Antigravity' in b for b in x['buttons']))
    capture('origins',334)
    call('escape')
    click('查看 2 项已知报错和等待')
    ready(lambda x:'报错和等待' in x['names'] and any('匿名桌面报错' in n for n in x['names']))
    call('escape')
    backend.stdin.write('close-web\n')
    backend.stdin.flush()
    assert backend.stdout.readline().strip()=='CLOSED'
    ready(lambda x:any('查看 Gemini 全部 3 个任务' in b and '状态未知' in b for b in x['buttons']))
    click('查看 Gemini 全部')
    ready(lambda x:any('QDT-641' in n for n in x['names']) and any('等待你操作 · Gemini / Antigravity' in b for b in x['buttons']))
    call('escape')
    call('settings')
    click('收起为窄条')
    ready(lambda x:x['width']==260 and any(b['width']<=34 and b['height']==33 for b in x['buttonBounds'] if '已知报错和等待' in b['name']))
    capture('narrow',92)
    print('native merge, two source origins, alert filter, disconnect and both window sizes passed')
finally:
    win32api.SetCursorPos(cursor)
    if app and app.poll() is None: app.terminate();app.wait(timeout=10)
    if backend.poll() is None:
        backend.stdin.write('quit\n');backend.stdin.flush()
        try: backend.wait(timeout=10)
        except subprocess.TimeoutExpired: backend.terminate();backend.wait(timeout=5)
    if back:back.destroy()
