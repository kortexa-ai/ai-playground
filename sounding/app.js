import {
  READINGS,
  clamp,
  depthAtProgress,
  echoDelay,
  formatDepth,
  formatPulse,
  readingAt,
  surveyCode,
} from "./core.js";

const TAU = Math.PI * 2;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

function smoothstep(value) {
  const amount = clamp(value, 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function hash32(index, channel = 0) {
  let value =
    Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(channel + 7, 0x85ebca6b);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return value >>> 0;
}

function randomAt(index, channel = 0) {
  return hash32(index, channel) / 4294967296;
}

class AbyssRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: false });
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.stage = 0;
    this.displayStage = 0;
    this.depth = 0;
    this.pulses = [];
    this.points = [];
    this.motes = [];
    this.eyeLevel = 0;
    this.answering = false;
    this.pointer = { x: 0.5, y: 0.5 };
    this.lastTime = performance.now();
    this.onImpact = null;

    this.resize = this.resize.bind(this);
    this.draw = this.draw.bind(this);
    this.movePointer = this.movePointer.bind(this);
    window.addEventListener("resize", this.resize);
    window.addEventListener("pointermove", this.movePointer, { passive: true });
    this.resize();
    requestAnimationFrame(this.draw);
  }

  movePointer(event) {
    this.pointer.x = clamp(event.clientX / Math.max(1, innerWidth), 0, 1);
    this.pointer.y = clamp(event.clientY / Math.max(1, innerHeight), 0, 1);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.buildMotes();
    this.buildContact();
  }

  buildMotes() {
    const count = clamp(
      Math.round((this.width * this.height) / 4200),
      120,
      430,
    );
    this.motes = Array.from({ length: count }, (_, index) => ({
      x: randomAt(index, 1),
      y: randomAt(index, 2),
      size: 0.35 + randomAt(index, 3) * 1.45,
      speed: 0.006 + randomAt(index, 4) * 0.018,
      drift: randomAt(index, 5) * TAU,
      alpha: 0.035 + randomAt(index, 6) * 0.13,
    }));
  }

  addCurve(count, minimumStage, channel, curve) {
    for (let index = 0; index < count; index += 1) {
      const t = count === 1 ? 0 : index / (count - 1);
      const position = curve(t, index);
      this.points.push({
        u: position.u,
        v: position.v,
        minimumStage:
          minimumStage + (randomAt(index, channel + 1) > 0.87 ? 1 : 0),
        cold: 0,
        warm: 0,
        size: 0.65 + randomAt(index, channel + 2) * 1.25,
        phase: randomAt(index, channel + 3) * TAU,
      });
    }
  }

  buildContact() {
    this.points = [];

    this.addCurve(360, 2, 20, (t) => {
      const u = lerp(-1.3, 1.3, t);
      return {
        u,
        v: -0.43 + u * u * 0.15 + Math.sin(u * 8.2) * 0.012,
      };
    });

    this.addCurve(310, 3, 30, (t) => {
      const u = lerp(-1.18, 1.18, t);
      return {
        u,
        v: 0.2 - u * u * 0.055 + Math.sin(u * 5.4 + 0.7) * 0.018,
      };
    });

    this.addCurve(250, 4, 40, (t) => {
      const u = lerp(-1.06, 1.05, t);
      return {
        u,
        v: -0.08 + Math.sin(u * 3.2) * 0.025 + u * 0.035,
      };
    });

    for (let ridge = 0; ridge < 7; ridge += 1) {
      const radiusU = 0.13 + ridge * 0.12;
      const radiusV = 0.055 + ridge * 0.055;
      this.addCurve(150 + ridge * 10, 4 + Math.floor(ridge / 2), 60 + ridge, (t) => {
        const angle = lerp(Math.PI * 0.08, Math.PI * 1.92, t);
        return {
          u: 0.13 + Math.cos(angle) * radiusU,
          v:
            -0.145 +
            Math.sin(angle) * radiusV +
            Math.sin(angle * 3 + ridge) * 0.008,
        };
      });
    }

    for (let rib = 0; rib < 11; rib += 1) {
      const anchor = lerp(-0.94, 0.92, rib / 10);
      this.addCurve(86, 4 + (rib % 3), 90 + rib, (t) => ({
        u: anchor + Math.sin(t * Math.PI) * (0.025 + Math.abs(anchor) * 0.03),
        v:
          -0.19 +
          t * (0.37 - Math.abs(anchor) * 0.08) +
          Math.sin(t * Math.PI * 2 + rib) * 0.009,
      }));
    }

    for (let filament = 0; filament < 7; filament += 1) {
      const anchor = lerp(-0.98, 0.82, filament / 6);
      const length = 0.17 + randomAt(filament, 120) * 0.25;
      this.addCurve(92, 5 + (filament % 2), 125 + filament, (t) => ({
        u:
          anchor +
          Math.sin(t * 5.6 + filament) * (0.012 + t * 0.032) +
          t * (anchor < 0 ? -0.05 : 0.05),
        v: 0.16 + t * length,
      }));
    }

    this.addCurve(170, 7, 150, (t) => {
      const angle = t * TAU;
      return {
        u: 0.13 + Math.cos(angle) * 0.105,
        v: -0.145 + Math.sin(angle) * 0.046,
      };
    });

    this.addCurve(90, 9, 160, (t) => {
      const angle = t * TAU;
      return {
        u: 0.13 + Math.cos(angle) * 0.048,
        v: -0.145 + Math.sin(angle) * 0.021,
      };
    });
  }

  setStage(stage) {
    this.stage = clamp(stage, 0, READINGS.length - 1);
  }

  setDepth(depth) {
    this.depth = Math.max(0, depth);
  }

  reset() {
    this.stage = 0;
    this.displayStage = 0;
    this.depth = 0;
    this.pulses = [];
    this.eyeLevel = 0;
    this.answering = false;
    for (const point of this.points) {
      point.cold = 0;
      point.warm = 0;
    }
  }

  approach() {
    return smoothstep((this.displayStage - 1) / 9);
  }

  contactFrame(time) {
    const approach = this.approach();
    const drift = reducedMotion ? 0 : Math.sin(time * 0.000085) * approach;
    return {
      centerX: this.width * (0.49 + drift * 0.013),
      centerY: this.height * (1.25 - approach * 0.63),
      scaleX: this.width * (0.61 + approach * 0.035),
      scaleY: this.height * (0.54 + approach * 0.025),
      approach,
    };
  }

  positionPoint(point, frame) {
    return {
      x: frame.centerX + point.u * frame.scaleX,
      y: frame.centerY + point.v * frame.scaleY,
    };
  }

  probePosition(time) {
    const strain = smoothstep((this.displayStage - 6) / 4);
    const sway = reducedMotion
      ? 0
      : Math.sin(time * 0.0007 + this.displayStage) *
        this.width *
        (0.002 + strain * 0.004);
    return {
      x: this.width * 0.5 + sway,
      y: this.height * (0.43 + strain * 0.006),
    };
  }

  pulseOrigin(pulse, time, frame) {
    if (pulse.origin === "eye") {
      return this.positionPoint({ u: 0.13, v: -0.145 }, frame);
    }
    return this.probePosition(time);
  }

  reveal(stage, warm = false, strength = 0.78) {
    for (let index = 0; index < this.points.length; index += 1) {
      const point = this.points[index];
      if (point.minimumStage > stage) continue;
      if (randomAt(index, stage + (warm ? 300 : 200)) < 0.72) {
        const key = warm ? "warm" : "cold";
        point[key] = Math.max(point[key], strength);
      }
    }
  }

  emitPulse(stage) {
    if (reducedMotion) {
      this.reveal(stage, false, 0.8);
      return;
    }
    this.pulses.push({
      kind: "outgoing",
      origin: "probe",
      born: performance.now(),
      duration: 1650,
      stage,
      impact: false,
    });
  }

  returnPulse(stage) {
    this.eyeLevel = Math.max(this.eyeLevel, clamp((stage - 6) / 4, 0, 1));
    if (reducedMotion) {
      this.reveal(stage, stage >= 9, 0.9);
      return;
    }
    this.pulses.push({
      kind: "return",
      origin: "probe",
      born: performance.now(),
      duration: 1120,
      stage,
      impact: false,
    });
  }

  passiveReturn() {
    if (reducedMotion) {
      this.reveal(this.stage, true, 0.45);
      return;
    }
    this.pulses.push({
      kind: "passive",
      origin: "eye",
      born: performance.now(),
      duration: 2050,
      stage: this.stage,
      impact: false,
    });
  }

  answer() {
    this.answering = true;
    this.eyeLevel = 1;
    if (reducedMotion) {
      this.reveal(10, true, 1);
      this.onImpact?.();
      return;
    }
    this.pulses.push({
      kind: "answer",
      origin: "eye",
      born: performance.now(),
      duration: 2600,
      stage: 10,
      impact: false,
    });
  }

  pulseRadius(pulse, progress, maximum) {
    if (pulse.kind === "return") return maximum * (1 - progress);
    return maximum * progress;
  }

  drawBackground(time) {
    const { context, width, height } = this;
    const gradient = context.createRadialGradient(
      width * 0.5,
      height * 0.38,
      0,
      width * 0.5,
      height * 0.48,
      Math.max(width, height) * 0.82,
    );
    gradient.addColorStop(0, "#071316");
    gradient.addColorStop(0.46, "#030b0d");
    gradient.addColorStop(1, "#010304");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    const probe = this.probePosition(time);
    const depthScale = 5.2;
    const spacing = clamp(height / 8, 62, 96);
    const offset = ((this.depth / depthScale) % spacing + spacing) % spacing;
    context.save();
    context.font = '6px "SFMono-Regular", Consolas, monospace';
    context.textAlign = "left";
    context.textBaseline = "middle";
    for (let y = probe.y - offset - spacing * 5; y < height + spacing; y += spacing) {
      const markerDepth = Math.max(
        0,
        Math.round((this.depth + (y - probe.y) * depthScale) / 100) * 100,
      );
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.strokeStyle = "rgba(149, 189, 179, 0.034)";
      context.lineWidth = 1;
      context.stroke();
      context.fillStyle = "rgba(149, 189, 179, 0.16)";
      context.fillText(String(markerDepth).padStart(5, "0") + " M", 9, y - 6);
    }
    context.restore();

    context.save();
    context.globalCompositeOperation = "lighter";
    for (const mote of this.motes) {
      const motion = reducedMotion ? 0 : time * mote.speed * 0.001;
      const y = ((mote.y - motion + this.displayStage * 0.006) % 1 + 1) % 1;
      const x =
        mote.x +
        (reducedMotion ? 0 : Math.sin(time * 0.00023 + mote.drift) * 0.008);
      const alpha = mote.alpha * (0.42 + this.approach() * 0.58);
      context.fillStyle = `rgba(151, 191, 182, ${alpha})`;
      context.fillRect(x * width, y * height, mote.size, mote.size);
    }
    context.restore();
  }

  drawContactShadow(frame) {
    if (frame.approach <= 0.005) return;
    const { context } = this;
    context.save();
    context.translate(frame.centerX, frame.centerY);
    context.scale(frame.scaleX, frame.scaleY);
    context.beginPath();
    context.moveTo(-1.3, -0.18);
    context.bezierCurveTo(-0.95, -0.55, -0.28, -0.5, 0.14, -0.46);
    context.bezierCurveTo(0.64, -0.49, 1.06, -0.35, 1.3, -0.16);
    context.bezierCurveTo(1.03, 0.18, 0.48, 0.29, -0.12, 0.28);
    context.bezierCurveTo(-0.72, 0.29, -1.13, 0.15, -1.3, -0.18);
    context.closePath();
    context.fillStyle = `rgba(0, 2, 3, ${0.24 + frame.approach * 0.45})`;
    context.fill();
    context.restore();
  }

  drawEye(frame) {
    if (this.eyeLevel <= 0.002) return;
    const { context } = this;
    const eye = this.positionPoint({ u: 0.13, v: -0.145 }, frame);
    const radiusX = frame.scaleX * 0.085;
    const radiusY = frame.scaleY * 0.035;
    const attention = this.answering ? 1 : this.eyeLevel;
    const followX = (this.pointer.x - 0.5) * radiusX * 0.23 * attention;
    const followY = (this.pointer.y - 0.5) * radiusY * 0.24 * attention;

    context.save();
    const halo = context.createRadialGradient(
      eye.x,
      eye.y,
      0,
      eye.x,
      eye.y,
      radiusX * 2.8,
    );
    halo.addColorStop(0, `rgba(152, 84, 66, ${0.08 * attention})`);
    halo.addColorStop(1, "rgba(152, 84, 66, 0)");
    context.fillStyle = halo;
    context.beginPath();
    context.arc(eye.x, eye.y, radiusX * 2.8, 0, TAU);
    context.fill();

    context.fillStyle = `rgba(0, 1, 1, ${0.46 + attention * 0.42})`;
    context.beginPath();
    context.ellipse(eye.x, eye.y, radiusX, radiusY, -0.04, 0, TAU);
    context.fill();

    if (attention > 0.46) {
      context.fillStyle = `rgba(195, 107, 82, ${
        (attention - 0.46) * (this.answering ? 0.9 : 0.36)
      })`;
      context.beginPath();
      context.ellipse(
        eye.x + followX,
        eye.y + followY,
        Math.max(1.2, radiusX * 0.055),
        Math.max(0.7, radiusY * 0.16),
        0,
        0,
        TAU,
      );
      context.fill();
    }
    context.restore();
  }

  updateAndDrawPulses(time, frame) {
    const { context, width, height } = this;
    const maximum = Math.hypot(width, height) * 1.03;
    const active = [];

    for (const pulse of this.pulses) {
      const progress = (time - pulse.born) / pulse.duration;
      if (progress < 0 || progress > 1) continue;
      active.push(pulse);
      const eased = pulse.kind === "return" ? progress : smoothstep(progress);
      const radius = this.pulseRadius(pulse, eased, maximum);
      const origin = this.pulseOrigin(pulse, time, frame);
      pulse.radius = radius;
      pulse.x = origin.x;
      pulse.y = origin.y;

      const warm = pulse.kind === "answer" || pulse.kind === "passive";
      const color = warm ? "195, 107, 82" : "149, 189, 179";
      const envelope = Math.sin(progress * Math.PI);
      context.save();
      context.strokeStyle = `rgba(${color}, ${envelope * (warm ? 0.26 : 0.2)})`;
      context.lineWidth = pulse.kind === "answer" ? 1.8 : 1;
      context.beginPath();
      context.arc(origin.x, origin.y, Math.max(0, radius), 0, TAU);
      context.stroke();
      context.strokeStyle = `rgba(${color}, ${envelope * 0.055})`;
      context.lineWidth = 8;
      context.beginPath();
      context.arc(origin.x, origin.y, Math.max(0, radius), 0, TAU);
      context.stroke();
      context.restore();

      if (pulse.kind === "answer" && !pulse.impact) {
        const probe = this.probePosition(time);
        const distance = Math.hypot(probe.x - origin.x, probe.y - origin.y);
        if (radius >= distance) {
          pulse.impact = true;
          this.onImpact?.();
        }
      }
    }

    this.pulses = active;
    return active;
  }

  drawContact(time, delta, frame, pulses) {
    const { context } = this;
    const decay = Math.exp(-delta * 0.00019);
    context.save();
    context.globalCompositeOperation = "lighter";

    for (const point of this.points) {
      point.cold *= decay;
      point.warm *= decay;
      const position = this.positionPoint(point, frame);

      for (const pulse of pulses) {
        if (point.minimumStage > pulse.stage) continue;
        const distance = Math.hypot(position.x - pulse.x, position.y - pulse.y);
        const band = pulse.kind === "answer" ? 27 : 16;
        if (Math.abs(distance - pulse.radius) > band) continue;
        const strength = 1 - Math.abs(distance - pulse.radius) / band;
        if (pulse.kind === "answer" || pulse.kind === "passive") {
          point.warm = Math.max(point.warm, strength);
        } else {
          point.cold = Math.max(point.cold, strength * 0.92);
        }
      }

      const cold = point.cold;
      const warm = point.warm;
      const energy = Math.max(cold, warm);
      if (energy < 0.018) continue;
      if (
        position.x < -4 ||
        position.x > this.width + 4 ||
        position.y < -4 ||
        position.y > this.height + 4
      ) {
        continue;
      }

      const flicker = reducedMotion
        ? 1
        : 0.82 + Math.sin(time * 0.004 + point.phase) * 0.18;
      const alpha = clamp(energy * flicker, 0, 1);
      const size = point.size * (0.72 + energy * 0.72);
      if (warm > cold) {
        context.fillStyle = `rgba(195, 107, 82, ${alpha * 0.88})`;
      } else {
        context.fillStyle = `rgba(159, 205, 193, ${alpha * 0.8})`;
      }
      context.fillRect(position.x, position.y, size, size);
    }
    context.restore();
  }

  drawCable(time) {
    const { context, width } = this;
    const probe = this.probePosition(time);
    const strain = smoothstep((this.displayStage - 6) / 4);
    const cableColor = this.answering
      ? "rgba(195, 107, 82, 0.48)"
      : `rgba(149, 189, 179, ${0.22 + strain * 0.12})`;

    context.save();
    context.strokeStyle = cableColor;
    context.lineWidth = 0.8 + strain * 0.7;
    context.beginPath();
    context.moveTo(width * 0.5, -4);
    context.bezierCurveTo(
      width * (0.5 - strain * 0.007),
      probe.y * 0.32,
      probe.x + Math.sin(time * 0.0006) * strain * 6,
      probe.y * 0.72,
      probe.x,
      probe.y - 9,
    );
    context.stroke();

    context.translate(probe.x, probe.y);
    context.strokeStyle = cableColor;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, -9);
    context.lineTo(0, 7);
    context.moveTo(-7, 8);
    context.lineTo(7, 8);
    context.stroke();
    context.fillStyle = this.answering
      ? "rgba(195, 107, 82, 0.75)"
      : "rgba(168, 205, 196, 0.62)";
    context.beginPath();
    context.arc(0, 8, 2.1, 0, TAU);
    context.fill();
    context.restore();
  }

  draw(time) {
    const delta = Math.min(50, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    const stageFollow = reducedMotion ? 1 : 1 - Math.exp(-delta * 0.0018);
    this.displayStage = lerp(this.displayStage, this.stage, stageFollow);

    this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawBackground(time);
    const frame = this.contactFrame(time);
    this.drawContactShadow(frame);
    const pulses = this.updateAndDrawPulses(time, frame);
    this.drawContact(time, delta, frame, pulses);
    this.drawEye(frame);
    this.drawCable(time);

    requestAnimationFrame(this.draw);
  }
}

