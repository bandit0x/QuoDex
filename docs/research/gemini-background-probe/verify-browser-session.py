"""Windows-only, offline persistent browser session test. No extension or driver."""
import ctypes
from ctypes import wintypes
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import threading
import time


class Rows(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows = []
        self.row = None

    def handle_starttag(self, tag, attrs):
        if tag == "li":
            self.row = ""

    def handle_data(self, data):
        if self.row is not None:
            self.row += data

    def handle_endtag(self, tag):
        if tag == "li" and self.row is not None:
            self.rows.append(self.row)
            self.row = None


def close_fixture_window(pid, title):
    user = ctypes.windll.user32
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    matches = []

    @callback_type
    def collect(hwnd, lparam):
        owner = wintypes.DWORD()
        user.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        name = ctypes.create_unicode_buffer(2048)
        user.GetWindowTextW(hwnd, name, len(name))
        if owner.value == pid and user.IsWindowVisible(hwnd) and title in name.value:
            matches.append(hwnd)
        return True

    for _ in range(100):
        user.EnumWindows(collect, 0)
        if matches:
            break
        time.sleep(0.1)
    if len(matches) != 1:
        raise RuntimeError("Could not isolate the fixture-owned visible browser window")
    if not user.PostMessageW(matches[0], 0x0010, 0, 0):  # WM_CLOSE
        raise RuntimeError("Fixture browser did not accept window close")


def main():
    browser = next((p for p in [
        Path(os.environ["ProgramFiles"]) / "Google/Chrome/Application/chrome.exe",
        Path(os.environ["ProgramFiles(x86)"]) / "Microsoft/Edge/Application/msedge.exe",
    ] if p.is_file()), None)
    assert browser, "No existing Chrome or Edge"
    title = "QuoDex fixture " + secrets.token_hex(6)
    cookie = "workspace_fixture=" + secrets.token_hex(16)
    signed_in = threading.Event()
    samples = []
    valid = True

    class Site(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            headers = {}
            kind = "text/html; charset=utf-8"
            if self.path == "/login-complete":
                # Simulates the first-party callback after a successful interactive login.
                # The browser sets its own HttpOnly cookie. The probe cannot read its value.
                headers["Set-Cookie"] = cookie + "; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800"
                body = "<title>" + title + "</title><p>Signed in to offline fixture</p><img src='/ready'>"
            elif self.path == "/ready":
                if self.headers.get("Cookie") == cookie:
                    signed_in.set()
                body = ""
            elif self.path == "/usage":
                body = """<title>Usage</title><ul aria-label="Usage cycles"></ul><script>
                addEventListener('load',()=>setTimeout(async()=>{
                  const data=await fetch('/quota.json',{cache:'no-store'}).then(r=>r.json());
                  for(const line of data){let li=document.createElement('li');li.textContent=line;
                    document.querySelector('ul').append(li)}
                },150));</script>"""
            elif self.path == "/quota.json":
                kind = "application/json"
                if self.headers.get("Cookie") == cookie and valid:
                    sample = ["5 hours remaining 73%", "Weekly remaining 88%"] if not samples else [
                        "5 hours remaining 69%", "Weekly remaining 82%"]
                else:
                    sample = ["Sign in required"]
                samples.append(sample)
                body = json.dumps(sample)
            else:
                body = ""
            payload = body.encode()
            self.send_response(200)
            self.send_header("Content-Type", kind)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(payload)))
            for k, v in headers.items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(payload)

    with tempfile.TemporaryDirectory(prefix="quodex-owned-session-") as profile, \
            ThreadingHTTPServer(("127.0.0.1", 0), Site) as site:
        threading.Thread(target=site.serve_forever, daemon=True).start()
        origin = "http://127.0.0.1:" + str(site.server_port)
        args = [str(browser), "--user-data-dir=" + profile, "--no-first-run",
                "--no-default-browser-check", "--disable-background-mode", "--disable-background-networking",
                "--disable-sync", "--disable-extensions"]
        visible = subprocess.Popen([*args, "--new-window", origin + "/login-complete"],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            assert signed_in.wait(15), "Visible fixture did not establish a session"
            close_fixture_window(visible.pid, title)
            visible.wait(timeout=15)
            def probe():
                run = subprocess.run([*args, "--headless", "--dump-dom", "--virtual-time-budget=4000",
                                      origin + "/usage"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                     timeout=25, check=True)
                rows = Rows()
                rows.feed(run.stdout.decode("utf-8"))
                return rows.rows
            first = probe()
            second = probe()
            valid = False
            revoked = probe()
            assert [first, second, revoked] == [
                ["5 hours remaining 73%", "Weekly remaining 88%"],
                ["5 hours remaining 69%", "Weekly remaining 82%"], ["Sign in required"]]
            print(json.dumps(dict(browser=browser.name,visibleSessionClosed=True,
                                  first=first,second=second,revoked=revoked)))
        finally:
            # Kill only the spawned fixture process if its window failed to close.
            if visible.poll() is None:
                visible.terminate()
                visible.wait(timeout=10)
            site.shutdown()


if __name__ == "__main__":
    main()
