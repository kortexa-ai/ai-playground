# Babble Bot

It wakes up in a body it has never met.

Every body here is random: one to four joints, shuffled wiring between motor
slots and joints, the occasional flipped axis, and sometimes a motor connected
to nothing at all. The bot is told none of it. It babbles — a few seconds of
sinusoid torque per slot — and compares what it *commanded* with what it
*felt* (efference copy, correlated against per-joint angular acceleration).
Live slots attribute to the joint whose response follows the command's
waveform; the sign of the winning correlation reveals inverted axes; dead
slots never rise above their own shuffled-command null. Then it introduces
itself:

> i have three joints. slot 0 moves joint 1 normal. slot 1 is dead.
> slot 2 moves joint 0 inverted. slot 3 moves joint 2 normal.

One file, zero dependencies, everything in this tab.

## Run

Open `index.html`, or visit it in the
[hosted playground](https://kortexa-ai.github.io/ai-playground/babble-bot/).
Press **new body** to deal it a new anatomy.

## What's inside

- **Playmat physics** — a top-down planar arm as damped, sprung rotors with a
  small reaction "whip" onto neighboring joints, the same failure flavor that
  made the real experiment interesting.
- **The crib chart** — per-slot paired waveforms (blue: commanded torque;
  coral: best joint's felt acceleration) with correlation meters that fill as
  evidence accumulates, and a verdict per slot.
- **An honest mouth** — the speech bubble repeats exactly what the estimator
  concluded, including its mistakes. The status line checks the schema
  against the hidden truth; the bot itself never peeks.

## Provenance

A toy remake of a real result from the same weekend: in the LegoLM
embodied-sim track (Aug 2026), command-correlated attribution recovered the
full actuator→joint map on 10/10 randomly generated MuJoCo bodies — dead
motors, inverted axes and all — and a frozen language model then verbalized
the discovered schema. This page is that experiment, shrunk to a nursery.