class AudioEngine {
  constructor() {
    this.context = null;
    this.master = null;
    this.droneFilter = null;
    this.muted = false;
    this.available = Boolean(window.AudioContext || window.webkitAudioContext);
  }

  async start() {
    if (!this.available) return false;
    if (this.context) {
      if (this.context.state === "suspended") await this.context.resume();
      return true;
    }

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    this.context = new AudioContext();
    const now = this.context.currentTime;
    this.master = this.context.createGain();
    this.master.gain.setValueAtTime(0.0001, now);
    this.master.gain.exponentialRampToValueAtTime(0.19, now + 1.8);

    const compressor = this.context.createDynamicsCompressor();
    compressor.threshold.value = -22;
    compressor.knee.value = 18;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.02;
    compressor.release.value = 0.7;
    this.master.connect(compressor);
    compressor.connect(this.context.destination);

    this.droneFilter = this.context.createBiquadFilter();
    this.droneFilter.type = "lowpass";
    this.droneFilter.frequency.value = 115;
    this.droneFilter.Q.value = 0.8;
    const droneGain = this.context.createGain();
    droneGain.gain.value = 0.035;
    this.droneFilter.connect(droneGain);
    droneGain.connect(this.master);

    for (const [frequency, detune] of [
      [37, -4],
      [55, 3],
      [73, -7],
    ]) {
      const oscillator = this.context.createOscillator();
      oscillator.type = frequency === 37 ? "sine" : "triangle";
      oscillator.frequency.value = frequency;
      oscillator.detune.value = detune;
      oscillator.connect(this.droneFilter);
      oscillator.start(now);
    }

    return true;
  }

