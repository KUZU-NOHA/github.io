"""Build the KDP interior PDF (8.5x8.5in trim, 0.125in bleed on outer/top/bottom, 300dpi).

Usage: python3 build_book.py   (reads images/*.png, writes out/interior.pdf and out/preview/*.png)
"""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
DPI = 300
IN = lambda x: int(round(x * DPI))
TRIM = 8.5
BLEED = 0.125
PW, PH = IN(TRIM + BLEED), IN(TRIM + 2 * BLEED)   # page incl. bleed (gutter side has none)
CREAM = (253, 246, 231)
INK = (74, 44, 28)
FONT = os.path.join(HERE, "fonts", "FredokaOne-Regular.ttf")

STORY = [  # (left page text, right page text, text position)
    ("Tomorrow was Fennel\u2019s first day of school.", "He packed his new backpack. \u201cThis will be cool!\u201d", "top"),
    ("But when the moon rose and the house grew still,", "a tiny thought wiggled and gave him a chill.", "top"),
    ("\u201cWhat if I get lost? What if no one plays?", "What if I forget what my teacher says?\u201d", "top"),
    ("Each \u201cwhat if\u201d became a gray, tangly thread,", "and they twisted and tangled inside his head.", "top"),
    ("The tangle grew bigger. It filled up his bed.", "It squeezed in his tummy and buzzed in his head.", "top"),
    ("\u201cMama,\u201d whispered Fennel, \u201cI have a Big Gray Worry.\u201d", "Mama Bear came in, no hurry, no hurry.", "top"),
    ("\u201cFirst, SAY it out loud. Let the worry come out.\u201d", "\u201cWhat if no one plays with me?\u201d sniffed Fennel, in doubt.", "top"),
    ("\u201cNext, UNTANGLE it. One thread at a time.", "What is one small thing that could make it fine?\u201d", "top"),
    ("\u201cI could smile,\u201d said Fennel. \u201cI could say hello.", "I could ask, \u2018Can I play?\u2019 and give it a go.\u201d", "top"),
    ("\u201cLast, take one small STEP. That\u2019s all you need.\u201d", "The gray tangle shrank to a small ball of thread.", "top"),
    ("Next morning at the gate, his tummy went flip,", "but he took one small step and he gave a small skip.", "top"),
    ("A bunny in blue said, \u201cHi! Want to play?\u201d", "And Fennel\u2019s Big Gray Worry just floated away.", "top"),
]


def to_cream(im):
    """Re-map the character sheet's paper tone to the page colour so crops have no visible box."""
    import numpy as np
    a = np.asarray(im).astype("float32")
    bg = np.array([254, 248, 232], dtype="float32")
    a = a / bg * np.array(CREAM, dtype="float32")
    return Image.fromarray(a.clip(0, 255).astype("uint8"))


def font(pt):
    return ImageFont.truetype(FONT, IN(pt / 72))


def wrap(draw, text, fnt, maxw):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=fnt) <= maxw:
            cur = t
        else:
            lines.append(cur)
            cur = w
    lines.append(cur)
    if len(lines) == 2:  # balance two-line blocks so the second line is not a lone word
        best = None
        for i in range(1, len(words)):
            a, b = " ".join(words[:i]), " ".join(words[i:])
            wa, wb = draw.textlength(a, font=fnt), draw.textlength(b, font=fnt)
            if max(wa, wb) <= maxw and (best is None or max(wa, wb) < best[0]):
                best = (max(wa, wb), [a, b])
        if best:
            lines = best[1]
    return lines


def new_page():
    return Image.new("RGB", (PW, PH), CREAM)


def x_trim0(recto):  # x of trim-box left edge on the page canvas
    return 0 if recto else IN(BLEED)


