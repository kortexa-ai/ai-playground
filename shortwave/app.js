(() => {
  "use strict";

  const TAU = Math.PI * 2;
  const BAND_LO = 530;
  const BAND_HI = 1710;
  const DAY_PERIOD = 120; // seconds for a full day-night cycle
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const STATIONS = [
    { freq: 605, name: "THE CLOCK", kind: "clock" },
    { freq: 742, name: "THE WEATHER", kind: "weather" },
    { freq: 951, name: "THE TALKBACK", kind: "talkback" },
    { freq: 1210, name: "THE LULLABY", kind: "lullaby" },
    { freq: 1503, name: "THE EMPTY ROOM", kind: "empty" },
  ];

  const MORSE = {
    a: ".-", b: "-...", c: "-.-.", d: "-..", e: ".", f: "..-.", g: "--.",
    h: "....", i: "..", j: ".---", k: "-.-", l: ".-..", m: "--", n: "-.",
    o: "---", p: ".--.", q: "--.-", r: ".-.", s: "...", t: "-", u: "..-",
    v: "...-", w: ".--", x: "-..-", y: "-.--", z: "--..",
  };

  // Approximate formant targets. Voiced phonemes use the saw source;
  // unvoiced ones use the noise source through the same filter bank.
  const PHONEMES = {
    L: { f1: 390, f2: 1990, f3: 2530, voiced: true, dur: 0.09 },
    AY: { f1: 640, f2: 1190, f3: 2390, voiced: true, dur: 0.14 },
    T: { f1: 1200, f2: 2100, f3: 3000, voiced: false, dur: 0.05 },
    R: { f1: 640, f2: 1190, f3: 2390, voiced: true, dur: 0.09 },
    EY: { f1: 530, f2: 1840, f3: 2480, voiced: true, dur: 0.16 },
    N: { f1: 250, f2: 2000, f3: 3000, voiced: true, dur: 0.08 },
    M: { f1: 250, f2: 1300, f3: 2700, voiced: true, dur: 0.09 },
    OW: { f1: 570, f2: 840, f3: 2410, voiced: true, dur: 0.14 },
    V: { f1: 300, f2: 1800, f3: 2900, voiced: true, dur: 0.08 },
    IH: { f1: 390, f2: 1990, f3: 2530, voiced: true, dur: 0.1 },
    NG: { f1: 250, f2: 2000, f3: 3000, voiced: true, dur: 0.09 },
    S: { f1: 1500, f2: 2500, f3: 3500, voiced: false, dur: 0.09 },
    K: { f1: 1200, f2: 2200, f3: 3000, voiced: false, dur: 0.04 },
    AO: { f1: 730, f2: 1090, f3: 2440, voiced: true, dur: 0.14 },
    IY: { f1: 390, f2: 1990, f3: 2530, voiced: true, dur: 0.14 },
    P: { f1: 640, f2: 1190, f3: 2390, voiced: false, dur: 0.05 },
    W: { f1: 300, f2: 1800, f3: 2900, voiced: true, dur: 0.09 },
    EH: { f1: 530, f2: 1840, f3: 2480, voiced: true, dur: 0.1 },
  };

  // The report the weather station reads, over and over, about a place
  // that does not exist.
  const REPORT = [
    ["LIGHT", "RAIN"],
    ["MOVING", "EAST"],
    ["SEA", "CALM"],
    ["SLEEP", "WELL"],
  ];
  const WORDS = {
    LIGHT: "L AY T",
    RAIN: "R EY N",
    MOVING: "M OW V IH NG",
    EAST: "EY S T",
    SEA: "S EY",
    CALM: "K AO L M",
    SLEEP: "S L IY P",
    WELL: "W EH L",
  };
  const DEFAULT_WORDS = ["HOME", "SLEEP", "LANTERN", "SEA"];

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }
  function smoothstep(x) {
    x = clamp(x, 0, 1);
    return x * x * (3 - 2 * x);
  }
  function hash01(n) {
    let x = (n + 1) * 0x9e3779b1;
    x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
    x = Math.imul(x ^ (x >>> 12), 0x297a2d39);
    return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
  }

  // ---------- state ----------
  let dial = 951;
  let volume = 0.72;
  let power = false;
  let dayPhase = 0.62; // start at dusk
  const dayStart = performance.now();
  let meter = 0;
  let locked = null;
  let transcript = "";

  function nightFactor() {
    const phase = (dayPhase + (performance.now() - dayStart) / 1000 / DAY_PERIOD) % 1;
    const sun = (1 + Math.cos(phase * TAU)) / 2;
    return 1 - smoothstep(sun);
  }

  function strength(dialFreq, stationFreq) {
    const night = nightFactor();
    const sigma = 16 + 8 * night;
    const d = dialFreq - stationFreq;
    return Math.exp(-(d * d) / (2 * sigma * sigma));
  }

  // ---------- dom ----------
  const spectrum = document.getElementById("spectrum");
  const sctx = spectrum.getContext("2d");
  const meterCanvas = document.getElementById("meter");
  const mctx = meterCanvas.getContext("2d");
  const freqEl = document.getElementById("freq");
  const stationEl = document.getElementById("station");
  const tuneKnob = document.getElementById("tune");
  const volumeKnob = document.getElementById("volume");
  const powerBtn = document.getElementById("power");
  const transcriptEl = document.getElementById("transcript");
  const sendLed = document.getElementById("send-led");

  // ---------- audio ----------
  let ctx = null;
  let master = null;
  let staticFilter = null;
  let staticGain = null;
  let whistleOsc = null;
  let whistleGain = null;
  let schedTimer = null;
  let built = [];

  function makeNoiseBuffer(seconds, brown) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      } else {
        data[i] = white;
      }
    }
    return buf;
  }

  // A tiny event-window helper: stations record [start, end] windows of
  // activity so the s-meter and the spectrum can see what is happening.
  function makeWindows() {
    const windows = [];
    return {
      push(t, dur) {
        windows.push([t, t + dur]);
        while (windows.length > 64 && ctx.currentTime - windows[0][1] > 2) {
          windows.shift();
        }
      },
      active() {
        const now = ctx.currentTime;
        for (const [a, b] of windows) if (now >= a && now < b) return true;
        return false;
      },
    };
  }

  function buildClock(station) {
    const bus = ctx.createGain();
    bus.gain.value = 1;
    const hum = ctx.createOscillator();
    hum.type = "sine";
    hum.frequency.value = 96;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.1;
    hum.connect(humGain).connect(bus);
    hum.start();
    const tickBuf = makeNoiseBuffer(0.03);
    let nextTick = ctx.currentTime + 0.2;
    let lastMinute = new Date().getMinutes();
    function chime(t) {
      const partials = [
        [660, 0.16, 2.4],
        [990, 0.09, 1.8],
        [1320, 0.05, 1.2],
      ];
      for (const [f, a, dec] of partials) {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(a, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
        o.connect(g).connect(bus);
        o.start(t);
        o.stop(t + dec + 0.1);
      }
      station.windows.push(t, 1.2);
    }
    station.schedule = (now, horizon) => {
      while (nextTick < now + horizon) {
        const src = ctx.createBufferSource();
        src.buffer = tickBuf;
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 2600;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.4, nextTick);
        g.gain.exponentialRampToValueAtTime(0.001, nextTick + 0.025);
        src.connect(hp).connect(g).connect(bus);
        src.start(nextTick);
        src.stop(nextTick + 0.03);
        const d = new Date(nextTick * 1000);
        if (d.getMinutes() !== lastMinute) {
          chime(nextTick);
          lastMinute = d.getMinutes();
        }
        station.windows.push(nextTick, 0.06);
        nextTick += 1;
      }
    };
    station.activity = () => 1;
    bus.connect(station.gain);
  }

  function buildWeather(station) {
    const bus = ctx.createGain();
    bus.gain.value = 1;
    const saw = ctx.createOscillator();
    saw.type = "sawtooth";
    saw.frequency.value = 112;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.4;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 6;
    lfo.connect(lfoGain).connect(saw.frequency);
    const noise = ctx.createBufferSource();
    noise.buffer = makeNoiseBuffer(2);
    noise.loop = true;
    const voicedGain = ctx.createGain();
    voicedGain.gain.value = 0;
    const unvoicedGain = ctx.createGain();
    unvoicedGain.gain.value = 0;
    saw.connect(voicedGain);
    noise.connect(unvoicedGain);
    const formants = [
      { f: 600, q: 9, g: 1.0 },
      { f: 1400, q: 11, g: 0.55 },
      { f: 2600, q: 12, g: 0.28 },
    ].map((cfg) => {
      const flt = ctx.createBiquadFilter();
      flt.type = "bandpass";
      flt.frequency.value = cfg.f;
      flt.Q.value = cfg.q;
      const g = ctx.createGain();
      g.gain.value = cfg.g;
      voicedGain.connect(flt);
      unvoicedGain.connect(flt);
      flt.connect(g);
      return { flt };
    });
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 3400;
    for (const f of formants) f.flt.connect(tone);
    const voiceOut = ctx.createGain();
    voiceOut.gain.value = 0.9;
    tone.connect(voiceOut).connect(bus);
    saw.start();
    noise.start();
    lfo.start();

    const seq = [];
    for (const phrase of REPORT) {
      for (const word of phrase) {
        for (const p of WORDS[word].split(" ")) seq.push({ ph: p });
        seq.push({ pause: 0.16 });
      }
      seq.push({ pause: 0.55 });
    }
    seq.push({ pause: 3.0 });
    let idx = 0;
    let nextT = ctx.currentTime + 0.5;
    station.schedule = (now, horizon) => {
      while (nextT < now + horizon) {
        const item = seq[idx % seq.length];
        if (item.pause) {
          nextT += item.pause;
          idx += 1;
          continue;
        }
        const p = PHONEMES[item.ph];
        const t = nextT;
        formants[0].flt.frequency.setTargetAtTime(p.f1, t, 0.025);
        formants[1].flt.frequency.setTargetAtTime(p.f2, t, 0.025);
        formants[2].flt.frequency.setTargetAtTime(p.f3, t, 0.025);
        if (p.voiced) {
          voicedGain.gain.setTargetAtTime(0.85, t, 0.02);
          voicedGain.gain.setTargetAtTime(0, t + p.dur, 0.035);
          unvoicedGain.gain.setTargetAtTime(0, t, 0.02);
        } else {
          unvoicedGain.gain.setTargetAtTime(0.5, t, 0.02);
          unvoicedGain.gain.setTargetAtTime(0, t + p.dur, 0.035);
          voicedGain.gain.setTargetAtTime(0, t, 0.02);
        }
        saw.frequency.setTargetAtTime(112 * (0.94 + 0.12 * hash01(idx)), t, 0.03);
        if (p.voiced) station.windows.push(t, p.dur);
        nextT += p.dur;
        idx += 1;
      }
    };
    station.activity = () => (station.windows.active() ? 1 : 0.12);
    bus.connect(station.gain);
  }

  function buildTalkback(station) {
    const bus = ctx.createGain();
    bus.gain.value = 1;
    const tone = ctx.createOscillator();
    tone.type = "sine";
    tone.frequency.value = 640;
    const key = ctx.createGain();
    key.gain.value = 0;
    tone.connect(key).connect(bus);
    tone.start();
    const DOT = 0.07;
    const GAP = 0.07;
    const queue = [];
    let wordNo = 0;
    let charIdx = 0;
    let nextKey = ctx.currentTime + 0.6;
    station.enqueue = (ch) => {
      if (queue.length < 64) queue.push(ch);
    };
    station.queueLength = () => queue.length;
    station.schedule = (now, horizon) => {
      while (nextKey < now + horizon) {
        let ch;
        let fromUser = false;
        if (queue.length) {
          ch = queue.shift();
          fromUser = true;
        } else {
          const w = DEFAULT_WORDS[wordNo % DEFAULT_WORDS.length];
          ch = w[charIdx % w.length];
        }
        const code = ch === " " ? "" : MORSE[ch] || "";
        let t = nextKey;
        for (let i = 0; i < code.length; i++) {
          const dur = code[i] === "." ? DOT : DOT * 3;
          key.gain.setTargetAtTime(0.7, t, 0.008);
          key.gain.setTargetAtTime(0, t + dur, 0.008);
          station.windows.push(t, dur);
          t += dur + GAP;
        }
        if (fromUser) {
          t += GAP * 2;
          charIdx = 0;
        } else {
          charIdx += 1;
          const w = DEFAULT_WORDS[wordNo % DEFAULT_WORDS.length];
          if (charIdx >= w.length) {
            charIdx = 0;
            wordNo += 1;
            t += GAP * 6;
          }
        }
        nextKey = t;
      }
    };
    station.activity = () => (station.windows.active() ? 1 : 0.06);
    bus.connect(station.gain);
  }

  function buildLullaby(station) {
    const bus = ctx.createGain();
    bus.gain.value = 1;
    const SCALE = [220, 261.63, 293.66, 329.63, 392, 440, 523.25];
    let noteIdx = 2;
    let nextNote = ctx.currentTime + 0.6;
    function note(t, f, dur, gain, type) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.35);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(bus);
      o.start(t);
      o.stop(t + dur + 0.1);
      station.windows.push(t, dur);
    }
    station.schedule = (now, horizon) => {
      while (nextNote < now + horizon) {
        const r = Math.random();
        noteIdx = clamp(
          noteIdx + (r < 0.4 ? 0 : r < 0.72 ? 1 : -1),
          0,
          SCALE.length - 1,
        );
        if (Math.random() < 0.18) noteIdx = 0;
        const f = SCALE[noteIdx];
        note(nextNote, f, 2.3, 0.16, "sine");
        if (Math.random() < 0.4) note(nextNote + 1.1, f / 2, 2.5, 0.1, "triangle");
        nextNote += 1.9 + Math.random() * 0.7;
      }
    };
    const sea = ctx.createBufferSource();
    sea.buffer = makeNoiseBuffer(4, true);
    sea.loop = true;
    const seaFilt = ctx.createBiquadFilter();
    seaFilt.type = "lowpass";
    seaFilt.frequency.value = 320;
    const seaLfo = ctx.createOscillator();
    seaLfo.frequency.value = 0.06;
    const seaLfoGain = ctx.createGain();
    seaLfoGain.gain.value = 140;
    seaLfo.connect(seaLfoGain).connect(seaFilt.frequency);
    const seaGain = ctx.createGain();
    seaGain.gain.value = 0.12;
    sea.connect(seaFilt).connect(seaGain).connect(bus);
    sea.start();
    seaLfo.start();
    station.activity = () => (station.windows.active() ? 1 : 0.45);
    bus.connect(station.gain);
  }

  function buildEmpty(station) {
    const bus = ctx.createGain();
    bus.gain.value = 1;
    const hum = ctx.createOscillator();
    hum.type = "sine";
    hum.frequency.value = 402;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.05;
    hum.connect(humGain).connect(bus);
    hum.start();
    let nextTap = ctx.currentTime + 2;
    station.schedule = (now, horizon) => {
      while (nextTap < now + horizon) {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = 880;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.12, nextTap);
        g.gain.exponentialRampToValueAtTime(0.0001, nextTap + 0.05);
        o.connect(g).connect(bus);
        o.start(nextTap);
        o.stop(nextTap + 0.06);
        station.windows.push(nextTap, 0.08);
        nextTap += 7;
      }
    };
    station.activity = () => (station.windows.active() ? 1 : 0.4);
    bus.connect(station.gain);
  }

  const BUILDERS = {
    clock: buildClock,
    weather: buildWeather,
    talkback: buildTalkback,
    lullaby: buildLullaby,
    empty: buildEmpty,
  };

  function buildAudio() {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);

    const staticSrc = ctx.createBufferSource();
    staticSrc.buffer = makeNoiseBuffer(2);
    staticSrc.loop = true;
    staticFilter = ctx.createBiquadFilter();
    staticFilter.type = "bandpass";
    staticFilter.frequency.value = 400;
    staticFilter.Q.value = 0.9;
    staticGain = ctx.createGain();
    staticGain.gain.value = 0.05;
    staticSrc.connect(staticFilter).connect(staticGain).connect(master);
    staticSrc.start();

    whistleOsc = ctx.createOscillator();
    whistleOsc.type = "sine";
    whistleOsc.frequency.value = 60;
    whistleGain = ctx.createGain();
    whistleGain.gain.value = 0;
    whistleOsc.connect(whistleGain).connect(master);
    whistleOsc.start();

    built = STATIONS.map((def) => {
      const st = { ...def, windows: makeWindows() };
      st.gain = ctx.createGain();
      st.gain.gain.value = 0;
      st.gain.connect(master);
      BUILDERS[def.kind](st);
      return st;
    });
  }

  function thunk() {
    const src = ctx.createBufferSource();
    src.buffer = makeNoiseBuffer(0.09);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 320;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09);
    src.connect(lp).connect(g).connect(master);
    src.start();
  }

  function mapToAudio(freq) {
    const t = (Math.log(freq) - Math.log(BAND_LO)) / (Math.log(BAND_HI) - Math.log(BAND_LO));
    return 120 + t * 600;
  }

  function updateAudio() {
    if (!ctx || !power) return;
    const now = ctx.currentTime;
    const night = nightFactor();
    const sky = 1 + 0.75 * night;

    staticFilter.frequency.setTargetAtTime(mapToAudio(dial), now, 0.06);
    staticGain.gain.setTargetAtTime(0.05 - 0.018 * night, now, 0.1);

    let signal = 0.1;
    for (const st of built) {
      const s = strength(dial, st.freq) * sky;
      const a = st.activity ? st.activity() : 1;
      st.gain.gain.setTargetAtTime(s * (0.25 + 0.75 * a) * 0.85, now, 0.05);
      signal += s * (0.25 + 0.75 * a);
    }

    let best = null;
    let bestD = Infinity;
    for (const st of STATIONS) {
      const d = Math.abs(dial - st.freq);
      if (d < bestD) {
        bestD = d;
        best = st;
      }
    }
    if (bestD < 45) {
      const closeness = 1 - bestD / 45;
      whistleOsc.frequency.setTargetAtTime(30 + bestD * 2.4, now, 0.08);
      whistleGain.gain.setTargetAtTime(
        0.05 * closeness * closeness,
        now,
        0.08,
      );
    } else {
      whistleGain.gain.setTargetAtTime(0, now, 0.08);
    }

    master.gain.setTargetAtTime(volume * 0.9, now, 0.03);
    meter += (clamp(signal, 0, 1) - meter) * 0.08;

    locked = null;
    for (const st of STATIONS) {
      if (strength(dial, st.freq) > 0.55) locked = st;
    }
  }

  function startScheduler() {
    stopScheduler();
    schedTimer = setInterval(() => {
      if (!power || !ctx) return;
      const now = ctx.currentTime;
      for (const st of built) st.schedule(now, 0.45);
    }, 90);
  }
  function stopScheduler() {
    if (schedTimer) {
      clearInterval(schedTimer);
      schedTimer = null;
    }
  }

  async function togglePower() {
    if (!power) {
      if (!ctx) buildAudio();
      await ctx.resume();
      power = true;
      startScheduler();
      thunk();
    } else {
      power = false;
      stopScheduler();
      await ctx.suspend();
    }
    powerBtn.setAttribute("aria-pressed", String(power));
    powerBtn.classList.toggle("on", power);
  }
  powerBtn.addEventListener("click", togglePower);

  // ---------- knobs ----------
  function makeKnob(el, min, max, initial, onChange) {
    let value = initial;
    let dragging = false;
    let startY = 0;
    let startVal = 0;
    const render = () => {
      const t = (value - min) / (max - min);
      el.style.setProperty("--angle", (-135 + t * 270).toFixed(1) + "deg");
      el.setAttribute("aria-valuenow", value.toFixed(0));
    };
    el.addEventListener("pointerdown", (e) => {
      dragging = true;
      startY = e.clientY;
      startVal = value;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      value = clamp(startVal + (startY - e.clientY) * ((max - min) / 260), min, max);
      onChange(value);
      render();
    });
    const end = () => {
      dragging = false;
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      value = clamp(value - Math.sign(e.deltaY) * ((max - min) / 120), min, max);
      onChange(value);
      render();
    }, { passive: false });
    el.addEventListener("keydown", (e) => {
      const step = (max - min) / 120;
      if (e.key === "ArrowUp" || e.key === "ArrowRight") value = clamp(value + step, min, max);
      else if (e.key === "ArrowDown" || e.key === "ArrowLeft") value = clamp(value - step, min, max);
      else return;
      e.preventDefault();
      e.stopPropagation();
      onChange(value);
      render();
    });
    render();
    return {
      get value() {
        return value;
      },
      set(v) {
        value = clamp(v, min, max);
        onChange(value);
        render();
      },
    };
  }

  const tune = makeKnob(tuneKnob, BAND_LO, BAND_HI, dial, (v) => {
    dial = v;
  });
  const vol = makeKnob(volumeKnob, 0, 1, volume, (v) => {
    volume = v;
  });

  // ---------- typing ----------
  addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "ArrowLeft") {
      dial = clamp(dial - (e.shiftKey ? 1 : 5), BAND_LO, BAND_HI);
      tune.set(dial);
      e.preventDefault();
      return;
    }
    if (e.key === "ArrowRight") {
      dial = clamp(dial + (e.shiftKey ? 1 : 5), BAND_LO, BAND_HI);
      tune.set(dial);
      e.preventDefault();
      return;
    }
    if (!power) return;
    const talkback = built.find((s) => s.kind === "talkback");
    if (!talkback) return;
    if (/^[a-z]$/i.test(e.key)) {
      talkback.enqueue(e.key.toLowerCase());
      transcript += e.key.toLowerCase();
      if (transcript.length > 46) transcript = transcript.slice(-46);
      renderTranscript();
    } else if (e.key === " ") {
      e.preventDefault();
      talkback.enqueue(" ");
      transcript += " ";
      if (transcript.length > 46) transcript = transcript.slice(-46);
      renderTranscript();
    }
  });

  function renderTranscript() {
    transcriptEl.textContent = transcript || "· · ·";
    const talkback = built.find((s) => s.kind === "talkback");
    sendLed.classList.toggle("lit", !!talkback && talkback.queueLength() > 0);
  }

  // ---------- spectrum canvas ----------
  let sw = 1;
  let sh = 1;
  let sdpr = 1;
  const COLS = 140;
  const floor = new Array(COLS).fill(0.06);
  const stars = Array.from({ length: 42 }, (_, i) => ({
    x: hash01(i * 3 + 1),
    y: hash01(i * 3 + 2) * 0.55,
    s: 0.5 + hash01(i * 3 + 3) * 0.9,
    tw: hash01(i * 7 + 4) * TAU,
  }));

  function resizeSpectrum() {
    const rect = spectrum.getBoundingClientRect();
    sdpr = Math.min(devicePixelRatio || 1, 2);
    sw = Math.max(1, Math.round(rect.width));
    sh = Math.max(1, Math.round(rect.height));
    spectrum.width = Math.round(sw * sdpr);
    spectrum.height = Math.round(sh * sdpr);
    sctx.setTransform(sdpr, 0, 0, sdpr, 0, 0);
  }

  function freqToX(f) {
    return ((f - BAND_LO) / (BAND_HI - BAND_LO)) * sw;
  }

  let frame = 0;
  function drawSpectrum() {
    frame += 1;
    const night = nightFactor();
    const sky = 1 + 0.75 * night;
    sctx.setTransform(sdpr, 0, 0, sdpr, 0, 0);

    const bg = sctx.createLinearGradient(0, 0, 0, sh);
    bg.addColorStop(0, night > 0.5 ? "#05060b" : "#0b0e15");
    bg.addColorStop(1, night > 0.5 ? "#030408" : "#07090f");
    sctx.fillStyle = bg;
    sctx.fillRect(0, 0, sw, sh);

    if (night > 0.15) {
      for (const st of stars) {
        const twinkle = reducedMotion
          ? 0.7
          : 0.55 + 0.45 * Math.sin(frame * 0.02 + st.tw);
        sctx.fillStyle = "rgba(214, 224, 240, " + (0.35 * night * twinkle).toFixed(3) + ")";
        sctx.fillRect(st.x * sw, st.y * sh, st.s, st.s);
      }
    }

    // grid
    sctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    sctx.lineWidth = 1;
    sctx.font = "9px ui-monospace, Menlo, monospace";
    sctx.fillStyle = "rgba(255, 255, 255, 0.28)";
    for (let f = 600; f <= 1700; f += 100) {
      const x = Math.round(freqToX(f)) + 0.5;
      sctx.beginPath();
      sctx.moveTo(x, sh - 14);
      sctx.lineTo(x, sh - 8);
      sctx.stroke();
      if (f % 200 === 0) sctx.fillText(String(f / 100), x - 3, sh - 2);
    }

    // noise floor
    if (frame % (reducedMotion ? 6 : 2) === 0) {
      for (let i = 0; i < COLS; i++) {
        floor[i] = clamp(floor[i] + (Math.random() - 0.5) * 0.018, 0.02, 0.14);
      }
    }

    // trace: floor + station peaks
    const baseY = sh - 14;
    const scale = sh - 26;
    sctx.beginPath();
    sctx.moveTo(0, baseY);
    for (let i = 0; i < COLS; i++) {
      const f = BAND_LO + (i / (COLS - 1)) * (BAND_HI - BAND_LO);
      let level = floor[i];
      for (const st of STATIONS) {
        const s = strength(f, st.freq) * sky;
        const a = built.length && power ? built.find((b) => b.freq === st.freq).activity() : 0.5;
        level += s * (0.3 + 0.7 * a) * 0.8;
      }
      const y = baseY - clamp(level, 0, 1) * scale;
      sctx.lineTo((i / (COLS - 1)) * sw, y);
    }
    sctx.lineTo(sw, baseY);
    sctx.closePath();
    const fill = sctx.createLinearGradient(0, 0, 0, baseY);
    fill.addColorStop(0, "rgba(232, 160, 92, 0.34)");
    fill.addColorStop(1, "rgba(232, 160, 92, 0.03)");
    sctx.fillStyle = fill;
    sctx.fill();
    sctx.strokeStyle = "rgba(232, 160, 92, 0.75)";
    sctx.lineWidth = 1;
    sctx.stroke();

    // needle
    const nx = freqToX(dial);
    const glow = locked ? 1 : 0.45;
    sctx.save();
    if (!reducedMotion) {
      sctx.shadowColor = "rgba(255, 217, 160, " + (0.5 * glow).toFixed(3) + ")";
      sctx.shadowBlur = 8 * glow;
    }
    sctx.strokeStyle = "rgba(255, 217, 160, " + (0.55 + 0.45 * glow).toFixed(3) + ")";
    sctx.lineWidth = 1.4;
    sctx.beginPath();
    sctx.moveTo(nx, 6);
    sctx.lineTo(nx, baseY);
    sctx.stroke();
    sctx.restore();
    sctx.fillStyle = "rgba(255, 217, 160, 0.9)";
    sctx.beginPath();
    sctx.moveTo(nx - 4, 2);
    sctx.lineTo(nx + 4, 2);
    sctx.lineTo(nx, 8);
    sctx.closePath();
    sctx.fill();

    // sun / moon
    const cx = sw - 22;
    const cy = 20;
    if (night > 0.5) {
      sctx.fillStyle = "rgba(214, 224, 240, 0.8)";
      sctx.beginPath();
      sctx.arc(cx, cy, 6, 0, TAU);
      sctx.fill();
      sctx.fillStyle = night > 0.5 ? "#05060b" : "#0b0e15";
      sctx.beginPath();
      sctx.arc(cx - 3.5, cy - 2, 5.2, 0, TAU);
      sctx.fill();
    } else {
      sctx.fillStyle = "rgba(232, 160, 92, 0.85)";
      sctx.beginPath();
      sctx.arc(cx, cy, 6, 0, TAU);
      sctx.fill();
    }
  }

  // ---------- s-meter ----------
  let mw = 1;
  let mh = 1;
  let mdpr = 1;
  function resizeMeter() {
    const rect = meterCanvas.getBoundingClientRect();
    mdpr = Math.min(devicePixelRatio || 1, 2);
    mw = Math.max(1, Math.round(rect.width));
    mh = Math.max(1, Math.round(rect.height));
    meterCanvas.width = Math.round(mw * mdpr);
    meterCanvas.height = Math.round(mh * mdpr);
    mctx.setTransform(mdpr, 0, 0, mdpr, 0, 0);
  }

  function drawMeter() {
    mctx.setTransform(mdpr, 0, 0, mdpr, 0, 0);
    mctx.clearRect(0, 0, mw, mh);
    const cx = mw / 2;
    const cy = mh - 6;
    const r = Math.min(mw / 2 - 6, mh - 12);
    const a0 = -Math.PI * 0.75;
    const a1 = Math.PI * 0.75;
    mctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
    mctx.lineWidth = 2;
    mctx.beginPath();
    mctx.arc(cx, cy, r, a0, a1);
    mctx.stroke();
    mctx.strokeStyle = "rgba(217, 98, 67, 0.55)";
    mctx.beginPath();
    mctx.arc(cx, cy, r, Math.PI * 0.42, a1);
    mctx.stroke();
    for (let i = 0; i <= 8; i++) {
      const a = a0 + ((a1 - a0) * i) / 8;
      mctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
      mctx.lineWidth = 1;
      mctx.beginPath();
      mctx.moveTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4));
      mctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      mctx.stroke();
    }
    const na = a0 + (a1 - a0) * clamp(meter, 0, 1);
    mctx.strokeStyle = "rgba(255, 217, 160, 0.9)";
    mctx.lineWidth = 1.6;
    mctx.beginPath();
    mctx.moveTo(cx, cy);
    mctx.lineTo(cx + Math.cos(na) * (r - 2), cy + Math.sin(na) * (r - 2));
    mctx.stroke();
    mctx.fillStyle = "rgba(255, 217, 160, 0.9)";
    mctx.beginPath();
    mctx.arc(cx, cy, 2.4, 0, TAU);
    mctx.fill();
  }

  // ---------- readout ----------
  function renderReadout() {
    if (!power) {
      freqEl.textContent = "-- --";
      stationEl.textContent = "NO CARRIER";
      return;
    }
    freqEl.textContent = String(Math.round(dial)).padStart(4, "0");
    stationEl.textContent = locked ? locked.name : "· · ·";
    stationEl.classList.toggle("locked", !!locked);
  }

  // ---------- main loop ----------
  function loop() {
    updateAudio();
    drawSpectrum();
    drawMeter();
    renderReadout();
    requestAnimationFrame(loop);
  }

  addEventListener("resize", () => {
    resizeSpectrum();
    resizeMeter();
  });
  resizeSpectrum();
  resizeMeter();
  renderTranscript();
  requestAnimationFrame(loop);
})();