  setStage(stage) {
    if (!this.context || !this.droneFilter) return;
    const now = this.context.currentTime;
    this.droneFilter.frequency.cancelScheduledValues(now);
    this.droneFilter.frequency.linearRampToValueAtTime(115 - stage * 4.8, now + 1.2);
  }

  tone({
    startFrequency,
    endFrequency = startFrequency,
    duration,
    volume,
    type = "sine",
    delay = 0,
    pan = 0,
  }) {
    if (!this.context || this.muted) return;
    const start = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner?.();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(1, startFrequency), start);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(1, endFrequency),
      start + duration,
    );
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + Math.min(0.045, duration * 0.15));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    if (panner) {
      panner.pan.value = pan;
      gain.connect(panner);
      panner.connect(this.master);
    } else {
      gain.connect(this.master);
    }
    oscillator.start(start);
    oscillator.stop(start + duration + 0.05);
  }

  noise(duration, volume, cutoff, delay = 0) {
    if (!this.context || this.muted) return;
    const sampleCount = Math.max(1, Math.floor(this.context.sampleRate * duration));
    const buffer = this.context.createBuffer(1, sampleCount, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < sampleCount; index += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.985 + white * 0.015;
      data[index] = last;
    }
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const start = this.context.currentTime + delay;
    source.buffer = buffer;
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + duration * 0.22);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(start);
  }

  ping(stage) {
    this.tone({
      startFrequency: 1150 + stage * 22,
      endFrequency: 190 - stage * 3,
      duration: 1.05,
      volume: 0.16,
      pan: -0.12,
    });
    this.tone({
      startFrequency: 1900,
      endFrequency: 760,
      duration: 0.17,
      volume: 0.055,
      type: "triangle",
      pan: 0.14,
    });
  }

  echo(stage) {
    this.tone({
      startFrequency: 68 - stage * 1.8,
      endFrequency: 36,
      duration: 1.25 + stage * 0.035,
      volume: 0.12 + stage * 0.005,
      pan: stage % 2 ? 0.24 : -0.2,
    });
    this.noise(0.85, 0.055 + stage * 0.002, 82 + stage * 2);
  }

  passive() {
    this.tone({
      startFrequency: 42,
      endFrequency: 118,
      duration: 1.65,
      volume: 0.1,
      type: "triangle",
      pan: 0.28,
    });
  }

  answer() {
    this.tone({
      startFrequency: 31,
      endFrequency: 610,
      duration: 3.1,
      volume: 0.18,
      type: "sine",
      pan: 0,
    });
    this.tone({
      startFrequency: 43,
      endFrequency: 39,
      duration: 4.2,
      volume: 0.14,
      type: "triangle",
      delay: 0.14,
      pan: -0.18,
    });
    this.noise(3.4, 0.11, 105, 0.08);
  }

  async toggle() {
    if (!this.context) return this.muted;
    if (this.context.state === "suspended") await this.context.resume();
    this.muted = !this.muted;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(Math.max(0.0001, this.master.gain.value), now);
    this.master.gain.exponentialRampToValueAtTime(this.muted ? 0.0001 : 0.19, now + 0.16);
    return this.muted;
  }
}

