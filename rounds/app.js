/* Rounds — a wheel that answers itself. Zero dependencies, one canvas. */
(() => {
  "use strict";

  const Canon = window.Canon;
  const TAU = Math.PI * 2;
  const STORAGE_KEY = "rounds-wheel-v1";
  const LOOKAHEAD = 0.15;
  const TICK_MS = 25;

  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  const canvas = document.getElementById("wheel");
  const context = canvas.getContext("2d");
  const statusLine = document.getElementById("status");
  const voiceReadout = document.getElementById("voice-readout");
  const tempoInput = document.getElementById("tempo");
  const tempoReadout = document.getElementById("tempo-readout");
  const growToggle = document.getElementById("grow");
  const playButton = document.getElementById("play");
  const clearButton = document.getElementById("clear");

  let state = load();
  let audio = null;
  let started = false;

  // Wheel position is derived from the audio clock, never from frame counts.
  let absoluteStep = 0;
  let nextStepTime = 0;
  let tickTimer = 0;

  const pending = [];
  const ripples = [];
  const litCells = new Map();
  let clearArmed = false;
  let geometry = { cx: 0, cy: 0, inner: 0, outer: 0, gap: 0 };

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return Canon.deserialize(JSON.parse(raw));
    } catch {
      // A corrupt wheel is not worth a broken page.
    }
    return Canon.seedPattern(Canon.createState());
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Canon.serialize(state)));
    } catch {
      // Private browsing, quota, whatever — the wheel still turns.
    }
  }

  /* ---------------------------------------------------------------- sound */

  function makeAudio() {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return null;
    const ctx = new Context();

    const master = ctx.createGain();
    master.gain.value = 0.9;

    const softener = ctx.createDynamicsCompressor();
    softener.threshold.value = -18;
    softener.ratio.value = 3;
    softener.attack.value = 0.006;
    softener.release.value = 0.22;

    // A short feedback delay standing in for a room. Cheaper than a convolver
    // and it never has to load anything.
    const delay = ctx.createDelay(1.2);
    delay.delayTime.value = 0.26;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.36;
    const damp = ctx.createBiquadFilter();
    damp.type = "lowpass";
    damp.frequency.value = 2300;
    const wet = ctx.createGain();
    wet.gain.value = 0.32;

    delay.connect(damp);
    damp.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    wet.connect(master);
    master.connect(softener);
    softener.connect(ctx.destination);

    return { ctx, master, delay };
  }

  function playNote(note, when) {
    if (!audio) return;
    const { ctx, master, delay } = audio;
    const length = 1.5 + note.gain * 0.7;

    const envelope = ctx.createGain();
    const peak = 0.15 * note.gain;
    envelope.gain.setValueAtTime(0.0001, when);
    envelope.gain.exponentialRampToValueAtTime(peak, when + 0.014);
    envelope.gain.exponentialRampToValueAtTime(0.0001, when + length);

    const colour = ctx.createBiquadFilter();
    colour.type = "lowpass";
    colour.frequency.setValueAtTime(
      Math.min(7200, note.frequency * 7.5),
      when,
    );
    colour.frequency.exponentialRampToValueAtTime(
      Math.max(280, note.frequency * 1.6),
      when + length,
    );
    colour.Q.value = 0.8;

    const body = ctx.createOscillator();
    body.type = note.wave;
    body.frequency.value = note.frequency;

    // A quiet octave gives the tone a struck, bell-like edge.
    const shimmer = ctx.createOscillator();
    shimmer.type = "sine";
    shimmer.frequency.value = note.frequency * 2;
    const shimmerGain = ctx.createGain();
    shimmerGain.gain.value = 0.13;

    body.connect(colour);
    shimmer.connect(shimmerGain);
    shimmerGain.connect(colour);
    colour.connect(envelope);
    envelope.connect(master);
    envelope.connect(delay);

    body.start(when);
    shimmer.start(when);
    body.stop(when + length + 0.05);
    shimmer.stop(when + length + 0.05);
  }

  /* ------------------------------------------------------------ the clock */

  function scheduleStep(step, when) {
    for (const note of Canon.notesAtStep(state, step)) {
      playNote(note, when);
      pending.push({ note, when });
    }
  }

  function tick() {
    if (!audio || !state.playing) return;
    const { ctx } = audio;

    while (nextStepTime < ctx.currentTime + LOOKAHEAD) {
      scheduleStep(absoluteStep, nextStepTime);
      nextStepTime += Canon.stepDuration(state);
      absoluteStep += 1;

      if (absoluteStep % state.steps === 0) {
        state.turns += 1;
        if (Canon.shouldGrow(state)) {
          state.voiceCount += 1;
          state.turns = 0;
          announceVoice();
          save();
        }
      }
    }
  }

  function announceVoice() {
    const voice = Canon.VOICES[state.voiceCount - 1];
    say(voice ? `“${voice.name}” joins — ${state.voiceCount} voices` : "");
    renderControls();
  }

  /** Smooth wheel position in steps, read straight off the audio clock. */
  function playhead() {
    if (!audio || !state.playing) return absoluteStep % state.steps;
    const remaining = nextStepTime - audio.ctx.currentTime;
    const position = absoluteStep - remaining / Canon.stepDuration(state);
    return ((position % state.steps) + state.steps) % state.steps;
  }

  async function start() {
    if (!audio) audio = makeAudio();
    if (!audio) {
      say("this browser has no Web Audio — the wheel will turn in silence");
      return;
    }
    if (audio.ctx.state === "suspended") await audio.ctx.resume();

    started = true;
    state.playing = true;
    absoluteStep = 0;
    state.turns = 0;
    nextStepTime = audio.ctx.currentTime + 0.06;
    clearInterval(tickTimer);
    tickTimer = setInterval(tick, TICK_MS);
    renderControls();
    say("");
  }

  function stop() {
    state.playing = false;
    clearInterval(tickTimer);
    tickTimer = 0;
    renderControls();
  }

  function togglePlay() {
    if (state.playing) stop();
    else void start();
  }

  /* ------------------------------------------------------------- geometry */

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    geometry = Canon.makeGeometry(
      rect.width,
      rect.height,
      state.steps,
      state.rings,
    );
  }

  function cellCentre(step, ring) {
    return Canon.cellCentre(geometry, step, ring);
  }

  function cellAt(x, y) {
    return Canon.cellAt(geometry, x, y);
  }

  /* --------------------------------------------------------------- render */

  function draw() {
    const { cx, cy, inner, outer, gap, width, height } = geometry;
    const now = audio ? audio.ctx.currentTime : 0;

    const sky = context.createRadialGradient(cx, cy, inner * 0.2, cx, cy, outer * 1.7);
    sky.addColorStop(0, "#141a2b");
    sky.addColorStop(0.55, "#0c1020");
    sky.addColorStop(1, "#070912");
    context.fillStyle = sky;
    context.fillRect(0, 0, width, height);

    // Notes that have just sounded become light.
    while (pending.length && pending[0].when <= now) {
      const { note } = pending.shift();
      litCells.set(note.patternStep + ":" + note.ring + ":" + note.voice, {
        note,
        at: now,
      });
      if (!reducedMotion) ripples.push({ note, at: now });
    }

    const head = playhead();

    context.save();
    context.globalCompositeOperation = "lighter";

    // Rings and spokes: the paper the phrase is written on.
    context.strokeStyle = "rgba(150, 178, 226, 0.055)";
    context.lineWidth = 1;
    for (let ring = 0; ring <= state.rings; ring++) {
      context.beginPath();
      context.arc(cx, cy, inner + ring * gap, 0, TAU);
      context.stroke();
    }
    for (let step = 0; step < state.steps; step++) {
      const angle = (step / state.steps) * TAU - Math.PI / 2;
      const strong = step % 4 === 0;
      context.strokeStyle = strong
        ? "rgba(160, 188, 236, 0.13)"
        : "rgba(150, 178, 226, 0.05)";
      context.beginPath();
      context.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      context.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
      context.stroke();
    }

    // Where each voice is currently reading. This is the canon, made visible.
    const active = Math.min(state.voiceCount, Canon.VOICES.length);
    for (let index = active - 1; index >= 0; index--) {
      const voice = Canon.VOICES[index];
      const readAngle =
        (((head - voice.delay) / state.steps) % 1) * TAU - Math.PI / 2;
      const alpha = index === 0 ? 0.5 : 0.24;
      context.strokeStyle = `hsla(${voice.hue}, 78%, 66%, ${alpha})`;
      context.lineWidth = index === 0 ? 2 : 1.2;
      context.beginPath();
      context.moveTo(
        cx + Math.cos(readAngle) * (outer + 4),
        cy + Math.sin(readAngle) * (outer + 4),
      );
      context.lineTo(
        cx + Math.cos(readAngle) * (outer + 15 + (active - index) * 3),
        cy + Math.sin(readAngle) * (outer + 15 + (active - index) * 3),
      );
      context.stroke();
    }

    // The written phrase.
    for (let step = 0; step < state.steps; step++) {
      for (let ring = 0; ring < state.rings; ring++) {
        const point = cellCentre(step, ring);
        const on = Canon.hasCell(state, step, ring);
        const size = gap * 0.3;

        if (!on) {
          context.fillStyle = "rgba(150, 178, 226, 0.09)";
          context.beginPath();
          context.arc(point.x, point.y, Math.max(0.8, size * 0.24), 0, TAU);
          context.fill();
          continue;
        }

        let glow = 0;
        let hue = Canon.VOICES[0].hue;
        for (let index = 0; index < active; index++) {
          const lit = litCells.get(step + ":" + ring + ":" + index);
          if (!lit) continue;
          const age = now - lit.at;
          if (age < 0 || age > 1.1) continue;
          const strength = (1 - age / 1.1) * lit.note.gain;
          if (strength > glow) {
            glow = strength;
            hue = lit.note.hue;
          }
        }

        context.fillStyle = `hsla(${hue}, ${58 + glow * 34}%, ${
          62 + glow * 26
        }%, ${0.5 + glow * 0.5})`;
        context.beginPath();
        context.arc(point.x, point.y, size * (0.62 + glow * 0.5), 0, TAU);
        context.fill();

        if (glow > 0.02) {
          const halo = context.createRadialGradient(
            point.x,
            point.y,
            0,
            point.x,
            point.y,
            size * 3.4,
          );
          halo.addColorStop(0, `hsla(${hue}, 88%, 72%, ${glow * 0.42})`);
          halo.addColorStop(1, "hsla(0, 0%, 0%, 0)");
          context.fillStyle = halo;
          context.beginPath();
          context.arc(point.x, point.y, size * 3.4, 0, TAU);
          context.fill();
        }
      }
    }

    // Ripples: one per sounded note, in the colour of the voice that sang it.
    for (let index = ripples.length - 1; index >= 0; index--) {
      const ripple = ripples[index];
      const age = now - ripple.at;
      if (age > 1.5) {
        ripples.splice(index, 1);
        continue;
      }
      const point = cellCentre(ripple.note.patternStep, ripple.note.ring);
      const progress = age / 1.5;
      context.strokeStyle = `hsla(${ripple.note.hue}, 84%, 70%, ${
        (1 - progress) * 0.4 * ripple.note.gain
      })`;
      context.lineWidth = 1.4 * (1 - progress);
      context.beginPath();
      context.arc(point.x, point.y, gap * 0.4 + progress * gap * 3.2, 0, TAU);
      context.stroke();
    }

    // The turning hand.
    const headAngle = (head / state.steps) * TAU - Math.PI / 2;
    const sweep = context.createLinearGradient(
      cx,
      cy,
      cx + Math.cos(headAngle) * outer,
      cy + Math.sin(headAngle) * outer,
    );
    sweep.addColorStop(0, "hsla(38, 90%, 70%, 0)");
    sweep.addColorStop(1, "hsla(38, 92%, 72%, 0.5)");
    context.strokeStyle = sweep;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(cx + Math.cos(headAngle) * inner * 0.7, cy + Math.sin(headAngle) * inner * 0.7);
    context.lineTo(cx + Math.cos(headAngle) * (outer + 4), cy + Math.sin(headAngle) * (outer + 4));
    context.stroke();

    context.restore();

    // The hub.
    context.fillStyle = "rgba(8, 11, 20, 0.92)";
    context.beginPath();
    context.arc(cx, cy, inner * 0.72, 0, TAU);
    context.fill();
    context.strokeStyle = "rgba(160, 188, 236, 0.14)";
    context.lineWidth = 1;
    context.stroke();

    context.textAlign = "center";
    context.textBaseline = "middle";
    if (!started) {
      context.fillStyle = "rgba(240, 235, 226, 0.82)";
      context.font = "600 12px ui-sans-serif, system-ui, sans-serif";
      context.fillText("press", cx, cy - 7);
      context.fillText("to listen", cx, cy + 8);
    } else {
      context.fillStyle = "rgba(240, 235, 226, 0.72)";
      context.font = "600 17px ui-sans-serif, system-ui, sans-serif";
      context.fillText(String(Math.min(state.voiceCount, Canon.VOICES.length)), cx, cy - 4);
      context.fillStyle = "rgba(190, 200, 220, 0.44)";
      context.font = "500 8.5px ui-sans-serif, system-ui, sans-serif";
      context.fillText(
        state.voiceCount === 1 ? "VOICE" : "VOICES",
        cx,
        cy + 11,
      );
    }
  }

  function frame() {
    draw();
    requestAnimationFrame(frame);
  }

  /* ---------------------------------------------------------- interaction */

  let painting = null;

  function pointerCell(event) {
    const rect = canvas.getBoundingClientRect();
    return cellAt(event.clientX - rect.left, event.clientY - rect.top);
  }

  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    // Capture keeps a drag alive past the rim; it is not worth losing the
    // stroke over when the browser declines.
    try {
      canvas.setPointerCapture?.(event.pointerId);
    } catch {
      // Draw without it.
    }
    if (!started) void start();

    const cell = pointerCell(event);
    if (!cell) return;
    painting = !Canon.hasCell(state, cell.step, cell.ring);
    Canon.setCell(state, cell.step, cell.ring, painting);
    disarmClear();
    save();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (painting === null) return;
    const cell = pointerCell(event);
    if (!cell) return;
    Canon.setCell(state, cell.step, cell.ring, painting);
  });

  function endPaint() {
    if (painting !== null) save();
    painting = null;
  }
  canvas.addEventListener("pointerup", endPaint);
  canvas.addEventListener("pointercancel", endPaint);
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  function addVoice() {
    if (state.voiceCount >= Canon.VOICES.length) {
      say("all five voices are already singing");
      return;
    }
    state.voiceCount += 1;
    state.turns = 0;
    announceVoice();
    save();
  }

  function removeVoice() {
    if (state.voiceCount <= 1) {
      say("one voice is the fewest a round can have");
      return;
    }
    state.voiceCount -= 1;
    state.turns = 0;
    // Dropping a voice while it is still growing is a request, not a hiccup.
    state.autoGrow = false;
    growToggle.checked = false;
    renderControls();
    save();
  }

  /** A fresh pentatonic phrase, sparse enough to leave room for the answers. */
  function roll() {
    state.cells.clear();
    const count = 5 + Math.floor(Math.random() * 4);
    const used = new Set();
    let ring = 3 + Math.floor(Math.random() * 4);
    for (let index = 0; index < count; index++) {
      let step;
      do {
        step = Math.floor(Math.random() * state.steps);
      } while (used.has(step));
      used.add(step);
      // Walk rather than jump, so the phrase sounds like a line.
      ring = Math.max(0, Math.min(state.rings - 1, ring + Math.round((Math.random() - 0.5) * 4)));
      Canon.setCell(state, step, ring, true);
    }
    state.voiceCount = 1;
    state.turns = 0;
    renderControls();
    disarmClear();
    say("a new phrase — let it turn a couple of times");
    save();
  }

  function disarmClear() {
    if (!clearArmed) return;
    clearArmed = false;
    clearButton.textContent = "clear";
    clearButton.classList.remove("armed");
  }

  function clearWheel() {
    if (!clearArmed) {
      clearArmed = true;
      clearButton.textContent = "really clear?";
      clearButton.classList.add("armed");
      setTimeout(disarmClear, 4000);
      return;
    }
    disarmClear();
    state.cells.clear();
    state.voiceCount = 1;
    state.turns = 0;
    litCells.clear();
    ripples.length = 0;
    renderControls();
    say("an empty wheel. draw something.");
    save();
  }

  function exportPng() {
    const link = document.createElement("a");
    link.download = `rounds-${state.voiceCount}-voices.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    say("saved a picture of the wheel");
  }

  function say(message) {
    statusLine.textContent = message;
  }

  function renderControls() {
    const voices = Math.min(state.voiceCount, Canon.VOICES.length);
    const names = Canon.VOICES.slice(0, voices)
      .map((voice) => voice.name)
      .join(" · ");
    voiceReadout.textContent = `${voices} — ${names}`;
    playButton.textContent = state.playing ? "pause" : "play";
    playButton.setAttribute(
      "aria-label",
      state.playing ? "Pause the wheel" : "Play the wheel",
    );
    tempoReadout.textContent = `${state.tempo} bpm`;
  }

  document.getElementById("add-voice").addEventListener("click", addVoice);
  document.getElementById("drop-voice").addEventListener("click", removeVoice);
  document.getElementById("roll").addEventListener("click", roll);
  document.getElementById("export").addEventListener("click", exportPng);
  clearButton.addEventListener("click", clearWheel);
  playButton.addEventListener("click", () => {
    if (!started) void start();
    else togglePlay();
  });

  tempoInput.value = String(state.tempo);
  tempoInput.addEventListener("input", () => {
    state.tempo = Number(tempoInput.value);
    renderControls();
    save();
  });

  growToggle.checked = state.autoGrow;
  growToggle.addEventListener("change", () => {
    state.autoGrow = growToggle.checked;
    state.turns = 0;
    save();
  });

  addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement) return;
    const key = event.key.toLowerCase();
    if (event.code === "Space") {
      event.preventDefault();
      if (!started) void start();
      else togglePlay();
    } else if (key === "v") {
      event.preventDefault();
      if (event.shiftKey) removeVoice();
      else addVoice();
    } else if (key === "r") {
      roll();
    } else if (key === "e") {
      exportPng();
    } else if (key === "c") {
      clearWheel();
    }
  });

  addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => {
    // Leaving the tab should not leave a hundred notes queued behind you.
    if (document.hidden && state.playing) stop();
  });

  resize();
  renderControls();
  if (reducedMotion) {
    say("reduced motion: the wheel turns without ripples");
  }
  frame();
})();
