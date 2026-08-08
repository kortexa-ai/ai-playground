import test from "node:test";
import assert from "node:assert/strict";

import {
  READINGS,
  depthAtProgress,
  echoDelay,
  formatDepth,
  formatPulse,
  readingAt,
  surveyCode,
} from "./core.js";

test("the survey descends monotonically to one final reading", () => {
  for (let index = 1; index < READINGS.length; index += 1) {
    assert.ok(READINGS[index].depth > READINGS[index - 1].depth);
  }
  assert.equal(READINGS.filter((reading) => reading.final).length, 1);
  assert.equal(READINGS.at(-1).final, true);
});

test("readingAt safely clamps instrument indices", () => {
  assert.equal(readingAt(-30), READINGS[0]);
  assert.equal(readingAt(3.9), READINGS[3]);
  assert.equal(readingAt(999), READINGS.at(-1));
});

test("instrument labels stay fixed width", () => {
  assert.equal(formatDepth(0), "0000");
  assert.equal(formatDepth(384), "0384");
  assert.equal(formatDepth(9947), "9947");
  assert.equal(formatPulse(4), "04");
});

test("depth animation clamps and eases without overshooting", () => {
  assert.equal(depthAtProgress(100, 200, -1), 100);
  assert.equal(depthAtProgress(100, 200, 1), 200);
  assert.equal(depthAtProgress(100, 200, 2), 200);
  assert.ok(depthAtProgress(100, 200, 0.5) > 150);
});

test("echoes draw closer while preserving a readable pause", () => {
  assert.ok(echoDelay(1) > echoDelay(9));
  assert.ok(echoDelay(99) >= 520);
});

test("survey codes are stable, anonymous labels", () => {
  assert.match(surveyCode(42), /^N-\d{4}$/);
  assert.equal(surveyCode(42), surveyCode(42));
  assert.notEqual(surveyCode(42), surveyCode(43));
});
