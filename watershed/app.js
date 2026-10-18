// Watershed — rain, and the shape it leaves.
//
// Thousands of droplets fall on a procedural hill, pick sediment up and put it
// down downhill. Their paths become gullies, the gullies become a drainage
// network, and the network becomes rivers. Between storms a slow hillslope
// creep keeps the mesh honest. All of the geology lives in terrain.js; this
// file draws it, lets you rain on it, and shows the lakes the rain made.

(() => {
  "use strict";

  const T = window.Watershed;
  const COLS = 300;
  const ROWS = 190;
  const RIVER_MIN = 14; // upstream cells before a channel is drawn
  const MAX_DROPS_PER_SECOND = 1500;
  const DROPLET_OPTIONS = {
    lifetime: 36,
    capacityFactor: 4,
    brushRadius: 3,
    maxStepErode: 0.02,
    depositSpeed: 0.3,
  };
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const mapCanvas = document.getElementById("map");
  const mapContext = mapCanvas.getContext("2d", { alpha: false });
  const profileCanvas = document.getElementById("profile");
  const profileContext = profileCanvas.getContext("2d");
  const rainInput = document.getElementById("rain");
  const rockInput = document.getElementById("rock");
  const rainOutput = document.getElementById("rain-out");
  const rockOutput = document.getElementById("rock-out");
  const floodButton = document.getElementById("flood");
  const againButton = document.getElementById("again");
  const soundButton = document.getElementById("sound");
  const dropsReadout = document.getElementById("drops");
  const sedimentReadout = document.getElementById("sediment");
  const drainageReadout = document.getElementById("drainage");
  const basinsReadout = document.getElementById("basins");
  const sectionRow = document.getElementById("section-row");

  const SECTION_ROW = Math.round(ROWS * 0.62);

  const state = {
    heights: null,
    accumulation: null,
    filled: null,
    stats: null,
    rain: Number(rainInput.value),
    rock: Number(rockInput.value),
    raining: true,
    flood: false,
    drops: 0,
    sediment: 0,
    dropBudget: 0,
    refreshTimer: 0,
    floodTimer: 0,
    pourRemaining: 0,
    pourX: 0,
    pourY: 0,
    ripples: [],
  };

  let width = 1;
  let height = 1;
  let dpr = 1;
  let lastFrame = performance.now();

  const fieldCanvas = document.createElement("canvas");
  fieldCanvas.width = COLS;
  fieldCanvas.height = ROWS;
  const fieldContext = fieldCanvas.getContext("2d");
  const fieldImage = fieldContext.createImageData(COLS, ROWS);
  const fieldPixels = new Uint32Array(fieldImage.data.buffer);

  // A dark relief palette: moss in the bottoms, bone on the tops.
  const PALETTE = [
    [11, 20, 19],
    [26, 44, 38],
    [64, 74, 56],
    [126, 120, 94],
    [196, 186, 160],
    [240, 234, 216],
  ];
  const PALETTE_SIZE = 128;
  const paletteR = new Uint8Array(PALETTE_SIZE);
  const paletteG = new Uint8Array(PALETTE_SIZE);
  const paletteB = new Uint8Array(PALETTE_SIZE);
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const position = (i / (PALETTE_SIZE - 1)) * (PALETTE.length - 1);
    const lower = Math.floor(position);
    const upper = Math.min(PALETTE.length - 1, lower + 1);
    const mix = position - lower;
    paletteR[i] = PALETTE[lower][0] + (PALETTE[upper][0] - PALETTE[lower][0]) * mix;
    paletteG[i] = PALETTE[lower][1] + (PALETTE[upper][1] - PALETTE[lower][1]) * mix;
    paletteB[i] = PALETTE[lower][2] + (PALETTE[upper][2] - PALETTE[lower][2]) * mix;
  }

  const WATER = { r: 62, g: 146, b: 140 };
  const RIVER = { r: 124, g: 202, b: 190 };

  const streaks = Array.from({ length: 150 }, () => ({
    x: Math.random(),
    y: Math.random(),
    length: 0.014 + Math.random() * 0.032,
    speed: 0.34 + Math.random() * 0.5,
  }));

  // — audio ———————————————————————————————————————————————
  const audio = { context: null, master: null, enabled: false };

  function buildNoise(context) {
    const seconds = 2.5;
    const length = Math.floor(context.sampleRate * seconds);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      brown = (brown + 0.035 * white) / 1.035;
      data[i] = brown * 2.6 + white * 0.16;
    }
    return buffer;
  }

  function ensureAudio() {
    if (audio.context) return audio.context;
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return null;
    const context = new Context();
    const source = context.createBufferSource();
    source.buffer = buildNoise(context);
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1050;
    filter.Q.value = 0.5;
    const master = context.createGain();
    master.gain.value = 0;
    source.connect(filter).connect(master).connect(context.destination);
    source.start();
    audio.context = context;
    audio.master = master;
    return context;
  }

  function updateSoundGain() {
    if (!audio.context || !audio.master) return;
    const level = audio.enabled ? 0.016 + (state.rain / 100) * 0.075 : 0.0001;
    audio.master.gain.setTargetAtTime(level, audio.context.currentTime, 0.4);
  }

  function plink() {
    if (!audio.enabled || !audio.context) return;
    const context = audio.context;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.value = 420 + Math.random() * 520;
    gain.gain.setValueAtTime(0.018, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.2);
  }

  // — terrain —————————————————————————————————————————————
  function seedTerrain(seed) {
    state.heights = T.createHeightField(seed, COLS, ROWS);
    state.accumulation = null;
    state.filled = null;
    state.stats = null;
    state.drops = 0;
    state.sediment = 0;
    state.dropBudget = 0;
    state.pourRemaining = 0;
    state.ripples.length = 0;
    state.raining = true;
    setFlood(false);
    refreshDrainage(true);
  }

  function erodeSpeed() {
    return 0.05 + 0.55 * (1 - state.rock / 100);
  }

  function spawnDroplet(x, y) {
    const options = Object.assign({}, DROPLET_OPTIONS, {
      x,
      y,
      erodeSpeed: erodeSpeed(),
    });
    const result = T.simulateDroplet(state.heights, COLS, ROWS, options);
    state.drops++;
    state.sediment += result.eroded;
  }

  function refreshDrainage(force) {
    if (!state.heights) return;
    let surface = state.heights;
    if (state.flood) {
      state.filled = T.priorityFlood(state.heights, COLS, ROWS);
      surface = state.filled;
    } else if (force) {
      state.filled = null;
    }
    state.accumulation = T.flowAccumulation(surface, COLS, ROWS);
    state.stats = T.computeStats(
      state.heights,
      COLS,
      ROWS,
      state.accumulation,
    );
    updateReadouts();
  }

  function setFlood(on) {
    state.flood = on;
    floodButton.setAttribute("aria-pressed", String(on));
    if (on) {
      state.filled = T.priorityFlood(state.heights, COLS, ROWS);
      state.floodTimer = 0;
    } else {
      state.filled = null;
    }
    refreshDrainage(false);
  }

  // — rendering ———————————————————————————————————————————
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    mapCanvas.width = Math.round(width * dpr);
    mapCanvas.height = Math.round(height * dpr);
    mapContext.setTransform(dpr, 0, 0, dpr, 0, 0);

    const profileRect = profileCanvas.getBoundingClientRect();
    profileCanvas.width = Math.max(1, Math.round(profileRect.width * dpr));
    profileCanvas.height = Math.max(1, Math.round(profileRect.height * dpr));
    profileContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const ELEVATION_LOW = 0.02;
  const ELEVATION_RANGE = 0.98;

  function paintField() {
    const heights = state.heights;
    const accumulation = state.accumulation;
    const filled = state.filled;
    const strength = COLS * 0.95;
    const flood = state.flood && filled;

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const index = y * COLS + x;
        const h = heights[index];
        const left = heights[y * COLS + Math.max(0, x - 1)];
        const right = heights[y * COLS + Math.min(COLS - 1, x + 1)];
        const up = heights[Math.max(0, y - 1) * COLS + x];
        const down = heights[Math.min(ROWS - 1, y + 1) * COLS + x];
        const dzdx = (right - left) * 0.5 * strength;
        const dzdy = (down - up) * 0.5 * strength;
        const inverse = 1 / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
        const lambert = (dzdx * 0.55 + dzdy * 0.62 + 0.56) * inverse;
        const shade = Math.max(0.2, Math.min(1.22, 0.3 + 0.82 * lambert));

        let t = (h - ELEVATION_LOW) / ELEVATION_RANGE;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const paletteIndex = (t * (PALETTE_SIZE - 1)) | 0;
        let r = paletteR[paletteIndex] * shade;
        let g = paletteG[paletteIndex] * shade;
        let b = paletteB[paletteIndex] * shade;

        if (flood) {
          const depth = filled[index] - h;
          if (depth > 0.0015) {
            const alpha = Math.min(0.94, 0.5 + depth * 16);
            r += (WATER.r - r) * alpha;
            g += (WATER.g - g) * alpha;
            b += (WATER.b - b) * alpha;
          }
        }

        if (accumulation) {
          const flow = accumulation[index];
          if (flow >= RIVER_MIN) {
            const strengthRiver = Math.min(
              1,
              0.32 + (flow - RIVER_MIN) / 110,
            );
            const alpha = 0.62 * strengthRiver;
            r += (RIVER.r - r) * alpha;
            g += (RIVER.g - g) * alpha;
            b += (RIVER.b - b) * alpha;
          }
        }

        fieldPixels[index] =
          (255 << 24) |
          ((b | 0) << 16) |
          ((g | 0) << 8) |
          (r | 0);
      }
    }
    fieldContext.putImageData(fieldImage, 0, 0);
  }

  function drawRain(dt) {
    if (!state.raining || state.rain <= 0 || reducedMotion) return;
    const visible = Math.round(streaks.length * (state.rain / 100));
    mapContext.strokeStyle = "rgba(198, 219, 209, 0.11)";
    mapContext.lineWidth = 1;
    mapContext.beginPath();
    for (let i = 0; i < visible; i++) {
      const streak = streaks[i];
      streak.y += streak.speed * dt * 0.85;
      streak.x += streak.speed * dt * 0.1;
      if (streak.y > 1.08) {
        streak.y = -0.08;
        streak.x = Math.random();
      }
      if (streak.x > 1.05) streak.x -= 1.1;
      const x = streak.x * width;
      const y = streak.y * height;
      const length = streak.length * height;
      mapContext.moveTo(x, y);
      mapContext.lineTo(x + length * 0.22, y + length);
    }
    mapContext.stroke();
  }

  function drawRipples(dt) {
    for (let i = state.ripples.length - 1; i >= 0; i--) {
      const ripple = state.ripples[i];
      ripple.age += dt;
      if (ripple.age > 0.9) {
        state.ripples.splice(i, 1);
        continue;
      }
      const fade = 1 - ripple.age / 0.9;
      const radius = 6 + ripple.age * 62;
      mapContext.strokeStyle = `rgba(126, 202, 190, ${(0.38 * fade).toFixed(3)})`;
      mapContext.lineWidth = 1.2;
      mapContext.beginPath();
      mapContext.arc(ripple.x, ripple.y, radius, 0, Math.PI * 2);
      mapContext.stroke();
    }
  }

  function drawSection() {
    if (!state.heights || !state.stats) return;
    const rect = profileCanvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const dprLocal = Math.min(window.devicePixelRatio || 1, 2);
    profileContext.setTransform(dprLocal, 0, 0, dprLocal, 0, 0);
    profileContext.clearRect(0, 0, w, h);

    const top = 5;
    const bottom = h - 5;
    const sectionFilled = state.flood ? state.filled : null;
    const heights = state.heights;
    const row = SECTION_ROW;

    const yFor = (value) =>
      bottom -
      ((value - ELEVATION_LOW) / ELEVATION_RANGE) * (bottom - top);

    profileContext.beginPath();
    profileContext.moveTo(0, bottom);
    for (let x = 0; x < COLS; x++) {
      const value = heights[row * COLS + x];
      profileContext.lineTo((x / (COLS - 1)) * w, yFor(value));
    }
    profileContext.lineTo(w, bottom);
    profileContext.closePath();
    const fill = profileContext.createLinearGradient(0, top, 0, bottom);
    fill.addColorStop(0, "rgba(226, 219, 202, 0.20)");
    fill.addColorStop(1, "rgba(226, 219, 202, 0.02)");
    profileContext.fillStyle = fill;
    profileContext.fill();

    profileContext.beginPath();
    for (let x = 0; x < COLS; x++) {
      const value = heights[row * COLS + x];
      const px = (x / (COLS - 1)) * w;
      const py = yFor(value);
      if (x === 0) profileContext.moveTo(px, py);
      else profileContext.lineTo(px, py);
    }
    profileContext.strokeStyle = "rgba(230, 223, 205, 0.82)";
    profileContext.lineWidth = 1.1;
    profileContext.stroke();

    if (sectionFilled) {
      profileContext.beginPath();
      let open = false;
      for (let x = 0; x < COLS; x++) {
        const index = row * COLS + x;
        const depth = sectionFilled[index] - heights[index];
        const px = (x / (COLS - 1)) * w;
        if (depth > 0.0015) {
          if (!open) {
            profileContext.moveTo(px, yFor(heights[index]));
            open = true;
          }
          profileContext.lineTo(px, yFor(sectionFilled[index]));
        } else if (open) {
          profileContext.lineTo(px, bottom);
          open = false;
        }
      }
      profileContext.strokeStyle = "rgba(126, 202, 190, 0.8)";
      profileContext.lineWidth = 1;
      profileContext.stroke();
    }

    if (state.accumulation) {
      profileContext.fillStyle = "rgba(126, 202, 190, 0.75)";
      for (let x = 0; x < COLS; x++) {
        if (state.accumulation[row * COLS + x] >= RIVER_MIN) {
          const px = (x / (COLS - 1)) * w;
          profileContext.fillRect(px, yFor(heights[row * COLS + x]) - 1.5, 1.5, 3);
        }
      }
    }
  }

  // — readouts —————————————————————————————————————————————
  function formatCount(value) {
    if (value >= 1e6) return (value / 1e6).toFixed(1) + "m";
    if (value >= 1e4) return (value / 1e3).toFixed(1) + "k";
    return String(Math.round(value));
  }

  function updateReadouts() {
    dropsReadout.textContent = formatCount(state.drops);
    sedimentReadout.textContent = formatCount(state.sediment);
    if (state.stats) {
      drainageReadout.textContent = formatCount(state.stats.drainage);
      basinsReadout.textContent = String(state.stats.basins);
    }
    sectionRow.textContent = String(SECTION_ROW);
  }

  // — controls —————————————————————————————————————————————
  function setRain(value) {
    state.rain = value;
    rainOutput.textContent = String(value);
    updateSoundGain();
  }

  function setRock(value) {
    state.rock = value;
    rockOutput.textContent = String(value);
  }

  function toggleSound() {
    const context = ensureAudio();
    if (!context) {
      soundButton.disabled = true;
      return;
    }
    if (context.state === "suspended") context.resume();
    audio.enabled = !audio.enabled;
    soundButton.setAttribute("aria-pressed", String(audio.enabled));
    soundButton.querySelector(".label").textContent = audio.enabled
      ? "sound on"
      : "sound";
    updateSoundGain();
  }

  function pourAt(clientX, clientY) {
    state.pourX = (clientX / width) * COLS;
    state.pourY = (clientY / height) * ROWS;
    state.pourRemaining = 300;
    state.ripples.push({
      x: (clientX / width) * width,
      y: (clientY / height) * height,
      age: 0,
    });
    plink();
  }

  rainInput.addEventListener("input", () => setRain(Number(rainInput.value)));
  rockInput.addEventListener("input", () => setRock(Number(rockInput.value)));
  floodButton.addEventListener("click", () => setFlood(!state.flood));
  againButton.addEventListener("click", () =>
    seedTerrain((Math.random() * 1e9) | 0),
  );
  soundButton.addEventListener("click", toggleSound);

  let pouring = false;
  mapCanvas.addEventListener("pointerdown", (event) => {
    pouring = true;
    mapCanvas.focus({ preventScroll: true });
    mapCanvas.setPointerCapture(event.pointerId);
    pourAt(event.clientX, event.clientY);
  });
  mapCanvas.addEventListener("pointermove", (event) => {
    if (!pouring) return;
    state.pourX = (event.clientX / width) * COLS;
    state.pourY = (event.clientY / height) * ROWS;
    if (state.pourRemaining < 120) state.pourRemaining = 120;
  });
  const stopPouring = () => {
    pouring = false;
  };
  mapCanvas.addEventListener("pointerup", stopPouring);
  mapCanvas.addEventListener("pointercancel", stopPouring);

  window.addEventListener("keydown", (event) => {
    if (!(event.target instanceof Element)) return;
    // Range sliders own their arrow keys; text fields own everything. A
    // focused button still needs Space/Enter for its own activation, but the
    // letter shortcuts should keep working after you click one.
    if (event.target.closest("input, textarea, select")) return;
    if (
      event.target.closest("button") &&
      (event.code === "Space" || event.key === "Enter")
    )
      return;
    if (event.key === "r" || event.key === "R") {
      seedTerrain((Math.random() * 1e9) | 0);
    } else if (event.key === "f" || event.key === "F") {
      setFlood(!state.flood);
    } else if (event.code === "Space") {
      event.preventDefault();
      state.raining = !state.raining;
    } else if (event.key === "s" || event.key === "S") {
      toggleSound();
    }
  });

  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => {
    lastFrame = performance.now();
  });

  // — simulation ———————————————————————————————————————————
  function update(dt) {
    if (state.raining && state.rain > 0) {
      const rate = (state.rain / 100) * MAX_DROPS_PER_SECOND;
      state.dropBudget += rate * dt;
      const count = Math.min(30, Math.floor(state.dropBudget));
      state.dropBudget -= count;
      for (let i = 0; i < count; i++) spawnDroplet();
    } else {
      state.dropBudget = 0;
    }

    if (state.pourRemaining > 0) {
      const burst = Math.min(22, state.pourRemaining);
      const jitter = 2.4;
      for (let i = 0; i < burst; i++) {
        spawnDroplet(
          state.pourX + (Math.random() - 0.5) * jitter * 2,
          state.pourY + (Math.random() - 0.5) * jitter * 2,
        );
      }
      state.pourRemaining -= burst;
    }

    state.refreshTimer += dt;
    if (state.refreshTimer >= 0.6) {
      state.refreshTimer = 0;
      T.diffuse(state.heights, COLS, ROWS, 0.12);
      refreshDrainage(false);
    }

    if (state.flood) {
      state.floodTimer += dt;
      if (state.floodTimer >= 2.4) {
        state.floodTimer = 0;
        state.filled = T.priorityFlood(state.heights, COLS, ROWS);
      }
    }
  }

  function draw(dt) {
    paintField();
    mapContext.imageSmoothingEnabled = true;
    mapContext.imageSmoothingQuality = "high";
    mapContext.drawImage(fieldCanvas, 0, 0, width, height);
    drawRain(dt);
    drawRipples(dt);
    drawSection();
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    if (!document.hidden) {
      update(dt);
      draw(dt);
    }
    requestAnimationFrame(frame);
  }

  setRain(Number(rainInput.value));
  setRock(Number(rockInput.value));
  seedTerrain((Math.random() * 1e9) | 0);
  resize();
  updateReadouts();
  if (reducedMotion) {
    for (let i = 0; i < 30; i++) {
      const result = T.simulateDroplet(
        state.heights,
        COLS,
        ROWS,
        Object.assign({}, DROPLET_OPTIONS, { erodeSpeed: erodeSpeed() }),
      );
      state.sediment += result.eroded;
      state.drops++;
    }
    refreshDrainage(true);
    draw(0);
  }
  requestAnimationFrame(frame);
})();
