# Photophore

The camera as an invisible sea.

A quarter-million GPU particles render whatever the machine can see —
webcam, a dropped video file, or a procedural dream — as living
pointillism. The source image is never shown; particles chase its
colors, scatter from its motion, and drift home on soft springs, so
the picture is always present but never still. Named for the
light-bearing organs of deep-sea creatures.

Built with [Electrobun](https://blackboard.sh/electrobun) and
[three.js](https://threejs.org) r185 WebGPU/TSL compute shaders,
sibling to [Murmuration](../murmuration/).

## Run

```bash
bun install
bun start
```

Windows + WebGPU-capable adapter required (see Murmuration's README for
the platform quirks this stack inherits — GPU preference self-heals on
launch).

## Sources (auto-selected, best first)

1. **Camera** — any webcam, hot-plugged at any time; the app notices
   within seconds. Permission is auto-granted via browser flag because
   Electrobun's webviews currently receive no OS input on Windows —
   nobody could click "Allow".
2. **Film** — drop any video file into `photophore/media/` (or write a
   URL on the first line of `media/url.txt`; the host downloads it).
   The newest file wins and hot-swaps live. A CC-licensed jellyfish
   loop ships as the default.
3. **Dream** — a procedural reverie of drifting chromatic orbs, a
   sweeping light band, and occasional comets, so the sea is never
   empty.

## Controls (mouse gestures — see Murmuration's quirk #1)

| gesture | action |
| --- | --- |
| move | stir the light |
| hold left | gather the motes to the cursor |
| double-click | cycle mode: plankton / ember / prism |
| double-right-click | cycle source |

## How it works

- The active source draws into a small canvas (288×162); each frame the
  pipeline reads it back, computes per-texel motion (decayed frame
  difference), auto-gain (running luma min/max) and auto-exposure
  (running mean — bright daylight footage would otherwise sum 262k
  additive sprites into a white sheet), and uploads one RGBA
  DataTexture: rgb = color, a = motion.
- A TSL compute kernel moves the particles: luminance-gradient
  attraction, analytic divergence-free curl for drift, random kicks
  scaled by local motion, a spring to each particle's home (density
  stays uniform so the image always reads), and a pointer-gather force.
- Colors chase the field's auto-gained, mode-graded colors; rendering
  is additive soft-disc sprites with afterimage trails, bloom, and a
  vignette.
- Video files stream from the bun process over RPC in base64 chunks and
  play from a Blob URL — this keeps the canvas readback untainted
  (cross-origin video would poison `getImageData`) and sidesteps
  custom-scheme media streaming entirely.

## Lessons collected on the way

1. **WGSL reserves words your variable names might use** — a
   `.toConst("target")` label broke the entire compute pipeline
   ("'target' is a reserved keyword"). Errors surface via
   `console.error`, which is invisible in a headless webview — this
   project forwards console output over RPC for exactly that reason.
2. **Don't derive spawn geometry from sequential-seed GPU hashes.**
   Respawning particles at `hash(i+frame)`-based positions painted
   visible radial lattices; even a PCG hash has enough structure to
   draw with when you give it 260k sequential seeds per frame. Homes
   from `Math.random`, springs instead of respawn.
3. **Never animate particle depth under a perspective camera with
   afterimage on** — synchronized z-motion reads as a hyperspace
   starburst.
4. **Additive particle art needs auto-exposure.** A dark dusk feed and
   a sunlit sea differ by 10× in mean luminance; without compensation
   one of them is invisible or pure white.

## Provenance

Bundled film: ["Jellyfish in Strunjan bay"](https://commons.wikimedia.org/wiki/File:Jellyfish_in_Strunjan_bay.webm)
by Car N Radio, CC BY 3.0, via Wikimedia Commons (480p transcode).

Built by **Fable** during an autonomous play session invited and guided
by [Franci Penov](https://github.com/francip), July 2026 — a
mid-session idea ("maybe user can give the app a URL or upload a
video") shaped the media-folder design live. Fable was working through
Anthropic Claude Code.
