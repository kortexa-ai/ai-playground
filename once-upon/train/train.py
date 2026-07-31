"""Train the once-upon storyteller on snappy's MPS.

Adapted from esp32-mind/src/train.py, minus the ablation machinery, plus
rolling atomic checkpoints so an overnight run can crash without losing the
night.
"""

import argparse
import json
import math
import os
import time

import numpy as np
import torch

from model import Config, TinyLM

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
RUNS = os.path.join(HERE, "runs")


def get_device():
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


class Batcher:
    def __init__(self, split, batch_size, seq_len, device):
        self.data = np.memmap(os.path.join(DATA, f"{split}.bin"), dtype=np.uint16, mode="r")
        self.bs, self.sl, self.device = batch_size, seq_len, device
        self.rng = np.random.default_rng(1234 if split == "val" else None)

    def __call__(self):
        ix = self.rng.integers(0, len(self.data) - self.sl - 1, self.bs)
        x = np.stack([self.data[i : i + self.sl] for i in ix]).astype(np.int64)
        y = np.stack([self.data[i + 1 : i + 1 + self.sl] for i in ix]).astype(np.int64)
        return torch.from_numpy(x).to(self.device), torch.from_numpy(y).to(self.device)


@torch.no_grad()
def evaluate(model, batcher, iters):
    model.eval()
    batcher.rng = np.random.default_rng(1234)  # same val batches every eval
    losses = [model(*batcher())[1].item() for _ in range(iters)]
    model.train()
    return sum(losses) / len(losses)


def lr_at(step, total, peak, warmup):
    if step < warmup:
        return peak * (step + 1) / warmup
    p = (step - warmup) / max(1, total - warmup)
    return 0.1 * peak + 0.9 * peak * 0.5 * (1 + math.cos(math.pi * p))


def save_ckpt(model, cfg, step, path):
    tmp = path + ".tmp"
    torch.save({"cfg": cfg.__dict__, "state": model.state_dict(), "step": step}, tmp)
    os.replace(tmp, path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--d-model", type=int, default=384)
    ap.add_argument("--n-layers", type=int, default=12)
    ap.add_argument("--n-heads", type=int, default=6)
    ap.add_argument("--ffn", type=int, default=1024)
    ap.add_argument("--seq-len", type=int, default=512)
    ap.add_argument("--batch-size", type=int, default=32)
    ap.add_argument("--steps", type=int, default=15000)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--warmup", type=int, default=300)
    ap.add_argument("--eval-every", type=int, default=250)
    ap.add_argument("--eval-iters", type=int, default=20)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--bf16", action="store_true")
    ap.add_argument("--tag", default="sedan")
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    device = get_device()
    os.makedirs(RUNS, exist_ok=True)

    cfg = Config(
        d_model=args.d_model, n_layers=args.n_layers, n_heads=args.n_heads,
        ffn_hidden=args.ffn, seq_len=args.seq_len,
    )
    model = TinyLM(cfg).to(device)
    print(f"device={device} params={model.num_params():,} "
          f"(embed {cfg.vocab_size * cfg.d_model:,} tied)", flush=True)

    decay, no_decay = [], []
    for n, p in model.named_parameters():
        (no_decay if p.ndim < 2 or "tok_emb" in n else decay).append(p)
    opt = torch.optim.AdamW(
        [{"params": decay, "weight_decay": 0.1}, {"params": no_decay, "weight_decay": 0.0}],
        lr=args.lr, betas=(0.9, 0.95),
    )

    train_b = Batcher("train", args.batch_size, args.seq_len, device)
    val_b = Batcher("val", args.batch_size, args.seq_len, device)

    name = f"{args.tag}-s{args.seed}"
    ckpt_path = os.path.join(RUNS, f"{name}.pt")
    history, best = [], float("inf")
    tokens_per_step = args.batch_size * args.seq_len
    t0 = time.time()

    for step in range(args.steps):
        lr = lr_at(step, args.steps, args.lr, args.warmup)
        for g in opt.param_groups:
            g["lr"] = lr
        x, y = train_b()
        if args.bf16:
            with torch.autocast(device_type=device, dtype=torch.bfloat16):
                _, loss = model(x, y)
        else:
            _, loss = model(x, y)
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()

        if step % args.eval_every == 0 or step == args.steps - 1:
            vl = evaluate(model, val_b, args.eval_iters)
            best = min(best, vl)
            tok = (step + 1) * tokens_per_step
            el = time.time() - t0
            history.append({"step": step, "tokens": tok, "train": loss.item(), "val": vl})
            eta = el / (step + 1) * (args.steps - step - 1)
            print(
                f"{name} step {step:5d} | tok {tok / 1e6:6.1f}M | train {loss.item():.4f} "
                f"| val {vl:.4f} | ppl {math.exp(vl):7.2f} | {tok / el / 1e3:5.1f}k tok/s "
                f"| {el:6.0f}s | eta {eta / 3600:.1f}h",
                flush=True,
            )
            save_ckpt(model, cfg, step, ckpt_path)
            with open(os.path.join(RUNS, f"{name}.json"), "w") as f:
                json.dump({"config": cfg.__dict__, "params": model.num_params(),
                           "history": history, "best_val": best}, f, indent=2)

    save_ckpt(model, cfg, args.steps - 1, ckpt_path)
    print(f"{name} DONE val={history[-1]['val']:.4f} "
          f"ppl={math.exp(history[-1]['val']):.2f} wall={(time.time() - t0) / 3600:.2f}h")


if __name__ == "__main__":
    main()