const elements = {
  answer: document.getElementById("answer"),
  contact: document.getElementById("contact-value"),
  depth: document.getElementById("depth-value"),
  instruction: document.getElementById("instruction"),
  instrument: document.getElementById("instrument"),
  live: document.getElementById("live-region"),
  log: document.getElementById("reading-log"),
  mode: document.getElementById("mode-value"),
  open: document.getElementById("open-channel"),
  pulse: document.getElementById("pulse-button"),
  pulseValue: document.getElementById("pulse-value"),
  restart: document.getElementById("restart-button"),
  sound: document.getElementById("sound-toggle"),
  survey: document.getElementById("survey-code"),
  threshold: document.getElementById("threshold"),
  winch: document.getElementById("winch-value"),
};

const renderer = new AbyssRenderer(document.getElementById("abyss"));
const audio = new AudioEngine();
let started = false;
let busy = false;
let ended = false;
let stageIndex = 0;
let displayedDepth = 0;
let readings = [0];
let depthAnimation = 0;
let idleTimer = 0;
const timers = new Set();

elements.survey.textContent = surveyCode(Date.now());

function schedule(callback, delay) {
  const timer = window.setTimeout(() => {
    timers.delete(timer);
    callback();
  }, delay);
  timers.add(timer);
  return timer;
}

