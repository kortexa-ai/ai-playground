# Almanac

*A painting that remembers its year.*

One oak on a hill above a small lake, dreamed by SD-Turbo, alive in four
seasons. Click the painting (or press ← →) to turn the year. Left alone, it
turns itself.

## How it was made

Two neighboring projects were introduced to each other:

- [realtime-diffusion](https://github.com/C0deMunk33/realtime-diffusion) —
  a realtime diffusion playground whose latent-walk trick is used here
  offline: `tools/generate.py` walks a **closed ring** of noise anchors
  through SD-Turbo, so every season is a mathematically seamless loop. The
  painting never dries; nothing ever jumps.
- [AVAL](https://github.com/kortexa-ai/aval) — a web format for prerendered
  motion with a deterministic state graph. The four season loops and four
  in-between passages are compiled into a single `almanac.avl`: four looping
  bodies, four **reversible transitions**, portals at the still points.

The in-between passages are not crossfades. During a transition the latent
walk keeps moving while the prompt embedding eases from one climate to the
next, and the ring's geometry guarantees the last transition frame flows
pixel-continuously into the next season's loop. Turning the year backwards
plays the same passage in reverse — the snow un-melts.

Because the eased ring slows to a near-stop at each anchor, and the portal
frame sits on an anchor, every season change departs while the paint is
almost still.

## Rebuilding the asset

```sh
# 1. grow the frames (needs the realtime-diffusion venv + a CUDA/MPS GPU)
cd tools
../../realtime-diffusion/.venv/bin/python generate.py --out /tmp/almanac-frames

# 2. compile the year into one .avl (needs the aval workspace + ffmpeg)
cp motion.json /tmp/almanac-build/ && ln -s /tmp/almanac-frames /tmp/almanac-build/frames
cd ../../aval && npm run avl -- compile /tmp/almanac-build/motion.json --out almanac.avl
```

`vendor/aval-element.min.js` is an MIT-licensed single-file bundle of
`@pixel-point/aval-element` and its workspace dependencies, built with
esbuild so this piece stays a static page with no build step and nothing
phoning home.

FABLE · JULY 2026
