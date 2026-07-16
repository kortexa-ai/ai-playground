(() => {
  "use strict";

  const TAU = Math.PI * 2;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ambientCanvas = document.getElementById("ambient");
  const ambientContext = ambientCanvas.getContext("2d");
  const previews = [];
  let ambientWidth = 1;
  let ambientHeight = 1;
  let ambientDpr = 1;
  let ambientPoints = [];
  let pageVisible = !document.hidden;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, amount) {
    return a + (b - a) * amount;
  }

  function smoothstep(value) {
    const x = clamp(value, 0, 1);
    return x * x * (3 - 2 * x);
  }

  function mix32(value) {
    let x = value >>> 0;
    x ^= x >>> 16;
    x = Math.imul(x, 0x21f0aaad);
    x ^= x >>> 15;
    x = Math.imul(x, 0x735a2d97);
    x ^= x >>> 15;
    return (x ^ (x >>> 15)) >>> 0;
  }

  function randomAt(index, channel = 0) {
    return (
      mix32(
        Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(channel + 3, 0x85ebca6b),
      ) / 4294967296
    );
  }

  function sizeCanvas(canvas, context) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width, height, dpr };
  }

  function resizeAmbient() {
    const rect = ambientCanvas.getBoundingClientRect();
    ambientDpr = Math.min(devicePixelRatio || 1, 2);
    ambientWidth = Math.max(1, Math.round(rect.width));
    ambientHeight = Math.max(1, Math.round(rect.height));
    ambientCanvas.width = Math.round(ambientWidth * ambientDpr);
    ambientCanvas.height = Math.round(ambientHeight * ambientDpr);
    ambientContext.setTransform(ambientDpr, 0, 0, ambientDpr, 0, 0);
    const count = clamp(Math.round(ambientWidth / 17), 34, 92);
    ambientPoints = Array.from({ length: count }, (_, index) => ({
      x: 0.44 + randomAt(index, 1) * 0.56,
      y: 0.08 + randomAt(index, 2) * 0.72,
      size: 0.35 + randomAt(index, 3) * 1.05,
      phase: randomAt(index, 4) * TAU,
      speed: 0.05 + randomAt(index, 5) * 0.12,
    }));
  }

  function drawAmbient(time) {
    ambientContext.setTransform(ambientDpr, 0, 0, ambientDpr, 0, 0);
    ambientContext.clearRect(0, 0, ambientWidth, ambientHeight);
    const centerX = ambientWidth * 0.76;
    const centerY = ambientHeight * 0.39;

    ambientContext.save();
    ambientContext.strokeStyle = "rgba(225, 159, 124, 0.045)";
    ambientContext.lineWidth = 0.7;
    for (let ring = 1; ring <= 4; ring++) {
      ambientContext.beginPath();
      ambientContext.ellipse(
        centerX,
        centerY,
        ambientWidth * (0.09 + ring * 0.055),
        ambientHeight * (0.045 + ring * 0.034),
        -0.17,
        0,
        TAU,
      );
      ambientContext.stroke();
    }

    for (let i = 0; i < ambientPoints.length; i++) {
      const point = ambientPoints[i];
      const driftX = Math.sin(time * point.speed + point.phase) * 23;
      const driftY = Math.cos(time * point.speed * 0.73 + point.phase) * 13;
      const x = point.x * ambientWidth + driftX;
      const y = point.y * ambientHeight + driftY;
      const alpha =
        0.12 + (Math.sin(time * 0.33 + point.phase) * 0.5 + 0.5) * 0.2;
      ambientContext.fillStyle = "rgba(235, 226, 216, " + alpha + ")";
      ambientContext.fillRect(x, y, point.size, point.size);
      if (i % 9 === 0) {
        ambientContext.beginPath();
        ambientContext.moveTo(x, y);
        ambientContext.lineTo(centerX, centerY);
        ambientContext.strokeStyle = "rgba(217, 140, 103, 0.026)";
        ambientContext.stroke();
      }
    }
    ambientContext.restore();
  }

  class Study {
    constructor(canvas, kind) {
      this.canvas = canvas;
      this.context = canvas.getContext("2d", { alpha: false });
      this.kind = kind;
      this.active = true;
      this.width = 1;
      this.height = 1;
      this.dpr = 1;
      this.points = [];
      this.targets = [];
      this.resize();
    }

    resize() {
      const size = sizeCanvas(this.canvas, this.context);
      this.width = size.width;
      this.height = size.height;
      this.dpr = size.dpr;
      if (this.kind === "signals") this.makeSignals();
      if (this.kind === "letters") this.makeLetters();
      if (this.kind === "murmuration") this.makeMurmuration();
      if (this.kind === "photophore") this.makePhotophore();
      if (this.kind === "seasons") this.makeSeasons();
      this.draw(3.4);
    }

    makeSignals() {
      const centers = [
        { x: 0.28, y: 0.34, hue: 155 },
        { x: 0.6, y: 0.3, hue: 184 },
        { x: 0.48, y: 0.62, hue: 126 },
        { x: 0.74, y: 0.68, hue: 204 },
        { x: 0.2, y: 0.73, hue: 43 },
      ];
      this.centers = centers;
      const count = clamp(
        Math.round((this.width * this.height) / 2400),
        95,
        190,
      );
      this.points = Array.from({ length: count }, (_, index) => {
        const center = centers[index % centers.length];
        return {
          center,
          angle: randomAt(index, 10) * TAU,
          radius:
            14 + randomAt(index, 11) * Math.min(this.width, this.height) * 0.18,
          speed: 0.09 + randomAt(index, 12) * 0.26,
          size: 0.65 + randomAt(index, 13) * 1.7,
          phase: randomAt(index, 14) * TAU,
        };
      });
    }

    makeLetters() {
      const sampleCanvas = document.createElement("canvas");
      sampleCanvas.width = Math.max(1, Math.round(this.width));
      sampleCanvas.height = Math.max(1, Math.round(this.height));
      const sample = sampleCanvas.getContext("2d", {
        willReadFrequently: true,
      });
      const label = this.width < 420 ? "FLY" : "NIGHT";
      const fontSize = Math.min(
        this.width / (label.length * 0.65),
        this.height * 0.31,
      );
      sample.clearRect(0, 0, this.width, this.height);
      sample.fillStyle = "#fff";
      sample.font = "400 " + fontSize + "px Georgia, serif";
      sample.textAlign = "center";
      sample.textBaseline = "middle";
      sample.fillText(label, this.width / 2, this.height * 0.48);
      const pixels = sample.getImageData(
        0,
        0,
        sampleCanvas.width,
        sampleCanvas.height,
      ).data;
      let step = clamp(Math.round(fontSize / 13), 4, 8);
      const targets = [];
      for (let y = 0; y < this.height; y += step) {
        for (let x = 0; x < this.width; x += step) {
          const alpha =
            pixels[
              (Math.floor(y) * sampleCanvas.width + Math.floor(x)) * 4 + 3
            ];
          if (alpha > 80) targets.push({ x, y });
        }
      }
      if (targets.length > 230) {
        targets.sort(
          (a, b) =>
            mix32(Math.round(a.x) ^ Math.imul(Math.round(a.y), 19349663)) -
            mix32(Math.round(b.x) ^ Math.imul(Math.round(b.y), 19349663)),
        );
        targets.length = 230;
      }
      this.targets = targets;
      this.points = targets.map((target, index) => ({
        target,
        angle: randomAt(index, 20) * TAU,
        radius: 0.18 + randomAt(index, 21) * 0.34,
        speed: 0.18 + randomAt(index, 22) * 0.23,
        size: 1.7 + randomAt(index, 23) * 1.9,
        phase: randomAt(index, 24) * TAU,
      }));
    }

    makeMurmuration() {
      const count = clamp(
        Math.round((this.width * this.height) / 1000),
        260,
        620,
      );
      this.points = Array.from({ length: count }, (_, index) => ({
        angle: randomAt(index, 30) * TAU,
        radius: Math.sqrt(randomAt(index, 31)),
        speed: 0.06 + randomAt(index, 32) * 0.11,
        band: randomAt(index, 33) * 2 - 1,
        size: 0.4 + randomAt(index, 34) * 1.1,
        phase: randomAt(index, 35) * TAU,
      }));
    }

    draw(time) {
      this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      if (this.kind === "signals") this.drawSignals(time);
      if (this.kind === "letters") this.drawLetters(time);
      if (this.kind === "murmuration") this.drawMurmuration(time);
      if (this.kind === "photophore") this.drawPhotophore(time);
      if (this.kind === "seasons") this.drawSeasons(time);
    }

    makeSeasons() {
      const count = clamp(
        Math.round((this.width * this.height) / 700),
        380,
        900,
      );
      this.points = Array.from({ length: count }, (_, index) => {
        const roll = randomAt(index, 50);
        let zone = "sky";
        let x = randomAt(index, 51);
        let y = randomAt(index, 52);
        if (roll < 0.52) {
          zone = "canopy";
          const angle = randomAt(index, 53) * TAU;
          const radius = Math.sqrt(randomAt(index, 54));
          x = 0.52 + Math.cos(angle) * radius * 0.17;
          y = 0.36 + Math.sin(angle) * radius * 0.12;
        } else if (roll < 0.8) {
          zone = "ground";
          y = 0.64 + y * 0.36;
        } else {
          y = y * 0.64;
        }
        return {
          zone,
          x,
          y,
          size: 2 + randomAt(index, 55) * 3.2,
          phase: randomAt(index, 56) * TAU,
          tone: randomAt(index, 57),
        };
      });
    }

    drawSeasons(time) {
      const context = this.context;
      // palettes: winter, spring, summer, autumn — rgb triplets per zone
      const SKY = [
        [178, 186, 196],
        [166, 204, 222],
        [150, 195, 226],
        [206, 178, 142],
      ];
      const GROUND = [
        [222, 226, 232],
        [98, 164, 82],
        [158, 158, 62],
        [196, 138, 62],
      ];
      const CANOPY = [
        [72, 76, 88],
        [112, 178, 92],
        [58, 122, 64],
        [198, 104, 46],
      ];
      const DENSITY = [0.3, 0.95, 1, 0.9];
      const cycle = (time * 0.16) % 4;
      const k = Math.floor(cycle) % 4;
      const next = (k + 1) % 4;
      const blend = smoothstep(cycle - Math.floor(cycle));
      const mixChannel = (a, b, channel) =>
        Math.round(lerp(a[channel], b[channel], blend));
      const zoneColor = (palette) => [
        mixChannel(palette[k], palette[next], 0),
        mixChannel(palette[k], palette[next], 1),
        mixChannel(palette[k], palette[next], 2),
      ];
      const sky = zoneColor(SKY);
      const ground = zoneColor(GROUND);
      const canopy = zoneColor(CANOPY);
      const density = lerp(DENSITY[k], DENSITY[next], blend);

      const wash = context.createLinearGradient(0, 0, 0, this.height);
      wash.addColorStop(
        0,
        "rgb(" + sky[0] * 0.62 + "," + sky[1] * 0.64 + "," + sky[2] * 0.68 + ")",
      );
      wash.addColorStop(
        0.62,
        "rgb(" + sky[0] * 0.44 + "," + sky[1] * 0.46 + "," + sky[2] * 0.5 + ")",
      );
      wash.addColorStop(
        0.64,
        "rgb(" +
          ground[0] * 0.42 +
          "," +
          ground[1] * 0.46 +
          "," +
          ground[2] * 0.36 +
          ")",
      );
      wash.addColorStop(
        1,
        "rgb(" +
          ground[0] * 0.22 +
          "," +
          ground[1] * 0.24 +
          "," +
          ground[2] * 0.18 +
          ")",
      );
      context.fillStyle = wash;
      context.fillRect(0, 0, this.width, this.height);

      // trunk — a few dark strokes, steady through every climate
      context.strokeStyle = "rgba(38, 30, 24, 0.9)";
      context.lineCap = "round";
      const baseX = 0.52 * this.width;
      const baseY = 0.68 * this.height;
      const crownY = 0.42 * this.height;
      context.lineWidth = Math.max(2.5, this.width * 0.011);
      context.beginPath();
      context.moveTo(baseX, baseY);
      context.quadraticCurveTo(
        baseX - this.width * 0.012,
        (baseY + crownY) / 2,
        baseX,
        crownY,
      );
      context.moveTo(baseX, crownY + this.height * 0.05);
      context.lineTo(baseX - this.width * 0.07, crownY - this.height * 0.03);
      context.moveTo(baseX, crownY + this.height * 0.04);
      context.lineTo(baseX + this.width * 0.08, crownY - this.height * 0.04);
      context.stroke();
      context.lineWidth = Math.max(1.5, this.width * 0.006);
      context.beginPath();
      context.moveTo(baseX, crownY + this.height * 0.09);
      context.lineTo(baseX - this.width * 0.045, crownY - this.height * 0.075);
      context.moveTo(baseX, crownY + this.height * 0.02);
      context.lineTo(baseX + this.width * 0.035, crownY - this.height * 0.085);
      context.moveTo(baseX - this.width * 0.04, crownY + this.height * 0.006);
      context.lineTo(baseX - this.width * 0.085, crownY - this.height * 0.055);
      context.stroke();

      for (const point of this.points) {
        const boil = Math.sin(time * 0.9 + point.phase) * 0.0035;
        const x = (point.x + boil) * this.width;
        const y =
          (point.y + Math.cos(time * 0.7 + point.phase * 1.6) * 0.0028) *
          this.height;
        let color = sky;
        let alpha = 0.22 + point.tone * 0.26;
        if (point.zone === "ground") {
          color = ground;
          alpha = 0.32 + point.tone * 0.4;
        } else if (point.zone === "canopy") {
          if (point.tone > density) continue;
          color = canopy;
          alpha = 0.5 + point.tone * 0.42;
        }
        const shade = 0.82 + point.tone * 0.36;
        context.fillStyle =
          "rgba(" +
          Math.round(color[0] * shade) +
          "," +
          Math.round(color[1] * shade) +
          "," +
          Math.round(color[2] * shade) +
          "," +
          alpha +
          ")";
        context.fillRect(x, y, point.size, point.size);
      }
    }

    makePhotophore() {
      const count = clamp(
        Math.round((this.width * this.height) / 620),
        420,
        980,
      );
      this.points = Array.from({ length: count }, (_, index) => ({
        x: randomAt(index, 40),
        y: randomAt(index, 41),
        size: 0.6 + randomAt(index, 42) * 1.3,
        phase: randomAt(index, 43) * TAU,
        jitter: 0.35 + randomAt(index, 44) * 0.85,
      }));
    }

    drawPhotophore(time) {
      const context = this.context;
      const deep = context.createLinearGradient(0, 0, 0, this.height);
      deep.addColorStop(0, "#04121b");
      deep.addColorStop(0.6, "#03212b");
      deep.addColorStop(1, "#020a10");
      context.fillStyle = deep;
      context.fillRect(0, 0, this.width, this.height);

      // invisible field the motes can feel: two drifting warm-cool orbs,
      // one dark wandering jelly, one slow comet
      const orbs = [
        {
          x: 0.32 + Math.sin(time * 0.09) * 0.14,
          y: 0.38 + Math.cos(time * 0.07) * 0.12,
          r: 0.34,
          hue: 172,
        },
        {
          x: 0.71 + Math.sin(time * 0.06 + 2.1) * 0.12,
          y: 0.6 + Math.cos(time * 0.08 + 1.2) * 0.13,
          r: 0.3,
          hue: 196,
        },
      ];
      const jelly = {
        x: 0.5 + Math.sin(time * 0.045 + 4.2) * 0.3,
        y: 0.42 + Math.cos(time * 0.035 + 0.8) * 0.2,
        r: 0.17,
      };
      const cometCycle = (time % 11) / 11;
      const comet = {
        x: -0.1 + cometCycle * 1.2,
        y: 0.3 + Math.sin(cometCycle * 5.2) * 0.14,
        on: cometCycle > 0.02 && cometCycle < 0.98,
      };

      context.globalCompositeOperation = "lighter";
      const aspect = this.width / Math.max(this.height, 1);
      for (const point of this.points) {
        const jx =
          point.x + Math.sin(time * 0.5 * point.jitter + point.phase) * 0.004;
        const jy =
          point.y +
          Math.cos(time * 0.42 * point.jitter + point.phase * 1.7) * 0.004;

        let light = 0.05;
        let hue = 188;
        for (const orb of orbs) {
          const dx = (jx - orb.x) * aspect;
          const dy = jy - orb.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          const glow = Math.max(0, 1 - d / orb.r);
          if (glow > 0) {
            light += glow * glow * 0.85;
            hue = lerp(hue, orb.hue, glow);
          }
        }
        {
          const dx = (jx - jelly.x) * aspect;
          const dy = jy - jelly.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          const shadow = Math.max(0, 1 - d / jelly.r);
          light *= 1 - shadow * 0.85;
        }
        if (comet.on) {
          const dx = (jx - comet.x) * aspect;
          const dy = jy - comet.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          const spark = Math.max(0, 1 - d / 0.09);
          light += spark * spark * 1.3;
        }
        const twinkle =
          0.75 + Math.sin(time * 1.7 * point.jitter + point.phase) * 0.25;
        const alpha = clamp(light * twinkle, 0.015, 0.95);
        context.fillStyle =
          "hsla(" + hue + ", 62%, " + (52 + light * 22) + "%, " + alpha + ")";
        context.fillRect(
          jx * this.width,
          jy * this.height,
          point.size,
          point.size,
        );
      }
      context.globalCompositeOperation = "source-over";
    }

    drawSignals(time) {
      const context = this.context;
      const background = context.createRadialGradient(
        this.width * 0.48,
        this.height * 0.5,
        0,
        this.width * 0.48,
        this.height * 0.5,
        Math.max(this.width, this.height) * 0.75,
      );
      background.addColorStop(0, "#0b211b");
      background.addColorStop(0.55, "#071410");
      background.addColorStop(1, "#040908");
      context.fillStyle = background;
      context.fillRect(0, 0, this.width, this.height);
      context.globalCompositeOperation = "lighter";

      context.beginPath();
      for (let i = 0; i < this.centers.length; i++) {
        for (let j = i + 1; j < this.centers.length; j++) {
          if ((i + j) % 2) continue;
          context.moveTo(
            this.centers[i].x * this.width,
            this.centers[i].y * this.height,
          );
          context.lineTo(
            this.centers[j].x * this.width,
            this.centers[j].y * this.height,
          );
        }
      }
      context.strokeStyle = "rgba(126, 224, 184, 0.055)";
      context.lineWidth = 0.7;
      context.stroke();

      for (const point of this.points) {
        const centerX = point.center.x * this.width;
        const centerY = point.center.y * this.height;
        const angle = point.angle + time * point.speed;
        const wobble = 0.72 + Math.sin(time * 0.19 + point.phase) * 0.28;
        const x = centerX + Math.cos(angle) * point.radius * wobble;
        const y = centerY + Math.sin(angle * 1.13) * point.radius * 0.64;
        const oldAngle = angle - 0.05;
        const oldX = centerX + Math.cos(oldAngle) * point.radius * wobble;
        const oldY = centerY + Math.sin(oldAngle * 1.13) * point.radius * 0.64;
        context.beginPath();
        context.moveTo(oldX, oldY);
        context.lineTo(x, y);
        context.strokeStyle = "hsla(" + point.center.hue + ", 68%, 67%, 0.32)";
        context.lineWidth = point.size * 0.5;
        context.stroke();
        context.fillStyle = "hsla(" + point.center.hue + ", 78%, 70%, 0.58)";
        context.fillRect(x, y, point.size, point.size);
      }
      context.globalCompositeOperation = "source-over";
    }

    drawLetters(time) {
      const context = this.context;
      const sky = context.createLinearGradient(0, 0, 0, this.height);
      sky.addColorStop(0, "#090a15");
      sky.addColorStop(0.65, "#2b1d2d");
      sky.addColorStop(1, "#090a0f");
      context.fillStyle = sky;
      context.fillRect(0, 0, this.width, this.height);

      const cycle = (time % 14) / 14;
      let home = 0;
      if (cycle < 0.23) home = 1;
      else if (cycle < 0.4) home = 1 - smoothstep((cycle - 0.23) / 0.17);
      else if (cycle > 0.72) home = smoothstep((cycle - 0.72) / 0.28);

      context.globalCompositeOperation = "lighter";
      for (let i = 0; i < this.points.length; i++) {
        const point = this.points[i];
        const flightX =
          this.width * 0.5 +
          Math.cos(point.angle + time * point.speed) *
            this.width *
            point.radius +
          Math.sin(time * 0.31 + point.phase) * 17;
        const flightY =
          this.height * 0.5 +
          Math.sin(point.angle * 1.7 + time * point.speed * 0.82) *
            this.height *
            point.radius *
            0.55;
        const x = lerp(flightX, point.target.x, home);
        const y = lerp(flightY, point.target.y, home);
        const heading = point.angle + time * point.speed + Math.PI * 0.5;
        const hx = Math.cos(heading);
        const hy = Math.sin(heading);
        const px = -hy;
        const py = hx;
        const wing =
          point.size *
          (0.62 + Math.abs(Math.sin(time * 4 + point.phase)) * 0.5);
        context.beginPath();
        context.moveTo(
          x - hx * point.size * 0.2 + px * wing,
          y - hy * point.size * 0.2 + py * wing,
        );
        context.lineTo(x + hx * point.size * 0.7, y + hy * point.size * 0.7);
        context.lineTo(
          x - hx * point.size * 0.2 - px * wing,
          y - hy * point.size * 0.2 - py * wing,
        );
        context.strokeStyle =
          i % 17 === 0
            ? "rgba(231, 158, 121, 0.75)"
            : "rgba(226, 220, 217, " + (0.48 + home * 0.32) + ")";
        context.lineWidth = 0.75;
        context.stroke();
      }
      context.globalCompositeOperation = "source-over";
    }

    drawMurmuration(time) {
      const context = this.context;
      const sky = context.createLinearGradient(0, 0, 0, this.height);
      sky.addColorStop(0, "#111426");
      sky.addColorStop(0.51, "#60505e");
      sky.addColorStop(0.64, "#c18270");
      sky.addColorStop(0.66, "#30252c");
      sky.addColorStop(1, "#08090d");
      context.fillStyle = sky;
      context.fillRect(0, 0, this.width, this.height);

      const horizon = this.height * 0.65;
      context.fillStyle = "rgba(7, 9, 14, 0.72)";
      context.fillRect(0, horizon, this.width, this.height - horizon);
      for (let i = 0; i < 20; i++) {
        const y = horizon + 8 + i * ((this.height - horizon) / 22);
        context.beginPath();
        context.moveTo(this.width * (0.27 + Math.sin(i * 2.1) * 0.03), y);
        context.lineTo(this.width * (0.74 + Math.cos(i * 1.7) * 0.04), y);
        context.strokeStyle =
          "rgba(223, 160, 124, " + 0.045 * (1 - i / 20) + ")";
        context.lineWidth = 1;
        context.stroke();
      }

      const centerX = this.width * (0.52 + Math.sin(time * 0.07) * 0.08);
      const centerY = this.height * (0.37 + Math.sin(time * 0.11) * 0.04);
      context.fillStyle = "rgba(7, 8, 12, 0.77)";
      for (const point of this.points) {
        const angle = point.angle + time * point.speed;
        const radiusX = this.width * (0.08 + point.radius * 0.31);
        const radiusY = this.height * (0.025 + point.radius * 0.17);
        const fold = Math.sin(angle * 2.6 + time * 0.19 + point.phase);
        const x =
          centerX + Math.cos(angle) * radiusX + fold * this.width * 0.035;
        const y = centerY + Math.sin(angle * 1.34) * radiusY + point.band * 8;
        context.fillRect(x, y, point.size * 1.4, point.size * 0.72);
      }

      const falconX = centerX + Math.sin(time * 0.31) * this.width * 0.28;
      const falconY = centerY - this.height * 0.18 + Math.cos(time * 0.23) * 18;
      context.beginPath();
      context.moveTo(falconX - 13, falconY - 2);
      context.quadraticCurveTo(falconX - 3, falconY + 3, falconX, falconY + 1);
      context.quadraticCurveTo(
        falconX + 4,
        falconY + 3,
        falconX + 14,
        falconY - 3,
      );
      context.strokeStyle = "rgba(5, 6, 9, 0.86)";
      context.lineWidth = 2.2;
      context.stroke();
    }
  }

  document.querySelectorAll("canvas[data-study]").forEach((canvas) => {
    previews.push(new Study(canvas, canvas.dataset.study));
  });

  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const study = previews.find(
        (candidate) => candidate.canvas === entry.target,
      );
      if (study) study.resize();
    }
  });
  previews.forEach((study) => resizeObserver.observe(study.canvas));

  const intersectionObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const study = previews.find(
          (candidate) => candidate.canvas === entry.target,
        );
        if (study) study.active = entry.isIntersecting;
      }
    },
    { rootMargin: "120px" },
  );
  previews.forEach((study) => intersectionObserver.observe(study.canvas));

  function wireCopyButton(buttonId, project) {
    const button = document.getElementById(buttonId);
    if (!button) return;
    const command = [
      "git clone https://github.com/kortexa-ai/ai-playground.git",
      "cd ai-playground/" + project,
      "bun install",
      "bun start",
    ].join("\n");

    async function copyCommand() {
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(command);
        } else {
          const area = document.createElement("textarea");
          area.value = command;
          area.style.position = "fixed";
          area.style.opacity = "0";
          document.body.appendChild(area);
          area.select();
          document.execCommand("copy");
          area.remove();
        }
        button.textContent = "copied";
        button.setAttribute("aria-label", "Commands copied");
        setTimeout(() => {
          button.textContent = "copy";
          button.setAttribute("aria-label", "Copy run commands");
        }, 1500);
      } catch {
        button.textContent = "select + copy";
      }
    }

    button.setAttribute("aria-label", "Copy run commands");
    button.addEventListener("click", copyCommand);
  }

  wireCopyButton("copy-command", "murmuration");
  wireCopyButton("copy-command-photophore", "photophore");

  document.addEventListener("visibilitychange", () => {
    pageVisible = !document.hidden;
  });

  let resizeTimer = 0;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resizeAmbient, 100);
  });

  function frame(now) {
    if (pageVisible) {
      const time = now / 1000;
      if (scrollY < ambientHeight + 120) drawAmbient(time);
      for (const study of previews) {
        if (study.active) study.draw(time);
      }
    }
    requestAnimationFrame(frame);
  }

  resizeAmbient();
  if (reducedMotion) {
    drawAmbient(4.8);
    for (const study of previews) study.draw(4.8);
  } else {
    requestAnimationFrame(frame);
  }
})();
