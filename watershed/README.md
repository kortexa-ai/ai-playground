# Watershed

Rain, and the shape it leaves.

A rain machine on a procedural hill. Thousands of droplets fall, follow the
gradient, pick sediment up when they can carry it and put it down when they
cannot. Their paths erode gullies; the gullies converge into a drainage
network; the network becomes rivers. A slow hillslope creep between storms
keeps the slope from turning into a field of pinholes.

- **rain** — how hard it falls, from a stopped sky to a downpour.
- **rock** — how much the ground gives up. Soft rock carves in seconds; hard
  rock barely notices the weather.
- **click or drag the land** — pour a bucket where you point. A bucket digs a
  gully you can watch, and the rain keeps working on it afterward.
- **flood** (`f`) — fill every closed basin to its spill point. The lakes are
  the rain's own work; the surface is computed with a priority flood each time
  the terrain changes.
- **reseed** (`r`) — a new hill from a new seed. Nothing carries over.
- **weather** (`space`) — pause or resume the rain. Clicking the land still
  pours while paused.
- **sound** (`s`) — synthesized rain, off until you ask for it.

The live **section** under the readout cuts the hill at row 118: the pale line
is the surface, the teal trace is water standing in it when `flood` is on, and
the ticks are the cells where the drainage overlay finds a channel.

```bash
python3 -m http.server 8765
```

Then open <http://localhost:8765>.

`node --test terrain.test.mjs` is the piece's ears. The terrain lives apart
from the DOM in `terrain.js`, and the tests run the same file the browser does:
the seed is reproducible, the bilinear gradient the droplets steer by matches
finite differences, terrain and droplet keep matching sediment books, drainage
conserves its drops, priority flood fills a bowl to its rim without digging,
hillslope creep smooths without flattening, and a long storm still leaves a
channel the drainage can find.

## Why the rain is not on the GPU

The grid is 300×190 cells. At maximum rain with flood on, a CPU profile of the
page shows it idle about 86% of the time: the droplet walk, the drainage sort,
and the hillshade all fit easily inside a frame, and the page stays at 60 fps.
The piece stays plain JavaScript so the tests run the exact geology the browser
runs. If you want to wear the hill down faster, put rain at 100 and rock at 0.