def draw_text_block(img, text, recto, pos="top", pt=22, panel=True):
    """Text inside the safe zone of one page; semi-transparent cream panel behind it."""
    x0 = x_trim0(recto)
    margin = IN(0.6)
    boxw = IN(TRIM) - 2 * margin
    f = font(pt)
    d = ImageDraw.Draw(img)
    if pos == "topright":
        boxw = IN(2.9)
    lines = wrap(d, text, f, boxw - IN(0.5))
    lh = int(f.size * 1.3)
    h = lh * len(lines) + IN(0.4)
    w = max(d.textlength(l, font=f) for l in lines) + IN(0.5)
    cx = x0 + IN(TRIM) // 2
    if pos == "topright":
        cx = x0 + IN(TRIM) - IN(0.5) - int(w / 2)
    y = IN(BLEED) + IN(0.55) if pos in ("top", "topright") else PH - IN(BLEED) - IN(0.55) - h
    if panel:
        ov = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ImageDraw.Draw(ov).rounded_rectangle([cx - w / 2, y, cx + w / 2, y + h], radius=IN(0.25), fill=(255, 250, 238, 200))
        img.paste(Image.alpha_composite(img.convert("RGBA"), ov).convert("RGB"))
        d = ImageDraw.Draw(img)
    for i, l in enumerate(lines):
        tw = d.textlength(l, font=f)
        d.text((cx - tw / 2, y + IN(0.2) + i * lh), l, font=f, fill=INK)


def hires(path):
    """Prefer the Real-ESRGAN upscaled copy (images_hires/) when it exists."""
    alt = os.path.join(os.path.dirname(os.path.dirname(path)), "images_hires", os.path.basename(path))
    return alt if os.path.exists(alt) else path


def spread_pages(path, left_text, right_text, pos):
    """One 2:1 illustration -> two bled pages (left = verso, right = recto)."""
    im = Image.open(hires(path)).convert("RGB")
    tw, th = 2 * PW, PH
    s = max(tw / im.width, th / im.height)
    im = im.resize((int(im.width * s) + 1, int(im.height * s) + 1), Image.LANCZOS)
    l, t = (im.width - tw) // 2, (im.height - th) // 2
    im = im.crop((l, t, l + tw, t + th)).filter(ImageFilter.UnsharpMask(radius=2, percent=60, threshold=2))
    left, right = im.crop((0, 0, PW, PH)), im.crop((PW, 0, 2 * PW, PH))
    lpos, rpos = pos if isinstance(pos, tuple) else (pos, pos)
    draw_text_block(left, left_text, recto=False, pos=lpos)
    draw_text_block(right, right_text, recto=True, pos=rpos)
    return left, right


def centered(img, text, y_in, pt, recto, color=INK):
    d = ImageDraw.Draw(img)
    f = font(pt)
    cx = x_trim0(recto) + IN(TRIM) // 2
    tw = d.textlength(text, font=f)
    d.text((cx - tw / 2, IN(y_in)), text, font=f, fill=color)


