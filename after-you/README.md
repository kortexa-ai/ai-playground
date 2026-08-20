# After You

It is watching your hand, and learning to be there first.

A 146-parameter neural network — 4 inputs (hand position and velocity), two
hidden tanh layers of eight, 2 outputs (forecast position) — trains itself in
this tab with plain backprop, no libraries. A hand follows your pointer on a
spring; the amber ghost is the net's forecast of where the hand will be
`horizon` seconds from now. When the hand arrives where the ghost was, the
forecast is confirmed with a pop. The constellation on the left is the net's
actual weights, redrawing every frame: warm edges are positive, cool edges
negative, and the pattern visibly restructures as it learns.

- **move** — the hand follows; the net learns your rhythm.
- **feint** (or `space`) — the hand dashes to a far corner. The forecast
  breaks, the error spikes, and the net relearns.
- **sleep / wake** (`s` / `w`) — the hand rests at center; watch the ghost
  settle onto it.
- **relearn** (`r`) — re-randomize the weights and start from zero.
- **horizon** — how far ahead the net tries to see, 0.2s to 1.5s.

```bash
python3 -m http.server 8765
```

Then open <http://localhost:8765>.

`node --test net.test.mjs` is the piece's ears: a finite-difference gradient
check on the exact code the browser trains with, plus a convergence test on a
circling target. The gradient is the load-bearing part — if it is wrong, the
net quietly learns nothing.
