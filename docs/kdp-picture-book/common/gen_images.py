"""Generate the 13 art files of a book with Codex (ChatGPT image generation), 4 in parallel.

python3 common/gen_images.py <book_dir> [--only s02,s03]
Spec section "gen": {"refs": [...], "common": str, "spread": str, "scenes": {s01..s12, cover}, "scene_refs": {name: [...]}}
Existing files are skipped; delete a file (and its images_hires copy) to regenerate it.
"""
import os, sys, json, subprocess, concurrent.futures as cf

book = os.path.abspath(sys.argv[1])
only = None
if "--only" in sys.argv:
    only = sys.argv[sys.argv.index("--only") + 1].split(",")
spec = json.load(open(os.path.join(book, "spec.json"), encoding="utf-8"))
g = spec["gen"]
img = os.path.join(book, "images")
logs = "/tmp/claude-0/genlogs"
os.makedirs(logs, exist_ok=True)

def prompt(name):
    scene = g["scenes"][name]
    if name == "cover":
        return g["common"] + scene + " Request the largest output size the tool supports. Save the final PNG as ./cover.png and report its exact pixel size."
    return g["common"] + g["spread"] + "Scene: " + scene + f" Save the final PNG as ./{name}.png and report its exact pixel size."

def run(name):
    out = os.path.join(img, name + ".png")
    if os.path.exists(out):
        return name, "exists"
    refs = g.get("scene_refs", {}).get(name, g["refs"])
    cmd = ["codex", "exec", "--skip-git-repo-check", "--sandbox", "workspace-write"]
    for r in refs:
        cmd += ["-i", r]
    try:
        with open(os.path.join(logs, f"{os.path.basename(book)}-{name}.log"), "w") as lf:
            subprocess.run(cmd, input=prompt(name).encode(), cwd=img, stdout=lf, stderr=subprocess.STDOUT, timeout=1500)
    except Exception as e:
        return name, "error " + str(e)
    return name, "ok" if os.path.exists(out) else "missing"

names = only or list(g["scenes"].keys())
with cf.ThreadPoolExecutor(4) as ex:
    for n, r in ex.map(run, names):
        print(n, r, flush=True)
print("GEN_DONE", flush=True)
