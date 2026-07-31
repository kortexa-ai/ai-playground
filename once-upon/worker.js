/* Web Worker: owns the tokenizer and the model, streams tokens back.
 * Messages in:  {type:"load"}
 *               {type:"generate", prompt, maxTokens, temperature, topK, seed}
 *               {type:"stop"}
 * Messages out: {type:"progress", loaded, total}
 *               {type:"ready", config, bytes}
 *               {type:"token", text}
 *               {type:"done", tokens, seconds}
 *               {type:"error", message}
 */
"use strict";
importScripts("tokenizer.js", "engine.js");

let model = null;
let tokenizer = null;
let stopFlag = false;

async function fetchWithProgress(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + ": " + res.status);
  const total = Number(res.headers.get("Content-Length")) || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    postMessage({ type: "progress", loaded, total });
  }
  const buf = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.length;
  }
  return buf.buffer;
}

async function load() {
  const tokRes = await fetch("model/tokenizer.json");
  tokenizer = new BPETokenizer(await tokRes.json());
  const buf = await fetchWithProgress("model/model.bin");
  model = new OnceModel(buf);
  postMessage({ type: "ready", config: model.config, bytes: buf.byteLength });
}

async function generate(msg) {
  const { prompt, maxTokens, temperature, topK, seed } = msg;
  stopFlag = false;
  const rnd = mulberry32(seed >>> 0);
  const c = model.config;
  let ids = tokenizer.encode(prompt);
  if (ids.length === 0) ids = [tokenizer.eot];
  // Leave room to write; trim the oldest prompt tokens if someone pastes a saga.
  const budget = Math.min(maxTokens, c.seq_len - 8);
  if (ids.length > c.seq_len - budget) ids = ids.slice(ids.length - (c.seq_len - budget));

  model.reset();
  tokenizer.resetStream();
  const t0 = performance.now();
  let logits = null;
  for (const id of ids) logits = model.forward(id);
  let produced = 0;
  while (produced < maxTokens && model.pos < c.seq_len) {
    const next = sampleTopK(logits, temperature, topK, rnd);
    if (next === tokenizer.eot) break;
    postMessage({ type: "token", text: tokenizer.decodeToken(next) });
    produced++;
    if (stopFlag) break;
    if (produced % 8 === 0) await new Promise((r) => setTimeout(r, 0)); // let "stop" in
    if (stopFlag) break;
    logits = model.forward(next);
  }
  postMessage({ type: "done", tokens: produced, seconds: (performance.now() - t0) / 1000 });
}

onmessage = (e) => {
  const msg = e.data;
  if (msg.type === "stop") {
    stopFlag = true;
    return;
  }
  const run = msg.type === "load" ? load() : msg.type === "generate" ? generate(msg) : null;
  if (run) run.catch((err) => postMessage({ type: "error", message: String(err) }));
};
