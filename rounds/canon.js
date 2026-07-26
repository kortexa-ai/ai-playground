/**
 * Rounds — the musical logic, kept free of the DOM and the audio clock so it
 * can be reasoned about (and tested) on its own.
 *
 * A pattern is a set of cells on a wheel: `steps` positions around, `rings`
 * pitches outward. A voice is a rule for following that pattern — some number
 * of steps behind, some number of scale degrees above. Everything anyone hears
 * is those two ideas turning against each other.
 */
(function (root, factory) {
  if (typeof module === "object" && typeof module.exports === "object") {
    module.exports = factory();
  } else {
    root.Canon = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STEPS = 16;
  const RINGS = 10;
  const ROOT_MIDI = 57; // A3

  /**
   * Minor pentatonic. Chosen so that no combination of voices can sound wrong:
   * the piece adds harmony on its own, and it should never punish you for it.
   */
  const SCALE = [0, 3, 5, 7, 10];

  /**
   * Each voice enters later and sits further back. Delays are whole fractions
   * of the wheel so entries land on the beat; shifts stay inside the pentatonic
   * so they stay consonant with everything already sounding.
   */
  const VOICES = [
    { name: "you", delay: 0, shift: 0, gain: 1.0, hue: 38, wave: "triangle" },
    { name: "answer", delay: 4, shift: 0, gain: 0.7, hue: 189, wave: "triangle" },
    { name: "third", delay: 8, shift: 2, gain: 0.55, hue: 151, wave: "sine" },
    { name: "shadow", delay: 2, shift: -3, gain: 0.46, hue: 284, wave: "sine" },
    { name: "shimmer", delay: 12, shift: 4, gain: 0.34, hue: 14, wave: "sine" },
  ];

  /** Ring 0 is the innermost and lowest. Rings outside the wheel still sound. */
  function midiForRing(ring) {
    const octave = Math.floor(ring / SCALE.length);
    const degree = ((ring % SCALE.length) + SCALE.length) % SCALE.length;
    return ROOT_MIDI + octave * 12 + SCALE[degree];
  }

  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function cellKey(step, ring) {
    return step + ":" + ring;
  }

  function createState() {
    return {
      steps: STEPS,
      rings: RINGS,
      cells: new Set(),
      voiceCount: 1,
      tempo: 92,
      playing: false,
      // Turns completed since the last voice joined.
      turns: 0,
      autoGrow: true,
    };
  }

  function hasCell(state, step, ring) {
    return state.cells.has(cellKey(step, ring));
  }

  function toggleCell(state, step, ring) {
    const key = cellKey(step, ring);
    if (state.cells.has(key)) state.cells.delete(key);
    else state.cells.add(key);
    return state;
  }

  function setCell(state, step, ring, on) {
    const key = cellKey(step, ring);
    if (on) state.cells.add(key);
    else state.cells.delete(key);
    return state;
  }

  function ringsAtStep(state, step) {
    const found = [];
    for (let ring = 0; ring < state.rings; ring++) {
      if (hasCell(state, step, ring)) found.push(ring);
    }
    return found;
  }

  /** Seconds per step. Steps are eighth notes, so a turn is two bars of 4/4. */
  function stepDuration(state) {
    return 30 / state.tempo;
  }

  function turnDuration(state) {
    return stepDuration(state) * state.steps;
  }

  /**
   * Everything that should sound at one absolute step of the wheel.
   *
   * A voice `delay` steps behind is, at absolute step N, playing whatever the
   * pattern holds at step N - delay. That single line is the entire canon.
   */
  function notesAtStep(state, absoluteStep) {
    const notes = [];
    const active = Math.min(state.voiceCount, VOICES.length);

    for (let index = 0; index < active; index++) {
      const voice = VOICES[index];
      const patternStep =
        (((absoluteStep - voice.delay) % state.steps) + state.steps) %
        state.steps;

      for (const ring of ringsAtStep(state, patternStep)) {
        const sounded = ring + voice.shift;
        notes.push({
          voice: index,
          hue: voice.hue,
          wave: voice.wave,
          gain: voice.gain,
          // Where it is written, for drawing.
          patternStep,
          ring,
          // Where it lands, for hearing.
          soundedRing: sounded,
          midi: midiForRing(sounded),
          frequency: midiToFreq(midiForRing(sounded)),
        });
      }
    }
    return notes;
  }

  /** True when the wheel has just closed a turn and another voice may join. */
  function shouldGrow(state) {
    return (
      state.autoGrow &&
      state.cells.size > 0 &&
      state.voiceCount < VOICES.length &&
      state.turns >= 2
    );
  }

  function isEmpty(state) {
    return state.cells.size === 0;
  }

  /** A wandering pentatonic phrase, so the wheel is never silent on arrival. */
  function seedPattern(state) {
    const seed = [
      [0, 4],
      [3, 6],
      [4, 5],
      [6, 7],
      [8, 4],
      [11, 2],
      [12, 3],
      [14, 5],
    ];
    for (const [step, ring] of seed) setCell(state, step, ring, true);
    return state;
  }

  /* ------------------------------------------------------------- geometry */

  const TAU = Math.PI * 2;

  function makeGeometry(width, height, steps, rings) {
    const outer = Math.min(width, height) * 0.44;
    const inner = outer * 0.3;
    return {
      cx: width / 2,
      cy: height / 2,
      inner,
      outer,
      gap: (outer - inner) / rings,
      steps,
      rings,
      width,
      height,
    };
  }

  /** Where a cell is drawn. Dots sit on the spokes, at the ring's mid-line. */
  function cellCentre(geometry, step, ring) {
    const angle = (step / geometry.steps) * TAU - Math.PI / 2;
    const radius = geometry.inner + (ring + 0.5) * geometry.gap;
    return {
      x: geometry.cx + Math.cos(angle) * radius,
      y: geometry.cy + Math.sin(angle) * radius,
      angle,
      radius,
    };
  }

  /**
   * Which cell a point lands in. The target wedge is centred on the spoke, so
   * that aiming at a dot hits the dot rather than its counter-clockwise
   * neighbour.
   */
  function cellAt(geometry, x, y) {
    const dx = x - geometry.cx;
    const dy = y - geometry.cy;
    const radius = Math.hypot(dx, dy);
    if (radius < geometry.inner || radius > geometry.outer) return null;

    const ring = Math.floor((radius - geometry.inner) / geometry.gap);
    if (ring < 0 || ring >= geometry.rings) return null;

    const half = TAU / geometry.steps / 2;
    let angle = Math.atan2(dy, dx) + Math.PI / 2 + half;
    angle = ((angle % TAU) + TAU) % TAU;
    const step = Math.floor((angle / TAU) * geometry.steps) % geometry.steps;
    return { step, ring };
  }

  function serialize(state) {
    return {
      v: 1,
      steps: state.steps,
      rings: state.rings,
      tempo: state.tempo,
      voiceCount: state.voiceCount,
      autoGrow: state.autoGrow,
      cells: [...state.cells],
    };
  }

  function deserialize(raw) {
    const state = createState();
    if (!raw || typeof raw !== "object") return state;
    if (Number.isFinite(raw.tempo)) {
      state.tempo = Math.min(180, Math.max(40, raw.tempo));
    }
    if (Number.isFinite(raw.voiceCount)) {
      state.voiceCount = Math.min(
        VOICES.length,
        Math.max(1, Math.round(raw.voiceCount)),
      );
    }
    if (typeof raw.autoGrow === "boolean") state.autoGrow = raw.autoGrow;
    if (Array.isArray(raw.cells)) {
      for (const key of raw.cells) {
        if (typeof key !== "string") continue;
        const [step, ring] = key.split(":").map(Number);
        if (
          Number.isInteger(step) &&
          Number.isInteger(ring) &&
          step >= 0 &&
          step < state.steps &&
          ring >= 0 &&
          ring < state.rings
        ) {
          state.cells.add(cellKey(step, ring));
        }
      }
    }
    return state;
  }

  return {
    STEPS,
    RINGS,
    SCALE,
    ROOT_MIDI,
    VOICES,
    createState,
    seedPattern,
    hasCell,
    toggleCell,
    setCell,
    ringsAtStep,
    notesAtStep,
    midiForRing,
    midiToFreq,
    stepDuration,
    turnDuration,
    shouldGrow,
    isEmpty,
    makeGeometry,
    cellCentre,
    cellAt,
    serialize,
    deserialize,
  };
});
