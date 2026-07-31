"""Export a checkpoint to the once-upon browser format, plus golden logits.

Format ("ONCE" v1, little-endian):
  bytes 0-3   magic "ONCE"
  bytes 4-7   uint32 header JSON length
  header      JSON: {version, config, tensors:[{name, shape, dtype, offset, size}]}
              (space-padded so the data section starts 4-byte aligned)
  data        tensor blobs; offsets are relative to data start; f32 aligned to 4

Linear/embedding weights are int8 with a per-output-row f32 scale
(name + ".scale"); norm gains are raw f32. The head is tied to tok_emb and not
stored twice. Golden logits come from the *dequantized* model so the JS engine
can be compared bit-for-bit-ish (1e-3) against exactly the numbers it computes.
"""

import argparse
import json
import os
import struct

import numpy as np
import torch

from model import Config, TinyLM

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(HERE, "..", "model")


def quantize_rows(w):
    """w: (out, in) f32 -> int8 rows + f32 per-row scales."""
    a = w.astype(np.float32)
    scale = np.abs(a).max(axis=1) / 127.0
    scale[scale == 0] = 1.0
    q = np.clip(np.round(a / scale[:, None]), -127, 127).astype(np.int8)
    return q, scale.astype(np.float32)


class Blob:
    def __init__(self):
        self.parts, self.tensors, self.off = [], [], 0

    def add(self, name, arr):
        dtype = {"int8": "i8", "float32": "f32"}[str(arr.dtype)]
        if dtype == "f32" and self.off % 4:
            pad = 4 - self.off % 4
            self.parts.append(b"\0" * pad)
            self.off += pad
        raw = arr.tobytes()
        self.tensors.append({"name": name, "shape": list(arr.shape), "dtype": dtype,
                             "offset": self.off, "size": len(raw)})
        self.parts.append(raw)
        self.off += len(raw)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", default=os.path.join(HERE, "runs", "sedan-s0.pt"))
    ap.add_argument("--golden-prompt", default="Once upon a time, there was a little fox")
    args = ap.parse_args()

    ck = torch.load(args.ckpt, map_location="cpu", weights_only=True)
    cfg = Config(**ck["cfg"])
    model = TinyLM(cfg)
    model.load_state_dict(ck["state"])
    model.eval()
    sd = {k: v.numpy() for k, v in model.state_dict().items()}

    blob = Blob()
    dq = {}  # dequantized copies, written back for the golden pass

    def add_quant(name):
        q, s = quantize_rows(sd[name])
        blob.add(name, q)
        blob.add(name + ".scale", s)
        dq[name] = q.astype(np.float32) * s[:, None]

    add_quant("tok_emb.weight")
    for i in range(cfg.n_layers):
        p = f"blocks.{i}."
        blob.add(p + "attn_norm.weight", sd[p + "attn_norm.weight"].astype(np.float32))
        add_quant(p + "attn.qkv.weight")
        add_quant(p + "attn.proj.weight")
        blob.add(p + "ffn_norm.weight", sd[p + "ffn_norm.weight"].astype(np.float32))
        add_quant(p + "ffn.gate.weight")
        add_quant(p + "ffn.up.weight")
        add_quant(p + "ffn.down.weight")
    blob.add("out_norm.weight", sd["out_norm.weight"].astype(np.float32))

    header = {"version": 1, "config": cfg.__dict__, "tensors": blob.tensors,
              "step": ck.get("step")}
    hj = json.dumps(header).encode()
    hj += b" " * ((4 - (8 + len(hj)) % 4) % 4)
    out = os.path.join(MODEL_DIR, "model.bin")
    with open(out, "wb") as f:
        f.write(b"ONCE" + struct.pack("<I", len(hj)) + hj + b"".join(blob.parts))
    print(f"wrote {out}: {(8 + len(hj) + blob.off) / 1e6:.1f} MB, step {ck.get('step')}")

    # Golden pass on the dequantized model: the exact function the JS engine runs.
    with torch.no_grad():
        for k, v in dq.items():
            model.state_dict()[k].copy_(torch.from_numpy(v))
        from tokenizers import Tokenizer
        tok = Tokenizer.from_file(os.path.join(MODEL_DIR, "tokenizer.json"))
        ids = tok.encode(args.golden_prompt).ids
        logits, _ = model(torch.tensor([ids]))
        logits = logits[0].float().numpy()
    with open(os.path.join(MODEL_DIR, "golden.bin"), "wb") as f:
        f.write(struct.pack("<II", len(ids), cfg.vocab_size))
        f.write(np.array(ids, dtype=np.uint32).tobytes())
        f.write(logits.astype(np.float32).tobytes())
    print(f"golden: {len(ids)} positions, prompt={args.golden_prompt!r}")
    print("golden last-pos top5:",
          [(int(i), float(logits[-1][i])) for i in np.argsort(-logits[-1])[:5]])


if __name__ == "__main__":
    main()
