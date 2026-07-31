"""Emit tokenizer parity fixtures for the JS test (test/fixtures.json)."""

import json
import os

from tokenizers import Tokenizer

HERE = os.path.dirname(os.path.abspath(__file__))
TEXTS = [
    "Once upon a time",
    "Once upon a time, there was a little fox who couldn't sleep.",
    "Tom said, \"Don't worry! We'll find it.\"",
    "  leading spaces and   runs   of spaces",
    "numbers 123 and 4,567 mixed with words",
    "café, naïve, jalapeño — and an em-dash",
    "emoji stress test 🦊🌙✨",
    "line\nbreaks\n\nand tabs\there",
    "it's Tom's toy; they're going; we've gone; I'll stay; he'd know",
    "<|endoftext|> literal text around it",
    "punctuation!!! ... ??? (parens) [brackets] {braces}",
    "A",
    " ",
    "",
    "The quick brown fox jumps over the lazy dog. THE QUICK BROWN FOX.",
]


def main():
    tok = Tokenizer.from_file(os.path.join(HERE, "..", "model", "tokenizer.json"))
    out = []
    for t in TEXTS:
        ids = tok.encode(t).ids
        out.append({"text": t, "ids": ids, "decoded": tok.decode(ids)})
    dest = os.path.join(HERE, "..", "test", "fixtures.json")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"wrote {dest}: {len(out)} fixtures")


if __name__ == "__main__":
    main()
