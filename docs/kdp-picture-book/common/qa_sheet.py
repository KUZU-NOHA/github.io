"""Visual QA sheets: python3 common/qa_sheet.py <book_dir> -> /tmp/claude-0/qa-<folder>-a.jpg, -b.jpg (+ cover).
Red line = gutter, magenta box = central strip that must stay free of faces/key objects."""
import os, sys
from PIL import Image, ImageDraw
b = os.path.abspath(sys.argv[1]); tag = os.path.basename(b)
W = 900
def sheet(names, out):
    ims = [Image.open(os.path.join(b, "images", n + ".png")).convert("RGB") for n in names]
    ims = [i.resize((W, int(W * i.height / i.width))) for i in ims]
    cols = 2; rows = (len(ims) + 1) // 2; h = max(i.height for i in ims)
    S = Image.new("RGB", (W * cols, h * rows), "white"); d = ImageDraw.Draw(S)
    for k, i in enumerate(ims):
        x, y = (k % cols) * W, (k // cols) * h
        S.paste(i, (x, y)); d.line([(x + W // 2, y), (x + W // 2, y + h)], fill=(255, 0, 0), width=1)
        d.rectangle([x + int(W * .425), y, x + int(W * .575), y + h - 1], outline=(255, 0, 255))
        d.text((x + 6, y + 4), names[k], fill=(0, 0, 0))
    S.save(out, quality=88)
sheet([f"s{i:02d}" for i in range(1, 7)], f"/tmp/claude-0/qa-{tag}-a.jpg")
sheet([f"s{i:02d}" for i in range(7, 13)], f"/tmp/claude-0/qa-{tag}-b.jpg")
Image.open(os.path.join(b, "images", "cover.png")).convert("RGB").resize((700, 700)).save(f"/tmp/claude-0/qa-{tag}-cover.jpg", quality=88)
print("ok")
