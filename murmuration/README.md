# Murmuration

A WebGPU flocking study — 16,384 starlings over water at dusk, hunted by a
peregrine falcon. Built with [Electrobun](https://blackboard.sh/electrobun)
(Bun-native desktop shell) and [three.js](https://threejs.org) r185's
`WebGPURenderer` + TSL compute shaders, running inside WebView2's native
`navigator.gpu` on Windows.

![stack](https://img.shields.io/badge/electrobun-1.18.1-orange)
![stack](https://img.shields.io/badge/three.js-r185-blue)
![stack](https://img.shields.io/badge/webgpu-tsl_compute-green)

## Run

```bash
bun install
bun start
```

First launch downloads Electrobun's core binaries (~50MB) and Windows may
show a firewall prompt for the dev server — cancel is fine, it only needs
loopback.

## What's inside

- **Flock simulation** (`src/mainview/flock.ts`) — classic Reynolds
  boids (separation / alignment / cohesion zones) in a TSL compute kernel,
  O(N·M) with a per-adapter sample budget. Extra forces: a wandering
  anchor the flock loosely follows, falcon terror with panic that decays
  through a storage buffer, scatter bursts, wind, and soft altitude
  bounds. A second kernel integrates positions and advances per-bird wing
  phase (speed- and panic-coupled flapping).
- **Birds** — 7-triangle authored starling geometry, instanced 16k×,
  oriented along velocity and flapped entirely in the vertex stage from
  the same storage buffers the compute kernels write. Colors are
  silhouette-dark with per-bird variation, panic warming, and aerial
  perspective fade.
- **Falcon** (`src/mainview/falcon.ts`) — CPU-steered peregrine with
  cruise/dive states, banking turns, glide-tuck during dives, autonomous
  hunts when the mouse is idle.
- **Environment** (`src/mainview/environment.ts`) — art-directed unlit
  dusk: custom gradient sky dome with sun disc, analytic sun-glitter
  water with nonlinearly-warped ripple fields, three noise-topped ridge
  silhouette rings, twinkling stars.
- **Post** — bloom + vignette via three's TSL PostProcessing.
- **Audio** (`src/mainview/audio.ts`) — procedural WebAudio soundscape:
  band-passed pink-noise wind with slow LFO, detuned sine pad, a
  wingbeat-tremolo flutter layer that tracks flock panic, and a falling
  band-sweep swoosh on falcon dives. No assets.
- **Host** (`src/bun/index.ts`) — Electrobun window + telemetry relay +
  a 60Hz mouse pump (see quirks).

## Controls (all mouse — see quirks)

| gesture | action |
| --- | --- |
| move | falcon follows your cursor |
| left-drag | orbit camera |
| right-hold | falcon dives |
| left+right drag | zoom |
| double-click | scatter the flock |
| double-right-click | toggle sound |

## Windows quirks discovered along the way

1. **Electrobun 1.18.1 delivers no OS input to webviews on Windows** —
   the WebView2 is composited via DirectComposition with no child HWND,
   and clicks/keys never reach the page (the stock template's sliders
   don't work either). Workaround: the bun process polls
   `Screen.getCursorScreenPoint()` / `getMouseButtons()` and streams
   input over RPC; all interactions are gesture-based. The HUD's TUNE
   panel is consequently decorative for now.
2. **WebView2 runs on the power-saving GPU by default.** On this
   dual-GPU laptop the AMD iGPU driver hung (DXGI_ERROR_DEVICE_HUNG) on
   this workload; the fix was per-app GPU preference in the registry:
   `HKCU\Software\Microsoft\DirectX\UserGpuPreferences` →
   `GpuPreference=2;` for the WebView2 runtime exes under
   `C:\Program Files (x86)\Microsoft\EdgeWebView\Application\<ver>\msedgewebview2.exe`.
   Remove those values to undo.
3. **TSL `Loop` bounds must be uniforms, not literals** — a
   compile-time trip count of thousands invites the D3D shader compiler
   to fully unroll the loop, stalling pipeline creation for 10–20s until
   the browser watchdog kills the GPU process.
4. **Compute needs explicit backpressure** — a 165Hz rAF happily
   submits heavy dispatches faster than a weak GPU retires them; the
   queue grows unboundedly until the device is lost. The render loop
   awaits `queue.onSubmittedWorkDone()` and caps sim rate at ~60Hz.
5. **`hidden` vs authored `display`** — CSS `display:flex` on an
   overlay beats the HTML `hidden` attribute; add an explicit
   `[hidden] { display:none }` override. (Cost me a "black screen" that
   was actually a fully-working scene under an opaque overlay.)

## Provenance

Built as an autonomous play session by **Fable** in Anthropic Claude Code,
2026-07-05, invited and guided by [Franci Penov](https://github.com/francip),
and informed by the
[threejs-game-skills](https://github.com/majidmanzarpour/threejs-game-skills)
skill pack: authored forms before materials before lighting before
effects; verified with screenshots and canvas telemetry at every step.
