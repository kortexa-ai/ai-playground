// Watershed — the rain machine's geology.
//
// Pure terrain functions shared by the browser piece and its tests: a seeded
// height field, bilinear sampling with an analytic gradient, droplet-based
// hydraulic erosion, D8 flow accumulation, and priority-flood basin filling.
// No dependencies; works in the browser and in Node, so the tests exercise
// the exact code the piece runs.

(() => {
  "use strict";

  // mulberry32 — small, fast, seedable.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash2(ix, iy, seed) {
    let h =
      Math.imul(ix | 0, 0x27d4eb2d) ^
      Math.imul(iy | 0, 0x165667b1) ^
      (seed | 0);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function smooth(t) {
    const x = t < 0 ? 0 : t > 1 ? 1 : t;
    return x * x * (3 - 2 * x);
  }

  function valueNoise(x, y, seed) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = smooth(x - ix);
    const fy = smooth(y - iy);
    const a = hash2(ix, iy, seed);
    const b = hash2(ix + 1, iy, seed);
    const c = hash2(ix, iy + 1, seed);
    const d = hash2(ix + 1, iy + 1, seed);
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  }

  function fbm(x, y, seed, octaves = 5) {
    let sum = 0;
    let amplitude = 1;
    let norm = 0;
    for (let octave = 0; octave < octaves; octave++) {
      sum += valueNoise(x, y, seed + octave * 1013) * amplitude;
      norm += amplitude;
      amplitude *= 0.5;
      // rotate between octaves so the grid never lines up with itself
      const nx = (x * 0.8 - y * 0.6) * 2.03 + 17.31;
      const ny = (x * 0.6 + y * 0.8) * 2.03 + 9.73;
      x = nx;
      y = ny;
    }
    return sum / norm;
  }

  function normalize(map, low = 0, high = 1) {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < map.length; i++) {
      if (map[i] < min) min = map[i];
      if (map[i] > max) max = map[i];
    }
    const span = max - min || 1;
    for (let i = 0; i < map.length; i++) {
      map[i] = low + ((map[i] - min) / span) * (high - low);
    }
    return map;
  }

  // A hill worth raining on: a few domes, fractal noise, and a ridge pattern
  // for structure. The edges fall away so every river has somewhere to go.
  function createHeightField(seed, cols, rows) {
    const rand = mulberry32(seed >>> 0);
    const map = new Float32Array(cols * rows);
    const offsetX = rand() * 80;
    const offsetY = rand() * 80;
    const ridgeSeed = (seed ^ 0x9e3779b9) >>> 0;
    const domes = [];
    for (let i = 0; i < 3; i++) {
      domes.push({
        x: 0.18 + rand() * 0.64,
        y: 0.12 + rand() * 0.72,
        radius: 0.1 + rand() * 0.16,
        height: 0.22 + rand() * 0.5,
      });
    }
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const nx = cols > 1 ? x / (cols - 1) : 0;
        const ny = rows > 1 ? y / (rows - 1) : 0;
        let height = 0;
        for (const dome of domes) {
          const dx = nx - dome.x;
          const dy = ny - dome.y;
          const falloff = Math.exp(
            -(dx * dx + dy * dy) / (dome.radius * dome.radius),
          );
          height += dome.height * falloff;
        }
        height +=
          fbm(nx * 3.1 + offsetX, ny * 3.1 + offsetY, seed >>> 0, 5) * 0.52 +
          (1 -
            Math.abs(
              2 *
                fbm(
                  nx * 2.2 + offsetX * 0.6,
                  ny * 2.2 + offsetY * 0.6,
                  ridgeSeed,
                  4,
                ) -
                1,
            )) *
            0.32;
        const edge = Math.min(nx, 1 - nx, ny, 1 - ny);
        height *= 0.28 + 0.72 * smooth(edge / 0.16);
        map[y * cols + x] = height;
      }
    }
    normalize(map, 0.02, 1);
    return map;
  }

  // Bilinear height and the analytic gradient of that same bilinear patch.
  // The droplet steering reads this every step, so the gradient has to be
  // exact; the finite-difference test in terrain.test.mjs is its ear.
  function heightAndGradient(map, cols, rows, x, y) {
    const cx = Math.min(cols - 1, Math.max(0, x));
    const cy = Math.min(rows - 1, Math.max(0, y));
    const x0 = Math.min(cols - 1, Math.floor(cx));
    const y0 = Math.min(rows - 1, Math.floor(cy));
    const x1 = Math.min(cols - 1, x0 + 1);
    const y1 = Math.min(rows - 1, y0 + 1);
    const fx = cx - x0;
    const fy = cy - y0;
    const h00 = map[y0 * cols + x0];
    const h10 = map[y0 * cols + x1];
    const h01 = map[y1 * cols + x0];
    const h11 = map[y1 * cols + x1];
    const height =
      (h00 + (h10 - h00) * fx) * (1 - fy) +
      (h01 + (h11 - h01) * fx) * fy;
    const gradientX = (h10 - h00) * (1 - fy) + (h11 - h01) * fy;
    const gradientY = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;
    return { height, gradientX, gradientY };
  }

  function brushOffsets(radius) {
    const offsets = [];
    let total = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx === 0 && dy === 0) continue;
        const distance = Math.hypot(dx, dy);
        if (distance > radius) continue;
        const weight = 1 - distance / radius;
        offsets.push({ dx, dy, weight });
        total += weight;
      }
    }
    return { offsets, total };
  }

  const brushCache = new Map();
  function getBrush(radius) {
    const key = radius | 0;
    if (!brushCache.has(key)) brushCache.set(key, brushOffsets(key));
    return brushCache.get(key);
  }

  // Sediment is dropped across the four cells around the point, not into one
  // cell. A single-cell drop builds needle piles; a bilinear one builds
  // floodplains.
  function depositAt(map, cols, rows, x, y, amount) {
    const x0 = Math.min(cols - 1, Math.max(0, Math.floor(x)));
    const y0 = Math.min(rows - 1, Math.max(0, Math.floor(y)));
    const x1 = Math.min(cols - 1, x0 + 1);
    const y1 = Math.min(rows - 1, y0 + 1);
    const fx = x - x0;
    const fy = y - y0;
    map[y0 * cols + x0] += amount * (1 - fx) * (1 - fy);
    map[y0 * cols + x1] += amount * fx * (1 - fy);
    map[y1 * cols + x0] += amount * (1 - fx) * fy;
    map[y1 * cols + x1] += amount * fx * fy;
  }

  const DROPLET_DEFAULTS = {
    lifetime: 36,
    inertia: 0.06,
    capacityFactor: 3.5,
    minCapacity: 0.0004,
    erodeSpeed: 0.35,
    depositSpeed: 0.3,
    gravity: 6,
    evaporation: 0.012,
    brushRadius: 2,
    water: 1,
    // A cliff is not an invitation. Without a per-step ceiling, one drop that
    // crosses a deposit needle erodes it whole, carries the spike downhill,
    // and the map slowly grows towers. These keep the books bounded.
    maxStepErode: 0.02,
    maxStepDeposit: 0.02,
  };

  // One raindrop: it follows the gradient, gathers what it can carry, and
  // leaves what it cannot. `eroded - deposited` is exactly the sediment it
  // is still holding when it leaves the map.
  function simulateDroplet(map, cols, rows, options = {}) {
    const opts = Object.assign({}, DROPLET_DEFAULTS, options);
    const rng = opts.rng || Math.random;
    const scale = opts.gradientScale == null ? cols : opts.gradientScale;
    let x = opts.x == null ? rng() * (cols - 1) : opts.x;
    let y = opts.y == null ? rng() * (rows - 1) : opts.y;
    let dirX = rng() * 2 - 1;
    let dirY = rng() * 2 - 1;
    const dirLength = Math.hypot(dirX, dirY) || 1;
    dirX /= dirLength;
    dirY /= dirLength;
    let speed = 1;
    let water = opts.water;
    let sediment = 0;
    let eroded = 0;
    let deposited = 0;
    let steps = 0;
    const brush = getBrush(opts.brushRadius);

    for (let step = 0; step < opts.lifetime; step++) {
      if (x < 0 || y < 0 || x > cols - 1 || y > rows - 1) break;
      const sample = heightAndGradient(map, cols, rows, x, y);

      dirX =
        dirX * opts.inertia - sample.gradientX * scale * (1 - opts.inertia);
      dirY =
        dirY * opts.inertia - sample.gradientY * scale * (1 - opts.inertia);
      const length = Math.hypot(dirX, dirY) || 1;
      dirX /= length;
      dirY /= length;

      x += dirX;
      y += dirY;
      steps++;
      if (x < 0 || y < 0 || x > cols - 1 || y > rows - 1) break;

      const next = heightAndGradient(map, cols, rows, x, y);
      const deltaHeight = next.height - sample.height;
      const capacity = Math.max(
        -deltaHeight * speed * water * opts.capacityFactor,
        opts.minCapacity,
      );
      const cellX = Math.floor(x);
      const cellY = Math.floor(y);

      if (deltaHeight > 0 || sediment > capacity) {
        const amount = Math.min(
          deltaHeight > 0
            ? Math.min(deltaHeight, sediment)
            : (sediment - capacity) * opts.depositSpeed,
          opts.maxStepDeposit,
        );
        if (amount > 0) {
          depositAt(map, cols, rows, x, y, amount);
          sediment -= amount;
          deposited += amount;
        }
      } else {
        const amountToErode = Math.min(
          (capacity - sediment) * opts.erodeSpeed,
          -deltaHeight,
          opts.maxStepErode,
        );
        if (amountToErode > 0) {
          let totalWeight = 0;
          for (const offset of brush.offsets) {
            const nx = cellX + offset.dx;
            const ny = cellY + offset.dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            totalWeight += offset.weight;
          }
          let removed = 0;
          for (const offset of brush.offsets) {
            const nx = cellX + offset.dx;
            const ny = cellY + offset.dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            const index = ny * cols + nx;
            const take = Math.min(
              amountToErode * (offset.weight / totalWeight),
              map[index],
            );
            map[index] -= take;
            removed += take;
          }
          sediment += removed;
          eroded += removed;
        }
      }

      speed = Math.sqrt(Math.max(0, speed * speed + deltaHeight * opts.gravity));
      water *= 1 - opts.evaporation;
    }

    return { x, y, sediment, eroded, deposited, steps };
  }

  // D8 drainage: every cell points at its steepest lower neighbour, and each
  // cell contributes one drop to everything downstream. A cell's accumulation
  // is therefore its upstream area in cells — the number flow overlay draws.
  function flowAccumulation(map, cols, rows) {
    const count = cols * rows;
    const order = new Array(count);
    for (let i = 0; i < count; i++) order[i] = i;
    order.sort((a, b) => map[b] - map[a]);

    const accumulation = new Float32Array(count);
    accumulation.fill(1);

    for (let i = 0; i < count; i++) {
      const index = order[i];
      const x = index % cols;
      const y = (index - x) / cols;
      let best = -1;
      let bestDrop = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= rows) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= cols) continue;
          const neighbour = ny * cols + nx;
          const drop = map[index] - map[neighbour];
          if (drop > bestDrop) {
            bestDrop = drop;
            best = neighbour;
          }
        }
      }
      if (best >= 0) accumulation[best] += accumulation[index];
    }
    return accumulation;
  }

  // Priority flood: fill every closed basin to its spill point, the way water
  // would. Returns the water surface elevation for each cell.
  function priorityFlood(map, cols, rows) {
    const count = cols * rows;
    const filled = new Float32Array(count);
    const seen = new Uint8Array(count);
    const heapIndex = [];
    const heapKey = [];

    function push(index, key) {
      heapIndex.push(index);
      heapKey.push(key);
      let i = heapIndex.length - 1;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (heapKey[parent] <= heapKey[i]) break;
        const ti = heapIndex[parent];
        const tk = heapKey[parent];
        heapIndex[parent] = heapIndex[i];
        heapKey[parent] = heapKey[i];
        heapIndex[i] = ti;
        heapKey[i] = tk;
        i = parent;
      }
    }

    function pop() {
      const top = heapIndex[0];
      const lastIndex = heapIndex.pop();
      const lastKey = heapKey.pop();
      if (heapIndex.length > 0) {
        heapIndex[0] = lastIndex;
        heapKey[0] = lastKey;
        let i = 0;
        const size = heapIndex.length;
        for (;;) {
          const left = i * 2 + 1;
          const right = left + 1;
          let smallest = i;
          if (left < size && heapKey[left] < heapKey[smallest]) smallest = left;
          if (right < size && heapKey[right] < heapKey[smallest])
            smallest = right;
          if (smallest === i) break;
          const ti = heapIndex[smallest];
          const tk = heapKey[smallest];
          heapIndex[smallest] = heapIndex[i];
          heapKey[smallest] = heapKey[i];
          heapIndex[i] = ti;
          heapKey[i] = tk;
          i = smallest;
        }
      }
      return top;
    }

    function addBorder(index) {
      if (seen[index]) return;
      seen[index] = 1;
      filled[index] = map[index];
      push(index, map[index]);
    }

    for (let x = 0; x < cols; x++) {
      addBorder(x);
      addBorder((rows - 1) * cols + x);
    }
    for (let y = 0; y < rows; y++) {
      addBorder(y * cols);
      addBorder(y * cols + cols - 1);
    }

    while (heapIndex.length > 0) {
      const index = pop();
      const x = index % cols;
      const y = (index - x) / cols;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= rows) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= cols) continue;
          const neighbour = ny * cols + nx;
          if (seen[neighbour]) continue;
          seen[neighbour] = 1;
          filled[neighbour] = Math.max(map[neighbour], filled[index]);
          push(neighbour, filled[neighbour]);
        }
      }
    }
    return filled;
  }

  // Between storms, a slow hillslope creep: each interior cell moves a little
  // toward the average of its eight neighbours. Droplet erosion alone leaves
  // brush-sized pits everywhere; this is what makes a slope look rained-on
  // rather than peppered with holes, and it is why the drainage stays legible.
  function diffuse(map, cols, rows, rate = 0.1) {
    if (cols < 3 || rows < 3) return map;
    const copy = Float32Array.from(map);
    for (let y = 1; y < rows - 1; y++) {
      for (let x = 1; x < cols - 1; x++) {
        const index = y * cols + x;
        const average =
          (copy[index - 1] +
            copy[index + 1] +
            copy[index - cols] +
            copy[index + cols] +
            copy[index - cols - 1] +
            copy[index - cols + 1] +
            copy[index + cols - 1] +
            copy[index + cols + 1]) /
          8;
        map[index] += rate * (average - copy[index]);
      }
    }
    return map;
  }

  function computeStats(map, cols, rows, accumulation) {
    let lowest = Infinity;
    let highest = -Infinity;
    let drainage = 0;
    for (let i = 0; i < map.length; i++) {
      if (map[i] < lowest) lowest = map[i];
      if (map[i] > highest) highest = map[i];
      if (accumulation && accumulation[i] > drainage)
        drainage = accumulation[i];
    }

    let basins = 0;
    for (let y = 1; y < rows - 1; y++) {
      for (let x = 1; x < cols - 1; x++) {
        const index = y * cols + x;
        const height = map[index];
        let hasLower = false;
        for (let dy = -1; dy <= 1 && !hasLower; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            if (map[(y + dy) * cols + (x + dx)] < height - 1e-7) {
              hasLower = true;
              break;
            }
          }
        }
        if (!hasLower) basins++;
      }
    }

    return {
      lowest,
      highest,
      relief: highest - lowest,
      drainage,
      basins,
    };
  }

  const api = {
    mulberry32,
    valueNoise,
    createHeightField,
    normalize,
    heightAndGradient,
    simulateDroplet,
    flowAccumulation,
    priorityFlood,
    diffuse,
    computeStats,
    DROPLET_DEFAULTS,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.Watershed = api;
})();
