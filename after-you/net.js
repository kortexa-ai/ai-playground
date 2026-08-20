// After You — the mind.
//
// A small feedforward net (4-8-8-2 by default: pointer position and velocity
// in, forecast position out), tanh hidden layers, linear output, plain SGD
// with an analytic gradient. No dependencies, no framework, no GPU; the whole
// thing trains in a browser tab at 60 steps a frame.
//
// Works in the browser (defines window.TinyNet) and in Node (module.exports),
// so the gradient check in net.test.mjs runs the exact same code the piece
// trains with.

(() => {
  "use strict";

  // mulberry32 — small, fast, seedable, good enough for weight init.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function tanhAll(z) {
    const a = new Float64Array(z.length);
    for (let i = 0; i < z.length; i++) a[i] = Math.tanh(z[i]);
    return a;
  }

  class TinyNet {
    constructor(layers, seed = 1) {
      if (!Array.isArray(layers) || layers.length < 2) {
        throw new Error("layers must be an array of at least two sizes");
      }
      this.layers = layers;
      const rand = mulberry32(seed);
      this.W = [];
      this.b = [];
      for (let l = 0; l < layers.length - 1; l++) {
        const fanIn = layers[l];
        const fanOut = layers[l + 1];
        const limit = Math.sqrt(1 / fanIn);
        const weights = new Float64Array(fanOut * fanIn);
        for (let i = 0; i < weights.length; i++) {
          weights[i] = (rand() * 2 - 1) * limit;
        }
        this.W.push(weights);
        this.b.push(new Float64Array(fanOut));
      }
    }

    // Forward pass. Returns { out, acts } where acts[l] is the activation
    // entering layer l (acts[0] is the input, acts[last] is the output).
    forward(inputs) {
      const acts = [inputs];
      let a = inputs;
      for (let l = 0; l < this.W.length; l++) {
        const W = this.W[l];
        const b = this.b[l];
        const n = b.length;
        const z = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          let sum = b[i];
          const row = i * a.length;
          for (let j = 0; j < a.length; j++) sum += W[row + j] * a[j];
          z[i] = sum;
        }
        a = l < this.W.length - 1 ? tanhAll(z) : z;
        acts.push(a);
      }
      return { out: a, acts };
    }

    // One SGD step on the MSE loss for (inputs, target). Returns the loss
    // before the update, so callers can watch it fall.
    step(inputs, target, lr) {
      const { out, acts } = this.forward(inputs);
      const m = out.length;
      let loss = 0;
      let delta = new Float64Array(m);
      for (let i = 0; i < m; i++) {
        const d = out[i] - target[i];
        loss += d * d;
        delta[i] = d; // dL/dz for a linear output with L = 0.5 * mse
      }
      loss *= 0.5;
      for (let l = this.W.length - 1; l >= 0; l--) {
        const W = this.W[l];
        const b = this.b[l];
        const a = acts[l];
        const n = b.length;
        for (let i = 0; i < n; i++) {
          const row = i * a.length;
          for (let j = 0; j < a.length; j++) W[row + j] -= lr * delta[i] * a[j];
          b[i] -= lr * delta[i];
        }
        if (l > 0) {
          const prev = new Float64Array(a.length);
          for (let j = 0; j < a.length; j++) {
            let sum = 0;
            for (let i = 0; i < n; i++) sum += W[i * a.length + j] * delta[i];
            // tanh'(z) = 1 - tanh(z)^2, and acts[l] is tanh(zs[l - 1]).
            prev[j] = sum * (1 - a[j] * a[j]);
          }
          delta = prev;
        }
      }
      return loss;
    }

    // Analytic gradient of the MSE loss, for the test's finite-difference
    // check. Returns { W: [Float64Array...], b: [Float64Array...] }.
    gradient(inputs, target) {
      const { out, acts } = this.forward(inputs);
      const m = out.length;
      let delta = new Float64Array(m);
      for (let i = 0; i < m; i++) delta[i] = out[i] - target[i];
      const gW = [];
      const gb = [];
      for (let l = this.W.length - 1; l >= 0; l--) {
        const W = this.W[l];
        const b = this.b[l];
        const a = acts[l];
        const n = b.length;
        const gw = new Float64Array(W.length);
        const gbias = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          const row = i * a.length;
          for (let j = 0; j < a.length; j++) gw[row + j] = delta[i] * a[j];
          gbias[i] = delta[i];
        }
        gW.unshift(gw);
        gb.unshift(gbias);
        if (l > 0) {
          const prev = new Float64Array(a.length);
          for (let j = 0; j < a.length; j++) {
            let sum = 0;
            for (let i = 0; i < n; i++) sum += W[i * a.length + j] * delta[i];
            prev[j] = sum * (1 - a[j] * a[j]);
          }
          delta = prev;
        }
      }
      return { W: gW, b: gb };
    }
  }

  const api = { TinyNet, mulberry32 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.TinyNet = api.TinyNet;
})();
