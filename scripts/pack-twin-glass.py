"""Pack the optically rendered frames into lossless WebP textures for the live canvas."""
import argparse
from pathlib import Path
from PIL import Image

TILE = (172, 108)
CROPS = ((15, 6, 187, 114), (197, 6, 369, 114))
COLUMNS = 9
ROWS_PER_COLOR = 6

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("frames", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)

for layout in ("standard", "narrow"):
    atlas = Image.new("RGBA", (COLUMNS * TILE[0], 2 * ROWS_PER_COLOR * TILE[1]))
    bounds = [None, None]
    for index, percent in enumerate(range(0, 101, 2)):
        column, row = index % COLUMNS, index // COLUMNS
        with Image.open(args.frames / f"{layout}-{percent:03}.png") as frame:
            for color, crop in enumerate(CROPS):
                image = frame.convert("RGBA").crop(crop)
                edge = image.getbbox()
                assert edge is not None, f"Empty glass at {layout} {percent}%"
                if bounds[color] is None:
                    bounds[color] = edge
                assert edge == bounds[color], f"Glass changed bounds at {layout} {percent}%: {edge}"
                atlas.paste(image, (column*TILE[0], (row+color*ROWS_PER_COLOR)*TILE[1]))
    atlas.save(args.output / f"twin-glass-{layout}.webp", lossless=True, method=6)
