"""Recheck the standard Windows float after removing the two AG weekly badges."""
import argparse
import json
from pathlib import Path
from statistics import median

from PIL import Image, ImageChops, ImageDraw, ImageStat


def erase_badges(reference):
    revised = reference.copy()
    # Native 300 × 130 coordinates. Sample only the original glass to either
    # side of each approved badge. The rest of the artwork stays byte-identical.
    for left, top, right, bottom in ((48, 65, 107, 81), (192, 65, 253, 81)):
        patch = Image.new("RGB", (right - left, bottom - top))
        for y in range(top, bottom):
            neighbors = ((left - 3, left), (right, right + 3))
            start, end = [
                tuple(median(channel) for channel in zip(*(reference.getpixel((x, y)) for x in range(*side))))
                for side in neighbors
            ]
            for x in range(left, right):
                fraction = (x - left) / (patch.width - 1)
                pixel = tuple(round(a + (b - a) * fraction) for a, b in zip(start, end))
                patch.putpixel((x - left, y - top), pixel)
        mask = Image.new("L", patch.size)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, patch.width - 1, patch.height - 1), radius=6, fill=255)
        revised.paste(patch, (left, top), mask)
    return revised


def measure(actual, reference):
    difference = ImageChops.difference(actual, reference)
    pixels = actual.width * actual.height
    return {
        "meanRGBChannelAbsoluteDifference": sum(ImageStat.Stat(difference).mean) / 3,
        "differentPixels": sum(count for count, rgb in difference.getcolors(pixels) if any(rgb)),
        "comparedPixels": pixels,
    }


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("capture_folder", type=Path)
folder = parser.parse_args().capture_folder
with Image.open(folder / "ready-standard-approved.png") as image:
    reference = image.convert("RGB")
with Image.open(folder / "ready-standard-actual.png") as image:
    actual = image.convert("RGB")
if actual.size != (300, 130) or reference.size != actual.size:
    parser.error("expected matching 300 × 130 native standard captures")

revised = erase_badges(reference)
revised.save(folder / "ready-standard-without-badges-approved.png")
results = {"originalTarget": measure(actual, reference), "targetWithoutTwoBadges": measure(actual, revised)}
report = json.dumps(results, indent=2) + "\n"
(folder / "standard-channel-error.json").write_text(report, encoding="utf-8")
print(report, end="")
