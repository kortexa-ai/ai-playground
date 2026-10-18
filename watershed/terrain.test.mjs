// The rain machine's ears.
//
// The browser renders whatever terrain.js computes, so the load-bearing parts
// are tested here: the seeded field is reproducible, the bilinear gradient the
// droplets steer by agrees with finite differences, erosion keeps honest
// sediment books, drainage conserves its drops, and priority flood never
// lowers a hill.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const T = require("./terrain.js");

function ramp(cols, rows, slope = 0.02) {
  const map = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) map[y * cols + x] = 1 - y * slope - x * 0.001;
  }
  return map;
}

test("a seed means the same hill every time", () => {
  const a = T.createHeightField(42, 40, 30);
  const b = T.createHeightField(42, 40, 30);
  const c = T.createHeightField(43, 40, 30);
  assert.deepEqual(Array.from(a), Array.from(b));
  assert.notDeepEqual(Array.from(a), Array.from(c));
  assert.equal(a.length, 40 * 30);
  for (const value of a) {
    assert.ok(value >= 0.0199 && value <= 1, `height ${value} out of range`);
  }
});

test("the bilinear gradient matches finite differences", () => {
  const map = T.createHeightField(7, 48, 36);
  const cols = 48;
  const rows = 36;
  const epsilon = 1e-4;
  for (const [x, y] of [
    [12.3, 8.7],
    [23.5, 17.1],
    [35.9, 28.4],
    [2.2, 3.3],
  ]) {
    const sample = T.heightAndGradient(map, cols, rows, x, y);
    const left = T.heightAndGradient(map, cols, rows, x - epsilon, y);
    const right = T.heightAndGradient(map, cols, rows, x + epsilon, y);
    const up = T.heightAndGradient(map, cols, rows, x, y - epsilon);
    const down = T.heightAndGradient(map, cols, rows, x, y + epsilon);
    const numericX = (right.height - left.height) / (2 * epsilon);
    const numericY = (down.height - up.height) / (2 * epsilon);
    assert.ok(
      Math.abs(sample.gradientX - numericX) < 1e-5,
      `gradientX ${sample.gradientX} vs ${numericX}`,
    );
    assert.ok(
      Math.abs(sample.gradientY - numericY) < 1e-5,
      `gradientY ${sample.gradientY} vs ${numericY}`,
    );
  }
});

test("a droplet goes downhill, erodes, and balances its sediment", () => {
  const cols = 32;
  const rows = 32;
  const map = ramp(cols, rows);
  const before = Float32Array.from(map);
  const result = T.simulateDroplet(map, cols, rows, {
    x: 16,
    y: 3,
    rng: T.mulberry32(9),
    lifetime: 30,
    erodeSpeed: 0.6,
  });
  assert.ok(result.steps > 0, "droplet should move");
  assert.ok(result.y > 3, `droplet should move downhill, ended at ${result.y}`);
  assert.ok(result.eroded > 0, "a steep slope should give up sediment");
  assert.ok(
    Math.abs(result.sediment - (result.eroded - result.deposited)) < 1e-6,
    "sediment in hand must equal eroded minus deposited",
  );
  let moved = 0;
  for (let i = 0; i < map.length; i++) moved += before[i] - map[i];
  assert.ok(
    Math.abs(moved - (result.eroded - result.deposited)) < 1e-6,
    "terrain must lose exactly what the droplet kept",
  );
  for (const value of map) assert.ok(Number.isFinite(value) && value >= 0);
});

