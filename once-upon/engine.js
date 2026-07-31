/* Zero-dependency inference engine for the "ONCE" v1 model format.
 *
 * Weights stay int8 in memory with per-output-row f32 scales; every matmul
 * accumulates int8*f32 and multiplies by the row scale once. That quarters
 * both memory and bandwidth vs dequantizing up front, and JS matmuls are
 * bandwidth-bound. Activations are fp32. KV cache, RoPE, RMSNorm, SwiGLU,
 * tied embedding head — the same math as train/model.py, one token at a time.
 */
"use strict";

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class OnceModel {
  constructor(arrayBuffer) {
    const dv = new DataView(arrayBuffer);
    if (dv.getUint32(0, false) !== 0x4f4e4345) throw new Error("bad magic, want ONCE");
    const hlen = dv.getUint32(4, true);
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(arrayBuffer, 8, hlen)));
    if (header.version !== 1) throw new Error("bad version " + header.version);
    this.config = header.config;
    const base = 8 + hlen;
    this.t = {};
    for (const t of header.tensors) {
      this.t[t.name] =
        t.dtype === "i8"
          ? new Int8Array(arrayBuffer, base + t.offset, t.size)
          : new Float32Array(arrayBuffer, base + t.offset, t.size / 4);
    }

    const c = this.config;
    const hd = c.d_model / c.n_heads;
    this.hd = hd;
    // RoPE tables: [pos][i] for i < hd/2, pairs are (i, i + hd/2).
    this.cos = new Float32Array(c.seq_len * (hd / 2));
    this.sin = new Float32Array(c.seq_len * (hd / 2));
    for (let p = 0; p < c.seq_len; p++) {
      for (let i = 0; i < hd / 2; i++) {
        const ang = p / Math.pow(c.rope_theta, (2 * i) / hd);
        this.cos[p * (hd / 2) + i] = Math.cos(ang);
        this.sin[p * (hd / 2) + i] = Math.sin(ang);
      }
    }

    // Scratch + KV cache.
    this.x = new Float32Array(c.d_model);
    this.xn = new Float32Array(c.d_model);
    this.qkv = new Float32Array(3 * c.d_model);
    this.attnOut = new Float32Array(c.d_model);
    this.proj = new Float32Array(c.d_model);
    this.g = new Float32Array(c.ffn_hidden);
    this.u = new Float32Array(c.ffn_hidden);
    this.h = new Float32Array(c.ffn_hidden);
    this.scores = new Float32Array(c.seq_len);
    this.logits = new Float32Array(c.vocab_size);
    this.kCache = [];
    this.vCache = [];
    for (let l = 0; l < c.n_layers; l++) {
      this.kCache.push(new Float32Array(c.seq_len * c.d_model));
      this.vCache.push(new Float32Array(c.seq_len * c.d_model));
    }
    this.pos = 0;
  }

  reset() {
    this.pos = 0;
  }

  matmulQ(out, w, scale, x, nOut, nIn) {
    for (let o = 0; o < nOut; o++) {
      const b = o * nIn;
      let s = 0;
      for (let j = 0; j < nIn; j++) s += w[b + j] * x[j];
      out[o] = s * scale[o];
    }
  }

  rmsnorm(out, x, w, n) {
    let ss = 0;
    for (let i = 0; i < n; i++) ss += x[i] * x[i];
    const inv = 1 / Math.sqrt(ss / n + 1e-6);
    for (let i = 0; i < n; i++) out[i] = w[i] * x[i] * inv;
  }

  rope(v, off, p) {
    const half = this.hd / 2;
    const tb = p * half;
    for (let i = 0; i < half; i++) {
      const c = this.cos[tb + i];
      const s = this.sin[tb + i];
      const a = v[off + i];
      const b = v[off + i + half];
      v[off + i] = a * c - b * s;
      v[off + i + half] = b * c + a * s;
    }
  }

  /* Run one token at the current position; returns logits. */
  forward(token) {
    const c = this.config;
    const d = c.d_model;
    const H = c.n_heads;
    const hd = this.hd;
    const p = this.pos;
    if (p >= c.seq_len) throw new Error("context full");
    const x = this.x;

    const emb = this.t["tok_emb.weight"];
    const embS = this.t["tok_emb.weight.scale"];
    const eb = token * d;
    for (let i = 0; i < d; i++) x[i] = emb[eb + i] * embS[token];

    for (let l = 0; l < c.n_layers; l++) {
      const P = "blocks." + l + ".";
      this.rmsnorm(this.xn, x, this.t[P + "attn_norm.weight"], d);
      this.matmulQ(this.qkv, this.t[P + "attn.qkv.weight"], this.t[P + "attn.qkv.weight.scale"], this.xn, 3 * d, d);

      const K = this.kCache[l];
      const V = this.vCache[l];
      for (let h = 0; h < H; h++) {
        this.rope(this.qkv, h * hd, p); // q
        this.rope(this.qkv, d + h * hd, p); // k
      }
      K.set(this.qkv.subarray(d, 2 * d), p * d);
      V.set(this.qkv.subarray(2 * d, 3 * d), p * d);

      const inv = 1 / Math.sqrt(hd);
      for (let h = 0; h < H; h++) {
        const qo = h * hd;
        let max = -Infinity;
        for (let t = 0; t <= p; t++) {
          let s = 0;
          const kb = t * d + qo;
          for (let i = 0; i < hd; i++) s += this.qkv[qo + i] * K[kb + i];
          s *= inv;
          this.scores[t] = s;
          if (s > max) max = s;
        }
        let sum = 0;
        for (let t = 0; t <= p; t++) {
          const e = Math.exp(this.scores[t] - max);
          this.scores[t] = e;
          sum += e;
        }
        const norm = 1 / sum;
        for (let i = 0; i < hd; i++) this.attnOut[qo + i] = 0;
        for (let t = 0; t <= p; t++) {
          const w = this.scores[t] * norm;
          const vb = t * d + qo;
          for (let i = 0; i < hd; i++) this.attnOut[qo + i] += w * V[vb + i];
        }
      }
      this.matmulQ(this.proj, this.t[P + "attn.proj.weight"], this.t[P + "attn.proj.weight.scale"], this.attnOut, d, d);
      for (let i = 0; i < d; i++) x[i] += this.proj[i];

      this.rmsnorm(this.xn, x, this.t[P + "ffn_norm.weight"], d);
      this.matmulQ(this.g, this.t[P + "ffn.gate.weight"], this.t[P + "ffn.gate.weight.scale"], this.xn, c.ffn_hidden, d);
      this.matmulQ(this.u, this.t[P + "ffn.up.weight"], this.t[P + "ffn.up.weight.scale"], this.xn, c.ffn_hidden, d);
      for (let i = 0; i < c.ffn_hidden; i++) {
        const g = this.g[i];
        this.h[i] = (g / (1 + Math.exp(-g))) * this.u[i]; // silu(g) * u
      }
      this.matmulQ(this.proj, this.t[P + "ffn.down.weight"], this.t[P + "ffn.down.weight.scale"], this.h, d, c.ffn_hidden);
      for (let i = 0; i < d; i++) x[i] += this.proj[i];
    }

    this.rmsnorm(this.xn, x, this.t["out_norm.weight"], d);
    this.matmulQ(this.logits, emb, embS, this.xn, c.vocab_size, d);
    this.pos++;
    return this.logits;
  }
}

