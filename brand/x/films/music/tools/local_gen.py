#!/usr/bin/env python3
"""Local ACE-Step 1.5 text2music on Apple Silicon (run inside the ACE-Step-1.5 repo venv).

Usage (from the repo dir):  uv run --frozen python local_gen.py --prompt "..." --duration 24 --bpm 120 \
    --seeds 11,22,33 --outdir out --tag cand
Writes <outdir>/<tag>_s<seed>.wav (48 kHz stereo) and <tag>_s<seed>.json (params + wall time).
DiT only (no LM, thinking off) keeps the footprint near 6 GB of weights.
"""
import argparse, json, os, sys, time

os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
sys.path.insert(0, os.getcwd())
from acestep.handler import AceStepHandler
from acestep.llm_inference import LLMHandler
from acestep.inference import GenerationParams, GenerationConfig, generate_music


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--prompt", required=True)
    a.add_argument("--lyrics", default="[Instrumental]")
    a.add_argument("--duration", type=float, required=True)
    a.add_argument("--bpm", type=int)
    a.add_argument("--key", default="")
    a.add_argument("--timesig", default="4")
    a.add_argument("--seeds", default="42", help="comma separated; one clip per seed")
    a.add_argument("--steps", type=int, default=8)
    a.add_argument("--config", default="acestep-v15-turbo")
    a.add_argument("--no-mlx", action="store_true", help="torch MPS only: skips the MLX weight copy, about half the RAM")
    a.add_argument("--outdir", default="out")
    a.add_argument("--tag", default="gen")
    a = a.parse_args()
    os.makedirs(a.outdir, exist_ok=True)

    t0 = time.time()
    dit = AceStepHandler()
    msg, ok = dit.initialize_service(project_root=os.getcwd(), config_path=a.config, device="auto", offload_to_cpu=False, use_mlx_dit=not a.no_mlx)
    if not ok:
        sys.exit(f"DiT init failed: {msg}")
    dit.use_mlx_vae = False  # the MLX fp32 VAE decode spiked about 6 GB of swap on a 16 GB Mac; torch MPS decodes in 32-frame tiles
    load_s = time.time() - t0
    print(f"loaded {a.config} in {load_s:.1f}s", flush=True)

    for seed in [int(s) for s in a.seeds.split(",")]:
        p = GenerationParams(
            task_type="text2music", thinking=False, caption=a.prompt, lyrics=a.lyrics,
            instrumental=(a.lyrics.strip() == "[Instrumental]"), bpm=a.bpm, keyscale=a.key,
            timesignature=a.timesig, duration=a.duration, inference_steps=a.steps,
            guidance_scale=1.0, seed=seed, vocal_language="unknown",
            use_cot_metas=False, use_cot_caption=False, use_cot_language=False,
        )
        c = GenerationConfig(batch_size=1, use_random_seed=False, seeds=[seed], audio_format="wav")
        t1 = time.time()
        r = generate_music(dit, LLMHandler(), p, c, save_dir=a.outdir)
        wall = time.time() - t1
        if not r.success or not r.audios:
            sys.exit(f"seed {seed} failed: {r.error or r.status_message}")
        dst = os.path.join(a.outdir, f"{a.tag}_s{seed}.wav")
        os.replace(r.audios[0]["path"], dst)
        json.dump({"model": a.config, "prompt": a.prompt, "lyrics": a.lyrics, "bpm": a.bpm, "key": a.key,
                   "duration": a.duration, "steps": a.steps, "seed": seed, "gen_seconds": round(wall, 1),
                   "load_seconds": round(load_s, 1)}, open(dst[:-4] + ".json", "w"), indent=1)
        print(f"seed {seed}: {dst} in {wall:.1f}s", flush=True)


if __name__ == "__main__":
    main()
