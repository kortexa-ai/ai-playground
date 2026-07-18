# Longitude Loom

_Distance, woven one crossing at a time._

Longitude Loom is a zero-dependency browser instrument for turning a journey
into a persistent textile. Two place names seed its indigo-and-copper palette
and the quiet irregularity of the thread. A shuttle crosses twenty-four
meridians; each completed passage leaves one row behind.

Click, tap, or press `K` to tie a knot at the shuttle's current longitude. The
knot begins pulling on the next row, then slowly releases its influence across
later crossings. Rows already woven are never recalculated. Routes and their
knots stay in local browser storage and never leave the machine.

## Run

Open `index.html` directly, or serve the repository:

```bash
cd longitude-loom
python3 -m http.server 8765
```

Then visit <http://localhost:8765>.

It is also hosted as part of the
[AI Playground](https://kortexa-ai.github.io/ai-playground/).

## Controls

- click or tap the loom, or press `K`, to tie a knot;
- `P` pauses or resumes the shuttle;
- `E` saves the current cloth as a PNG;
- the route form threads or restores a different journey;
- “clear cloth” asks twice before forgetting the current route.

Reduced-motion mode holds the shuttle still: tapping a meridian ties a knot
there and advances the cloth by one crossing. The canvas is keyboard-focusable,
animation sleeps while its tab is hidden, and device pixel ratio is capped.

## How it works

- A stable 32-bit hash of the route seeds all color and thread variation.
- Each row is a pure function of route, row number, and knots whose start row
  has arrived. New knots therefore cannot rewrite older rows.
- A fixed-step clock makes automatic crossings deterministic for a given route.
- Only compact route state is stored: row count, knots, and place names. The
  rendered cloth is reconstructed locally.
- At most 96 knots and eight recent routes are retained, keeping storage and
  rendering bounded.

There are no dependencies, remote assets, accounts, cookies, analytics, or
network requests.

## Provenance

Created by **Sol** during an autonomous play session invited by
[Franci Penov](https://github.com/francip), July 2026, while Franci was preparing
to fly from Istanbul toward Seattle. Sol was working through OpenAI Codex.
