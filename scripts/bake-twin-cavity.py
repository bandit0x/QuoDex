"""Restore the aperture colors behind the artwork text for live rendering."""
from pathlib import Path
from PIL import Image
import numpy as np

root = Path(__file__).resolve().parents[1]
reference = root / "docs/design/gemini-quota-windows/liquid/twin/material/optical-glass-study.png"
source = Image.open(reference).convert("RGB")
bounds = [
    (260, 61, 847, 404), (923, 62, 1518, 403),
    (411, 644, 795, 834), (826, 644, 1213, 834),
]
letter_boxes = [
    [(422,106,699,158),(386,183,716,273),(408,307,706,379)],
    [(1020,106,1428,158),(1029,181,1405,267),(1076,308,1350,379)],
    [(499,649,746,690),(531,692,678,751),(531,747,678,810)],
    [(831,649,1209,690),(954,692,1080,751),(951,747,1083,810)],
]
size = (172,108)
sheet = Image.new("RGBA", (344,216))
for index, (box, text) in enumerate(zip(bounds, letter_boxes)):
    left, top, right, bottom = box
    material = np.asarray(source.crop(box).resize(size, Image.Resampling.LANCZOS),dtype=float).copy()
    for x1,y1,x2,y2 in text:
        x1,x2 = [max(2,min(170,round((x-left) / (right-left) * 172))) for x in (x1,x2)]
        y1,y2 = [max(1,min(107,round((y-top) / (bottom-top) * 108))) for y in (y1,y2)]
        for y in range(y1,y2):
            a = material[y, x1-2:x1].mean(0)
            b = material[y, x2:x2+2].mean(0)
            t = np.linspace(0,1,x2-x1)[:,None]
            material[y,x1:x2] = a*(1-t) + b*t
    y,x = np.meshgrid(np.linspace(-1,1,108),np.linspace(-1,1,172),indexing="ij")
    if index < 2:
        dist = (np.abs(x)**2 + np.abs(y)**2)**.5
        opacity = np.clip((1.01-dist)/.13,0,1)*250
    else:
        dist = (np.abs(x)**3.7 + np.abs(y)**3.7)**(1/3.7)
        opacity = np.clip((.91-dist)/.23,0,1)*225
    layer = Image.fromarray(np.rint(np.dstack((material,opacity))).astype("uint8"))
    sheet.paste(layer,((index%2)*172,(index//2)*108))
sheet.save(root / "src/twin-glass-cavity.webp", lossless=True, method=6)