function clearTimers() {
  for (const timer of timers) window.clearTimeout(timer);
  timers.clear();
  window.clearTimeout(idleTimer);
  idleTimer = 0;
}

function setMode(mode) {
  elements.mode.textContent = mode;
}

function renderLog() {
  const items = readings.slice(0, 3).map((index) => {
    const reading = readingAt(index);
    const item = document.createElement("li");
    if (index >= 6) item.classList.add("alarm");

    const pulse = document.createElement("time");
    pulse.textContent = `P${formatPulse(index)}`;
    const code = document.createElement("strong");
    code.textContent = reading.code;
    const detail = document.createElement("span");
    detail.textContent = reading.detail;
    item.append(pulse, code, detail);
    return item;
  });
  elements.log.replaceChildren(...items);
}

function announce(reading, index) {
  elements.live.textContent = `Pulse ${index}. ${reading.code}. ${reading.detail}`;
}

function animateDepth(fromDepth, toDepth, duration) {
  cancelAnimationFrame(depthAnimation);
  if (reducedMotion) {
    displayedDepth = toDepth;
    elements.depth.textContent = formatDepth(toDepth);
    renderer.setDepth(toDepth);
    return;
  }

  const startedAt = performance.now();
  const frame = (now) => {
    const progress = clamp((now - startedAt) / duration, 0, 1);
    displayedDepth = depthAtProgress(fromDepth, toDepth, progress);
    elements.depth.textContent = formatDepth(displayedDepth);
    renderer.setDepth(displayedDepth);
    if (progress < 1) depthAnimation = requestAnimationFrame(frame);
  };
  depthAnimation = requestAnimationFrame(frame);
}

