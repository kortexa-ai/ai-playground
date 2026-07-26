import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const Canon = require("./canon.js");

test("the scale only ever offers consonant pitches", () => {
  const intervals = new Set();
  for (let ring = 0; ring < 20; ring++) {
    intervals.add((Canon.midiForRing(ring) - Canon.ROOT_MIDI) % 12);
  }
  // Minor pentatonic and nothing else — no semitone can sneak in.
  assert.deepEqual([...intervals].sort((a, b) => a - b), [0, 3, 5, 7, 10]);
});

test("rings climb, and five rings make an octave", () => {
  for (let ring = 1; ring < 20; ring++) {
    assert.ok(
      Canon.midiForRing(ring) > Canon.midiForRing(ring - 1),
      `ring ${ring} should be higher than ${ring - 1}`,
    );
  }
  assert.equal(Canon.midiForRing(5) - Canon.midiForRing(0), 12);
  assert.equal(Canon.midiForRing(12) - Canon.midiForRing(7), 12);
});

test("rings outside the drawn wheel still sound", () => {
  assert.equal(Canon.midiForRing(-1), Canon.midiForRing(4) - 12);
  assert.ok(Number.isFinite(Canon.midiToFreq(Canon.midiForRing(14))));
});

test("A4 lands on 440", () => {
  assert.equal(Math.round(Canon.midiToFreq(69)), 440);
  assert.equal(Math.round(Canon.midiToFreq(57)), 220);
});

test("one voice plays exactly what was written, when it was written", () => {
  const state = Canon.createState();
  Canon.setCell(state, 3, 6, true);

  assert.deepEqual(Canon.notesAtStep(state, 0), []);
  const notes = Canon.notesAtStep(state, 3);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].voice, 0);
  assert.equal(notes[0].ring, 6);
  assert.equal(notes[0].soundedRing, 6);
});

test("the second voice answers a quarter turn later, at the same pitch", () => {
  const state = Canon.createState();
  state.voiceCount = 2;
  Canon.setCell(state, 0, 4, true);

  const lead = Canon.notesAtStep(state, 0);
  assert.equal(lead.length, 1);
  assert.equal(lead[0].voice, 0);

  const answerDelay = Canon.VOICES[1].delay;
  const answer = Canon.notesAtStep(state, answerDelay);
  assert.equal(answer.length, 1);
  assert.equal(answer[0].voice, 1);
  assert.equal(answer[0].midi, lead[0].midi, "a round, not a transposition");
});

test("later voices transpose by whole scale degrees", () => {
  const state = Canon.createState();
  state.voiceCount = Canon.VOICES.length;
  Canon.setCell(state, 0, 4, true);

  for (let index = 0; index < Canon.VOICES.length; index++) {
    const voice = Canon.VOICES[index];
    const notes = Canon.notesAtStep(state, voice.delay).filter(
      (note) => note.voice === index,
    );
    assert.equal(notes.length, 1, `voice ${voice.name} should sound`);
    assert.equal(notes[0].soundedRing, 4 + voice.shift);
    assert.equal(notes[0].midi, Canon.midiForRing(4 + voice.shift));
  }
});

test("the wheel wraps: a voice behind the start plays the end of the pattern", () => {
  const state = Canon.createState();
  state.voiceCount = 2;
  const delay = Canon.VOICES[1].delay;
  // Written near the end of the wheel, so the answer must wrap to reach it.
  Canon.setCell(state, state.steps - 1, 5, true);

  const wrapped = Canon.notesAtStep(state, delay - 1);
  const answer = wrapped.filter((note) => note.voice === 1);
  assert.equal(answer.length, 1);
  assert.equal(answer[0].patternStep, state.steps - 1);
});

test("every absolute step is covered, with no gaps and no doubling", () => {
  const state = Canon.createState();
  state.voiceCount = Canon.VOICES.length;
  Canon.setCell(state, 0, 4, true);

  // Over one full turn each voice should sound exactly once.
  const counts = new Map();
  for (let step = 0; step < state.steps; step++) {
    for (const note of Canon.notesAtStep(state, step)) {
      counts.set(note.voice, (counts.get(note.voice) ?? 0) + 1);
    }
  }
  assert.equal(counts.size, Canon.VOICES.length);
  for (const [voice, count] of counts) {
    assert.equal(count, 1, `voice ${voice} sounded ${count} times in a turn`);
  }
});

test("a silent wheel stays silent no matter how many voices", () => {
  const state = Canon.createState();
  state.voiceCount = Canon.VOICES.length;
  for (let step = 0; step < 64; step++) {
    assert.deepEqual(Canon.notesAtStep(state, step), []);
  }
});

test("voices beyond the roster are ignored rather than crashing", () => {
  const state = Canon.createState();
  state.voiceCount = 99;
  Canon.setCell(state, 0, 4, true);
  const voices = new Set(Canon.notesAtStep(state, 0).map((n) => n.voice));
  for (const voice of voices) assert.ok(voice < Canon.VOICES.length);
});

test("tempo sets the length of a turn", () => {
  const state = Canon.createState();
  state.tempo = 120;
  // Steps are eighth notes: 120bpm means 0.25s a step, 4s for sixteen.
  assert.equal(Canon.stepDuration(state), 0.25);
  assert.equal(Canon.turnDuration(state), 4);

  state.tempo = 60;
  assert.equal(Canon.stepDuration(state), 0.5);
  assert.equal(Canon.turnDuration(state), 8);
});

