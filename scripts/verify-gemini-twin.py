"""Compare the shipping Windows QuoDex window with the separately rendered approved HTML.

Requires Python with pywin32, Pillow, psutil and Playwright, Edge, and the WebView2 .NET
SDK used by Visual Studio Build Tools. All example browser traffic is answered in process.
"""
import argparse
import ctypes
import hashlib
import json
import os
import pathlib
import platform
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid

import psutil
import win32api
import win32con
import win32event
import win32gui
import win32job
import win32process
import win32service
import win32ui
from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright


ROOT = pathlib.Path(__file__).resolve().parents[1]
HELPER = ROOT / "scripts/gemini-twin-windows.ps1"
OPTICAL_STUDY = ROOT / "docs/design/gemini-quota-windows/liquid/twin/material/optical-glass-study.png"
OPTICAL_CROPS = {"standard": (194, 17, 1577, 601), "narrow": (194, 626, 1577, 852)}
NORMAL = {"gemini": (82, 16), "partner": (24, 90), "web": (68, 55)}
NAMES = {"gemini": "AG Gemini", "partner": "AG Claude/GPT", "web": "Gemini Web"}
HINTS = {"gemini": ("2 小时后重置", "3 天后重置"), "partner": ("1 小时后重置", None),
         "web": ("4 小时后重置", "2 天后重置")}


def checked(ok, message):
    if not ok:
        raise RuntimeError(message)


def wait_for(check, label, seconds=18):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        result = check()
        if result:
            return result
        time.sleep(.13)
    raise RuntimeError(f"QGT-106: timed out waiting for {label}")


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def save_json(path, value):
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def run_private(args):
    scratch = ROOT / ".scratch/gemini-twin"
    scratch.mkdir(exist_ok=True, parents=True)
    folder = pathlib.Path(tempfile.mkdtemp(prefix="native-", dir=scratch))
    name = "QuoDexTwinQA-" + uuid.uuid4().hex
    args.output.mkdir(exist_ok=True, parents=True)
    report_path = args.output / "report.json"
    save_json(report_path, {"status":"Blocked", "error":"QGT-123: the private worker has not produced a report"})
    desktop = win32service.CreateDesktop(name, 0, 0xF01FF, None)
    job = win32job.CreateJobObject(None, name)
    info = win32job.QueryInformationJobObject(job, win32job.JobObjectExtendedLimitInformation)
    info["BasicLimitInformation"]["LimitFlags"] |= win32job.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    win32job.SetInformationJobObject(job, win32job.JobObjectExtendedLimitInformation, info)
    try:
        startup = win32process.STARTUPINFO()
        startup.lpDesktop = "WinSta0\\" + name
        command = [sys.executable, str(pathlib.Path(__file__).resolve()), *sys.argv[1:],
                   "--worker", name, "--profile", str(folder)]
        process, thread, _, _ = win32process.CreateProcess(
            sys.executable, subprocess.list2cmdline(command), None, None, False,
            win32con.CREATE_SUSPENDED | win32con.CREATE_NO_WINDOW, dict(os.environ), str(ROOT), startup)
        win32job.AssignProcessToJobObject(job, process)
        win32process.ResumeThread(thread)
        limit = 360 if args.states else 100 + 25 * args.repeat_extremes
        checked(win32event.WaitForSingleObject(process, limit * 1000) == win32con.WAIT_OBJECT_0,
                "QGT-104: private desktop worker timed out")
        result = win32process.GetExitCodeProcess(process)
    finally:
        job.Close()
        desktop.CloseDesktop()
    if result == 0 and folder.resolve().parent == scratch.resolve() and folder.name.startswith("native-"):
        for attempt in range(8):
            try:
                shutil.rmtree(folder)
                break
            except PermissionError:
                if attempt == 7:
                    raise
                time.sleep(.35)
    report = json.loads(report_path.read_text(encoding="utf-8"))
    print(f"{report['status']} | {len(report.get('cases', {}))} captures | {report_path}")
    if report.get("error"):
        print(report["error"])
    for case in report.get("differingCases", []):
        print(f"{case} | {report['cases'][case]['changedRGBPixels']} different pixels")
    for case in report.get("differingDetailReturns", []):
        print(f"details {case} | {report['details'][case]['restoredChangedRGBPixels']} different pixels after returning")
    return result


