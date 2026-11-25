"""Transfer only side-wall specular highlights from the approved optical study."""
from pathlib import Path
from PIL import Image, ImageOps
import math

root = Path(__file__).resolve().parents[1]
reference = root / "docs/design/gemini-quota-windows/liquid/twin/material/optical-glass-study.png"
size = (172, 108)
layouts = [
    ("standard", [(260, 61, 847, 404), (923, 62, 1518, 403)]),
    ("narrow", [(411, 644, 795, 834), (826, 644, 1213, 834)]),
]

def ramp(value, start, stop):
    fraction = max(0, min(1, (value - start) / (stop - start)))
    return fraction * fraction * (3 - 2 * fraction)

sheet = Image.open(reference).convert("RGB")
texture = Image.new("RGBA", (2 * size[0], 2 * size[1]))
for row, (layout, apertures) in enumerate(layouts):
    for column, bounds in enumerate(apertures):
        material = sheet.crop(bounds).resize(size, Image.Resampling.LANCZOS)
        luma = ImageOps.grayscale(material)
        layer = Image.new("RGBA", size)
        for y in range(size[1]):
            v = (y + .5) / size[1]
            side_height = ramp(v, .25, .38) * (1 - ramp(v, .76, .89))
            chord = math.sqrt(max(.01, 1 - (2 * v - 1) ** 2)) if layout == "standard" else 1
            for x in range(size[0]):
                radial = abs((x + .5) / size[0] - .5) * 2 / chord
                wall = ramp(radial, .68, .84) * (1 - ramp(radial, .97, 1.02))
                if layout == "standard" and 29 <= y <= 45:
                    needle_side = x < 22 if column == 0 else x >= 146
                    if needle_side:
                        wall = 0
                luminance = luma.getpixel((x, y))
                alpha = round(195 * side_height * wall * ramp(luminance, 59, 175))
                pixel = material.getpixel((x, y))
                light = tuple(round(channel * .67 + luminance * .33) for channel in pixel)
                layer.putpixel((x, y), (*light, alpha))
        texture.paste(layer, (column * size[0], row * size[1]))
texture.save(root / "src/twin-glass-reflections.webp", lossless=True, method=6)

# Keep only the transmitted blue or violet light. The colored layer excludes
# the neutral and warm typesetting and can be positioned by a live liquid level.
light_bands = [
    (284, 153, 828, 194), (948, 290, 1494, 315),
    (419, 685, 784, 711), (830, 768, 1200, 797),
    (301, 313, 807, 389), (967, 328, 1456, 393),
    (425, 786, 779, 826), (839, 787, 1193, 826),
]
strip = Image.new("RGBA", (size[0], 16 * len(light_bands)))
for row, bounds in enumerate(light_bands):
    image = sheet.crop(bounds).resize((size[0], 16), Image.Resampling.LANCZOS)
    for y in range(16):
        fade = ramp(y, -1, 4) * (1 - ramp(y, 12, 16))
        for x in range(size[0]):
            red, green, blue = image.getpixel((x, y))
            hue = blue - red if row % 2 == 0 else min(blue, red) - green
            alpha = round(190 * fade * ramp(hue, 18, 65) * ramp(blue, 105, 230))
            if row >= 4:
                side = abs((x + .5) / size[0] - .5)
                alpha = round(alpha * ramp(side, .12, .28))
            strip.putpixel((x, row * 16 + y), (red, green, blue, alpha))
strip.save(root / "src/twin-glass-waterline.webp", lossless=True, method=6)

# Only the outside steel ring is fixed. The inner arc and both needles are
# painted by the app, so exclude their full paths from this layer.
panel = sheet.crop((194, 17, 1577, 601)).resize((300, 130), Image.Resampling.LANCZOS)
trim = Image.new("RGBA", (282, 83))
for column, (start, center) in enumerate(((7, 77), (152, 223))):
    for y in range(83):
        for x in range(141):
            window_x, window_y = start + x, 3 + y
            red, green, blue = panel.getpixel((window_x, window_y))
            radius = math.hypot((window_x + .5 - center) / 72, (window_y + .5 - 45) / 43)
            lower_edge = .89 if window_y >= 46 else .94
            mask = ramp(radius, lower_edge, lower_edge + .02) * (1 - ramp(radius, 1.005, 1.03))
            needle_side = window_x < 29 if column == 0 else window_x > 277
            if red - min(green, blue) > 17 or (24 <= window_y <= 45 and needle_side):
                mask = 0
            trim.putpixel((column * 141 + x, y), (red, green, blue, round(255 * mask)))
trim.save(root / "src/twin-glass-steel.webp", lossless=True, method=6)
