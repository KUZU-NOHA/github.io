"""Poll books; when all 13 images_hires exist, build interior+cover PDFs, previews, copy to kdp-upload/.
python3 common/build_when_ready.py <book_dir> ...   (prints 'BUILT <book>' once per book)"""
import os, sys, time, subprocess
from PIL import Image
NAMES = [f"s{i:02d}" for i in range(1, 13)] + ["cover"]
root = os.path.dirname(os.path.abspath(__file__))
books = [os.path.abspath(b) for b in sys.argv[1:]]
done = set()
def previews(b):
    import glob
    fs = sorted(glob.glob(os.path.join(b, "out", "preview", "p*.png")))
    w, cols = 330, 8
    ims = [Image.open(f).convert("RGB") for f in fs]; ims = [i.resize((w, int(w * i.height / i.width))) for i in ims]
    h = ims[0].height; rows = (len(ims) + cols - 1) // cols
    S = Image.new("RGB", (w * cols + (cols + 1) * 8, h * rows + (rows + 1) * 8), (90, 90, 90))
    for k, i in enumerate(ims): S.paste(i, (8 + (k % cols) * (w + 8), 8 + (k // cols) * (h + 8)))
    S.save(os.path.join(b, "preview-all-pages.jpg"), quality=88)
    Image.open(os.path.join(b, "out", "cover-preview.png")).convert("RGB").resize((2000, int(2000 * 2625 / 5198))).save(os.path.join(b, "preview-cover.jpg"), quality=90)
while len(done) < len(books):
    for b in books:
        if b in done: continue
        if all(os.path.exists(os.path.join(b, "images_hires", n + ".png")) for n in NAMES):
            try:
                for n in NAMES:  # make sure every upscaled image is fully written and readable
                    im = Image.open(os.path.join(b, "images_hires", n + ".png")); im.load()
                subprocess.run(["python3", os.path.join(root, "build_book.py"), b], check=True, capture_output=True)
                subprocess.run(["python3", os.path.join(root, "build_cover.py"), b], check=True, capture_output=True)
                os.makedirs(os.path.join(b, "kdp-upload"), exist_ok=True)
                for f in ("interior.pdf", "cover.pdf"):
                    subprocess.run(["cp", os.path.join(b, "out", f), os.path.join(b, "kdp-upload", f)], check=True)
                previews(b)
                print("BUILT", os.path.basename(b), flush=True)
                done.add(b)
            except Exception as e:
                print("FAILED (will retry)", os.path.basename(b), e, flush=True)
    time.sleep(60)
print("ALL_BUILT", flush=True)
