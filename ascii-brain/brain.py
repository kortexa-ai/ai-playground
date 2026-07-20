#!/usr/bin/env python3
"""
ascii-brain — grow a brain from six numbers.

A Clifford strange attractor rendered as terminal ASCII density art.
No dependencies, no data, no training. Just python3 and a loop that
chases its own tail 600,000 times until it accidentally becomes anatomy.

    x' = sin(a*y) + c*cos(a*x)
    y' = sin(b*x) + d*cos(b*y)

Usage:
    python3 brain.py                 # the "cortex" brain from the session
    python3 brain.py list            # show all named presets
    python3 brain.py jellyfish       # render a named preset
    python3 brain.py random          # roll random params (prints them so you can keep the keepers)
    python3 brain.py -1.7 1.8 -1.9 -0.4   # your own a b c d
    python3 brain.py cortex 140 60   # a preset at a custom width height
"""
import math
import random
import sys

RAMP = " .:-=+*#%@"

# Hand-picked param sets (a, b, c, d) that each fold into something lovely.
PRESETS = {
    "cortex":    (-1.7,  1.8, -1.9, -0.4),
    "jellyfish": (-1.4,  1.6,  1.0,  0.7),
    "moth":      ( 1.6, -0.6, -1.2,  1.6),
    "vortex":    (-1.8, -2.0, -0.5, -0.9),
    "ribbon":    (-1.7,  1.3, -0.1, -1.2),
    "orchid":    ( 1.5, -1.8,  1.6,  0.9),
}


def render(a, b, c, d, w=96, h=44, iters=600000):
    grid = [[0] * w for _ in range(h)]
    x = y = 0.0
    lo, span = -2.4, 4.8
    for _ in range(iters):
        x, y = math.sin(a * y) + c * math.cos(a * x), math.sin(b * x) + d * math.cos(b * y)
        px = int((x - lo) / span * (w - 1))
        py = int((y - lo) / span * (h - 1))
        if 0 <= px < w and 0 <= py < h:
            grid[py][px] += 1
    peak = max((max(row) for row in grid), default=1) or 1
    lines = []
    for row in grid:
        lines.append("".join(
            RAMP[min(len(RAMP) - 1, int((v / peak) ** 0.42 * (len(RAMP) - 1)))] if v else " "
            for v in row
        ))
    return "\n".join(lines)


def parse_size(rest):
    """Optional trailing 'WIDTH HEIGHT' -> (w, h). Falls back to defaults."""
    try:
        if len(rest) >= 2:
            return int(rest[0]), int(rest[1])
    except ValueError:
        pass
    return 96, 44


def main(argv):
    args = argv[1:]

    if args and args[0] == "list":
        print("presets: " + ", ".join(PRESETS))
        print("also try:  random   |   your own:  brain.py a b c d")
        return

    if not args:
        name, params, size = "cortex", PRESETS["cortex"], (96, 44)
    elif args[0] == "random":
        params = tuple(round(random.uniform(-2.0, 2.0), 3) for _ in range(4))
        name, size = "random", parse_size(args[1:])
    elif args[0] in PRESETS:
        name, params, size = args[0], PRESETS[args[0]], parse_size(args[1:])
    else:
        try:
            params = tuple(float(v) for v in args[:4])
            name, size = "custom", parse_size(args[4:])
        except (ValueError, IndexError):
            print("usage: brain.py [ list | random | <preset> | a b c d ] [width height]")
            print("       run  'brain.py list'  to see the presets")
            return

    a, b, c, d = params
    w, h = size
    print(render(a, b, c, d, w=w, h=h))
    print(f"\n  {name}:  a={a}  b={b}  c={c}  d={d}   ({w}x{h})")
    if name == "random":
        print(f"  keep it:  python3 brain.py {a} {b} {c} {d}")


if __name__ == "__main__":
    main(sys.argv)
