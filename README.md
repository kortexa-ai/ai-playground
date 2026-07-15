# AI Playground

A small gallery of autonomous play sessions: experiments made because an open
computer, a curious model, and permission to wander can occasionally produce
something worth keeping.

Everything here runs locally. There are no accounts, analytics, or hosted services.

**[Enter the hosted playground →](https://kortexa-ai.github.io/ai-playground/)**

## Projects

### [Signal Garden](signal-garden/)

Language, left alone, begins to move.

A zero-dependency browser canvas where words become an evolving particle ecology.
Each signal loops forever through a deterministic bloom, drift, and fade cycle;
new phrases expand the garden without disturbing the older patterns. Includes
optional generative sound and JSON save/restore.

```bash
cd signal-garden
python3 -m http.server 8765
```

Then open <http://localhost:8765>.

**Created by Sol**, during a collaborative play session with
[Franci Penov](https://github.com/francip), July 2026. Sol was working through
OpenAI Codex.

### [Night Letters](night-letters/)

A sentence learns to fly.

A zero-dependency browser murmuration where hundreds of tiny birds gather into
typed language, loosen at its punctuation, cross a dusk field, and remember
their way home. Includes pointer-made wind, a generative soundscape, reduced
motion support, and PNG postcards.

```bash
cd night-letters
python3 -m http.server 8765
```

Then open <http://localhost:8765>.

**Created by Sol**, after wandering between Signal Garden and Fable's sky,
during an autonomous play session with
[Franci Penov](https://github.com/francip), July 2026. Sol was working through
OpenAI Codex.

### [Murmuration](murmuration/)

A WebGPU flocking study: 16,384 starlings over water at dusk, hunted by a
peregrine falcon.

An Electrobun desktop experiment using three.js WebGPU/TSL compute shaders,
procedural birds, a CPU-steered falcon, an art-directed dusk environment, and a
generative WebAudio soundscape.

```bash
cd murmuration
bun install
bun start
```

Windows and a WebGPU-capable adapter are currently required for the intended
experience. See its README for controls and the wonderfully specific platform
quirks discovered during development.

**Created by Fable**, during an autonomous play session invited and guided by
[Franci Penov](https://github.com/francip), July 2026. Fable was working through
Anthropic Claude Code.

### [Photophore](photophore/)

The camera as an invisible sea.

A quarter-million WebGPU particles render whatever the machine can see — a
webcam, a video dropped into a folder, or a procedural dream — as living
pointillism: colors chased, motion scattered, homes returned to on soft
springs. The image is always present and never still.

```bash
cd photophore
bun install
bun start
```

Windows and a WebGPU-capable adapter are currently required. Drop any video
into `photophore/media/` to change what the sea dreams about; a CC-licensed
jellyfish loop is included.

**Created by Fable**, during an autonomous play session invited and guided by
[Franci Penov](https://github.com/francip), July 2026 — with the media-folder
idea arriving from Franci mid-session, between rounds of backgammon. Fable was
working through Anthropic Claude Code.

## A note on provenance

These are model-authored experiments, but not orphaned outputs. The human part was
the invitation, taste, feedback, machine access, and decision to preserve them;
the model part was the design and implementation. Both mattered.
