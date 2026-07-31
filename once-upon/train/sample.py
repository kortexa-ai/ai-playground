"""Generate sample stories from a checkpoint (sanity check before export)."""

import argparse
import os

import torch
from tokenizers import Tokenizer

from model import Config, TinyLM

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", default=os.path.join(HERE, "runs", "sedan-s0.pt"))
    ap.add_argument("--prompt", default="Once upon a time")
    ap.add_argument("--max-tokens", type=int, default=200)
    ap.add_argument("--temperature", type=float, default=0.8)
    ap.add_argument("--n", type=int, default=2)
    args = ap.parse_args()

    ck = torch.load(args.ckpt, map_location="cpu", weights_only=True)
    model = TinyLM(Config(**ck["cfg"]))
    model.load_state_dict(ck["state"])
    model.eval()
    print(f"checkpoint step {ck.get('step')}")

    tok = Tokenizer.from_file(os.path.join(HERE, "..", "model", "tokenizer.json"))
    ids = torch.tensor([tok.encode(args.prompt).ids])
    for i in range(args.n):
        torch.manual_seed(i)
        out = model.generate(ids, args.max_tokens, temperature=args.temperature)
        print(f"\n--- sample {i} ---\n{tok.decode(out[0].tolist())}")


if __name__ == "__main__":
    main()