/* Temperature + top-k sampling over a logits array. */
function sampleTopK(logits, temperature, topK, rnd) {
  const n = logits.length;
  if (temperature <= 0) {
    let best = 0;
    for (let i = 1; i < n; i++) if (logits[i] > logits[best]) best = i;
    return best;
  }
  // Partial top-k: keep the k best in small parallel arrays.
  const k = Math.min(topK, n);
  const idx = new Int32Array(k).fill(-1);
  const val = new Float32Array(k).fill(-Infinity);
  for (let i = 0; i < n; i++) {
    const v = logits[i];
    if (v <= val[k - 1]) continue;
    let j = k - 1;
    while (j > 0 && val[j - 1] < v) {
      val[j] = val[j - 1];
      idx[j] = idx[j - 1];
      j--;
    }
    val[j] = v;
    idx[j] = i;
  }
  let max = val[0];
  let sum = 0;
  const probs = new Float64Array(k);
  for (let i = 0; i < k; i++) {
    const e = Math.exp((val[i] - max) / temperature);
    probs[i] = e;
    sum += e;
  }
  let r = rnd() * sum;
  for (let i = 0; i < k; i++) {
    r -= probs[i];
    if (r <= 0) return idx[i];
  }
  return idx[k - 1];
}

if (typeof module !== "undefined") module.exports = { OnceModel, sampleTopK, mulberry32 };
