"""Download a TinyStories slice and encode it with the esp32-mind BPE.

Adapted from esp32-mind/data/prepare.py. The tokenizer is reused verbatim
(../model/tokenizer.json) so the browser toy and the matchbox car speak the
same 16,384 tokens. The slice is 4x bigger because this model gets to be a
family sedan.
"""

import os
import sys

import numpy as np
import requests
from tokenizers import Tokenizer

HERE = os.path.dirname(os.path.abspath(__file__))
TOKENIZER = os.path.join(HERE, "..", "model", "tokenizer.json")
DATA = os.path.join(HERE, "data")
URL = "https://huggingface.co/datasets/roneneldan/TinyStories/resolve/main/TinyStories-train.txt"
RAW = os.path.join(DATA, "tinystories_slice.txt")
SLICE_BYTES = 1200 * 1024 * 1024
VAL_FRACTION = 0.005
EOT = "<|endoftext|>"


def download():
    if os.path.exists(RAW) and os.path.getsize(RAW) >= SLICE_BYTES * 0.99:
        print(f"already have {RAW}")
        return
    print(f"downloading first {SLICE_BYTES / 1e6:.0f}MB of TinyStories...")
    got = 0
    with requests.get(URL, stream=True, timeout=60) as r:
        r.raise_for_status()
        with open(RAW, "wb") as f:
            for chunk in r.iter_content(chunk_size=1 << 20):
                f.write(chunk)
                got += len(chunk)
                if got >= SLICE_BYTES:
                    break
                if got % (100 << 20) < (1 << 20):
                    print(f"  {got / 1e6:.0f}MB", flush=True)
    print(f"done, {got / 1e6:.0f}MB")


def main():
    os.makedirs(DATA, exist_ok=True)
    download()
    with open(RAW, "r", encoding="utf-8", errors="ignore") as f:
        text = f.read()
    # Drop the trailing partial story left by the byte-slice.
    text = text[: text.rfind(EOT) + len(EOT)]

    tok = Tokenizer.from_file(TOKENIZER)
    eot = tok.token_to_id(EOT)
    print(f"eot id = {eot}")

    print("encoding...")
    docs = text.split(EOT)
    del text
    chunks = []
    for i in range(0, len(docs), 20000):
        batch = [d for d in docs[i : i + 20000] if d.strip()]
        ids = []
        for enc in tok.encode_batch(batch):
            ids.extend(enc.ids)
            ids.append(eot)
        chunks.append(np.array(ids, dtype=np.uint16))
        done = sum(len(c) for c in chunks)
        print(f"  {i + len(batch)}/{len(docs)} docs, {done / 1e6:.1f}M tokens", flush=True)

    arr = np.concatenate(chunks)
    assert arr.max() < 16384
    n_val = int(len(arr) * VAL_FRACTION)
    arr[:-n_val].tofile(os.path.join(DATA, "train.bin"))
    arr[-n_val:].tofile(os.path.join(DATA, "val.bin"))
    print(f"train {len(arr) - n_val:,} tokens / val {n_val:,} tokens")


if __name__ == "__main__":
    sys.exit(main())