function updateSoundLabel() {
  if (!audio.available) {
    elements.sound.textContent = "SOUND N/A";
    elements.sound.disabled = true;
    return;
  }
  elements.sound.textContent = audio.muted ? "SOUND OFF" : "SOUND ON";
  elements.sound.setAttribute("aria-pressed", String(!audio.muted));
}

function schedulePassiveReturn() {
  window.clearTimeout(idleTimer);
  if (stageIndex < 7 || stageIndex >= READINGS.length - 1 || ended) return;
  idleTimer = window.setTimeout(() => {
    if (busy || ended) return;
    renderer.passiveReturn();
    audio.passive();
    setMode("RECEIVING");
    elements.instruction.textContent = "Something transmitted without being asked.";
    elements.live.textContent = "Uncommanded transmission received from below.";
    schedule(() => {
      if (!busy && !ended) {
        setMode("PASSIVE");
        elements.instruction.textContent = "The array is waiting. So is the contact.";
      }
    }, 2800);
  }, 7200);
}

function finishReading(index) {
  const reading = readingAt(index);
  if (index !== 6) {
    renderer.returnPulse(index);
    audio.echo(index);
  }
  readings.unshift(index);
  renderLog();
  announce(reading, index);
  elements.winch.textContent = index >= 5 ? "UNDER LOAD" : "HOLDING";
  elements.contact.textContent = index < 2 ? "NONE" : index < 7 ? "UNRESOLVED" : "CLOSING";

  if (reading.final) {
    busy = false;
    ended = true;
    document.body.classList.remove("transmitting");
    elements.pulse.hidden = true;
    elements.instruction.textContent = "Do not touch the cable.";
    setMode("LISTENING");
    schedule(() => {
      renderer.answer();
      audio.answer();
      document.body.classList.add("answered");
      elements.answer.setAttribute("aria-hidden", "false");
      setMode("RECEIVING");
      elements.live.textContent =
        "Uncommanded transmission. It knows which side of the water you are on.";
      schedule(() => {
        elements.restart.hidden = false;
        elements.instruction.textContent = "The survey is complete. The listening is not.";
      }, reducedMotion ? 100 : 2700);
    }, reducedMotion ? 180 : 1250);
    return;
  }

  busy = false;
  document.body.classList.remove("transmitting");
  elements.pulse.disabled = false;
  setMode("PASSIVE");
  elements.instruction.textContent =
    index < 6
      ? "Lower the transducer. Send another pulse."
      : "The contact is listening between transmissions.";
  schedulePassiveReturn();
}

