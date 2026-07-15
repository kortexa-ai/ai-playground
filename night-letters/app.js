(() => {
  "use strict";

  const TAU = Math.PI * 2;
  const STEP = 1 / 60;
  const MASK_WIDTH = 1200;
  const MASK_HEIGHT = 360;
  const DEFAULT_PHRASE = "At dusk, even language changes direction.";
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const canvas = document.getElementById("sky");
  const ctx = canvas.getContext("2d", { alpha: false });
  const input = document.getElementById("phrase");
  const composer = document.getElementById("composer");
  const toastElement = document.getElementById("toast");
  const whisperElement = document.getElementById("whisper");
  const sentenceStatus = document.getElementById("sentence-status");
  const phaseElement = document.querySelector(".phase");
  const phaseLabel = document.getElementById("phase-label");
  const phaseCountdown = document.getElementById("phase-countdown");
  const birdCount = document.getElementById("bird-count");
  const wordCount = document.getElementById("word-count");
  const windReading = document.getElementById("wind-reading");
  const soundButton = document.getElementById("sound-button");
  const pauseButton = document.getElementById("pause-button");
  const scatterButton = document.getElementById("scatter-button");
  const reformButton = document.getElementById("reform-button");
  const saveButton = document.getElementById("save-button");

  const mask = document.createElement("canvas");
  mask.width = MASK_WIDTH;
  mask.height = MASK_HEIGHT;
  const maskCtx = mask.getContext("2d", { willReadFrequently: true });

  const PHASES = [
    {
      key: "form",
      label: "gathering",
      seconds: 2.8,
      whisper: "every mark remembers where it belongs",
    },
    {
      key: "read",
      label: "legible",
      seconds: 3.8,
      whisper: "for a moment, the flock can be read",
    },
    {
      key: "lift",
      label: "loosening",
      seconds: 2.2,
      whisper: "meaning loosens first at the edges",
    },
    {
      key: "flight",
      label: "in flight",
      seconds: 11.5,
      whisper: "the sentence leaves; its shape remains",
    },
    {
      key: "return",
      label: "remembering",
      seconds: 4.5,
      whisper: "even scattered things keep an address",
    },
  ];

  const PALETTE = [
    { h: 24, s: 48, l: 76 },
    { h: 37, s: 40, l: 80 },
    { h: 202, s: 28, l: 78 },
    { h: 218, s: 24, l: 76 },
    { h: 347, s: 30, l: 78 },
    { h: 54, s: 24, l: 82 },
  ];

  let W = 1;
  let H = 1;
  let DPR = 1;
  let flock = null;
  let currentLayout = null;
  let stars = [];
  let ribbons = [];
  let activeRibbon = null;
  let lastNow = performance.now();
  let accumulator = 0;
  let toastTimer = 0;
  let whisperTimer = 0;
  let resizeQueued = false;
  let renderDirty = true;
  let lastStaticRender = 0;

  const state = {
    phrase: DEFAULT_PHRASE,
    seed: hashString(DEFAULT_PHRASE),
    phaseIndex: 0,
    phaseTick: 0,
    cycle: 0,
    simTick: 0,
    simTime: 0,
    paused: false,
    scatterEnergy: 0,
    scatterX: 0,
    scatterY: 0,
    metrics: { speed: 0, turn: 0, cohesion: 1, centroidX: 0, centroidY: 0 },
    punctuation: { exclamation: 0, question: 0, comma: 0, period: 0 },
  };

  const pointer = {
    x: -1000,
    y: -1000,
    vx: 0,
    vy: 0,
    lastX: 0,
    lastY: 0,
    lastAt: 0,
    activeUntil: 0,
    swirl: 1,
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function smoothstep(value) {
    const x = clamp(value, 0, 1);
    return x * x * (3 - 2 * x);
  }

  function smootherstep(value) {
    const x = clamp(value, 0, 1);
    return x * x * x * (x * (x * 6 - 15) + 10);
  }

  function hashString(value) {
    let hash = 2166136261;
    for (const character of value) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function mix32(value) {
    let x = value >>> 0;
    x ^= x >>> 16;
    x = Math.imul(x, 0x21f0aaad);
    x ^= x >>> 15;
    x = Math.imul(x, 0x735a2d97);
    x ^= x >>> 15;
    return x >>> 0;
  }

  function birdRandom(seed, id, channel, cycle = 0) {
    const mixed =
      seed ^
      Math.imul(id + 1, 0x9e3779b1) ^
      Math.imul(channel + 11, 0x85ebca6b) ^
      Math.imul(cycle + 1, 0xc2b2ae35);
    return mix32(mixed) / 4294967296;
  }

  function phaseDuration(index = state.phaseIndex) {
    return Math.round(PHASES[index].seconds / STEP);
  }

  function phaseProgress() {
    return clamp(state.phaseTick / Math.max(1, phaseDuration() - 1), 0, 1);
  }

  function punctuationCode(character) {
    if (character === "!") return 1;
    if (character === "?") return 2;
    if (character === "," || character === ";") return 3;
    if (character === "." || character === ":") return 4;
    if (character === "—" || character === "-") return 5;
    return 0;
  }

  function cleanWord(token) {
    return token
      .toLocaleLowerCase()
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  }

  function layoutAtSize(tokens, fontSize) {
    maskCtx.font = "400 " + fontSize + "px Georgia, 'Times New Roman', serif";
    const maxWidth = MASK_WIDTH - 150;
    const spaceWidth = maskCtx.measureText(" ").width;
    const lines = [{ items: [], width: 0 }];

    for (const token of tokens) {
      const width = maskCtx.measureText(token).width;
      let line = lines[lines.length - 1];
      const addition = (line.items.length ? spaceWidth : 0) + width;
      if (line.items.length && line.width + addition > maxWidth) {
        line = { items: [], width: 0 };
        lines.push(line);
      }
      line.items.push({ text: token, width });
      line.width += (line.items.length > 1 ? spaceWidth : 0) + width;
    }

    return { lines, spaceWidth, fontSize };
  }

  function buildTargets(phrase) {
    const tokens = phrase.match(/\S+/gu) || [];
    let fontSize = 132;
    let layout = layoutAtSize(tokens, fontSize);

    while (
      fontSize > 38 &&
      (layout.lines.length > 3 ||
        layout.lines.length * fontSize * 1.13 > MASK_HEIGHT - 70)
    ) {
      fontSize -= 3;
      layout = layoutAtSize(tokens, fontSize);
    }

    maskCtx.clearRect(0, 0, MASK_WIDTH, MASK_HEIGHT);
    maskCtx.fillStyle = "#fff";
    maskCtx.textAlign = "left";
    maskCtx.textBaseline = "middle";
    maskCtx.font = "400 " + fontSize + "px Georgia, 'Times New Roman', serif";

    const lineHeight = fontSize * 1.13;
    const blockTop = MASK_HEIGHT / 2 - (layout.lines.length * lineHeight) / 2;
    const boxes = [];
    const species = new Map();
    let nextSpecies = 0;
    let tokenCount = 0;

    layout.lines.forEach((line, lineIndex) => {
      let x = (MASK_WIDTH - line.width) / 2;
      const centerY = blockTop + (lineIndex + 0.5) * lineHeight;

      line.items.forEach((item, itemIndex) => {
        const token = item.text;
        const normalized = cleanWord(token);
        let speciesId;
        if (normalized) {
          tokenCount++;
          if (!species.has(normalized)) species.set(normalized, nextSpecies++);
          speciesId = species.get(normalized);
        } else {
          speciesId = nextSpecies++;
        }

        const suffix = token.match(/[!?.,;:—-]+$/u);
        const punctuation = suffix ? suffix[0].slice(-1) : "";
        const punctuationWidth = suffix
          ? maskCtx.measureText(suffix[0]).width
          : 0;
        const box = {
          x,
          right: x + item.width,
          top: centerY - fontSize * 0.66,
          bottom: centerY + fontSize * 0.66,
          punctuationStart: x + item.width - punctuationWidth - 1,
          punctuation,
          word: speciesId,
          palette: hashString(normalized || token) % PALETTE.length,
        };
        boxes.push(box);
        maskCtx.fillText(token, x, centerY);
        x += item.width;
        if (itemIndex < line.items.length - 1) x += layout.spaceWidth;
      });
    });

    const pixels = maskCtx.getImageData(0, 0, MASK_WIDTH, MASK_HEIGHT).data;
    let inkArea = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] > 48) inkArea++;
    }

    const desired = reducedMotion
      ? 260
      : clamp(Math.round(Math.sqrt(W * H) * 0.78), 360, 820);
    let spacing = clamp(
      Math.round(Math.sqrt(inkArea / Math.max(1, desired))),
      3,
      13,
    );
    let candidates = [];

    const sample = (step) => {
      const found = [];
      const offset = Math.floor(step / 2);
      for (let y = offset; y < MASK_HEIGHT; y += step) {
        for (let x = offset; x < MASK_WIDTH; x += step) {
          const alpha = pixels[(y * MASK_WIDTH + x) * 4 + 3];
          if (alpha < 72) continue;
          let box = null;
          for (let i = 0; i < boxes.length; i++) {
            const candidate = boxes[i];
            if (
              x >= candidate.x &&
              x <= candidate.right &&
              y >= candidate.top &&
              y <= candidate.bottom
            ) {
              box = candidate;
              break;
            }
          }
          if (!box) continue;
          const punct =
            box.punctuation && x >= box.punctuationStart
              ? punctuationCode(box.punctuation)
              : 0;
          found.push({
            x,
            y,
            word: box.word,
            palette: box.palette,
            punct,
            priority: mix32(
              state.seed ^
                Math.imul(x + 1, 73856093) ^
                Math.imul(y + 1, 19349663),
            ),
          });
        }
      }
      return found;
    };

    candidates = sample(spacing);
    while (candidates.length < desired * 0.64 && spacing > 3) {
      spacing--;
      candidates = sample(spacing);
    }

    if (candidates.length > desired * 1.12) {
      candidates.sort((a, b) => a.priority - b.priority);
      candidates.length = desired;
      candidates.sort((a, b) => a.y - b.y || a.x - b.x);
    }

    let minX = MASK_WIDTH;
    let maxX = 0;
    let minY = MASK_HEIGHT;
    let maxY = 0;
    for (const point of candidates) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }

    return {
      points: candidates,
      wordCount: tokenCount,
      speciesCount: species.size,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
      fontSize,
    };
  }

  function phaseWeights(phase, u, formDelay, liftDelay, returnDelay) {
    if (phase === "form") {
      return {
        home: smootherstep((u - formDelay) / Math.max(0.1, 0.76 - formDelay)),
        flock: 0,
      };
    }
    if (phase === "read") return { home: 1, flock: 0 };
    if (phase === "lift") {
      const released = smootherstep(
        (u - liftDelay) / Math.max(0.12, 0.76 - liftDelay),
      );
      return {
        home: 1 - released,
        flock: smootherstep((u - 0.08) / 0.72),
      };
    }
    if (phase === "flight") return { home: 0, flock: 1 };
    const home = smootherstep(
      (u - returnDelay) / Math.max(0.2, 0.94 - returnDelay),
    );
    return { home, flock: (1 - home) * (1 - home) };
  }

  class LetterFlock {
    constructor(layout) {
      this.layout = layout;
      this.count = layout.points.length;
      this.seed = state.seed;
      this.scale = 1;
      this.centerY = H * 0.43;
      this.homeAverage = 0;
      this.flightAverage = 0;

      const floats = [
        "x",
        "y",
        "px",
        "py",
        "vx",
        "vy",
        "ax",
        "ay",
        "targetX",
        "targetY",
        "homeU",
        "homeV",
        "size",
        "wing",
        "headingX",
        "headingY",
        "formDelay",
        "liftDelay",
        "returnDelay",
      ];
      for (const key of floats) this[key] = new Float32Array(this.count);
      this.word = new Uint16Array(this.count);
      this.palette = new Uint8Array(this.count);
      this.punct = new Uint8Array(this.count);
      this.next = new Int32Array(this.count);

      layout.points.forEach((point, i) => {
        this.homeU[i] = point.x - MASK_WIDTH / 2;
        this.homeV[i] = point.y - MASK_HEIGHT / 2;
        this.word[i] = point.word;
        this.palette[i] = point.palette;
        this.punct[i] = point.punct;
        this.size[i] = 2.3 + birdRandom(this.seed, i, 1) * 2.2;
        this.wing[i] = birdRandom(this.seed, i, 2) * TAU;
        this.headingX[i] = 1;
        this.headingY[i] = 0;
        const leftToRight = point.x / MASK_WIDTH;
        this.formDelay[i] =
          0.06 + leftToRight * 0.2 + birdRandom(this.seed, i, 3) * 0.05;
        this.liftDelay[i] =
          0.05 +
          leftToRight * 0.15 +
          birdRandom(this.seed, i, 4) * 0.04 +
          (point.punct === 3 ? 0.1 : point.punct === 4 ? 0.16 : 0);
        this.returnDelay[i] =
          0.02 + (1 - leftToRight) * 0.09 + birdRandom(this.seed, i, 5) * 0.03;
      });

      this.updateTargets(false);
      this.scatterFromHomes();
      this.rebuildGrid();
    }

    updateTargets(remap, oldW = W, oldH = H, oldScale = this.scale) {
      const margin = clamp(W * 0.09, 28, 130);
      const widthScale = (W - margin * 2) / (this.layout.width + 34);
      const heightScale = Math.min(H * 0.31, 245) / (this.layout.height + 26);
      const nextScale = clamp(Math.min(widthScale, heightScale), 0.25, 1.08);
      const nextCenterY = Math.max(125, Math.min(H * 0.43, H - 185));
      const globalHome = this.homeAverage;

      for (let i = 0; i < this.count; i++) {
        const oldTargetX = this.targetX[i];
        const oldTargetY = this.targetY[i];
        const nextTargetX = W / 2 + this.homeU[i] * nextScale;
        const nextTargetY = nextCenterY + this.homeV[i] * nextScale;

        if (remap && oldW > 1 && oldH > 1) {
          const viewX = this.x[i] * (W / oldW);
          const viewY = this.y[i] * (H / oldH);
          const scaleRatio = nextScale / Math.max(0.001, oldScale);
          const homeX = nextTargetX + (this.x[i] - oldTargetX) * scaleRatio;
          const homeY = nextTargetY + (this.y[i] - oldTargetY) * scaleRatio;
          this.x[i] = lerp(viewX, homeX, globalHome);
          this.y[i] = lerp(viewY, homeY, globalHome);
          this.px[i] = this.x[i];
          this.py[i] = this.y[i];
          const velocityScale = lerp(
            Math.sqrt((W * H) / Math.max(1, oldW * oldH)),
            scaleRatio,
            globalHome,
          );
          this.vx[i] *= velocityScale;
          this.vy[i] *= velocityScale;
        }

        this.targetX[i] = nextTargetX;
        this.targetY[i] = nextTargetY;
      }

      this.scale = nextScale;
      this.centerY = nextCenterY;
    }

    scatterFromHomes() {
      const worldScale = clamp(Math.sqrt((W * H) / (1280 * 720)), 0.72, 1.2);
      for (let i = 0; i < this.count; i++) {
        const angle = birdRandom(this.seed, i, 8) * TAU;
        const radius = (75 + birdRandom(this.seed, i, 9) * 260) * worldScale;
        this.x[i] = this.targetX[i] + Math.cos(angle) * radius;
        this.y[i] = this.targetY[i] + Math.sin(angle) * radius;
        this.px[i] = this.x[i];
        this.py[i] = this.y[i];
        const speed = 18 + birdRandom(this.seed, i, 10) * 34;
        this.vx[i] = -Math.sin(angle) * speed;
        this.vy[i] = Math.cos(angle) * speed;
      }
    }

    snapHome() {
      for (let i = 0; i < this.count; i++) {
        this.x[i] = this.targetX[i];
        this.y[i] = this.targetY[i];
        this.px[i] = this.x[i];
        this.py[i] = this.y[i];
        this.vx[i] = 0;
        this.vy[i] = 0;
      }
      this.homeAverage = 1;
      this.flightAverage = 0;
    }

    rebuildGrid() {
      this.worldScale = clamp(Math.sqrt((W * H) / (1280 * 720)), 0.72, 1.2);
      this.cellSize = 26 * this.worldScale;
      this.cols = Math.max(3, Math.ceil(W / this.cellSize) + 2);
      this.rows = Math.max(3, Math.ceil(H / this.cellSize) + 2);
      const cells = this.cols * this.rows;
      this.head = new Int32Array(cells);
      this.gridCount = new Uint16Array(cells);
      this.sumX = new Float32Array(cells);
      this.sumY = new Float32Array(cells);
      this.sumVX = new Float32Array(cells);
      this.sumVY = new Float32Array(cells);
    }

    cellFor(x, y) {
      const cx = clamp(Math.floor(x / this.cellSize) + 1, 0, this.cols - 1);
      const cy = clamp(Math.floor(y / this.cellSize) + 1, 0, this.rows - 1);
      return cy * this.cols + cx;
    }

    buildGrid() {
      this.head.fill(-1);
      this.gridCount.fill(0);
      this.sumX.fill(0);
      this.sumY.fill(0);
      this.sumVX.fill(0);
      this.sumVY.fill(0);

      for (let i = 0; i < this.count; i++) {
        const cell = this.cellFor(this.x[i], this.y[i]);
        this.next[i] = this.head[cell];
        this.head[cell] = i;
        this.gridCount[cell]++;
        this.sumX[cell] += this.x[i];
        this.sumY[cell] += this.y[i];
        this.sumVX[cell] += this.vx[i];
        this.sumVY[cell] += this.vy[i];
      }
    }

    applyPunctuationCue() {
      const cx = W / 2;
      const direction = state.cycle % 2 ? 1 : -1;
      for (let i = 0; i < this.count; i++) {
        const kind = this.punct[i];
        if (!kind) continue;
        const dx = this.x[i] - cx;
        if (kind === 1) {
          this.vx[i] += dx * 0.22;
          this.vy[i] -= 90 + birdRandom(this.seed, i, 20, state.cycle) * 45;
        } else if (kind === 2) {
          this.vx[i] += -this.vy[i] * 0.4 * direction;
          this.vy[i] += this.vx[i] * 0.28 * direction;
        } else if (kind === 3) {
          this.vx[i] += 45 * direction;
          this.vy[i] += 22;
        } else if (kind === 4) {
          this.vx[i] += dx * 0.35;
          this.vy[i] -= 52;
        } else {
          this.vx[i] += dx < 0 ? -68 : 68;
        }
      }
    }

    impulse(originX, originY, strength = 1) {
      const reach = Math.max(W, H) * 0.62;
      for (let i = 0; i < this.count; i++) {
        let dx = this.x[i] - originX;
        let dy = this.y[i] - originY;
        let distance = Math.hypot(dx, dy);
        if (distance < 0.001) {
          const angle = birdRandom(this.seed, i, 30, state.cycle) * TAU;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distance = 1;
        }
        const falloff = Math.max(0.12, 1 - distance / reach);
        const impulse = (70 + 125 * falloff) * strength;
        this.vx[i] += (dx / distance) * impulse;
        this.vy[i] += (dy / distance) * impulse - 14 * strength;
      }
    }

    update(dt, phase, u) {
      const activeFlock =
        phase === "flight" || phase === "lift" || phase === "return";
      if (activeFlock) this.buildGrid();

      const scale = this.worldScale;
      const separationRadius = 14 * scale;
      const separationRadiusSq = separationRadius * separationRadius;
      const cruise = (state.punctuation.comma ? 84 : 91) * scale;
      const maxSpeedByPhase = {
        form: 245,
        read: 70,
        lift: 185,
        flight: 138,
        return: 250,
      };
      const maxSpeed = maxSpeedByPhase[phase] * scale;
      let totalHome = 0;
      let totalFlock = 0;
      let centroidX = 0;
      let centroidY = 0;
      let totalSpeed = 0;
      let totalTurn = 0;

      for (let i = 0; i < this.count; i++) {
        const weights = phaseWeights(
          phase,
          u,
          this.formDelay[i],
          this.liftDelay[i],
          this.returnDelay[i],
        );
        const home = weights.home;
        const flight = weights.flock;
        totalHome += home;
        totalFlock += flight;
        let ax = 0;
        let ay = 0;

        if (home > 0.001) {
          const omegaBase =
            phase === "read" ? 10 : phase === "return" ? 7.5 : 7;
          const omega = omegaBase * Math.sqrt(home);
          const breathing =
            phase === "read"
              ? Math.sin(state.simTime * 0.55 + this.wing[i]) * 0.22
              : 0;
          const targetX = this.targetX[i] + breathing;
          const targetY =
            this.targetY[i] +
            Math.cos(state.simTime * 0.48 + this.wing[i]) * breathing;
          ax += omega * omega * (targetX - this.x[i]) - 2 * omega * this.vx[i];
          ay += omega * omega * (targetY - this.y[i]) - 2 * omega * this.vy[i];
        }

        if (flight > 0.015) {
          const centerCell = this.cellFor(this.x[i], this.y[i]);
          const centerX = centerCell % this.cols;
          const centerY = Math.floor(centerCell / this.cols);
          let separationX = 0;
          let separationY = 0;
          let closeChecks = 0;
          let aggregateCount = 0;
          let aggregateX = 0;
          let aggregateY = 0;
          let aggregateVX = 0;
          let aggregateVY = 0;
          let sameCount = 0;
          let sameX = 0;
          let sameY = 0;

          for (let gy = -2; gy <= 2; gy++) {
            const cy = centerY + gy;
            if (cy < 0 || cy >= this.rows) continue;
            for (let gx = -2; gx <= 2; gx++) {
              const cx = centerX + gx;
              if (cx < 0 || cx >= this.cols) continue;
              const cell = cy * this.cols + cx;
              const count = this.gridCount[cell];
              if (!count) continue;
              aggregateCount += count;
              aggregateX += this.sumX[cell];
              aggregateY += this.sumY[cell];
              aggregateVX += this.sumVX[cell];
              aggregateVY += this.sumVY[cell];

              if (Math.abs(gx) > 1 || Math.abs(gy) > 1) continue;
              let j = this.head[cell];
              while (j !== -1 && closeChecks < 56) {
                if (j !== i) {
                  const dx = this.x[i] - this.x[j];
                  const dy = this.y[i] - this.y[j];
                  const distanceSq = dx * dx + dy * dy;
                  if (distanceSq > 0.0001 && distanceSq < separationRadiusSq) {
                    const distance = Math.sqrt(distanceSq);
                    const q = 1 - distance / separationRadius;
                    separationX += (dx / distance) * q * q;
                    separationY += (dy / distance) * q * q;
                  }
                  if (this.word[j] === this.word[i] && distanceSq < 6400) {
                    sameCount++;
                    sameX += this.x[j];
                    sameY += this.y[j];
                  }
                  closeChecks++;
                }
                j = this.next[j];
              }
            }
          }

          ax += separationX * 620 * flight;
          ay += separationY * 620 * flight;

          if (aggregateCount > 1) {
            const inverse = 1 / (aggregateCount - 1);
            const averageX = (aggregateX - this.x[i]) * inverse;
            const averageY = (aggregateY - this.y[i]) * inverse;
            const averageVX = (aggregateVX - this.vx[i]) * inverse;
            const averageVY = (aggregateVY - this.vy[i]) * inverse;
            ax +=
              clamp((averageVX - this.vx[i]) / 0.45, -160, 160) * 0.8 * flight;
            ay +=
              clamp((averageVY - this.vy[i]) / 0.45, -160, 160) * 0.8 * flight;
            ax +=
              clamp((averageX - this.x[i]) * 0.65, -110, 110) * 0.65 * flight;
            ay +=
              clamp((averageY - this.y[i]) * 0.65, -110, 110) * 0.65 * flight;
          }

          if (sameCount > 1) {
            ax += (sameX / sameCount - this.x[i]) * 0.045 * flight;
            ay += (sameY / sameCount - this.y[i]) * 0.045 * flight;
          }

          const q = 0.008 / scale;
          const cross =
            0.6 * Math.cos(q * (this.x[i] + this.y[i]) + 0.17 * state.simTime);
          let flowX = Math.cos(q * this.y[i] - 0.31 * state.simTime) + cross;
          let flowY = -Math.cos(q * this.x[i] + 0.23 * state.simTime) - cross;
          const flowLength = Math.hypot(flowX, flowY) || 1;
          flowX = (flowX / flowLength) * cruise;
          flowY = (flowY / flowLength) * cruise;
          ax += clamp((flowX - this.vx[i]) / 0.9, -140, 140) * flight;
          ay += clamp((flowY - this.vy[i]) / 0.9, -140, 140) * flight;

          if (state.punctuation.question) {
            const anchorX = W * 0.5 + Math.sin(state.simTime * 0.17) * W * 0.12;
            const anchorY = H * 0.4 + Math.cos(state.simTime * 0.13) * H * 0.08;
            const dx = this.x[i] - anchorX;
            const dy = this.y[i] - anchorY;
            const distance = Math.hypot(dx, dy) || 1;
            const orbit = 32 * Math.min(2, state.punctuation.question) * flight;
            ax += (-dy / distance) * orbit;
            ay += (dx / distance) * orbit;
          }
        }

        const pointerFade = clamp(
          (pointer.activeUntil - state.simTime) / 0.22,
          0,
          1,
        );
        if (pointerFade > 0 && !reducedMotion) {
          const dx = this.x[i] - pointer.x;
          const dy = this.y[i] - pointer.y;
          const distance = Math.hypot(dx, dy) || 1;
          const radius = clamp(Math.min(W, H) * 0.16, 88, 178);
          if (distance < radius) {
            const q = 1 - distance / radius;
            const influence = q * q * pointerFade * (0.25 + flight * 0.75);
            ax +=
              ((dx / distance) * 260 +
                (-dy / distance) * 330 * pointer.swirl +
                pointer.vx * 0.55) *
              influence;
            ay +=
              ((dy / distance) * 260 +
                (dx / distance) * 330 * pointer.swirl +
                pointer.vy * 0.55) *
              influence;
          }
        }

        if (state.scatterEnergy > 0.001) {
          const dx = this.x[i] - state.scatterX;
          const dy = this.y[i] - state.scatterY;
          const distance = Math.hypot(dx, dy) || 1;
          const reach = Math.max(W, H) * 0.72;
          const q = Math.max(0, 1 - distance / reach);
          ax += (dx / distance) * q * 760 * state.scatterEnergy;
          ay += (dy / distance) * q * 760 * state.scatterEnergy;
        }

        const margin = 54 * scale;
        if (this.x[i] < margin) ax += (margin - this.x[i]) * 5.5;
        if (this.x[i] > W - margin) ax -= (this.x[i] - (W - margin)) * 5.5;
        if (this.y[i] < margin + 58) ay += (margin + 58 - this.y[i]) * 5.5;
        if (this.y[i] > H - margin - 105)
          ay -= (this.y[i] - (H - margin - 105)) * 5.5;

        const acceleration = Math.hypot(ax, ay);
        if (acceleration > 1400) {
          ax = (ax / acceleration) * 1400;
          ay = (ay / acceleration) * 1400;
        }
        this.ax[i] = ax;
        this.ay[i] = ay;
      }

      for (let i = 0; i < this.count; i++) {
        this.px[i] = this.x[i];
        this.py[i] = this.y[i];
        this.vx[i] += this.ax[i] * dt;
        this.vy[i] += this.ay[i] * dt;
        const weights = phaseWeights(
          phase,
          u,
          this.formDelay[i],
          this.liftDelay[i],
          this.returnDelay[i],
        );
        const drag = phase === "read" ? 4.8 : lerp(0.16, 1.2, weights.home);
        const damping = Math.exp(-drag * dt);
        this.vx[i] *= damping;
        this.vy[i] *= damping;

        let speed = Math.hypot(this.vx[i], this.vy[i]);
        if (speed > maxSpeed) {
          this.vx[i] = (this.vx[i] / speed) * maxSpeed;
          this.vy[i] = (this.vy[i] / speed) * maxSpeed;
          speed = maxSpeed;
        } else if (weights.flock > 0.7 && speed < 36 * scale) {
          const factor = (36 * scale) / Math.max(1, speed);
          this.vx[i] *= factor;
          this.vy[i] *= factor;
          speed = 36 * scale;
        }

        if (speed > 1) {
          this.headingX[i] = this.vx[i] / speed;
          this.headingY[i] = this.vy[i] / speed;
        }
        this.x[i] += this.vx[i] * dt;
        this.y[i] += this.vy[i] * dt;

        if (
          !Number.isFinite(this.x[i]) ||
          this.x[i] < -W ||
          this.x[i] > W * 2 ||
          this.y[i] < -H ||
          this.y[i] > H * 2
        ) {
          this.x[i] = this.targetX[i];
          this.y[i] = this.targetY[i];
          this.vx[i] = 0;
          this.vy[i] = 0;
        }

        centroidX += this.x[i];
        centroidY += this.y[i];
        totalSpeed += speed;
        totalTurn += Math.min(1, Math.hypot(this.ax[i], this.ay[i]) / 600);
      }

      const inverseCount = 1 / Math.max(1, this.count);
      centroidX *= inverseCount;
      centroidY *= inverseCount;
      let spread = 0;
      for (let i = 0; i < this.count; i += 3) {
        spread += Math.hypot(this.x[i] - centroidX, this.y[i] - centroidY);
      }
      spread /= Math.max(1, Math.ceil(this.count / 3));
      this.homeAverage = totalHome * inverseCount;
      this.flightAverage = totalFlock * inverseCount;

      const homeCohesion = totalHome * inverseCount * 0.9;
      return {
        speed: clamp((totalSpeed * inverseCount) / (138 * scale), 0, 1),
        turn: clamp(totalTurn * inverseCount, 0, 1),
        cohesion: clamp(
          Math.max(homeCohesion, 1 - spread / (Math.min(W, H) * 0.72)),
          0,
          1,
        ),
        centroidX: clamp((centroidX / W) * 2 - 1, -1, 1),
        centroidY: clamp((centroidY / H) * 2 - 1, -1, 1),
      };
    }
  }

  class Soundscape {
    constructor() {
      this.context = null;
      this.wanted = false;
      this.suspendTimer = 0;
      this.root = 55;
      this.lastUpdate = 0;
    }

    build() {
      if (this.context) return;
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("Web Audio is unavailable");
      const audio = new AudioContextClass({ latencyHint: "playback" });
      this.context = audio;

      const compressor = audio.createDynamicsCompressor();
      compressor.threshold.value = -20;
      compressor.knee.value = 16;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.006;
      compressor.release.value = 0.22;

      this.master = audio.createGain();
      this.master.gain.value = 0.0001;
      this.master.connect(compressor).connect(audio.destination);
      this.sceneBus = audio.createGain();
      this.sceneBus.gain.value = 0.75;
      this.sceneBus.connect(this.master);

      const noiseBuffer = audio.createBuffer(
        1,
        audio.sampleRate * 2,
        audio.sampleRate,
      );
      const noiseData = noiseBuffer.getChannelData(0);
      let previous = 0;
      for (let i = 0; i < noiseData.length; i++) {
        const white = Math.random() * 2 - 1;
        previous = previous * 0.965 + white * 0.035;
        noiseData[i] = previous * 3.2;
      }
      this.noise = audio.createBufferSource();
      this.noise.buffer = noiseBuffer;
      this.noise.loop = true;
      this.airHighpass = audio.createBiquadFilter();
      this.airHighpass.type = "highpass";
      this.airHighpass.frequency.value = 140;
      this.airLowpass = audio.createBiquadFilter();
      this.airLowpass.type = "lowpass";
      this.airLowpass.frequency.value = 850;
      this.airGain = audio.createGain();
      this.airGain.gain.value = 0.0001;
      this.airPan = audio.createStereoPanner();
      this.noise
        .connect(this.airHighpass)
        .connect(this.airLowpass)
        .connect(this.airGain)
        .connect(this.airPan)
        .connect(this.sceneBus);

      this.oscA = audio.createOscillator();
      this.oscA.type = "sine";
      this.oscAGain = audio.createGain();
      this.oscAGain.gain.value = 0.45;
      this.oscB = audio.createOscillator();
      this.oscB.type = "triangle";
      this.oscBGain = audio.createGain();
      this.oscBGain.gain.value = 0.12;
      this.toneFilter = audio.createBiquadFilter();
      this.toneFilter.type = "lowpass";
      this.toneFilter.frequency.value = 320;
      this.toneGain = audio.createGain();
      this.toneGain.gain.value = 0.0001;
      this.oscA.connect(this.oscAGain).connect(this.toneFilter);
      this.oscB.connect(this.oscBGain).connect(this.toneFilter);
      this.toneFilter.connect(this.toneGain).connect(this.sceneBus);

      this.releaseOsc = audio.createOscillator();
      this.releaseOsc.type = "sine";
      this.releaseGain = audio.createGain();
      this.releaseGain.gain.value = 0.0001;
      this.releaseOsc.connect(this.releaseGain).connect(this.sceneBus);

      this.setPhrase(state.seed);
      this.noise.start();
      this.oscA.start();
      this.oscB.start();
      this.releaseOsc.start();
    }

    setPhrase(seed) {
      const roots = [55, 65.41, 73.42, 82.41];
      this.root = roots[seed % roots.length];
      if (!this.context) return;
      const now = this.context.currentTime;
      this.oscA.frequency.setTargetAtTime(this.root, now, 0.15);
      this.oscB.frequency.setTargetAtTime(this.root * 1.5, now, 0.15);
      this.releaseOsc.frequency.setTargetAtTime(this.root * 4, now, 0.08);
    }

    async toggle() {
      if (!this.wanted) {
        this.build();
        clearTimeout(this.suspendTimer);
        await this.context.resume();
        this.wanted = true;
        const now = this.context.currentTime;
        this.master.gain.cancelScheduledValues(now);
        this.master.gain.setTargetAtTime(0.3, now, 0.12);
        this.cue();
        return true;
      }
      this.wanted = false;
      const now = this.context.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(0.0001, now, 0.06);
      clearTimeout(this.suspendTimer);
      this.suspendTimer = setTimeout(() => {
        if (!this.wanted && this.context && this.context.state === "running") {
          this.context.suspend().catch(() => {});
        }
      }, 220);
      return false;
    }

    cue() {
      if (!this.context || !this.wanted) return;
      const now = this.context.currentTime;
      this.releaseGain.gain.cancelScheduledValues(now);
      this.releaseGain.gain.setValueAtTime(0.0001, now);
      this.releaseGain.gain.exponentialRampToValueAtTime(0.011, now + 0.018);
      this.releaseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.44);
    }

    update(metrics, phase, progress) {
      if (!this.context || !this.wanted || this.context.state !== "running")
        return;
      if (state.simTime - this.lastUpdate < 1 / 14) return;
      this.lastUpdate = state.simTime;
      const now = this.context.currentTime;
      const presence = state.paused
        ? 0
        : phase === "read"
          ? 0.12
          : phase === "return"
            ? lerp(0.8, 0.22, progress)
            : phase === "form"
              ? lerp(0.15, 0.5, progress)
              : 0.88;
      const speed = clamp(
        Number.isFinite(metrics.speed) ? metrics.speed : 0,
        0,
        1,
      );
      const turn = clamp(
        Number.isFinite(metrics.turn) ? metrics.turn : 0,
        0,
        1,
      );
      const cohesion = clamp(
        Number.isFinite(metrics.cohesion) ? metrics.cohesion : 0,
        0,
        1,
      );
      const reform =
        phase === "return" ? smootherstep(progress) : phase === "form" ? 1 : 0;

      this.airGain.gain.setTargetAtTime(
        presence * (0.006 + 0.03 * speed + 0.012 * turn),
        now,
        0.08,
      );
      this.airLowpass.frequency.setTargetAtTime(
        650 + 3000 * speed + 900 * turn,
        now,
        0.15,
      );
      this.airLowpass.Q.setTargetAtTime(0.55 + 1.4 * cohesion, now, 0.15);
      this.airPan.pan.setTargetAtTime(metrics.centroidX * 0.6, now, 0.08);
      this.toneGain.gain.setTargetAtTime(
        presence * (0.003 + 0.018 * cohesion) * (1 - 0.3 * speed),
        now,
        0.1,
      );
      this.toneFilter.frequency.setTargetAtTime(
        240 + 660 * cohesion,
        now,
        0.15,
      );
      this.oscB.frequency.setTargetAtTime(
        this.root * lerp(1.5, 2, reform),
        now,
        0.15,
      );
    }

    hide() {
      if (!this.context || this.context.state !== "running") return;
      const now = this.context.currentTime;
      this.master.gain.setTargetAtTime(0.0001, now, 0.05);
      setTimeout(
        () => this.context && this.context.suspend().catch(() => {}),
        180,
      );
    }

    async show() {
      if (!this.context || !this.wanted) return;
      try {
        await this.context.resume();
        this.master.gain.setTargetAtTime(0.3, this.context.currentTime, 0.12);
      } catch {}
    }
  }

  const soundscape = new Soundscape();

  function setWhisper(text) {
    whisperElement.classList.add("changing");
    clearTimeout(whisperTimer);
    whisperTimer = setTimeout(() => {
      whisperElement.textContent = text;
      whisperElement.classList.remove("changing");
    }, 320);
  }

  function toast(message) {
    toastElement.textContent = message;
    toastElement.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastElement.classList.remove("show"), 1500);
  }

  function updatePunctuation(phrase) {
    state.punctuation.exclamation = (phrase.match(/!/g) || []).length;
    state.punctuation.question = (phrase.match(/\?/g) || []).length;
    state.punctuation.comma = (phrase.match(/[,;]/g) || []).length;
    state.punctuation.period = (phrase.match(/[.:]/g) || []).length;
  }

  function enterPhase(index, announce = true) {
    state.phaseIndex = (index + PHASES.length) % PHASES.length;
    state.phaseTick = 0;
    const phase = PHASES[state.phaseIndex];

    if (phase.key === "lift") {
      soundscape.cue();
    }
    if (phase.key === "flight") {
      activeRibbon = { born: state.simTime, points: [] };
      ribbons.push(activeRibbon);
    }
    if (phase.key === "read") {
      sentenceStatus.textContent =
        "The flock has formed the sentence: " + state.phrase;
    }

    if (announce) setWhisper(phase.whisper);
    updateHud();
  }

  function advancePhase() {
    if (PHASES[state.phaseIndex].key === "return") state.cycle++;
    enterPhase(state.phaseIndex + 1);
  }

  function releasePhrase(value, quiet = false) {
    const phrase = value.trim().replace(/\s+/g, " ");
    if (!phrase) {
      toast("give the flock a few words");
      input.focus();
      return false;
    }

    state.phrase = phrase.slice(0, 120);
    state.seed = hashString(state.phrase);
    state.cycle = 0;
    state.scatterEnergy = 0;
    updatePunctuation(state.phrase);
    currentLayout = buildTargets(state.phrase);
    flock = new LetterFlock(currentLayout);
    ribbons = [];
    activeRibbon = null;
    soundscape.setPhrase(state.seed);

    if (reducedMotion) {
      enterPhase(
        PHASES.findIndex((phase) => phase.key === "read"),
        false,
      );
      flock.snapHome();
      setWhisper("reduced motion is holding the sentence still");
    } else {
      enterPhase(0, false);
      setWhisper(PHASES[0].whisper);
    }

    input.value = "";
    birdCount.textContent =
      flock.count.toLocaleString("en-US") + " small birds";
    wordCount.textContent =
      currentLayout.wordCount +
      (currentLayout.wordCount === 1 ? " word" : " words");
    sentenceStatus.textContent = "Released sentence: " + state.phrase;
    renderDirty = true;
    if (!quiet) toast("sentence released");
    return true;
  }

  function scatter(originX = W / 2, originY = H * 0.43, strength = 1) {
    if (!flock) return;
    if (reducedMotion) {
      toast("reduced motion is holding the sentence still");
      return;
    }
    if (PHASES[state.phaseIndex].key !== "flight") {
      enterPhase(PHASES.findIndex((phase) => phase.key === "flight"));
    }
    state.scatterX = originX;
    state.scatterY = originY;
    state.scatterEnergy = Math.max(state.scatterEnergy, strength);
    flock.impulse(originX, originY, strength);
    pointer.swirl *= -1;
    soundscape.cue();
    toast("the line broke open");
  }

  function reform() {
    if (!flock) return;
    if (reducedMotion) {
      flock.snapHome();
      enterPhase(PHASES.findIndex((phase) => phase.key === "read"));
      return;
    }
    enterPhase(PHASES.findIndex((phase) => phase.key === "return"));
    toast("every bird remembers");
  }

  function togglePause() {
    state.paused = !state.paused;
    pauseButton.setAttribute("aria-pressed", String(state.paused));
    pauseButton.setAttribute(
      "aria-label",
      state.paused ? "Resume animation" : "Pause animation",
    );
    pauseButton.querySelector(".button-mark").textContent = state.paused
      ? "▶"
      : "Ⅱ";
    pauseButton.querySelector(".button-label").textContent = state.paused
      ? "resume"
      : "pause";
    soundscape.lastUpdate = -Infinity;
    soundscape.update(
      state.metrics,
      PHASES[state.phaseIndex].key,
      phaseProgress(),
    );
    renderDirty = true;
    toast(state.paused ? "the sky is holding still" : "the sky continues");
    updateHud();
  }

  async function toggleSound() {
    try {
      const on = await soundscape.toggle();
      soundButton.setAttribute("aria-pressed", String(on));
      soundButton.setAttribute(
        "aria-label",
        on ? "Turn sound off" : "Turn sound on",
      );
      soundButton.querySelector(".button-mark").textContent = on ? "●" : "◌";
      soundButton.querySelector(".button-label").textContent = on
        ? "sound on"
        : "sound off";
      toast(on ? "listening to the flock" : "sound folded away");
    } catch {
      soundButton.disabled = true;
      toast("this browser has no sound to give");
    }
  }

  function updateHud() {
    const phase = PHASES[state.phaseIndex];
    const progress = phaseProgress();
    const held = state.paused || reducedMotion;
    phaseLabel.textContent = held ? "held still" : phase.label;
    phaseCountdown.textContent = held
      ? "—"
      : Math.max(0, Math.ceil((phaseDuration() - state.phaseTick) * STEP)) +
        " sec";
    phaseElement.style.setProperty(
      "--phase-progress",
      Math.round(progress * 360) + "deg",
    );

    const pointerActive = pointer.activeUntil > state.simTime;
    const speed = state.metrics.speed;
    windReading.textContent = pointerActive
      ? "a hand in the wind"
      : speed < 0.18
        ? "still air"
        : speed < 0.52
          ? "a light current"
          : "wind rising";
  }

  function simulateStep(dt) {
    if (state.paused || !flock) return;
    const phase = PHASES[state.phaseIndex];
    const u = phaseProgress();

    if (reducedMotion) {
      flock.snapHome();
      state.metrics = {
        speed: 0,
        turn: 0,
        cohesion: 1,
        centroidX: 0,
        centroidY: 0,
      };
      return;
    }

    if (
      phase.key === "lift" &&
      state.phaseTick === Math.round(phaseDuration() * 0.34) &&
      (state.punctuation.exclamation ||
        state.punctuation.question ||
        state.punctuation.comma ||
        state.punctuation.period)
    ) {
      flock.applyPunctuationCue();
    }

    state.metrics = flock.update(dt, phase.key, u);
    state.scatterEnergy = Math.max(0, state.scatterEnergy - dt * 1.35);
    pointer.vx *= Math.exp(-4.5 * dt);
    pointer.vy *= Math.exp(-4.5 * dt);

    if (phase.key === "flight" && activeRibbon && state.simTick % 6 === 0) {
      activeRibbon.points.push({
        x: (state.metrics.centroidX + 1) * 0.5,
        y: (state.metrics.centroidY + 1) * 0.5,
      });
      if (activeRibbon.points.length > 180) activeRibbon.points.shift();
    }

    state.simTime += dt;
    state.simTick++;
    state.phaseTick++;
    soundscape.update(state.metrics, phase.key, u);

    if (state.phaseTick >= phaseDuration()) advancePhase();
    if (state.simTick % 10 === 0) updateHud();
    ribbons = ribbons.filter((ribbon) => state.simTime - ribbon.born < 34);
  }

  function buildStars() {
    const count = clamp(Math.round((W * H) / 8500), 55, 170);
    stars = [];
    for (let i = 0; i < count; i++) {
      const seed = mix32(Math.imul(i + 1, 0x9e3779b1));
      stars.push({
        x: (seed & 0xffff) / 0xffff,
        y: (((seed >>> 16) & 0xffff) / 0xffff) * 0.66,
        size: 0.35 + ((seed >>> 7) & 7) / 8,
        phase: (((seed >>> 11) & 255) / 255) * TAU,
      });
    }
  }

  function resize() {
    const oldW = W;
    const oldH = H;
    const oldScale = flock ? flock.scale : 1;
    W = Math.max(1, innerWidth);
    H = Math.max(1, innerHeight);
    DPR = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    buildStars();
    if (flock) {
      flock.updateTargets(true, oldW, oldH, oldScale);
      flock.rebuildGrid();
    }
    pointer.activeUntil = 0;
    renderDirty = true;
  }

  function drawSky() {
    const nightPulse = 0.5 + Math.sin(state.simTime * 0.018 - 0.8) * 0.5;
    const gradient = ctx.createLinearGradient(0, 0, 0, H);
    gradient.addColorStop(0, "rgb(7, 8, 18)");
    gradient.addColorStop(
      0.48,
      "rgb(" +
        Math.round(17 + nightPulse * 9) +
        ", " +
        Math.round(15 + nightPulse * 5) +
        ", " +
        Math.round(29 + nightPulse * 8) +
        ")",
    );
    gradient.addColorStop(
      0.7,
      "rgb(" +
        Math.round(35 + nightPulse * 23) +
        ", " +
        Math.round(24 + nightPulse * 10) +
        ", " +
        Math.round(37 + nightPulse * 7) +
        ")",
    );
    gradient.addColorStop(1, "rgb(5, 6, 11)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(
      W * 0.56,
      H * 0.63,
      0,
      W * 0.56,
      H * 0.63,
      Math.max(W, H) * 0.55,
    );
    glow.addColorStop(
      0,
      "rgba(218, 126, 94, " + (0.055 + nightPulse * 0.035) + ")",
    );
    glow.addColorStop(0.45, "rgba(86, 62, 82, 0.025)");
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "#f5eee4";
    for (const star of stars) {
      const twinkle =
        0.18 +
        (Math.sin(state.simTime * (0.35 + star.size * 0.22) + star.phase) *
          0.5 +
          0.5) *
          0.42;
      ctx.globalAlpha = twinkle * (0.38 + (1 - nightPulse) * 0.28);
      ctx.fillRect(star.x * W, star.y * H, star.size, star.size);
    }
    ctx.globalAlpha = 1;
  }

  function drawRibbons() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const ribbon of ribbons) {
      if (ribbon.points.length < 3) continue;
      const age = state.simTime - ribbon.born;
      const alpha = Math.min(0.16, age * 0.018) * clamp(1 - age / 34, 0, 1);
      ctx.beginPath();
      ctx.moveTo(ribbon.points[0].x * W, ribbon.points[0].y * H);
      for (let i = 1; i < ribbon.points.length - 1; i++) {
        const point = ribbon.points[i];
        const next = ribbon.points[i + 1];
        const midX = (point.x + next.x) * 0.5 * W;
        const midY = (point.y + next.y) * 0.5 * H;
        ctx.quadraticCurveTo(point.x * W, point.y * H, midX, midY);
      }
      ctx.strokeStyle = "rgba(217, 131, 105, " + alpha + ")";
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawHomeMemory() {
    if (!flock || flock.flightAverage < 0.2) return;
    const alpha = 0.025 + 0.025 * flock.flightAverage;
    ctx.fillStyle = "rgba(235, 226, 217, " + alpha + ")";
    for (let i = 0; i < flock.count; i += 4) {
      ctx.fillRect(flock.targetX[i], flock.targetY[i], 0.7, 0.7);
    }
  }

  function drawBirds(interpolation) {
    if (!flock) return;
    const home = flock.homeAverage;
    const wingOpacity = 0.88 - home * 0.7;
    const dotOpacity = smoothstep((home - 0.28) / 0.72);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    if (wingOpacity > 0.08) {
      ctx.beginPath();
      for (let i = 0; i < flock.count; i++) {
        const x = lerp(flock.px[i], flock.x[i], interpolation);
        const y = lerp(flock.py[i], flock.y[i], interpolation);
        ctx.moveTo(flock.px[i], flock.py[i]);
        ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "rgba(224, 204, 196, " + 0.05 * wingOpacity + ")";
      ctx.lineWidth = 0.65;
      ctx.stroke();

      const paths = PALETTE.map(() => new Path2D());
      const accentPath = new Path2D();
      for (let i = 0; i < flock.count; i++) {
        const x = lerp(flock.px[i], flock.x[i], interpolation);
        const y = lerp(flock.py[i], flock.y[i], interpolation);
        const hx = flock.headingX[i];
        const hy = flock.headingY[i];
        const px = -hy;
        const py = hx;
        const flap =
          0.58 +
          Math.abs(
            Math.sin(
              state.simTime * (4.2 + state.metrics.speed * 5) + flock.wing[i],
            ),
          ) *
            0.62;
        const size = flock.size[i];
        const noseX = x + hx * size * 0.72;
        const noseY = y + hy * size * 0.72;
        const backX = x - hx * size * 0.34;
        const backY = y - hy * size * 0.34;
        const path = flock.punct[i] ? accentPath : paths[flock.palette[i]];
        path.moveTo(backX + px * size * flap, backY + py * size * flap);
        path.lineTo(noseX, noseY);
        path.lineTo(backX - px * size * flap, backY - py * size * flap);
      }
      ctx.lineWidth = clamp(0.72 * flock.worldScale, 0.62, 1.05);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      paths.forEach((path, index) => {
        const color = PALETTE[index];
        ctx.strokeStyle =
          "hsla(" +
          color.h +
          ", " +
          color.s +
          "%, " +
          color.l +
          "%, " +
          0.56 * wingOpacity +
          ")";
        ctx.stroke(path);
      });
      ctx.strokeStyle = "rgba(238, 167, 126, " + 0.78 * wingOpacity + ")";
      ctx.stroke(accentPath);
    }

    if (dotOpacity > 0.02) {
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(242, 237, 229, " + 0.82 * dotOpacity + ")";
      for (let i = 0; i < flock.count; i++) {
        if (flock.punct[i]) continue;
        const x = lerp(flock.px[i], flock.x[i], interpolation);
        const y = lerp(flock.py[i], flock.y[i], interpolation);
        const size = 0.75 + flock.size[i] * 0.13;
        ctx.fillRect(x - size * 0.5, y - size * 0.5, size, size);
      }
      ctx.fillStyle = "rgba(238, 169, 128, " + 0.92 * dotOpacity + ")";
      for (let i = 0; i < flock.count; i++) {
        if (!flock.punct[i]) continue;
        const x = lerp(flock.px[i], flock.x[i], interpolation);
        const y = lerp(flock.py[i], flock.y[i], interpolation);
        ctx.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
      }
    }
    ctx.restore();
  }

  function render(interpolation) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawSky();
    drawRibbons();
    drawHomeMemory();
    drawBirds(interpolation);
  }

  function frame(now) {
    const frameSeconds = Math.min((now - lastNow) / 1000, 0.1);
    lastNow = now;
    if (state.paused || reducedMotion) {
      accumulator = 0;
      if (renderDirty || now - lastStaticRender > 1000) {
        render(0);
        renderDirty = false;
        lastStaticRender = now;
      }
      requestAnimationFrame(frame);
      return;
    }
    accumulator += frameSeconds;
    let steps = 0;
    while (accumulator >= STEP && steps < 5) {
      simulateStep(STEP);
      accumulator -= STEP;
      steps++;
    }
    if (steps === 5 && accumulator >= STEP) accumulator = 0;
    render(accumulator / STEP);
    requestAnimationFrame(frame);
  }

  function exportSky() {
    const output = document.createElement("canvas");
    output.width = canvas.width;
    output.height = canvas.height;
    const outputCtx = output.getContext("2d");
    outputCtx.drawImage(canvas, 0, 0);
    outputCtx.setTransform(DPR, 0, 0, DPR, 0, 0);

    const shade = outputCtx.createLinearGradient(0, H - 150, 0, H);
    shade.addColorStop(0, "rgba(5, 6, 11, 0)");
    shade.addColorStop(1, "rgba(5, 6, 11, 0.82)");
    outputCtx.fillStyle = shade;
    outputCtx.fillRect(0, H - 150, W, 150);
    outputCtx.fillStyle = "rgba(244, 239, 232, 0.82)";
    outputCtx.font = "400 11px Georgia, 'Times New Roman', serif";
    outputCtx.fillText(state.phrase, 34, H - 43, W - 68);
    outputCtx.fillStyle = "rgba(244, 239, 232, 0.38)";
    outputCtx.font = "500 7px 'Segoe UI', sans-serif";
    outputCtx.fillText(
      "NIGHT LETTERS  ·  A SENTENCE LEARNS TO FLY",
      34,
      H - 25,
    );

    output.toBlob((blob) => {
      if (!blob) return;
      const link = document.createElement("a");
      const slug =
        cleanWord(state.phrase.split(/\s+/u).slice(0, 4).join("-")) ||
        "night-letters";
      link.href = URL.createObjectURL(blob);
      link.download = "night-letters-" + slug.replace(/\s+/g, "-") + ".png";
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      toast("this sky is yours");
    }, "image/png");
  }

  function handlePointer(event) {
    const now = state.simTime;
    const elapsed = Math.max(1 / 120, now - pointer.lastAt);
    const dx = event.clientX - pointer.lastX;
    const dy = event.clientY - pointer.lastY;
    const rawVX = clamp(dx / elapsed, -1200, 1200);
    const rawVY = clamp(dy / elapsed, -1200, 1200);
    pointer.vx = lerp(pointer.vx, rawVX, 0.22);
    pointer.vy = lerp(pointer.vy, rawVY, 0.22);
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.lastX = event.clientX;
    pointer.lastY = event.clientY;
    pointer.lastAt = now;
    pointer.activeUntil = now + 0.25;
  }

  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    releasePhrase(input.value);
    input.blur();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") input.blur();
    event.stopPropagation();
  });

  canvas.addEventListener("pointermove", handlePointer);
  canvas.addEventListener("pointerdown", (event) => {
    handlePointer(event);
    pointer.swirl *= -1;
    scatter(event.clientX, event.clientY, 0.72);
  });
  canvas.addEventListener("pointerleave", () => {
    pointer.activeUntil = state.simTime + 0.12;
  });

  soundButton.addEventListener("click", toggleSound);
  pauseButton.addEventListener("click", togglePause);
  scatterButton.addEventListener("click", () => scatter());
  reformButton.addEventListener("click", reform);
  saveButton.addEventListener("click", exportSky);

  addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest(
        "button, a, input, textarea, select, [contenteditable='true']",
      )
    ) {
      return;
    }
    if (event.repeat) return;
    if (event.code === "Space") {
      event.preventDefault();
      scatter();
    } else if (event.code === "KeyR") {
      reform();
    } else if (event.code === "KeyA") {
      toggleSound();
    } else if (event.code === "KeyP") {
      togglePause();
    } else if (event.code === "KeyE") {
      exportSky();
    } else if (event.code === "Enter") {
      input.focus();
    }
  });

  addEventListener("resize", () => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      resize();
    });
  });

  document.addEventListener("visibilitychange", () => {
    lastNow = performance.now();
    accumulator = 0;
    if (document.hidden) soundscape.hide();
    else soundscape.show();
  });

  window.__nightLetters = {
    get state() {
      return {
        phrase: state.phrase,
        phase: PHASES[state.phaseIndex].key,
        phaseProgress: phaseProgress(),
        birds: flock ? flock.count : 0,
        words: currentLayout ? currentLayout.wordCount : 0,
        paused: state.paused,
        reducedMotion,
        metrics: { ...state.metrics },
      };
    },
    release: releasePhrase,
    scatter,
    reform,
    togglePause,
    checksum() {
      if (!flock) return 0;
      let checksum = 2166136261;
      for (let i = 0; i < flock.count; i += 7) {
        checksum ^= Math.round(flock.x[i] * 10) ^ Math.round(flock.y[i] * 10);
        checksum = Math.imul(checksum, 16777619);
      }
      return checksum >>> 0;
    },
  };

  resize();
  releasePhrase(DEFAULT_PHRASE, true);
  updateHud();
  requestAnimationFrame(frame);
})();
