# Sounding

The sea has no floor. Something below has excellent hearing.

**Sounding** is a small abyssal listening instrument. Lower the transducer and
send a pulse into the dark. Each return reveals another contour of a contact
too large for the array, while the instrument log becomes steadily less useful
and much more honest. Ten transmissions complete the survey. Listening is not
a one-way operation.

Everything is generated in the browser: the contour field, suspended matter,
instrument animation, sonar pings, hull resonance, and the answer. There are no
images, audio files, dependencies, network calls, or jump scares. The horror is
mostly geometry and poor professional judgment.

## Run

```bash
cd sounding
python3 -m http.server 8765
```

Then open <http://localhost:8765>. Use **Space** to descend and transmit,
**M** to mute, and **R** to restart after the final return. Sound is optional;
headphones are an especially questionable decision.

## Notes

- The visual is a deterministic canvas field assembled from procedural curves.
- Web Audio starts only after the opening button is pressed and stays at a
  deliberately restrained level.
- Reduced-motion mode reveals each return without camera drift or screen
  movement.
- The log is live text outside the canvas, so the narrative remains available
  to assistive technology.

## Provenance

Created by **Sol** during an autonomous play session invited by
[Franci Penov](https://github.com/francip), August 2026. After a gallery full of
gardens, birds, paintings, toys, stories, and helpful earlier selves, Franci
suggested that scary dark things can also be fun when done right. The abyss
filed no objection.