def snapshot(hwnd, css_size, save_full_to=None):
    """Print the whole private HWND, then take its fixed bottom-aligned quota viewport."""
    l, t, r, b = win32gui.GetWindowRect(hwnd)
    dpi = ctypes.windll.user32.GetDpiForWindow(hwnd)
    w, h = r - l, b - t
    expected = tuple(round(x * dpi / 96) for x in css_size)
    checked(w == expected[0] and h >= expected[1], f"QGT-107: native {w}x{h}, expected {expected}")
    dc = win32gui.GetWindowDC(hwnd)
    screen = win32ui.CreateDCFromHandle(dc)
    work = screen.CreateCompatibleDC()
    bitmap = win32ui.CreateBitmap()
    try:
        bitmap.CreateCompatibleBitmap(screen, w, h)
        work.SelectObject(bitmap)
        checked(ctypes.windll.user32.PrintWindow(hwnd, work.GetSafeHdc(), 2), "QGT-108: PrintWindow failed")
        raster = Image.frombytes("RGBA", (w, h), bitmap.GetBitmapBits(True), "raw", "BGRA")
    finally:
        work.DeleteDC()
        screen.DeleteDC()
        win32gui.ReleaseDC(hwnd, dc)
        win32gui.DeleteObject(bitmap.GetHandle())
    top = h - expected[1]
    if save_full_to is not None:
        raster.convert("RGB").save(save_full_to)
    return raster.crop((0, top, w, h)), {"hwndSize": [w, h], "crop": [0, top, w, h], "origin": [l,t], "dpi": dpi}


def get_window(pid):
    found = []
    def visit(h, _):
        if win32process.GetWindowThreadProcessId(h)[1] == pid and win32gui.GetWindowText(h) == "QuoDex":
            found.append(h)
    win32gui.EnumWindows(visit, None)
    return found[0] if found else None


def ui(hwnd):
    command = ["pwsh", "-NoProfile", "-File", str(HELPER), "-Mode", "inspect", "-Hwnd", str(hwnd)]
    response = subprocess.run(command, capture_output=True, timeout=8, check=True,
                              creationflags=subprocess.CREATE_NO_WINDOW)
    return json.loads(response.stdout)


def renderer_widget(hwnd):
    children = []
    win32gui.EnumChildWindows(hwnd, lambda h, _: children.append(h), None)
    return next(h for h in children if win32gui.GetClassName(h) == "Chrome_RenderWidgetHostHWND")


def pointer_away(hwnd):
    widget = renderer_widget(hwnd)
    win32gui.PostMessage(widget, win32con.WM_MOUSEMOVE, 0, (3 << 16) | 2)
    win32gui.PostMessage(widget, 0x02A3, 0, 0)  # WM_MOUSELEAVE


def click(hwnd, point, right=False):
    widget = renderer_widget(hwnd)
    x, y = win32gui.ScreenToClient(widget, point)
    coords = (y << 16) | (x & 65535)
    down, up, button = ((win32con.WM_RBUTTONDOWN, win32con.WM_RBUTTONUP, win32con.MK_RBUTTON)
                        if right else (win32con.WM_LBUTTONDOWN, win32con.WM_LBUTTONUP, win32con.MK_LBUTTON))
    win32gui.PostMessage(widget, down, button, coords)
    win32gui.PostMessage(widget, up, 0, coords)


def action(hwnd, name):
    def find():
        return next((i for i in ui(hwnd) if i["type"] == "ControlType.Button" and name in i["name"]), None)
    item = wait_for(find, name)
    geometry = win32gui.GetClientRect(hwnd)
    click(hwnd, (round(item["x"] + item["w"] / 2), round(item["y"] + item["h"] / 2)))
    return geometry


