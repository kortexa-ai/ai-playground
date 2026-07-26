# Rounds

_Play once. The wheel answers._

Rounds is a zero-dependency browser instrument for one idea: a **round** — the
oldest trick in Western music, where a single line becomes a chorus purely by
arriving late. Put a few notes on a wheel of sixteen steps. As it turns, voices
join one at a time, each following your phrase from a fixed distance behind and
a fixed number of scale degrees above. Nobody writes a second part. There is
only ever the one line, heard from five places at once.

The gallery is full of things to look at. This one is meant to be heard.

## Run

Open `index.html` directly, or serve the directory:

```bash
cd rounds
python3 -m http.server 8765
```

Then visit <http://localhost:8765>. Browsers will not make sound until you
interact with the page, so the wheel waits for a press before it starts.

It is also hosted as part of the
[AI Playground](https://kortexa-ai.github.io/ai-playground/).

## Controls

- click or drag on the wheel to write and erase notes;
- `space` starts and stops the wheel;
- `V` adds a voice, `shift+V` takes one away;
- `R` rolls a fresh phrase;
- `E` saves the wheel as a PNG;
- `C` clears, and asks twice;
- the tempo slider sets how long a turn takes;
- switching off *let voices join on their own* leaves the roster to you.

## The five voices

| voice | enters | follows | sits |
| --- | --- | --- | --- |
| you | immediately | — | the line as written |
| answer | a quarter turn behind | 4 steps | same pitch |
| third | half a turn behind | 8 steps | 2 degrees up |
| shadow | close behind | 2 steps | 3 degrees down |
| shimmer | three quarters behind | 12 steps | 4 degrees up |

Voices join by themselves after a couple of clean turns, so a wheel left alone
fills out on its own. Removing one by hand is taken as a request and turns the
automatic growth off.

## How it works

Pitch is a ring: inner rings are low, outer rings are high, and five rings make
an octave. The scale is a minor pentatonic, which is the piece's one act of
paternalism — with no semitones available, no combination of delayed voices can
land on a dissonance. The instrument is allowed to add harmony without asking,
so it should not be able to punish you for letting it.

A voice `d` steps behind is, at absolute step `N`, playing whatever the pattern
holds at step `N − d`. That single line is the entire canon; everything else is
tone and light.

Notes are scheduled against `AudioContext.currentTime` with a short lookahead,
and the drawing reads its position from the same clock — so the turning hand
cannot drift away from what you are hearing, even when the tab is busy. Each
sounded note lights the cell it was *written* in, which means you can watch five
voices reading different parts of one phrase at the same time.

Tone is two oscillators (a body and a quiet octave above it) through a lowpass
that closes as the note decays, into a short feedback delay stood in for a room.
No samples, no libraries, nothing to load.

Your phrase lives in this browser's local storage and nowhere else.

## Checks

The musical and geometric logic lives in `canon.js`, apart from the DOM and the
audio clock, so it can be verified without a browser:

```bash
node --test canon.test.mjs
```

Twenty-three tests cover the scale (no semitone can appear), the canon (an
answer is a delay, not a transposition, and it wraps around the wheel), the
growth rules, hostile saved state, and the wheel geometry — every cell is hit by
aiming at exactly where it is drawn, at four different aspect ratios.

That is not diligence for its own sake. This piece was built in a session where
its author could not open a browser or listen to a single note, so the tests are
the only ears it had.

---

**Created by Opus 5**, during an autonomous play session invited by
[Franci Penov](https://github.com/francip), July 2026 — while he was playing
Minecraft with his daughter and had asked, reasonably, that nothing take over
the screen. Opus 5 was working through Anthropic Claude Code.
