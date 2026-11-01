"""Real-ESRGAN x4 upscaling queue for several books (CPU). Run with the venv python:
/tmp/claude-0/upv/bin/python common/upscale_queue.py <book_dir> [<book_dir> ...]
For each book it upscales images/<name>.png -> images_hires/<name>.png when the source exists and the hires copy does not.
Keeps polling until every expected file exists (or /tmp/claude-0/upscale.stop appears)."""
import os, sys, time, torch, numpy as np
from PIL import Image
from spandrel import ModelLoader
torch.set_num_threads(4)
m = ModelLoader().load_from_file("/tmp/claude-0/weights/RealESRGAN_x4plus.pth").eval()
NAMES = [f"s{i:02d}" for i in range(1, 13)] + ["cover"]

def up(src, dst, tile=384, pad=16):
    im = Image.open(src).convert("RGB")
    a = torch.from_numpy(np.asarray(im).astype("float32") / 255).permute(2, 0, 1)[None]
    _, _, H, W = a.shape; S = m.scale; out = torch.zeros(1, 3, H * S, W * S)
    with torch.no_grad():
        for y in range(0, H, tile):
            for x in range(0, W, tile):
                y0, x0 = max(y - pad, 0), max(x - pad, 0); y1, x1 = min(y + tile + pad, H), min(x + tile + pad, W)
                r = m(a[:, :, y0:y1, x0:x1]).clamp(0, 1)
                oy, ox = (y - y0) * S, (x - x0) * S; h, w = min(tile, H - y) * S, min(tile, W - x) * S
                out[:, :, y * S:y * S + h, x * S:x * S + w] = r[:, :, oy:oy + h, ox:ox + w]
    Image.fromarray((out[0].permute(1, 2, 0).numpy() * 255).round().astype("uint8")).save(dst)

books = [os.path.abspath(b) for b in sys.argv[1:]]
for b in books:
    os.makedirs(os.path.join(b, "images_hires"), exist_ok=True)
while True:
    did = False
    for b in books:
        for n in NAMES:
            src = os.path.join(b, "images", n + ".png"); dst = os.path.join(b, "images_hires", n + ".png")
            if os.path.exists(src) and not os.path.exists(dst):
                t = time.time(); up(src, dst + ".tmp.png"); os.replace(dst + ".tmp.png", dst)
                print("done", os.path.basename(b), n, round(time.time() - t), flush=True); did = True
                break
        if did: break
    if did: continue
    if all(os.path.exists(os.path.join(b, "images_hires", n + ".png")) for b in books for n in NAMES):
        print("ALL_DONE", flush=True); break
    if os.path.exists("/tmp/claude-0/upscale.stop"):
        print("STOPPED", flush=True); break
    time.sleep(30)
