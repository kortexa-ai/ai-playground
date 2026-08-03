# Expert Aquarium

Sparse thoughts, observed underwater.

Words swim through twelve visible reefs standing in for the 43 layers of
DeepSeek V4 Flash. At each reef, the router lights only three representative
experts; the real model chooses six from 256. A VRAM slider changes whether the
ordinary layer stays resident, how many experts remain cached, how often a
visitor finds a warm specialist, and how long cache misses linger near storage.

This is a playful explainer, not a benchmark. Its three anchor points come from
real capped runs on one RTX PRO 6000:

| Budget | Policy | Expert cache | Warm decode |
| ---: | --- | ---: | ---: |
| 4 GiB | streamed layers | 3 / layer | 0.62 tok/s |
| 14 GiB | resident layers | 8 / layer | 2.16 tok/s |
| 40 GiB | resident layers | 51 / layer | 3.65 tok/s |

Everything else is aquarium logic: deterministic word routing, representative
experts, a tiny LRU per reef, and enough bioluminescence to make cache reuse
visible without asking anyone to download 167 GB first.

```bash
cd expert-aquarium
python3 -m http.server 8765
```

Then open <http://localhost:8765>.
