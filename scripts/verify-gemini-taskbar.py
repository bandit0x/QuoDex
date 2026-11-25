import argparse, base64, ctypes, datetime, json, math, os, pathlib, shutil, sqlite3, subprocess, tempfile, time, tkinter as tk
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
    colors={'Codex':(255,255,255),'ZCode':(0,0,0),'Gemini':(38,112,223)}
    def bounds(item):
        x,y=round(item['x']),round(item['y'])
        return (x,y,x+round(item['width']),y+round(item['height']))
    def ring_image(item):
        return ImageGrab.grab(bbox=bounds(item),all_screens=True).convert('RGB')
    def distance(a,b):
        return max(abs(p-q) for p,q in zip(a,b))
    def missing_arc(image,ink):
        # Cast rays through the outline. Only a contiguous sector may lack brand ink.
        cx,cy=(image.width-1)/2,(image.height-1)/2
        gaps=[]
        for i in range(72):
            theta=i*math.tau/72
            hits=[image.getpixel((round(cx+r*math.cos(theta)),round(cy+r*math.sin(theta))))
                  for r in range(round(image.width*.32),math.floor(min(cx,cy))+1)]
            gaps.append(all(distance(p,ink)>50 for p in hits))
        # An isolated missed ray at this size spans about a single pixel.
        return [gap and (gaps[i-1] or gaps[(i+1)%len(gaps)]) for i,gap in enumerate(gaps)]
    def check_hollow(image,bg):
        # Leave space for the fixed status character in the center.
        cx,cy=(image.width-1)/2,(image.height-1)/2
        side=[image.getpixel((x,y)) for y in range(image.height) for x in range(image.width)
              if .18*image.width<abs(x-cx) and (x-cx)**2+(y-cy)**2<(.32*image.width)**2]
        assert side and sum(distance(p,bg)<=2 for p in side)/len(side)>.80, 'Opaque ring interior'
    def check_gap(gaps):
        starts=sum(gap and not gaps[i-1] for i,gap in enumerate(gaps))
        assert starts==1 and 3<=sum(gaps)<=14, ('Expected a single short gap',sum(gaps),starts)
    def check_scene(palette):
        for item in orbs:
            name=next(name for name in colors if name in item['name'])
            image=ring_image(item)
            check_hollow(image,palette)
            gaps=missing_arc(image,colors[name])
            if name=='Gemini':
                check_gap(gaps)
            else:
                assert not any(gaps), (name,'Incomplete idle ring',sum(gaps))
    assert ' 3 个任务' in orb_name, orb_name
    gemini=next(b for b in orbs if b['name']==orb_name)
    # Muted, nonsaturated fixture backgrounds make each provider stroke independently measurable.
    backgrounds={'light':(225,218,204),'dark':(66,77,87)}
    for theme,palette in backgrounds.items():
        back.configure(bg='#%02x%02x%02x'%palette)
        back.update()
        time.sleep(.3)
        check_scene(palette)
        if not options.reduced_motion:
            capture('standard-'+theme,174)
    if options.reduced_motion:
        fixed=ring_image(gemini)
        time.sleep(.45)
        later=ring_image(gemini)
        assert ImageChops.difference(fixed,later).getbbox() is None,'Reduced motion gap moved'
        capture('reduced',174)
        print('Single static running gap and transparent centers passed on both backgrounds')
        raise SystemExit(0)
    call('hover',name=orb_name)
    ready(lambda x:any('等待你操作 · Gemini / Antigravity' in b for b in x['buttons']) and
          any('匿名桌面报错' in b for b in x['buttons']))
    capture('origins',334)
    win32api.SetCursorPos((30,40))
    closed=ready(lambda x:not any('匿名桌面报错' in b for b in x['buttons']))
    orb=next(item for item in closed['buttonBounds'] if item['name']==orb_name)
    # Record a rotation using the UI Automation rectangle of the real button.
    box=bounds(orb)
    frames=[]
    ring_frames=[]
    started=time.monotonic()
    for index in range(33):
        time.sleep(max(0,started+index*.1-time.monotonic()))
        image=grab_window(174)
        l,_,_,b=win32gui.GetWindowRect(hwnd)
        top=b-image.height
        cropped=image.crop((box[0]-l,box[1]-top,box[2]-l,box[3]-top))
        frames.append(image)
        ring_frames.append(cropped)
    for image in ring_frames:
        check_gap(missing_arc(image,colors['Gemini']))
    shifts={tuple(missing_arc(image,colors['Gemini'])) for image in ring_frames}
    assert len(shifts)>12, ('Gap did not rotate',len(shifts))
    middle=tuple(round(v*ring_frames[0].width) for v in (.32,.25,.68,.75))
    mark=ring_frames[0].crop(middle)
    assert all(ImageChops.difference(mark,image.crop(middle)).getbbox() is None for image in ring_frames[1:]), 'Center symbol moved'
    assert any(distance(p,backgrounds['dark'])>60 for p in mark.get_flattened_data()),'Missing center symbol'
    frames[0].save(out/'motion.webp',save_all=True,append_images=frames[1:-1],duration=100,lossless=True,loop=0)
    print(f'{len(shifts)} measured gap positions, error symbol stayed fixed')
    with sqlite3.connect(data/'conversation_summaries.db') as fixture:
        fixture.execute("UPDATE conversation_summaries SET status='CASCADE_RUN_STATUS_WAITING_FOR_USER_INPUT' WHERE title='匿名桌面运行'")
    for _ in range(60):
        if not any(missing_arc(ring_image(orb),colors['Gemini'])): break
        time.sleep(.15)
    else: raise AssertionError('Ring did not close after the final running task stopped')
    capture('idle',174)
    with sqlite3.connect(data/'conversation_summaries.db') as fixture:
        fixture.execute("UPDATE conversation_summaries SET status='CASCADE_RUN_STATUS_RUNNING' WHERE title='匿名桌面运行'")
    call('settings')
    click('收起为窄条')
    compact=ready(lambda x:x['width']==260 and any(24 <= b['width'] <= 26 and abs(b['height']-b['width'])<=1
          for b in x['buttonBounds'] if b['name'].startswith('查看 Gemini 全部')))
    tiny=next(b for b in compact['buttonBounds'] if b['name']==orb_name)
    for _ in range(50):
        if sum(missing_arc(ring_image(tiny),colors['Gemini']))>=3: break
        time.sleep(.15)
    check_gap(missing_arc(ring_image(tiny),colors['Gemini']))
    win32api.SetCursorPos((30,40))
    capture('narrow',92)
    print('native brand rings, hover task list, pointer exit and narrow layout passed')

finally:
    win32api.SetCursorPos(cursor)
    if app and app.poll() is None: app.terminate();app.wait(timeout=10)
    if back:back.destroy()