def title_page(recto=True):
    p = new_page()
    sheet = Image.open(os.path.join(HERE, "images", "character-sheet.png")).convert("RGB")
    bruno = to_cream(sheet.crop((20, 90, 560, 940)))
    bruno = bruno.resize((IN(2.5), int(IN(2.5) * bruno.height / bruno.width)), Image.LANCZOS)
    cx = x_trim0(recto) + IN(TRIM) // 2
    p.paste(bruno, (cx - bruno.width // 2, IN(4.3)))
    centered(p, "Fennel and", 1.0, 54, recto, (150, 40, 30))
    centered(p, "the Big Gray Worry", 1.9, 54, recto, (150, 40, 30))
    centered(p, "A story about feeling worried", 3.2, 20, recto)
    centered(p, "by KUZU NOHA", 3.75, 22, recto, (150, 40, 30))
    return p


def pose(idx, width_in):
    """Crop one of the three poses from the character sheet (0=calm, 1=angry, 2=breathing)."""
    sheet = Image.open(os.path.join(HERE, "images", "character-sheet.png")).convert("RGB")
    box = [(20, 90, 560, 940), (560, 90, 1000, 940), (1030, 90, 1520, 940)][idx]
    im = to_cream(sheet.crop(box))
    return im.resize((IN(width_in), int(IN(width_in) * im.height / im.width)), Image.LANCZOS)


def text_height(blocks):
    d = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    y = 0.0
    for text, pt, gap in blocks:
        n = len(wrap(d, text, font(pt), IN(TRIM) - IN(1.4)))
        y += n * pt * 1.35 / 72 + gap
    return y


def text_page(recto, blocks, art=None, top=None):
    p = new_page()
    y = top if top is not None else max(0.9, (TRIM + 0.25 - text_height(blocks)) / 2 - (1.6 if art else 0))
    if art is not None:
        cx = x_trim0(recto) + IN(TRIM) // 2
        p.paste(art, (cx - art.width // 2, PH - IN(BLEED) - IN(0.6) - art.height))
    for text, pt, gap in blocks:
        d = ImageDraw.Draw(p)
        f = font(pt)
        lines = wrap(d, text, f, IN(TRIM) - IN(1.4))
        cx = x_trim0(recto) + IN(TRIM) // 2
        for l in lines:
            tw = d.textlength(l, font=f)
            d.text((cx - tw / 2, IN(y)), l, font=f, fill=INK)
            y += pt * 1.35 / 72
        y += gap
    return p


def main():
    out = os.path.join(HERE, "out")
    os.makedirs(os.path.join(out, "preview"), exist_ok=True)
    pages = [None] * 32  # index = page number - 1; odd page numbers are recto
    pages[0] = title_page()
    pages[1] = text_page(False, [("Fennel and the Big Gray Worry", 20, 0.3),
                                 ("Copyright © 2026 KUZU NOHA. All rights reserved.", 14, 0.15),
                                 ("No part of this book may be reproduced without permission.", 14, 0.15),
                                 ("Illustrations were generated with AI tools and selected and arranged by the author.", 14, 0.15),
                                 ("First edition. Printed by Amazon KDP.", 14, 0)])
    pages[2] = text_page(True, [("For every little bear", 26, 0.1), ("with a big feeling.", 26, 0)])
    for k, (lt, rt, pos) in enumerate(STORY, start=1):
        a, b = spread_pages(os.path.join(HERE, "images", f"s{k:02d}.png"), lt, rt, pos)
        pages[2 * k + 2 - 1 + 0] = a      # page 2k+2 (verso)
        pages[2 * k + 3 - 1] = b          # page 2k+3 (recto)
    pages[27] = text_page(False, [("Fennel’s 3 Worry Steps", 30, 0.5),
                                  ("1. SAY IT", 26, 0.05), ("Say the worry out loud.", 20, 0.4),
                                  ("2. UNTANGLE", 26, 0.05), ("Find one small thing you can do.", 20, 0.4)],
                          art=pose(2, 2.0), top=0.9)
    pages[28] = text_page(True, [("3. STEP", 26, 0.05), ("Take one small step.", 20, 0.5),
                                 ("Worries get smaller", 24, 0.1), ("when we share them.", 20, 0)],
                         art=pose(0, 2.0), top=0.9)
    pages[29] = text_page(False, [("A Note for Grown-Ups", 26, 0.4),
                                  ("Name the feeling: “You feel worried.”", 18, 0.2),
                                  ("Listen first. You do not need to fix it.", 18, 0.2),
                                  ("Break it into one small step to try.", 18, 0.2),
                                  ("Celebrate brave steps, big or small.", 18, 0)])
    pages[30] = text_page(True, [("Thank you for reading!", 28, 0.4),
                                 ("If Fennel helped your little one, a short review on Amazon helps other families find this book.", 18, 0)])
    pages[31] = new_page()
    for i, p in enumerate(pages, start=1):
        assert p is not None and p.size == (PW, PH), i
        p.save(os.path.join(out, "preview", f"p{i:02d}.png"))
    pages[0].save(os.path.join(out, "interior.pdf"), save_all=True, append_images=pages[1:], resolution=DPI, quality=95)
    print("pages:", len(pages), "page px:", (PW, PH), "->", os.path.join(out, "interior.pdf"))


if __name__ == "__main__":
    main()
