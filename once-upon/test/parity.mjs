/* Node parity tests: JS tokenizer vs Python fixtures, JS engine vs golden
 * logits from the dequantized PyTorch model. Run: node test/parity.mjs */
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const { BPETokenizer } = require(join(root, "tokenizer.js"));
const { OnceModel } = require(join(root, "engine.js"));

let failures = 0;

// ---- tokenizer ----
const tok = new BPETokenizer(JSON.parse(readFileSync(join(root, "model", "tokenizer.json"), "utf8")));
const fixtures = JSON.parse(readFileSync(join(here, "fixtures.json"), "utf8"));
for (const f of fixtures) {
  const ids = tok.encode(f.text);
  const same = ids.length === f.ids.length && ids.every((x, i) => x === f.ids[i]);
  if (!same) {
    failures++;
    console.error(`ENCODE MISMATCH ${JSON.stringify(f.text)}\n  py: ${f.ids}\n  js: ${ids}`);
  }
  const dec = tok.decode(f.ids);
  // Python's decode() strips the special token; ours skips it too.
  if (dec !== f.decoded) {
    failures++;
    console.error(`DECODE MISMATCH ${JSON.stringify(f.text)}\n  py: ${JSON.stringify(f.decoded)}\n  js: ${JSON.stringify(dec)}`);
  }
  // Streaming decode must agree with one-shot decode.
  tok.resetStream();
  let stream = "";
  for (const id of f.ids) stream += tok.decodeToken(id);
  if (stream !== dec) {
    failures++;
    console.error(`STREAM MISMATCH ${JSON.stringify(f.text)}`);
  }
}
console.log(`tokenizer: ${fixtures.length} fixtures, ${failures} failures`);

// ---- engine vs golden ----
const modelPath = join(root, "model", "model.bin");
const goldenPath = join(root, "model", "golden.bin");
if (existsSync(modelPath) && existsSync(goldenPath)) {
  const raw = readFileSync(modelPath);
  const ab = new ArrayBuffer(raw.length);
  new Uint8Array(ab).set(raw); // fresh buffer: guarantees 4-byte alignment
  const model = new OnceModel(ab);

  const g = readFileSync(goldenPath);
  const gv = new DataView(g.buffer, g.byteOffset, g.byteLength);
  const nPos = gv.getUint32(0, true);
  const vocab = gv.getUint32(4, true);
  const ids = [];
  for (let i = 0; i < nPos; i++) ids.push(gv.getUint32(8 + 4 * i, true));
  const logitsOff = 8 + 4 * nPos;

  let worst = 0;
  let worstPos = -1;
  const t0 = performance.now();
  model.reset();
  for (let p = 0; p < nPos; p++) {
    const logits = model.forward(ids[p]);
    for (let v = 0; v < vocab; v++) {
      const ref = gv.getFloat32(logitsOff + 4 * (p * vocab + v), true);
      const d = Math.abs(logits[v] - ref);
      if (d > worst) {
        worst = d;
        worstPos = p;
      }
    }
  }
  const dt = (performance.now() - t0) / nPos;
  console.log(`engine: ${nPos} positions, max |Δlogit| = ${worst.toExponential(2)} (pos ${worstPos}), ${dt.toFixed(0)} ms/token`);
  if (worst > 5e-3) {
    failures++;
    console.error("ENGINE MISMATCH: tolerance 5e-3 exceeded");
  }
} else {
  console.log("engine: model.bin/golden.bin not present yet, skipped");
}

process.exit(failures ? 1 : 0);