function transmit() {
  if (!started || busy || ended) return;
  const nextIndex = stageIndex + 1;
  if (nextIndex >= READINGS.length) return;

  window.clearTimeout(idleTimer);
  busy = true;
  stageIndex = nextIndex;
  const reading = readingAt(stageIndex);
  const oldDepth = displayedDepth;
  const descentDuration = reducedMotion ? 0 : 760;
  const pulseDelay = reducedMotion ? 20 : 520;

  document.body.classList.add("transmitting");
  elements.pulse.disabled = true;
  elements.pulseValue.textContent = formatPulse(stageIndex);
  elements.winch.textContent = "LOWERING";
  elements.instruction.textContent = "The cable descends. The water holds its breath.";
  setMode("TRANSMITTING");
  renderer.setStage(stageIndex);
  audio.setStage(stageIndex);
  animateDepth(oldDepth, reading.depth, descentDuration);

  if (stageIndex === 6) {
    schedule(() => {
      renderer.returnPulse(stageIndex);
      audio.echo(stageIndex);
    }, Math.max(0, pulseDelay - 260));
  }

  schedule(() => {
    renderer.emitPulse(stageIndex);
    audio.ping(stageIndex);
  }, pulseDelay);

  schedule(
    () => finishReading(stageIndex),
    pulseDelay + (reducedMotion ? 70 : echoDelay(stageIndex)),
  );
}