test("drainage accumulates downstream and conserves its cells", () => {
  // One row, descending to the right: a single unambiguous D8 channel.
  const cols = 6;
  const map = new Float32Array(cols);
  for (let x = 0; x < cols; x++) map[x] = cols - 1 - x;
  const row = T.flowAccumulation(map, cols, 1);
  assert.equal(row[cols - 1], cols, "the outlet collects the whole row");

  // On a real hill, the water that reaches sinks is exactly every cell's one
  // drop: accumulation moves, it never multiplies.
  const hills = T.createHeightField(3, 60, 40);
  const acc = T.flowAccumulation(hills, 60, 40);
  let sinkTotal = 0;
  for (let y = 0; y < 40; y++) {
    for (let x = 0; x < 60; x++) {
      const index = y * 60 + x;
      let lower = false;
      for (let dy = -1; dy <= 1 && !lower; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= 60 || ny >= 40) continue;
          if (hills[ny * 60 + nx] < hills[index]) lower = true;
        }
      }
      if (!lower) sinkTotal += acc[index];
    }
  }
  assert.equal(sinkTotal, 60 * 40, "every cell contributes exactly one drop");
  assert.ok(Math.max(...acc) > 60, "some channel drains many uphill cells");
});

test("priority flood fills a bowl to its rim and never lowers a hill", () => {
  const cols = 7;
  const rows = 7;
  const map = new Float32Array(cols * rows).fill(0.6);
  map[3 * cols + 3] = 0.1;
  map[3 * cols + 4] = 0.2;
  const filled = T.priorityFlood(map, cols, rows);
  for (let i = 0; i < map.length; i++) {
    assert.ok(filled[i] >= map[i] - 1e-7, "flood cannot dig");
  }
  assert.ok(
    Math.abs(filled[3 * cols + 3] - 0.6) < 1e-6,
    `bowl should fill to the rim, got ${filled[3 * cols + 3]}`,
  );

  const flat = new Float32Array(cols * rows).fill(0.4);
  const flatFilled = T.priorityFlood(flat, cols, rows);
  for (let i = 0; i < flat.length; i++) {
    assert.ok(Math.abs(flatFilled[i] - 0.4) < 1e-6, "a plain stays a plain");
  }
});

test("hillslope creep smooths without flattening the hill", () => {
  const cols = 60;
  const rows = 40;
  const map = T.createHeightField(12, cols, rows);
  const roughness = (field) => {
    let total = 0;
    for (let y = 1; y < rows - 1; y++) {
      for (let x = 1; x < cols - 1; x++) {
        const i = y * cols + x;
        total += Math.abs(
          4 * field[i] -
            field[i - 1] -
            field[i + 1] -
            field[i - cols] -
            field[i + cols],
        );
      }
    }
    return total;
  };
  const before = roughness(map);
  for (let i = 0; i < 4; i++) T.diffuse(map, cols, rows, 0.2);
  const after = roughness(map);
  assert.ok(after < before, `roughness ${after} should fall below ${before}`);
  const stats = T.computeStats(map, cols, rows, null);
  assert.ok(stats.highest - stats.lowest > 0.5, "relief survives the creep");
  for (const value of map) assert.ok(Number.isFinite(value) && value >= 0);
});

test("erosion carves a channel that drainage can find", () => {
  const cols = 150;
  const rows = 100;
  const map = T.createHeightField(5, cols, rows);
  const rng = T.mulberry32(5);
  for (let i = 0; i < 6000; i++) {
    T.simulateDroplet(map, cols, rows, {
      rng,
      erodeSpeed: 0.5,
      capacityFactor: 4,
      brushRadius: 3,
      maxStepErode: 0.02,
    });
    if (i % 500 === 499) T.diffuse(map, cols, rows, 0.12);
  }
  const filled = T.priorityFlood(map, cols, rows);
  const stats = T.computeStats(
    map,
    cols,
    rows,
    T.flowAccumulation(filled, cols, rows),
  );
  assert.ok(stats.relief > 0.6, "the hill should still have relief");
  assert.ok(stats.drainage > 400, "channels should drain a lot of cells");
  assert.ok(stats.basins < 400, "the slope should not be a field of pits");
  for (const value of map) assert.ok(Number.isFinite(value) && value >= 0);
});
