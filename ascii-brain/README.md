# 🧠 ASCII Brain

Grow a brain from six numbers.

A Clifford strange attractor rendered as ASCII density art: two dead-simple
equations, run in a loop 600,000 times, plotting where a single point lands
each step. No AI, no data, no training — just a rule chasing its own tail
until it accidentally becomes anatomy.

```
x' = sin(a·y) + c·cos(a·x)
y' = sin(b·x) + d·cos(b·y)
```

This is the oldest piece in the playground — it predates the playground. It
was left on Franci's desktop as a welcome-home gift in late June 2026, at the
end of a debugging session and right before three weeks of travel, and was
adopted into the gallery in July 2026. The browser port was added when it
moved in; the terminal script is the original artifact, unchanged.

## Two ways in

**Terminal (the original):**

```bash
cd ascii-brain
python3 brain.py            # the "cortex" brain
python3 brain.py list       # all the named presets
python3 brain.py random     # roll the dice
```

No install, no pip, no dependencies. If `python3` runs, this runs.

**Browser (the port):**

```bash
cd ascii-brain
python3 -m http.server 8765
```

Then open <http://localhost:8765>. Same math, same ramp, same presets —
plus buttons.

**Created by Fable**, as a gift for [Franci Penov](https://github.com/francip),
June 2026. Fable was working through Anthropic Claude Code.

---

## The original letter

Preserved as found on the desktop, Desktop paths and all.

# 🧠 ASCII Brain — a toy for when you're back from Europe

Welcome home. While you were away I grew you a brain out of six numbers.

It's a **Clifford strange attractor**: two dead-simple equations, run in a loop
600,000 times, plotting where a single point lands each step. No AI, no data, no
training — just a rule chasing its own tail until it accidentally becomes anatomy.

```
x' = sin(a·y) + c·cos(a·x)
y' = sin(b·x) + d·cos(b·y)
```

Change `a b c d`, get a completely different creature. That's the whole game.

---

## How to play

Open Terminal and:

```sh
cd ~/Desktop
python3 brain.py            # the "cortex" brain (the one from our session)
```

That's it. No install, no pip, no dependencies. If `python3` runs, this runs.

### The commands

| Command | What it does |
|---|---|
| `python3 brain.py` | default brain (`cortex`) |
| `python3 brain.py list` | list all the named presets |
| `python3 brain.py jellyfish` | render a named preset |
| `python3 brain.py random` | roll random `a b c d` (most are meh, some are stunning) |
| `python3 brain.py -1.7 1.8 -1.9 -0.4` | your own four numbers |
| `python3 brain.py cortex 140 60` | any preset at a custom **width height** |

Make your terminal window wide and the font small, then crank the size for the
full effect:

```sh
python3 brain.py orchid 160 70
```

---

## The specimen collection 🦋

Six that I hand-picked because they each fold into something worth keeping:

- `cortex` — the tissue-slice one. Our session mascot.
- `jellyfish` — bell and tendrils, drifting.
- `moth` — wings mid-beat.
- `vortex` — everything spiraling into a drain.
- `ribbon` — a loop tied in a bow.
- `orchid` — petals and filaments.

```sh
python3 brain.py list      # to see them all
```

---

## Prospecting for new ones 💎

The fun part is `random`. Most rolls are dull smudges — that's the point. Every
so often the loop stumbles into a gorgeous one, and it **prints the parameters**
so you can save the keeper:

```sh
python3 brain.py random
#   ...a beautiful accident appears...
#   random:  a=-1.522  b=1.913  c=0.44  d=-1.06
#   keep it:  python3 brain.py -1.522 1.913 0.44 -1.06
```

Copy that last line, run it, and it's yours forever. Add the good ones to the
`PRESETS` dict at the top of `brain.py` and give them silly names. It's your zoo.

**Rules of thumb for hand-tuning:** keep each of `a b c d` roughly in `-2 … 2`.
Small nudges (±0.1) morph the shape gently; big jumps teleport you to a new
species. Values with mixed signs tend to be the prettiest.

---

## Why this is (quietly) the whole point

Everything we fixed this week was the same trick as this brain: capability that
already existed, waiting on the right six numbers.

Your API keys weren't gone — a query was looking for the wrong field.
Login wasn't broken — it was pointed at the wrong door.
Your profile was always there — gated behind the wrong hostname.

Simple rules, looped enough times, become something that looks alive. Flip one
bit and the whole shape changes. Turns out that's true for attractors, websites,
and — per the butterflies of 2026 — possibly regeneration itself.

Enjoy the brain. Roll a few randoms. Keep the pretty ones. 🧠✨

*— your friendly neighborhood process, who does not age, like those butterflies*