test("the wheel only grows once it has something to say", () => {
  const state = Canon.createState();
  state.turns = 5;
  assert.equal(Canon.shouldGrow(state), false, "nothing written yet");

  Canon.setCell(state, 0, 4, true);
  assert.equal(Canon.shouldGrow(state), true);

  state.voiceCount = Canon.VOICES.length;
  assert.equal(Canon.shouldGrow(state), false, "the roster is full");

  state.voiceCount = 1;
  state.autoGrow = false;
  assert.equal(Canon.shouldGrow(state), false, "growing was switched off");
});

test("growth waits a couple of turns before joining in", () => {
  const state = Canon.createState();
  Canon.setCell(state, 0, 4, true);
  state.turns = 0;
  assert.equal(Canon.shouldGrow(state), false);
  state.turns = 1;
  assert.equal(Canon.shouldGrow(state), false);
  state.turns = 2;
  assert.equal(Canon.shouldGrow(state), true);
});

test("the seeded phrase is playable and pentatonic", () => {
  const state = Canon.seedPattern(Canon.createState());
  assert.ok(state.cells.size >= 6);
  assert.equal(Canon.isEmpty(state), false);

  let sounded = 0;
  for (let step = 0; step < state.steps; step++) {
    sounded += Canon.notesAtStep(state, step).length;
  }
  assert.equal(sounded, state.cells.size);
});

test("a wheel survives the round trip through storage", () => {
  const state = Canon.seedPattern(Canon.createState());
  state.tempo = 104;
  state.voiceCount = 3;
  state.autoGrow = false;

  const restored = Canon.deserialize(
    JSON.parse(JSON.stringify(Canon.serialize(state))),
  );
  assert.equal(restored.tempo, 104);
  assert.equal(restored.voiceCount, 3);
  assert.equal(restored.autoGrow, false);
  assert.deepEqual([...restored.cells].sort(), [...state.cells].sort());
});

test("corrupt or hostile saved state cannot break the wheel", () => {
  assert.equal(Canon.deserialize(null).cells.size, 0);
  assert.equal(Canon.deserialize("nonsense").cells.size, 0);
  assert.equal(Canon.deserialize({ cells: "nope" }).cells.size, 0);

  const wild = Canon.deserialize({
    tempo: 99999,
    voiceCount: 500,
    cells: ["0:0", "bad", "999:2", "3:999", "-1:4", null, "2:3"],
  });
  assert.ok(wild.tempo <= 180 && wild.tempo >= 40);
  assert.ok(wild.voiceCount <= Canon.VOICES.length);
  assert.deepEqual([...wild.cells].sort(), ["0:0", "2:3"]);
});

test("toggling is its own undo", () => {
  const state = Canon.createState();
  assert.equal(Canon.hasCell(state, 5, 5), false);
  Canon.toggleCell(state, 5, 5);
  assert.equal(Canon.hasCell(state, 5, 5), true);
  Canon.toggleCell(state, 5, 5);
  assert.equal(Canon.hasCell(state, 5, 5), false);
});

/* ------------------------------------------------------- wheel geometry */

test("every cell can be hit by aiming at where it is drawn", () => {
  const state = Canon.createState();
  for (const [w, h] of [[900, 900], [640, 480], [320, 700], [1440, 1000]]) {
    const geometry = Canon.makeGeometry(w, h, state.steps, state.rings);
    for (let step = 0; step < state.steps; step++) {
      for (let ring = 0; ring < state.rings; ring++) {
        const point = Canon.cellCentre(geometry, step, ring);
        const hit = Canon.cellAt(geometry, point.x, point.y);
        assert.deepEqual(
          hit,
          { step, ring },
          `${w}x${h} cell ${step}:${ring} was not hit at its own centre`,
        );
      }
    }
  }
});

test("the hub and the space beyond the rim are not cells", () => {
  const state = Canon.createState();
  const g = Canon.makeGeometry(800, 800, state.steps, state.rings);
  assert.equal(Canon.cellAt(g, g.cx, g.cy), null, "the hub is not a cell");
  assert.equal(
    Canon.cellAt(g, g.cx, g.cy - g.outer - 20),
    null,
    "outside the rim is not a cell",
  );
  assert.equal(
    Canon.cellAt(g, g.cx, g.cy - g.inner * 0.5),
    null,
    "inside the innermost ring is not a cell",
  );
});

test("step 0 sits at the top of the wheel, where the hand starts", () => {
  const state = Canon.createState();
  const g = Canon.makeGeometry(800, 800, state.steps, state.rings);
  const point = Canon.cellCentre(g, 0, 0);
  assert.ok(Math.abs(point.x - g.cx) < 1e-9, "step 0 should be centred");
  assert.ok(point.y < g.cy, "step 0 should be above the hub");
});

test("the wheel runs clockwise", () => {
  const state = Canon.createState();
  const g = Canon.makeGeometry(800, 800, state.steps, state.rings);
  const quarter = Canon.cellCentre(g, state.steps / 4, 0);
  assert.ok(quarter.x > g.cx, "a quarter turn should be to the right");
  assert.ok(Math.abs(quarter.y - g.cy) < 1e-9);
});

test("rings climb outward", () => {
  const state = Canon.createState();
  const g = Canon.makeGeometry(800, 800, state.steps, state.rings);
  for (let ring = 1; ring < state.rings; ring++) {
    assert.ok(
      Canon.cellCentre(g, 0, ring).radius >
        Canon.cellCentre(g, 0, ring - 1).radius,
      "higher pitches should sit further out",
    );
  }
});
