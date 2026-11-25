"""Capture the material study inside the approved standard and narrow layouts."""
from pathlib import Path
import base64
from playwright.sync_api import sync_playwright

folder = Path(__file__).resolve().parent
entry = folder.parent / "index.html"
liquid = folder.parents[1] / "liquid.js"
source = liquid.read_text(encoding="utf-8")
start = source.index("  function draw(")
end = source.index("  function ", source.index("\n  }", start) + 4)
replacement = source[:start] + folder.joinpath("cavity.js").read_text(encoding="utf-8") + source[end:]

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="msedge", args=["--allow-file-access-from-files"])
    page = browser.new_page(viewport={"width":1200,"height":900}, device_scale_factor=2)
    rows = []
    for revised in (False, True):
        if revised:
            page.route("**/liquid.js",lambda route: route.fulfill(body=replacement,content_type="application/javascript"))
        page.goto(entry.as_uri())
        page.wait_for_function("Array.from(document.querySelectorAll('canvas.q-liquid')).some(c => c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data[3])")
        page.add_style_tag(content=".enlarged-standard{zoom:1}")
        captures = []
        for selector,width in [('[data-host="standard"] .surface',360),('#native-strip .surface',312)]:
            loc = page.locator(selector)
            assert loc.locator(".q-value").count() == 6
            encoded = base64.b64encode(loc.screenshot()).decode()
            captures.append(f'<img width="{width}" src="data:image/png;base64,{encoded}">')
        rows.append(captures)
    assert rows[0][0] != rows[1][0] and rows[0][1] != rows[1][1]
    cols = "".join("<section><h2>"+title+"</h2>"+"".join(row)+"</section>" for title,row in zip(["原材质","异形舱内壁"],rows))
    page.set_content('<meta charset=utf-8><style>*{box-sizing:border-box}body{margin:0;font:15px Microsoft YaHei UI;color:#233542}main{width:max-content;padding:22px 28px 30px;background:#dce3e4;display:flex;gap:28px}h2{font-size:16px;font-weight:600;margin:0}section{display:grid;gap:16px;justify-items:start}img{display:block}</style><main>'+cols+'</main>')
    page.locator("main").screenshot(path=folder/"comparison.png")
    browser.close()