async function openChannel() {
  if (started) return;
  elements.open.disabled = true;
  try {
    await audio.start();
  } catch {
    audio.available = false;
  }
  started = true;
  document.body.classList.add("started");
  elements.threshold.setAttribute("aria-hidden", "true");
  elements.instrument.setAttribute("aria-hidden", "false");
  elements.sound.disabled = !audio.available;
  updateSoundLabel();
  renderLog();
  elements.live.textContent =
    "Channel open. Passive hydrophone only. Lower the transducer and send one pulse.";
  schedule(() => elements.pulse.focus({ preventScroll: true }), 850);
}

function restart() {
  if (!ended) return;
  clearTimers();
  cancelAnimationFrame(depthAnimation);
  busy = false;
  ended = false;
  stageIndex = 0;
  displayedDepth = 0;
  readings = [0];
  document.body.classList.remove("answered", "transmitting");
  elements.answer.setAttribute("aria-hidden", "true");
  elements.restart.hidden = true;
  elements.pulse.hidden = false;
  elements.pulse.disabled = false;
  elements.depth.textContent = "0000";
  elements.pulseValue.textContent = "00";
  elements.winch.textContent = "LOCKED";
  elements.contact.textContent = "NONE";
  elements.instruction.textContent = "Lower the transducer. Send one pulse.";
  setMode("PASSIVE");
  renderer.reset();
  audio.setStage(0);
  renderLog();
  elements.live.textContent = "New sounding ready. The channel remains open.";
  elements.pulse.focus({ preventScroll: true });
}

renderer.onImpact = () => {
  if (reducedMotion) return;
  renderer.canvas.animate(
    [
      { transform: "translate(0, 0)" },
      { transform: "translate(-2px, 1px)" },
      { transform: "translate(2px, -1px)" },
      { transform: "translate(-1px, 0)" },
      { transform: "translate(0, 0)" },
    ],
    { duration: 380, easing: "ease-out" },
  );
};

elements.open.addEventListener("click", openChannel);
elements.pulse.addEventListener("click", transmit);
elements.restart.addEventListener("click", restart);
async function toggleSound() {
  try {
    await audio.toggle();
  } catch {
    audio.available = false;
  }
  updateSoundLabel();
}
elements.sound.addEventListener("click", toggleSound);

window.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === " " && started && !ended) {
    event.preventDefault();
    transmit();
  } else if (event.key.toLowerCase() === "m" && started && audio.available) {
    event.preventDefault();
    toggleSound();
  } else if (event.key.toLowerCase() === "r" && ended) {
    event.preventDefault();
    restart();
  }
});

renderLog();