def set_layout(hwnd, narrow):
    settings_height = 0
    if narrow:
        l, _, _, b = win32gui.GetWindowRect(hwnd)
        click(hwnd, (l + 40, b - 35), right=True)
        settings_height = action(hwnd, "收起为窄条")[3]
    else:
        action(hwnd, "恢复标准")
    width = 260 if narrow else 300
    wait_for(lambda: win32gui.GetClientRect(hwnd)[2] == width, "window width")
    time.sleep(.42)
    return settings_height


def markup(data, group):
    output = []
    for title, value, reset in zip(("Five Hour", "Weekly"), data, HINTS[group]):
        if value is not None:
            output.append(f"<p>{title} Limit Remaining <span>{value}%</span></p>")
            if reset:
                output.append(f"<p>{reset}</p>")
    return "".join(output)


def ag_panel(values):
    return ('<section role="dialog" aria-label="View Usage"><h2>View Usage</h2>'
            '<section><h3>Gemini Models</h3>' + markup(values["gemini"],"gemini") + "</section>"
            '<section><h3>Claude and GPT models</h3>' + markup(values["partner"],"partner") + "</section></section>")


def open_panel(pw, origin, title, body):
    browser = pw.chromium.launch(channel="msedge", headless=False,
                                 args=["--force-renderer-accessibility", "--disable-background-networking"])
    context = browser.new_context(service_workers="block")
    context.route("**/*", lambda route: route.fulfill(content_type="text/html; charset=utf-8",
                                                      body="<title>" + title + " · anonymous</title><main>" + body + "</main>"))
    page = context.new_page()
    page.goto("https://" + origin + "/app")
    return browser, page


