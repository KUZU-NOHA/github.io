"""Full-wrap paperback cover: back | spine | front, 300dpi, 0.125in bleed all round.

Spine width = pages x 0.002347in (KDP premium colour paper). Verify with KDP's cover calculator before upload.
"""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import build_book as B

DPI, IN = B.DPI, B.IN
PAGES = 32
SPINE = PAGES * 0.002347
W_IN = 2 * B.TRIM + SPINE + 2 * B.BLEED
H_IN = B.TRIM + 2 * B.BLEED
W, H = IN(W_IN), IN(H_IN)
SP0 = IN(B.BLEED + B.TRIM)           # spine left edge
FR0 = SP0 + IN(SPINE)                # front trim-left edge
HERE = B.HERE


def stroked(d, xy, text, f, fill, stroke):
    d.text(xy, text, font=f, fill=fill, stroke_width=IN(0.05), stroke_fill=stroke)


def main():
    cover = Image.new("RGB", (W, H), B.CREAM)
    art = Image.open(B.hires(os.path.join(HERE, "images", "cover.png"))).convert("RGB")
    fw, fh = IN(B.TRIM + B.BLEED), H           # front incl. right/top/bottom bleed
    s = max(fw / art.width, fh / art.height)
    art = art.resize((int(art.width * s) + 1, int(art.height * s) + 1), Image.LANCZOS)
    l, t = (art.width - fw) // 2, (art.height - fh) // 2
    art = art.crop((l, t, l + fw, t + fh)).filter(ImageFilter.UnsharpMask(radius=2, percent=60, threshold=2))
    cover.paste(art, (FR0, 0))
    d = ImageDraw.Draw(cover)
    lines = ["Fennel and", "the Big Green Jealous"]
    pt = 66
    while pt > 40 and max(d.textlength(l, font=B.font(pt)) for l in lines) > IN(6.9):  # keep title inside the safe zone
        pt -= 2
    f = B.font(pt)
    cx = FR0 + IN(B.TRIM) // 2
    for i, line in enumerate(lines):
        tw = d.textlength(line, font=f)
        stroked(d, (cx - tw / 2, IN(0.55) + i * int(IN(pt / 72) * 1.12)), line, f, (150, 40, 30), (255, 248, 230))
    f2 = B.font(24)
    sub = "A story about feeling jealous"
    tw = d.textlength(sub, font=f2)
    stroked(d, (cx - tw / 2, IN(2.6)), sub, f2, B.INK, (255, 248, 230))
    fa = B.font(32)
    auth = "KUZU NOHA"
    tw = d.textlength(auth, font=fa)
    stroked(d, (cx - tw / 2, IN(B.BLEED + B.TRIM - 0.95)), auth, fa, B.INK, (255, 248, 230))
    # back cover
    bx0 = IN(B.BLEED)
    bcx = bx0 + IN(B.TRIM) // 2
    blurb = ["A new baby came home to Fennel’s house.", "Now a prickly Big Green Jealous grows.", "",
             "With a little help from Mama Bear,", "Fennel learns three kind steps", "to tame a jealous feeling:", "Spot it. Ask. Join.", "",
             "A warm rhyming story for ages 3–6,", "with a note for grown-ups."]
    fb = B.font(20)
    y = IN(0.75)
    for line in blurb:
        tw = d.textlength(line, font=fb)
        d.text((bcx - tw / 2, y), line, font=fb, fill=B.INK)
        y += IN(0.38)
    pose = B.pose(0, 1.9)
    cover.paste(pose, (bcx - pose.width // 2, IN(B.BLEED + B.TRIM - 0.4) - pose.height - IN(0.1)))
    # barcode keep-clear area (KDP prints the barcode here): 2.0 x 1.2in, bottom-right of back cover
    out = os.path.join(HERE, "out")
    os.makedirs(out, exist_ok=True)
    cover.save(os.path.join(out, "cover.pdf"), resolution=DPI, quality=95)
    cover.save(os.path.join(out, "cover-preview.png"))
    guide = cover.copy()
    g = ImageDraw.Draw(guide)
    g.rectangle([IN(B.BLEED), IN(B.BLEED), W - IN(B.BLEED), H - IN(B.BLEED)], outline=(0, 160, 255), width=6)
    g.rectangle([SP0, 0, FR0, H], outline=(255, 0, 255), width=6)
    g.rectangle([SP0 - IN(2.25), H - IN(B.BLEED + 0.25) - IN(1.2), SP0 - IN(0.25), H - IN(B.BLEED + 0.25)], outline=(255, 0, 0), width=6)
    guide.save(os.path.join(out, "cover-guides.png"))
    print("cover size in:", round(W_IN, 3), "x", round(H_IN, 3), "px:", W, H, "spine in:", round(SPINE, 4))


if __name__ == "__main__":
    main()
