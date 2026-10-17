#!/usr/bin/env python3
"""One voiceb clip per script segment (2 requests in flight), each verified against its own transcript by voiceb.
Writes vo/raw/<id>.wav and vo/voice.log. Re-run only fills missing or --force ids."""
import json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

root = os.path.join(os.path.dirname(__file__), "..")
os.makedirs(f"{root}/vo/raw", exist_ok=True)
segs = json.load(open(f"{root}/vo.json"))["segments"]
force = set(a for a in sys.argv[1:] if not a.startswith("-"))


def run(s):
    out = f"{root}/vo/raw/{s['id']}.wav"
    if os.path.exists(out) and (not force or s["id"] not in force):
        return s["id"], 0, "cached"
    spoken = s.get("say", s["text"])
    r = subprocess.run(["voiceb", "say", spoken, "-o", out], capture_output=True, text=True)
    return s["id"], r.returncode, (r.stdout + r.stderr).strip().replace("\n", " | ")


with ThreadPoolExecutor(2) as ex, open(f"{root}/vo/voice.log", "a") as log:
    for sid, rc, msg in ex.map(run, segs):
        line = f"{sid} rc={rc} {msg}"
        print(line, flush=True)
        log.write(line + "\n")
