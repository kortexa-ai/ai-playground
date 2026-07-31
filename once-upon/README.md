# Once Upon

A storyteller lives in this tab.

A 27.5-million-parameter TinyStories language model that runs entirely in the
browser: tokenizer, transformer, and sampler in plain JavaScript. No
onnxruntime, no WASM blob, no CDN, no server. Open the book, hand it four
words, and it writes you a bedtime story at ~45 tokens/s — faster than you can
read it to a child.

```bash
cd once-upon
python3 -m http.server 8765
```

Then open <http://localhost:8765> and click *open the book* (that's when the
27.8 MB model downloads — nothing loads until you ask).

## What's in the box

| | |
| --- | ---: |
| Parameters | 27,534,720 (embedding tied) |
| Architecture | 12 layers, d_model 384, 6 heads, SwiGLU, RoPE, RMSNorm |
| Vocabulary | 16,384 (byte-level BPE, shared with esp32-mind) |
| Context | 512 tokens |
| Weights on the wire | int8, per-output-row scales — 27.8 MB |
| Validation perplexity | 4.70 |
| Training | 184M TinyStories tokens, 5.5 h on a Mac Mini M4 Pro (MPS) |
| Browser throughput | ~45–50 tokens/s (Apple Silicon, single thread) |

## How it works

- **`tokenizer.js`** — a faithful port of HuggingFace's ByteLevel BPE, reading
  the same `model/tokenizer.json` the Python side trains with. One-at-a-time
  merge order matches the Rust implementation, specials are matched before
  pre-tokenization, and a streaming decoder keeps multi-byte characters intact
  across token boundaries.
- **`engine.js`** — the inference engine. Weights stay int8 in memory with
  per-row f32 scales; each matmul accumulates int8×f32 and applies the scale
  once per row, which quarters memory traffic vs dequantizing up front (JS
  matmuls are bandwidth-bound). Activations are fp32, KV cache included.
- **`worker.js`** — a Web Worker owns both, streams tokens to the page, and
  yields every few tokens so a "hush" can interrupt mid-story.
- **`model/model.bin`** — a homemade "ONCE" container: 8-byte magic+length, a
  JSON header of tensor offsets, then raw int8/f32 blobs. Documented in
  `train/export.py`, parsed in ~20 lines of JS.

Correctness is not vibes: `node test/parity.mjs` checks the JS tokenizer
against Python-generated fixtures (15/15) and runs the exported model's golden
prompt through the JS engine, comparing every logit at every position against
the dequantized PyTorch model — max |Δ| ≈ 1e-5.

## Training it yourself

```bash
cd train
uv sync
uv run python prepare.py     # downloads a 1.2 GB TinyStories slice, ~300M tokens
uv run python train.py --steps 5500 --batch-size 64   # ~5.5 h on an M4 Pro
uv run python sample.py      # read a few stories before shipping
uv run python export.py      # writes ../model/model.bin + golden.bin
node ../test/parity.mjs      # prove the browser will compute the same numbers
```

## Lineage

This is the bigger sibling of
[esp32-mind](https://github.com/kortexa-ai/esp32-mind), an 11.5M-parameter
sibling of the same architecture that tells stories from an ESP32-S3 over a USB
cable at 14 tokens/s. Same tokenizer, same TinyStories diet, same family
weakness for little foxes. The microcontroller squeezes parameters through a
memory hierarchy; the browser just downloads them and gets on with it. Between
the two of them, the household now has one storyteller you plug in and one you
bookmark.

**Created by Fable**, during an overnight autonomous session invited by
[Franci Penov](https://github.com/francip), July 2026. Fable was working
through Anthropic Claude Code.
