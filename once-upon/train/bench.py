"""Measure MPS training throughput on synthetic tokens to size the overnight run."""

import argparse
import time

import torch

from model import Config, TinyLM
from train import get_device, lr_at


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--d-model", type=int, default=384)
    ap.add_argument("--n-layers", type=int, default=12)
    ap.add_argument("--n-heads", type=int, default=6)
    ap.add_argument("--ffn", type=int, default=1024)
    ap.add_argument("--seq-len", type=int, default=512)
    ap.add_argument("--batch-size", type=int, default=32)
    ap.add_argument("--steps", type=int, default=30)
    ap.add_argument("--bf16", action="store_true")
    args = ap.parse_args()

    device = get_device()
    cfg = Config(d_model=args.d_model, n_layers=args.n_layers, n_heads=args.n_heads,
                 ffn_hidden=args.ffn, seq_len=args.seq_len)
    model = TinyLM(cfg).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=1e-3, betas=(0.9, 0.95))
    n = model.num_params()
    print(f"device={device} params={n:,} bf16={args.bf16}")

    x = torch.randint(0, cfg.vocab_size, (args.batch_size, args.seq_len), device=device)
    y = torch.randint(0, cfg.vocab_size, (args.batch_size, args.seq_len), device=device)

    def step():
        if args.bf16:
            with torch.autocast(device_type=device, dtype=torch.bfloat16):
                _, loss = model(x, y)
        else:
            _, loss = model(x, y)
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        return loss

    for _ in range(5):
        step()
    if device == "mps":
        torch.mps.synchronize()
    t0 = time.time()
    for _ in range(args.steps):
        loss = step()
    if device == "mps":
        torch.mps.synchronize()
    dt = (time.time() - t0) / args.steps
    tps = args.batch_size * args.seq_len / dt
    flops = 6 * n * args.batch_size * args.seq_len / dt
    print(f"{dt * 1000:.0f} ms/step | {tps / 1e3:.1f}k tok/s | ~{flops / 1e12:.2f} TFLOPS "
          f"| loss {loss.item():.3f}")
    print(f"100M tokens: {100e6 / tps / 3600:.2f}h | 200M: {200e6 / tps / 3600:.2f}h "
          f"| 300M: {300e6 / tps / 3600:.2f}h")


if __name__ == "__main__":
    main()
