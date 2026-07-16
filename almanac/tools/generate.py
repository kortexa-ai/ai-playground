#!/usr/bin/env python
"""Almanac frame generator.

One landscape dreamed by SD-Turbo, walked around a closed ring of latent
noise so every season loops seamlessly. Season changes are authored
transitions: the walk keeps moving while the prompt embedding eases from
one season to the next, so the arrival frame of a transition is pixel-
identical to the entry frame of the next season's loop.

Run from the realtime-diffusion checkout's virtualenv:

    ../realtime-diffusion/.venv/bin/python generate.py --out frames

Frame layout (L = frames per loop, T = L - 1 transition frames):
    winter  [0, L)            loop
    w->sp   [L, L+T)          transition
    spring  [L+T, 2L+T)       loop
    ... and so on around the year.
"""

import argparse
import json
import math
from pathlib import Path

import torch
from diffusers import AutoPipelineForText2Image

MODEL = "stabilityai/sd-turbo"


def resolve_model_path(model_id: str) -> str:
    """Prefer the local HF snapshot dir; the cache here is weights-only and
    huggingface_hub refuses partial snapshots in offline mode."""
    cache = Path.home() / ".cache/huggingface/hub"
    repo = cache / ("models--" + model_id.replace("/", "--")) / "snapshots"
    if repo.is_dir():
        snaps = sorted(repo.iterdir())
        if snaps:
            return str(snaps[-1])
    return model_id

STYLE = (
    "impressionist oil painting, visible brushstrokes, dreamy soft light, "
    "muted harmonious palette, masterpiece"
)

SEASONS = [
    (
        "winter",
        "a lone ancient oak tree on a hill above a small lake, deep snow, "
        "bare dark branches, pale grey sky, cold blue morning light, ",
    ),
    (
        "spring",
        "a lone ancient oak tree on a hill above a small lake, fresh green "
        "leaves, wildflowers in the grass, rain-washed clear light, ",
    ),
    (
        "summer",
        "a lone ancient oak tree on a hill above a small lake, full deep "
        "green canopy, tall golden grass, warm hazy afternoon sun, ",
    ),
    (
        "autumn",
        "a lone ancient oak tree on a hill above a small lake, amber and "
        "crimson leaves, low golden sun, drifting morning mist, ",
    ),
]


def slerp(a: torch.Tensor, b: torch.Tensor, t: float) -> torch.Tensor:
    """Spherical interpolation between two noise tensors."""
    af = a.flatten().float()
    bf = b.flatten().float()
    dot = torch.dot(af / af.norm(), bf / bf.norm()).clamp(-1.0, 1.0)
    omega = torch.acos(dot)
    so = torch.sin(omega)
    if so.abs() < 1e-6:
        out = (1.0 - t) * af + t * bf
    else:
        out = (
            torch.sin((1.0 - t) * omega) / so * af
            + torch.sin(t * omega) / so * bf
        )
    return out.reshape(a.shape).to(a.dtype)


def ring_latent(anchors: list[torch.Tensor], t: float) -> torch.Tensor:
    """Position t in [0, 1) on the closed ring through the anchors."""
    k = len(anchors)
    seg = (t % 1.0) * k
    i = int(seg) % k
    frac = seg - int(seg)
    # Ease within each segment so the walk breathes instead of marching.
    eased = frac * frac * (3.0 - 2.0 * frac)
    return slerp(anchors[i], anchors[(i + 1) % k], eased)


def smoothstep(x: float) -> float:
    x = min(max(x, 0.0), 1.0)
    return x * x * (3.0 - 2.0 * x)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=Path("frames"))
    ap.add_argument("--frames-per-loop", type=int, default=100)
    ap.add_argument("--anchors", type=int, default=4)
    ap.add_argument("--steps", type=int, default=2)
    ap.add_argument("--size", type=int, default=512)
    ap.add_argument("--seed", type=int, default=20260716)
    ap.add_argument(
        "--preview",
        action="store_true",
        help="render one frame per season and one mid-transition, then stop",
    )
    args = ap.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32
    pipe = AutoPipelineForText2Image.from_pretrained(
        resolve_model_path(MODEL),
        torch_dtype=dtype,
        safety_checker=None,
        variant="fp16" if dtype == torch.float16 else None,
    ).to(device)
    pipe.set_progress_bar_config(disable=True)

    gen = torch.Generator(device="cpu").manual_seed(args.seed)
    latent_size = args.size // 8
    anchors = [
        torch.randn(
            (1, pipe.unet.config.in_channels, latent_size, latent_size),
            generator=gen,
        ).to(device, dtype)
        for _ in range(args.anchors)
    ]

    embeds = []
    for _, prompt in SEASONS:
        e, _ = pipe.encode_prompt(
            prompt + STYLE,
            device=device,
            num_images_per_prompt=1,
            do_classifier_free_guidance=False,
        )
        embeds.append(e)

    args.out.mkdir(parents=True, exist_ok=True)

    def render(index: int, latent: torch.Tensor, embed: torch.Tensor) -> None:
        image = pipe(
            prompt_embeds=embed,
            latents=latent.clone(),
            num_inference_steps=args.steps,
            guidance_scale=0.0,
            height=args.size,
            width=args.size,
        ).images[0]
        image.save(args.out / f"frame-{index:04d}.png")

    L = args.frames_per_loop
    T = L - 1

    if args.preview:
        for s in range(4):
            render(s, ring_latent(anchors, 0.0), embeds[s])
        # one mid-transition frame, winter -> spring
        mixed = torch.lerp(embeds[0], embeds[1], smoothstep(0.5))
        render(4, ring_latent(anchors, 0.5), mixed)
        print("preview frames 0-4 written to", args.out)
        return

    plan = []  # (name, first_frame, count) for the compile manifest
    index = 0
    for s in range(4):
        name, _ = SEASONS[s]
        nxt = (s + 1) % 4
        plan.append((name, index, L))
        for j in range(L):
            render(index, ring_latent(anchors, j / L), embeds[s])
            index += 1
        plan.append((f"{name}-to-{SEASONS[nxt][0]}", index, T))
        for k in range(1, L):
            alpha = smoothstep(k / L)
            mixed = torch.lerp(embeds[s], embeds[nxt], alpha)
            render(index, ring_latent(anchors, k / L), mixed)
            index += 1
        print(f"{name}: loop + transition done ({index} frames total)")

    manifest = {
        "framesPerLoop": L,
        "transitionFrames": T,
        "size": args.size,
        "seed": args.seed,
        "ranges": {
            name: [first, first + count] for name, first, count in plan
        },
    }
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print("manifest:", json.dumps(manifest["ranges"], indent=2))


if __name__ == "__main__":
    main()