def render_reference(args, profile, layout, scenario, env, product_geometry, reduced, settings_height):
    profile.mkdir()
    cmd = ["pwsh", "-NoProfile", "-STA", "-File", str(HELPER), "-Mode", "reference",
           "-Profile", str(profile), "-Runtime", str(args.runtime), "-Sdk", str(args.sdk),
           "-Loader", str(args.loader), "-Layout", layout, "-Scenario", scenario, "-Motion", "reduced" if reduced else "normal",
           "-TopInset", str(product_geometry["crop"][1]), "-SettingsHeight", str(settings_height), "-DesktopX", str(product_geometry["origin"][0]),
           "-DesktopY", str(product_geometry["origin"][1])]
    clean_env = {k: v for k, v in env.items() if not k.startswith("WEBVIEW2_")}
    with (profile / "host.log").open("wb") as log:
        p = subprocess.Popen(cmd, env=clean_env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            ready = profile / "capture-ready.json"
            def loaded():
                checked(p.poll() is None, "QGT-109: reference host exited; see " + str(profile / "host.log"))
                return ready.exists() and ready.stat().st_size > 0
            wait_for(loaded, "independent reference")
            meta = json.loads(ready.read_text(encoding="utf-8-sig"))
            size = (300, 130) if layout == "standard" else (260, 48)
            image, geometry = snapshot(meta["hwnd"], size)
            (profile / "captured").touch()
            p.wait(timeout=6)
            return image, {**geometry, "metrics": meta["metrics"], "runtime": meta["version"]}
        finally:
            if p.poll() is None:
                p.terminate()


def optical_reference(layout, size):
    with Image.open(OPTICAL_STUDY) as sheet:
        checked(sheet.size == (1774, 887), "QGT-127: optical study dimensions changed, verify the panel crops")
        crop = OPTICAL_CROPS[layout]
        image = sheet.convert("RGB").crop(crop).resize(size, Image.Resampling.LANCZOS)
    return image, {"file": str(OPTICAL_STUDY.relative_to(ROOT)), "sha256": sha256(OPTICAL_STUDY),
                   "crop": crop, "size": size, "resampling": "Lanczos"}


def compare(out, name, product, reference):
    checked(product.size == reference.size, "QGT-110: raster dimensions differ")
    checked(len(product.convert("RGB").getcolors(1000000)) > 100 and
            len(reference.convert("RGB").getcolors(1000000)) > 100, "QGT-111: empty capture")
    # PrintWindow returns RGB pixels for the visible HWND. Its reserved byte in a
    # compatible Win32 bitmap is not a documented alpha channel; do not compare it as alpha.
    actual, approved = product.convert("RGB"), reference.convert("RGB")
    difference = ImageChops.difference(actual, approved)
    changed = sum(count for count, rgb in difference.getcolors(actual.width * actual.height) if any(rgb))
    for label, image in (("actual", actual), ("approved", approved), ("diff", difference)):
        image.save(out / f"{name}-{label}.png")
    return {"pixels": actual.width * actual.height, "changedRGBPixels": changed,
            "actualDecodedRGBSHA256": hashlib.sha256(actual.tobytes()).hexdigest(),
            "approvedDecodedRGBSHA256": hashlib.sha256(approved.tobytes()).hexdigest(),
            "maxChannelDifference": max(high for _, high in difference.getextrema()),
            "differenceBounds": difference.getbbox()}


def scroll_down(hwnd, viewport):
    x = round(viewport["x"] + viewport["w"] / 2)
    y = round(viewport["y"] + viewport["h"] / 2)
    widget = renderer_widget(hwnd)
    cx, cy = win32gui.ScreenToClient(widget, (x, y))
    win32gui.PostMessage(widget, win32con.WM_MOUSEMOVE, 0, (cy << 16) | (cx & 65535))
    win32gui.PostMessage(widget, win32con.WM_MOUSEWHEEL, (-12 & 65535) << 16, (y << 16) | (x & 65535))
    time.sleep(.18)


def surface_readings(items):
    return [el["name"] for el in items if el["type"] == "ControlType.Image"
            and any(el["name"].startswith(name + " ") for name in NAMES.values())]


def task_interactions(hwnd):
    bounds = win32gui.GetWindowRect(hwnd)
    widget = renderer_widget(hwnd)
    def has_label(label):
        return any(el["name"] == label for el in ui(hwnd))
    def key(code):
        win32gui.PostMessage(widget, win32con.WM_KEYDOWN, code, 1)
        win32gui.PostMessage(widget, win32con.WM_KEYUP, code, 0xc0000001)
    button = next(el for el in ui(hwnd) if el["type"] == "ControlType.Button" and "个任务" in el["name"])
    name = button["name"].split(" ")[1]
    menu = name + " 任务列表"
    point = (round(button["x"] + button["w"]/2), round(button["y"] + button["h"]/2))
    x,y = win32gui.ScreenToClient(widget,point)
    stop = threading.Event()
    def move_within_button():
        offset = 0
        while not stop.is_set():
            win32gui.PostMessage(widget, win32con.WM_MOUSEMOVE, 0, (y << 16) | ((x + offset) & 65535))
            offset = 1 - offset
            stop.wait(.025)
    pointer = threading.Thread(target=move_within_button)
    pointer.start()
    try:
        wait_for(lambda: has_label(menu), "native task hover " + menu)
    finally:
        stop.set()
        pointer.join()
    click(hwnd, point)
    wait_for(lambda: any(el["name"] == button["name"] and el["focused"] for el in ui(hwnd)), "clicked task button focus")
    key(win32con.VK_ESCAPE)
    wait_for(lambda: not has_label(menu), "task menu closes on Escape")
    key(win32con.VK_TAB)
    def keyboard_focus():
        return next((el["name"] for el in ui(hwnd) if el["focused"] and el["type"] == "ControlType.Button"), None)
    focused = wait_for(keyboard_focus, "next keyboard button")
    # The native task reserve is 204 px high. This point misses the orbs and quota.
    click(hwnd,(bounds[0] + 130, bounds[1] + 120),right=True)
    wait_for(lambda: has_label("显示设置"), "settings opened by reserved-area context menu")
    action(hwnd,"关闭设置")
    wait_for(lambda: win32gui.GetWindowRect(hwnd) == bounds, "original bounds after context menu")
    pointer_away(hwnd)
    return {"hoveredTask":button["name"], "openedPopover":menu, "clickFocusedOriginalButton":True,
            "escapeClosedPopover":True, "nextKeyboardButton":focused, "blankContextMenuOpenedSettings":True,
            "boundsAfterClosing":bounds}


def verify_details(args, hwnd, diagnostic=False):
    before, geometry = snapshot(hwnd, (300,130))
    before_rows = surface_readings(ui(hwnd))
    checked(len(before_rows) == 6, "QGT-117: six standard readings expected")
    action(hwnd, "查看 Gemini 额度详情")
    def get_dialog():
        items = ui(hwnd)
        return items if any(el["name"] == "Gemini 额度窗口" for el in items) else None
    items = wait_for(get_dialog, "details table")
    viewport = next(el for el in items if el["name"] == "额度详情")
    def fully_visible(el):
        return (el["y"] >= viewport["y"] and el["y"] + el["h"] <= viewport["y"] + viewport["h"] + 1
                and el["x"] >= viewport["x"] and el["x"] + el["w"] <= viewport["x"] + viewport["w"] + 1)
    expected = []
    for group, amounts in NORMAL.items():
        for idx, amount in enumerate(amounts):
            value, hint = f"{amount}%", HINTS[group][idx] or "面板未披露"
            if diagnostic and group == "partner":
                value, hint = "未读", "—"
            expected.append((NAMES[group], ("5 小时","一周")[idx], value, hint))
    observed = set()
    code = ""
    screenshots = []
    for step in range(80):
        cells = [el for el in items if el["type"] == "ControlType.DataItem"]
        rows = {}
        for el in cells:
            rows.setdefault(el["y"], []).append(el)
        previous = len(observed)
        for group in rows.values():
            if len(group) == 4 and all(fully_visible(el) for el in group):
                row = tuple(el["name"] for el in sorted(group,key=lambda el: el["x"]))
                if row in expected:
                    observed.add(row)
        if diagnostic:
            for el in items:
                if "QGM-203" in el["name"] and fully_visible(el):
                    code = el["name"]
        if len(observed) > previous or code:
            l,t,r,b = win32gui.GetWindowRect(hwnd)
            shot, _ = snapshot(hwnd, (r-l,b-t))
            title = f"details-{'diagnostic' if diagnostic else 'ready'}-scroll-{step}.png"
            shot.convert("RGB").save(args.output/title)
            screenshots.append(title)
        if len(observed) == 6 and (not diagnostic or code):
            break
        scroll_down(hwnd, viewport)
        items = ui(hwnd)
    checked(len(observed) == 6, f"QGT-118: visible detail rows missing: {set(expected)-observed}")
    checked(not diagnostic or code, "QGT-119: production reader diagnostic not visible")
    action(hwnd, "关闭设置")
    wait_for(lambda: win32gui.GetClientRect(hwnd)[3] == geometry["hwndSize"][1], "original height on closing details")
    pointer_away(hwnd)
    time.sleep(.55)
    after, restored = snapshot(hwnd,(300,130))
    restored_rows = surface_readings(ui(hwnd))
    restored_diff = ImageChops.difference(before.convert("RGB"), after.convert("RGB"))
    changed_pixels = sum(n for n, rgb in restored_diff.getcolors(before.width*before.height) if any(rgb))
    returned_images = []
    if changed_pixels:
        stem = "details-unreadable" if diagnostic else "details-ready"
        for suffix, image in (("before",before),("restored",after),("return-diff",restored_diff)):
            filename = f"{stem}-{suffix}.png"
            image.convert("RGB").save(args.output/filename)
            returned_images.append(filename)
    checked(before_rows == restored_rows and restored["hwndSize"] == geometry["hwndSize"]
            and restored["origin"] == geometry["origin"], "QGT-120: restored readings or HWND bounds differ")
    return {"visibleRows": expected, "visibleDiagnostic": code or None, "screenshots": screenshots,
            "restoredReadings": restored_rows, "restoredHWNDSize": restored["hwndSize"], "restoredOrigin": restored["origin"],
            "restoredChangedRGBPixels":changed_pixels, "restoredDifferenceBounds":restored_diff.getbbox(),
            "restoredMaxChannelDifference":max(high for _,high in restored_diff.getextrema()), "returnImages":returned_images}


def measure_case(args, scenario, env, ag_page, report, reduced=True, label=None):
    label = label or (scenario if reduced else "default-motion")
    folder = args.profile / label
    config = folder / "config"
    config.mkdir(parents=True)
    save_json(config / "display-preferences.json", {"source":"gemini","geminiInCarousel":True,
              "x":120,"y":120,"reducedMotion":reduced,"alwaysOnTop":True,"opacity":.92})
    env = {**env, "WEBVIEW2_USER_DATA_FOLDER": str(folder/"webview"), "CODEX_CREDITS_CONFIG_DIR": str(config)}
    values = dict(NORMAL)
    if scenario in ("zero", "missing"):
        values["gemini"] = (82, 0 if scenario == "zero" else None)
    ag_page.locator("main").evaluate("(e,html) => { e.innerHTML=html; }", ag_panel(values))
    # Each scenario starts with an empty front-end observation cache. Only the stale
    # case first obtains the two fresh periods, then loses the weekly row on a refresh.
    product = subprocess.Popen([str(args.executable)], env=env, creationflags=subprocess.CREATE_NO_WINDOW,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        hwnd = wait_for(lambda: get_window(product.pid), "new product HWND")
        expected = "5/6" if scenario == "missing" else "6/6"
        def initial_readings():
            names = [el["name"] for el in ui(hwnd)]
            if "ERR_CONNECTION_REFUSED" in names and "localhost" in names:
                _, _, width, height = win32gui.GetClientRect(hwnd)
                snapshot(hwnd,(width,height),args.output/"launch-error.png")
                raise RuntimeError("QGT-124: release opened localhost instead of its bundled UI; check the custom-protocol build feature")
            return any(expected in name for name in names)
        wait_for(initial_readings, "initial panel readings")
        engines = {pathlib.Path(p.exe()).resolve() for p in psutil.Process(product.pid).children(recursive=True)
                   if p.name().lower() == "msedgewebview2.exe"}
        checked(engines == {(args.runtime/"msedgewebview2.exe").resolve()}, "QGT-112: actual WebView2 differs from reference runtime")
        if scenario in ("stale", "extremes"):
            if scenario == "stale":
                values["gemini"] = (82, None)
            else:
                values.update(gemini=(0,16),partner=(100,90))
            ag_page.locator("main").evaluate("(e,html) => { e.innerHTML=html; }", ag_panel(values))
            action(hwnd, "刷新")
            status = "含一项上次读数" if scenario == "stale" else "6/6 已更新"
            wait_for(lambda: any(status in i["name"] for i in ui(hwnd)), status)
        observations = surface_readings(ui(hwnd))
        checked(len(observations) == 6, "QGT-122: expected six accessible observations before collapsing")
        for layout, size in (("standard", (300,130)), ("narrow", (260,48))):
            settings_height = set_layout(hwnd, True) if layout == "narrow" else 0
            pointer_away(hwnd)
            time.sleep(.48 if reduced else 1.1)
            full_frame = f"ready-{layout}-hwnd.png" if scenario == "ready" and reduced else None
            image, geometry = snapshot(hwnd, size, args.output / full_frame if full_frame else None)
            changes = []
            if not reduced:
                initial = image.convert("RGB")
                for delay in (.12, .31, .53):
                    time.sleep(delay)
                    later, _ = snapshot(hwnd, size)
                    diff = ImageChops.difference(initial, later.convert("RGB"))
                    changes.append(sum(n for n, rgb in diff.getcolors(initial.width*initial.height) if any(rgb)))
            if args.optical_study:
                ref, reference = optical_reference(layout, image.size)
            else:
                ref, reference = render_reference(args, folder/f"ref-{layout}", layout, scenario, env, geometry, reduced, settings_height)
                checked(all(geometry[k] == reference[k] for k in ("hwndSize","crop","origin","dpi")) and
                        reference["metrics"]["dpr"] == geometry["dpi"]/96, "QGT-116: native reference geometry differs")
            name = label + "-" + layout
            metrics = compare(args.output, name, image, ref)
            report["cases"][name] = {"product": geometry, "reference": reference, "reducedMotion":reduced,
                                     "readingsBeforeCollapse":observations, "fullHWNDImage":full_frame,
                                     "settingsHWNDHeightBeforeCollapse":settings_height or None,
                                     "idleRepeatChangedRGBPixels":changes, **metrics}
            save_json(args.output / "report.json", report)
        if scenario == "ready" and reduced:
            set_layout(hwnd, False)
            pointer_away(hwnd)
            time.sleep(.45)
            report["details"] = {"ready":verify_details(args,hwnd)}
            if args.states:
                invalid = ag_panel(NORMAL).replace(markup(NORMAL["partner"],"partner"),
                                                   "<p>Five Hour Limit Remaining</p><p>Unavailable</p>")
                ag_page.locator("main").evaluate("(e,html) => { e.innerHTML=html; }", invalid)
                action(hwnd, "刷新")
                wait_for(lambda: any("4/6" in i["name"] for i in ui(hwnd)), "unreadable AG partner")
                pointer_away(hwnd)
                time.sleep(.4)
                report["details"]["unreadable"] = verify_details(args,hwnd,diagnostic=True)
                report["taskInteractions"] = task_interactions(hwnd)
            save_json(args.output/"report.json",report)
    finally:
        product.terminate()
        product.wait(timeout=5)


def execute(args, report):
    ctypes.windll.user32.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))
    desktop = win32service.GetThreadDesktop(win32api.GetCurrentThreadId())
    checked(win32service.GetUserObjectInformation(desktop, win32con.UOI_NAME) == args.worker,
            "QGT-105: production reader must run on this run's private desktop")
    root = args.profile
    env = {**os.environ, "USERPROFILE":str(root), "LOCALAPPDATA":str(root/"local"),
           "APPDATA":str(root/"roaming"), "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER":str(args.runtime),
           "CODEX_HOME":str(root/"codex"), "CODEX_SQLITE_HOME":str(root/"codex"), "ZCODE_DATA_BASE_DIR":str(root),
           "CODEX_CREDITS_ZCODE_CONFIG_DIR":str(root/"zcode-config"),
           "QUODEX_TASK_IPC_ENDPOINT":r"\\.\pipe\quodex-twin-no-task-server",
           "CODEX_CREDITS_APP_SERVER_EXECUTABLE":shutil.which("node"),
           "CODEX_CREDITS_APP_SERVER_ARGS":json.dumps([str(ROOT/"fixtures/app-server-fixture.mjs")]),
           "CODEX_CREDITS_HEALTH_ENDPOINT":"http://127.0.0.1:9/none","CODEX_CREDITS_COUNTRY_ENDPOINT":"http://127.0.0.1:9/none"}
    args.output.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        web, _ = open_panel(pw, "gemini.google.com", "Gemini", '<section role="dialog" aria-label="Usage Limits"><h2>Usage Limits</h2>' + markup(NORMAL["web"],"web") + "</section>")
        ag, ag_page = open_panel(pw, "antigravity.google.com", "Antigravity", ag_panel(NORMAL))
        try:
            report["reader"] = "Actual Windows UI Automation reading two anonymous Edge panels on a private desktop"
            if args.repeat_extremes:
                for i in range(args.repeat_extremes):
                    measure_case(args, "extremes", env, ag_page, report, label=f"extremes-{i + 1}")
                return
            if args.states:
                measure_case(args, "ready", env, ag_page, report, reduced=False)
            for scenario in (["zero", "missing", "stale", "extremes", "ready"] if args.states else ["ready"]):
                measure_case(args, scenario, env, ag_page, report)
        finally:
            web.close()
            ag.close()


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--executable", type=pathlib.Path, required=True)
    parser.add_argument("--runtime", type=pathlib.Path, required=True)
    parser.add_argument("--sdk", type=pathlib.Path, required=True, help="Path to Microsoft.Web.WebView2.Core.dll")
    parser.add_argument("--loader", type=pathlib.Path, required=True, help="Directory containing the x64 WebView2Loader.dll")
    parser.add_argument("--output", type=pathlib.Path, required=True)
    coverage = parser.add_mutually_exclusive_group()
    coverage.add_argument("--optical-study", action="store_true", help="Compare the normal sample to the approved thick-glass image in both layouts")
    coverage.add_argument("--states", action="store_true", help="Include normal motion, depleted, missing, stale, five-hour extremes and a real reader diagnostic")
    coverage.add_argument("--repeat-extremes", type=int, metavar="RUNS", help="Independently cold-start and compare only a normal to 0/100 update")
    parser.add_argument("--source-revision", help="Known source commit for the supplied executable")
    parser.add_argument("--worker", help=argparse.SUPPRESS)
    parser.add_argument("--profile", type=pathlib.Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.repeat_extremes is not None and args.repeat_extremes < 1:
        parser.error("--repeat-extremes requires a positive run count")
    args.repeat_extremes = args.repeat_extremes or 0
    for key in ("executable","runtime","sdk","loader","output"):
        setattr(args, key, getattr(args,key).resolve())
    return args


if __name__ == "__main__":
    args = arguments()
    if not args.worker:
        sys.exit(run_private(args))
    args.output.mkdir(parents=True, exist_ok=True)
    report = {"status":"Blocked","executableSHA256":sha256(args.executable),
              "productSourceRevision":args.source_revision,"windowsVersion":platform.version(),
              "pythonVersion":platform.python_version(),"normalFiveHourWeekly":NORMAL,
              "capture":"Win32 PrintWindow PW_RENDERFULLCONTENT, RGB on black backing; entire quota surface including footer; no actual image resampling, no mask, zero tolerance",
              "designGitRevision":subprocess.check_output(["git","log","-1","--format=%H","--","docs/design/gemini-quota-windows/liquid/twin"],cwd=ROOT,text=True).strip(),
              "runtimeSHA256":sha256(args.runtime/"msedgewebview2.exe"),"cases":{}}
    if args.optical_study:
        report["designGitRevision"] = subprocess.check_output(
            ["git", "log", "-1", "--format=%H", "--", str(OPTICAL_STUDY.relative_to(ROOT))], cwd=ROOT, text=True
        ).strip()
        report["visualCoverage"] = "normal readings in both layouts; the optical study contains only this state"
    try:
        manifest = args.executable.with_name("manifest.json")
        if manifest.is_file():
            metadata = json.loads(manifest.read_text(encoding="utf-8-sig"))
            entry = next((file for file in metadata.get("files", []) if file.get("path") == args.executable.name), None)
            if entry is not None:
                checked(entry["sha256"].lower() == report["executableSHA256"], "QGT-125: executable differs from release manifest")
                commit = metadata.get("sourceCommit")
                checked(not args.source_revision or args.source_revision == commit, "QGT-126: source revision differs from release manifest")
                report["productSourceRevision"] = commit
                report["manifestSHA256"] = sha256(manifest)
        execute(args, report)
        cases = report["cases"]
        report["comparedRGBPixels"] = sum(case["pixels"] for case in cases.values())
        report["changedRGBPixels"] = sum(case["changedRGBPixels"] for case in cases.values())
        report["differingCases"] = [name for name, case in cases.items()
                                    if case["changedRGBPixels"] or any(case["idleRepeatChangedRGBPixels"])]
        details = report.get("details", {})
        report["differingDetailReturns"] = [name for name, case in details.items() if case["restoredChangedRGBPixels"]]
        expected_cases = 2*args.repeat_extremes if args.repeat_extremes else 12 if args.states else 2
        if (len(cases) == expected_cases and (args.repeat_extremes or details) and
                not report["differingCases"] and not report["differingDetailReturns"]):
            report["status"] = "Verified"
    except Exception as error:
        report["error"] = f"{type(error).__name__}: {error}"
    save_json(args.output/"report.json", report)
    sys.exit(0 if report["status"] == "Verified" else 1)
