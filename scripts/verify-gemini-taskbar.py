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
parser.add_argument('--gemini-window',action='store_true',help='Capture the Gemini twin chambers with six readings from anonymous local panels.')
options=parser.parse_args()
config=root/'config'
config.mkdir()
(config/'display-preferences.json').write_text(json.dumps(dict(source='gemini' if options.gemini_window else 'codex',x=185,y=98,opacity=.96,alwaysOnTop=True,reducedMotion=options.reduced_motion)))
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
    agent.execute("INSERT INTO turn_usage VALUES('ses-sample','turn-sample','completed',?,?,NULL)",(now-240000,now-181000))
app=None
back=None
panels=None
cursor=win32api.GetCursorPos()
try:
    if options.gemini_window:
        panels=subprocess.Popen([shutil.which('node'),str(repo/'scripts/gemini-panel-fixture.mjs')],
                                stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,creationflags=subprocess.CREATE_NO_WINDOW)
        assert panels.stdout.readline().startswith('Expected 72 / 46 / 12.'),'QDT-V13 offline Gemini panels did not start'
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
    def bounds(item):
        x,y=round(item['x']),round(item['y'])
        return (x,y,x+round(item['width']),y+round(item['height']))
    def ring_image(item):
        return ImageGrab.grab(bbox=bounds(item),all_screens=True).convert('RGB')
    def distance(a,b):
        return max(abs(p-q) for p,q in zip(a,b))
    def equal(a,b):
        return ImageChops.difference(a,b).getbbox() is None
    def check_hollow(image,bg):
        # Sample the clear middle of the hub to both sides of the glyph.
        # Completion minutes occupy the lower half of this same aperture.
        cx,cy=(image.width-1)/2,(image.height-1)/2
        side=[image.getpixel((x,y)) for y in range(image.height) for x in range(image.width)
              if .24*image.width<abs(x-cx)<.34*image.width and abs(y-cy)<.1*image.height]
        hits=sum(distance(p,bg)<=2 for p in side)
        assert side and hits/len(side)>.85, ('QDT-V01 opaque ring interior',hits,len(side),bg)
    def rim_pixels(image):
        cx,cy=(image.width-1)/2,(image.height-1)/2
        for y in range(image.height):
            for x in range(image.width):
                dx,dy=x-cx,y-cy
                if .32*image.width<math.hypot(dx,dy)<.51*image.width:
                    yield dx,dy,image.getpixel((x,y))
    def check_scene(palette):
        for item in orbs:
            img=ring_image(item)
            check_hollow(img,palette)
            pixels=[p for _,_,p in rim_pixels(img)]
            if 'Codex' in item['name']:
                present=sum(min(p)>204 and distance(p,palette)>25 for p in pixels)
            elif 'ZCode' in item['name']:
                present=sum(max(p)<45 for p in pixels)
            else:
                present=sum(p[2]-p[0]>52 for p in pixels)
            assert present>=8, ('QDT-V02 missing agent rim',item['name'],present)
    def check_soft_light(image):
        # A stationary Gemini has a broad upper-left reflection. Sample only blue
        # ring pixels, away from the glyph and the neutral desktop.
        sectors=[]
        for cx,cy in [(-1,-1),(1,1)]:
            pixels=[p[1] for dx,dy,p in rim_pixels(image)
                    if dx*cx>1 and dy*cy>1 and p[2]-p[0]>48]
            assert len(pixels)>=8,('QDT-V03 missing shaded sector',len(pixels))
            sectors.append(sum(pixels)/len(pixels))
        assert sectors[0]>sectors[1]+10,('QDT-V04 stationary rim lacks upper-left reflection',sectors)
        print('stationary rim green-channel sector means:',[round(v,1) for v in sectors])
    def task_state(title,state):
        with sqlite3.connect(data/'conversation_summaries.db') as fixture:
            fixture.execute('UPDATE conversation_summaries SET status=? WHERE title=?',(state,title))
    def wait_motion(item,moving):
        for _ in range(50):
            first=ring_image(item)
            time.sleep(.18)
            second=ring_image(item)
            if equal(first,second)==(not moving):
                time.sleep(.21)
                if equal(first,ring_image(item))==(not moving):
                    return second
        raise AssertionError(('QDT-V05 unexpected ring motion',moving))
    def crop_button(image,item):
        x,y,r,b=bounds(item)
        left,_,_,bottom=win32gui.GetWindowRect(hwnd)
        top=bottom-image.height
        return image.crop((x-left,y-top,r-left,b-top))
    assert ' 3 个任务' in orb_name, orb_name
    gemini=next(b for b in orbs if b['name']==orb_name)
    dpi_scale=ctypes.windll.user32.GetDpiForWindow(hwnd)/96
    assert abs(gemini['width']-29*dpi_scale)<=1,(gemini['width'],dpi_scale,'QDT-V06 standard width')
    backgrounds={'light':(225,218,204),'dark':(66,77,87)}
    if options.gemini_window:
        expected={f'{agent} {period}，剩余 {value}%' for agent,pair in
                  [('Gemini Web',(72,95)),('AG Gemini',(76,46)),('AG Claude/GPT',(12,30))]
                  for period,value in zip(('5 小时','一周'),pair)}
        ready(lambda x:expected.issubset(x['names']))
        back.configure(bg='#424d57')
        back.update()
        time.sleep(.3)
        check_scene(backgrounds['dark'])
        capture('gemini-window',174)
        print('Three water rings and six anonymous Gemini quota readings appeared together.')
        raise SystemExit(0)
    for theme,palette in backgrounds.items():
        back.configure(bg='#%02x%02x%02x'%palette)
        back.update()
        time.sleep(.3)
        if not options.reduced_motion:
            capture('standard-'+theme,174)
        check_scene(palette)
    if options.reduced_motion:
        first=ring_image(gemini)
        time.sleep(.45)
        assert equal(first,ring_image(gemini)),'QDT-V07 reduced-motion water moved'
        capture('reduced',174)
        print('Running water remained fixed with reduced motion. Transparent centers passed on both backgrounds.')
        raise SystemExit(0)
    call('hover',name=orb_name)
    ready(lambda x:any('等待你操作 · Gemini / Antigravity' in b for b in x['buttons']) and
          any('匿名桌面报错' in b for b in x['buttons']))
    capture('origins',334)
    win32api.SetCursorPos((30,40))
    closed=ready(lambda x:not any('匿名桌面报错' in b for b in x['buttons']))
    group=[b for b in closed['buttonBounds'] if b['name'].startswith('查看 ') and ' 全部 ' in b['name']]
    orb=next(item for item in group if item['name']==orb_name)
    frames=[]
    started=time.monotonic()
    for index in range(32):
        time.sleep(max(0,started+index*.1-time.monotonic()))
        frames.append(grab_window(174))
    for item in group:
        samples=[crop_button(frame,item) for frame in frames]
        if item['name']!=orb_name:
            assert all(equal(samples[0],later) for later in samples[1:]),('QDT-V08 static ring moved',item['name'])
            continue
        positions=len({s.tobytes() for s in samples})
        assert positions>16,('QDT-V09 running water did not travel',positions)
        # Fit the 24-unit exclamation path (x=12, y=4…20) and its stroke.
        # The moving rim casts a subpixel reflection just inside the aperture.
        middle=tuple(round(v*samples[0].width) for v in (.40,.27,.6,.73))
        mark=samples[0].crop(middle)
        differences=[ImageChops.difference(mark,image.crop(middle)) for image in samples[1:]]
        assert all(diff.getbbox() is None for diff in differences),('QDT-V10 center symbol moved',[(d.getbbox(),d.getextrema()) for d in differences if d.getbbox()][:2])
        assert any(distance(mark.getpixel((x,y)),backgrounds['dark'])>55
                   for y in range(mark.height) for x in range(mark.width)),'QDT-V11 missing error mark'
    frames[0].save(out/'motion.webp',save_all=True,append_images=frames[1:],duration=100,lossless=True,loop=0)
    print(f'{positions} unique running frames. Both stationary buttons and the mixed-state error symbol stayed fixed.')
    task_state('匿名桌面运行','CASCADE_RUN_STATUS_WAITING_FOR_USER_INPUT')
    stationary=wait_motion(orb,False)
    check_soft_light(stationary)
    capture('static-error',174)
    task_state('匿名桌面报错','CASCADE_RUN_STATUS_WAITING_FOR_USER_INPUT')
    for _ in range(80):
        if not equal(stationary.crop(middle),ring_image(orb).crop(middle)): break
        time.sleep(.15)
    else: raise AssertionError('QDT-V12 waiting glyph did not replace the error glyph')
    check_soft_light(wait_motion(orb,False))
    capture('static-waiting',174)
    task_state('匿名桌面运行','CASCADE_RUN_STATUS_RUNNING')
    task_state('匿名桌面报错','CASCADE_RUN_STATUS_ERROR')
    call('settings')
    click('收起为窄条')
    compact=ready(lambda x:abs(x['width']-260*dpi_scale)<=1 and any(abs(b['width']-25*dpi_scale)<=1 and abs(b['height']-b['width'])<=1
          for b in x['buttonBounds'] if b['name'].startswith('查看 Gemini 全部')))
    tiny=next(b for b in compact['buttonBounds'] if b['name']==orb_name)
    check_hollow(wait_motion(tiny,True),backgrounds['dark'])
    win32api.SetCursorPos((30,40))
    capture('narrow',92)
    print('Native water rings, static material, hover, pointer exit and narrow layout passed.')

finally:
    if app and app.poll() is None: app.terminate();app.wait(timeout=10)
    if back:back.destroy()
    if panels and panels.poll() is None:
        panels.stdin.write('quit\n')
        panels.stdin.flush()
        panels.wait(timeout=15)
    win32api.SetCursorPos(cursor)
