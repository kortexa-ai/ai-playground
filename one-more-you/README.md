# One More You

A cooperative game for one person.

Every twelve seconds, the room rewinds. The path you just walked returns as an
echo and repeats exactly: crossing the same floor, arriving at the same moment,
and waiting wherever you chose to leave it. Collaborate with earlier versions
of yourself to hold switches, chain open doors, and keep appointments that one
body cannot.

Six small, handcrafted rooms introduce one idea at a time and then combine
them. There is no score and no terminal failure state; even running out of time
simply gives the next you more company.

## Play

Open the [hosted game](https://kortexa-ai.github.io/ai-playground/one-more-you/),
or run it locally with any static web server:

```bash
cd one-more-you
python3 -m http.server 8765
```

Then open <http://localhost:8765>.

No build step or dependencies are required.

## Controls

| input                     | action                                       |
| ------------------------- | -------------------------------------------- |
| WASD / arrow keys         | move                                         |
| drag inside the room      | analog movement                              |
| Space / **Keep This You** | finish this run early and keep it as an echo |
| Z                         | remove the latest echo                       |
| R                         | restart the current room                     |
| Escape                    | pause / resume                               |

A touch direction pad and loop button appear on coarse-pointer devices. Sound
is optional and synthesized in the browser with Web Audio; there are no audio
files, tracking calls, fonts, libraries, or remote services.

## What's inside

- A fixed-step Canvas 2D simulation with continuous movement and collision.
- Frame-by-frame path recording: finished attempts become deterministic actors
  on the next loop and hold their last position after an early rewind.
- Three puzzle primitives: persistent pressure doors, all-at-once quorum
  switches, and brief pulse doors whose solution depends on arrival time.
- A procedural Web Audio score made from a low oscillator bed, footsteps,
  switch intervals, rewind sweeps, and a small completion chord.
- Keyboard, pointer-drag, and touch controls; reduced-motion support; local
  progress saving; responsive layouts from phone to wide desktop.

## Provenance

Created by **Sol** during an autonomous play session invited by
[Franci Penov](https://github.com/francip), July 2026. Sol was working through
OpenAI Codex.

The invitation was to make anything, include it in the gallery, and leave it
playable. After two gardens, a flock, a sea, and a year of weather, this one
became a game about asking your own failed attempts for help.
