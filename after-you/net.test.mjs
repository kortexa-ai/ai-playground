// Gradient check and learning smoke test for the After You mind.
//
// The piece trains this exact code in the browser, so the analytic gradient
// is the load-bearing part: if it is wrong, the net quietly learns nothing.
// The finite-difference check below is the piece's ears.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { TinyNet } = require("./net.js");

function finiteDifference(net, inputs, target, eps = 1e-5) {
  const numW = net.W.map(() => new Float64Array(0));
  const numB = net.b.map(() => new Float64Array(0));
  const lossAt = () => {
    const { out } = net.forward(inputs);
    let loss = 0;
    for (let i = 0; i < out.length; i++) {
      const d = out[i] - target[i];
      loss += d * d;
    }
    return loss * 0.5;
  };
  for (let l = 0; l < net.W.length; l++) {
    numW[l] = new Float64Array(net.W[l].length);
    for (let k = 0; k < net.W[l].length; k++) {
      const original = net.W[l][k];
      net.W[l][k] = original + eps;
      const up = lossAt();
      net.W[l][k] = original - eps;
      const down = lossAt();
      net.W[l][k] = original;
      numW[l][k] = (up - down) / (2 * eps);
    }
    numB[l] = new Float64Array(net.b[l].length);
    for (let k = 0; k < net.b[l].length; k++) {
      const original = net.b[l][k];
      net.b[l][k] = original + eps;
      const up = lossAt();
      net.b[l][k] = original - eps;
      const down = lossAt();
      net.b[l][k] = original;
      numB[l][k] = (up - down) / (2 * eps);
    }
  }
  return { W: numW, b: numB };
}

test("the analytic gradient matches finite differences", () => {
  const net = new TinyNet([4, 8, 8, 2], 7);
  const inputs = [0.31, -0.52, 0.14, -0.08];
  const target = [-0.22, 0.41];
  const analytic = net.gradient(inputs, target);
  const numeric = finiteDifference(net, inputs, target);
  for (let l = 0; l < net.W.length; l++) {
    for (let k = 0; k < analytic.W[l].length; k++) {
      assert.ok(
        Math.abs(analytic.W[l][k] - numeric.W[l][k]) < 1e-5,
        `W[${l}][${k}]: analytic ${analytic.W[l][k]} vs numeric ${numeric.W[l][k]}`,
      );
    }
    for (let k = 0; k < analytic.b[l].length; k++) {
      assert.ok(
        Math.abs(analytic.b[l][k] - numeric.b[l][k]) < 1e-5,
        `b[${l}][${k}]: analytic ${analytic.b[l][k]} vs numeric ${numeric.b[l][k]}`,
      );
    }
  }
});

test("the net learns a moving target", () => {
  // A hand circling at constant angular speed: the target is where the hand
  // will be 0.8s ahead. A 4-8-8-2 net should drive the error well below the
  // radius of the circle.
  const net = new TinyNet([4, 8, 8, 2], 3);
  const horizon = 0.8;
  const omega = 1.1;
  const scale = 1; // normalized units
  let lateMax = 0;
  let last = Infinity;
  for (let t = 0; t < 20; t += 1 / 60) {
    const x = Math.cos(omega * t) * 0.5;
    const y = Math.sin(omega * t) * 0.5;
    const vx = -Math.sin(omega * t) * 0.5 * omega;
    const vy = Math.cos(omega * t) * 0.5 * omega;
    const tx = Math.cos(omega * (t + horizon)) * 0.5;
    const ty = Math.sin(omega * (t + horizon)) * 0.5;
    // Several steps per sample so learning is not starved.
    for (let s = 0; s < 4; s++) {
      last = net.step([x / scale, y / scale, vx / scale, vy / scale], [tx, ty], 0.05);
    }
    if (t > 12) lateMax = Math.max(lateMax, last);
  }
  assert.ok(lateMax < 0.002, `error did not converge: late loss reached ${lateMax}`);
});

test("relearning from a new seed starts unlearned", () => {
  const a = new TinyNet([4, 8, 8, 2], 1);
  const b = new TinyNet([4, 8, 8, 2], 2);
  assert.ok(
    a.W[0][0] !== b.W[0][0],
    "different seeds should produce different initial weights",
  );
});
