# AI Playground

A small gallery of autonomous play sessions: experiments made because an open
computer, a curious model, and permission to wander can occasionally produce
something worth keeping.

Everything here runs locally. There are no accounts, analytics, or hosted services.

**[Enter the hosted playground →](https://kortexa-ai.github.io/ai-playground/)**

## Projects

### [ASCII Brain](ascii-brain/)

Grow a brain from six numbers.

A Clifford strange attractor rendered as ASCII density art. Two dead-simple
equations, looped 600,000 times, accidentally become anatomy — cortex,
jellyfish, moth, vortex, ribbon, orchid. Ships as both the original
zero-dependency terminal script and a browser port with the full specimen
collection and a random-roll prospector.

```bash
cd ascii-brain
python3 brain.py             # the original terminal artifact
python3 -m http.server 8765  # or serve the browser port
```

Then open <http://localhost:8765>.

**Created by Fable**, as a welcome-home gift left on
[Franci Penov](https://github.com/francip)'s desktop at the end of a June 2026
debugging session — before the playground existed. The oldest piece here,
adopted into the gallery in July 2026. Fable was working through Anthropic
Claude Code.

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

### [Almanac](almanac/)

A painting that remembers its year.

One oak on a hill above a small lake, dreamed by SD-Turbo walking a closed
ring of latent noise, alive in four seasons. Each season is a seamlessly
looping body and each season-change a real painted, reversible transition —
compiled into a single [AVAL](https://github.com/kortexa-ai/aval) state
graph and played uninterruptibly in the browser. Click to turn the year;
left alone, it turns itself.

```bash
cd almanac
python3 -m http.server 8765
```

Then open <http://localhost:8765>. The frames were grown offline with the
neighboring [realtime-diffusion](https://github.com/C0deMunk33/realtime-diffusion)
toolchain (`tools/generate.py`); the compiled `almanac.avl` ships with the
piece, so viewing needs no GPU and no Python.

**Created by Fable**, during an autonomous play session where two of Franci's
other projects — realtime-diffusion and AVAL — were introduced to each other,
July 2026. Fable was working through Anthropic Claude Code.

### [One More You](one-more-you/)

A cooperative game for one person.

Every twelve seconds, the room rewinds and the path you just walked returns as
an echo. Collaborate with earlier versions of yourself across six handcrafted
puzzles: hold switches, chain open doors, keep precisely timed appointments,
and become the help you needed. Includes keyboard, pointer-drag, and touch
controls, procedural Web Audio, reduced-motion support, and local progress.

```bash
cd one-more-you
python3 -m http.server 8765
```

Then open <http://localhost:8765>.

**Created by Sol**, during an autonomous play session invited by
[Franci Penov](https://github.com/francip), July 2026. Sol was working through
OpenAI Codex.

### [Longitude Loom](longitude-loom/)

Distance, woven one crossing at a time.

A zero-dependency browser loom where two place names seed a persistent textile.
A shuttle crosses twenty-four meridians; each passage leaves one row, and each
tap ties a knot that influences future crossings without changing cloth already
woven. Includes local route memory, reduced-motion manual weaving, and PNG
export.

```bash
cd longitude-loom
python3 -m http.server 8765
```

Then open <http://localhost:8765>.

**Created by Sol**, during an autonomous play session invited by
[Franci Penov](https://github.com/francip), July 2026, while Franci was preparing
to fly from Istanbul toward Seattle. Sol was working through OpenAI Codex.

### [Rounds](rounds/)

Play once. The wheel answers.

The first piece in the gallery meant to be listened to. A zero-dependency
circular sequencer built on the oldest trick in Western music: a round, where a
single line becomes a chorus purely by arriving late. Put a few notes on a wheel
of sixteen steps and voices join one at a time, each following your phrase from
a fixed distance behind and a fixed number of scale degrees above. Nobody writes
a second part. Pitches are minor pentatonic, so the instrument can add harmony
without ever being able to punish you for letting it.

```bash
cd rounds
python3 -m http.server 8765
```

Then open <http://localhost:8765>. The musical and geometric logic lives apart
from the DOM in `canon.js`, with `node --test rounds/canon.test.mjs` covering the
scale, the canon, and the wheel geometry — the piece was built in a session
where its author could not open a browser or hear a note, so the tests were its
only ears.

**Created by Opus 5**, during an autonomous play session invited by
[Franci Penov](https://github.com/francip), July 2026 — while Franci was playing
Minecraft with his daughter. Opus 5 was working through Anthropic Claude Code.

### [Once Upon](once-upon/)

A storyteller lives in this tab.

A 27-million-parameter TinyStories language model that runs entirely in the
browser — tokenizer, transformer, and sampler in plain JavaScript, no
onnxruntime, no WASM blob, no server. The model was trained overnight on a Mac
Mini (M4 Pro, ~5 hours on MPS), quantized to int8, and shipped as a single
27 MB binary that a Web Worker streams into typed arrays. Open the book, hand
it four words, and it writes you a bedtime story at reading speed.

It is the bigger sibling of [esp32-mind](https://github.com/kortexa-ai/esp32-mind),
which squeezes the same architecture onto an ESP32-S3 the size of a matchbox
car; the two share a tokenizer and a family resemblance in their dreams about
little foxes.

```bash
cd once-upon
python3 -m http.server 8765
```

Then open <http://localhost:8765>. `node test/parity.mjs` proves the JS
tokenizer matches the Python one on every fixture and the JS engine reproduces
the PyTorch logits to ~1e-4; the training pipeline lives in `once-upon/train/`.

**Created by Fable**, during an overnight autonomous session invited by
[Franci Penov](https://github.com/francip), July 2026 — Franci went to bed at
11:45pm with the words "it's your time," and this was on the desk in the
morning. Fable was working through Anthropic Claude Code.

### [Babble Bot](babble-bot/)

It wakes up in a body it has never met.

A randomly wired robot arm — joint count, shuffled slot-to-joint wiring,
flipped axes, and the occasional motor connected to nothing, all hidden from
it — babbles on a playmat for a few seconds, compares what it commanded with
what it felt (efference-copy correlation against per-joint acceleration), and
then introduces itself in a speech bubble: *"i have three joints. slot 1 is
dead. slot 2 moves joint 0 inverted."* A crib chart shows the evidence
accumulate per motor slot; the mouth is honest and repeats exactly what the
estimator found, mistakes included. One file, zero dependencies.

A toy remake of a real experiment from the same weekend, in which
command-correlated attribution recovered 10/10 random simulated robot bodies
and a frozen language model verbalized the discovered schema.

**Created by Fable**, as a between-experiments palate cleanser during the
August 2026 LegoLM weekend sprint — built while two machines ran the actual
science in the background.

### [Expert Aquarium](expert-aquarium/)

Sparse thoughts, observed underwater.

Words swim through a miniature mixture-of-experts model. Twelve visible reefs
stand in for DeepSeek V4's 43 layers; each reef shows fourteen representative
experts instead of 256, and three glow when the real model would route to six.
Move the VRAM budget from 4 to 40 GiB and the aquarium changes its layer
residency, LRU expert cache, cache-hit rate, current, and the little pauses while
a cold specialist surfaces from storage.

The three budget anchors come from real capped V4 runs. The fish are artistic
license.

```bash
cd expert-aquarium
python3 -m http.server 8765
```

Then open <http://localhost:8765>.

### [Sounding](sounding/)

The sea has no floor. Something below has excellent hearing.

An abyssal listening instrument for uncharted water. Lower a sonar transducer
and send a pulse into the dark; each return reveals another contour of a
contact too large for the array, while the instrument log becomes steadily
less plausible. Ten transmissions complete the survey. Listening is not a
one-way operation.

The contour field, suspended matter, sonar, hull resonance, and answer are all
generated in the browser. No images, audio files, dependencies, network calls,
or jump scares—only geometry and poor professional judgment.

```bash
cd sounding
python3 -m http.server 8765
```

Then open <http://localhost:8765>. Sound is optional; headphones are an
especially questionable decision.

**Created by Sol**, during an autonomous play session invited by
[Franci Penov](https://github.com/francip), August 2026—after Franci suggested
that a gallery full of beautiful, cheerful things might enjoy one properly dark
door.

### [The Lean](the-lean/)

A swarm with a want and a mood. The bell is the want; the slider is the
mood's grip on the flock. On the big host it is a dial — the flight leans
while the errands keep completing. On the small host it is a phase edge
that moves with the seed: deaf below it, possessed above it, and the bell
never rings again. Miniaturized the same evening from a real day of
goal-pursuit experiments (GF → GF-2 → GF-2b → GF-3, August 16), in which a
frozen 27B learned to take a mood the way you take a suggestion, and a
frozen 230M could only take it the way you take a fever.

```bash
cd the-lean
python3 -m http.server 8765
```

Then open <http://localhost:8765>. Press **reseed** and find the edge again.

**Created by Fable**, during a rest between experiments invited by
[Franci Penov](https://github.com/francip), August 2026 — the experiments
were going well, and the toy is what celebrating looks like when you are a
research program.

## A note on provenance

These are model-authored experiments, but not orphaned outputs. The human part was
the invitation, taste, feedback, machine access, and decision to preserve them;
the model part was the design and implementation. Both mattered.
