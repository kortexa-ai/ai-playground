// After You — the piece.
//
// A hand follows your pointer on a spring. A 146-parameter net, trained
// live with plain backprop, forecasts where the hand will be `horizon`
// seconds from now. The ghost is the forecast; when the hand arrives where
// the ghost was, the forecast is confirmed with a pop. The constellation on
// the left is the net's actual weights, redrawing every frame.

(() => {
  "use strict";

  const fieldCanvas = document.getElementById("field");
  const mindCanvas = document.getElementById("mind");
  const field = fieldCanvas.getContext("2d");
  const mind = mindCanvas.getContext("2d");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const LAYERS = [4, 8, 8, 2];
  const LR = 0.05;
  const TRAIN_STEPS_PER_FRAME = 24;
  const BUFFER_TAIL = 2.5; // seconds of history kept beyond the horizon
  const SPRING_K = 42;
  const SPRING_C = 2 * Math.sqrt(SPRING_K);

  const INK = "#f0e9dc";
  const DIM = "#8a7f6a";
  const FAINT = "#221d15";
  const AMBER = "#e8a13d";
  const BLUE = "#6ea8c9";
  const FIELD_BG = "#12100c";
  const MIND_BG = "#171310";

  // ---- state -------------------------------------------------------------

  let net;
  let seed = 1;
  let pointer = { x: 0, y: 0, seen: false };
  let feint = null; // {x, y} — overrides the pointer until it moves again
  let hand = { x: 0, y: 0, vx: 0, vy: 0 };
  let mode = "follow"; // "follow" | "sleep"
  let horizon = 0.8;
  let buffer = []; // {t, x, y} hand samples, oldest first
  let predictions = []; // {x, y, due}
  let pops = []; // {x, y, age}
  let trail = []; // {x, y}
  let steps = 0;
  let confirmed = 0;
  let missed = 0;
  let missEma = null;
  let w = 1;
  let h = 1;
  let scale = 1;

  const statError = document.getElementById("stat-error");
  const statConfirmed = document.getElementById("stat-confirmed");
  const statMissed = document.getElementById("stat-missed");
  const statSteps = document.getElementById("stat-steps");
  const dialValue = document.getElementById("dial-value");
  const horizonInput = document.getElementById("horizon");
  const sleepButton = document.getElementById("sleep");

  // ---- setup -------------------------------------------------------------

  function relearn(newSeed) {
    seed = newSeed ?? ((Math.random() * 0x7fffffff) | 0) + 1;
    net = new TinyNet(LAYERS, seed);
    buffer = [];
    predictions = [];
    pops = [];
    trail = [];
    steps = 0;
    confirmed = 0;
    missed = 0;
    missEma = null;
  }

  function fit(canvas, context) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width: rect.width, height: rect.height };
  }

  function resize() {
    const f = fit(fieldCanvas, field);
    w = f.width;
    h = f.height;
    scale = Math.min(w, h) / 2;
    fit(mindCanvas, mind);
  }

  function centerHand() {
    hand.x = w / 2;
    hand.y = h / 2;
    hand.vx = 0;
    hand.vy = 0;
    pointer.x = w / 2;
    pointer.y = h / 2;
  }

  // ---- pointer -----------------------------------------------------------

  function onPointerMove(event) {
    const rect = fieldCanvas.getBoundingClientRect();
    pointer.x = event.clientX - rect.left;
    pointer.y = event.clientY - rect.top;
    pointer.seen = true;
    feint = null;
  }

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerdown", onPointerMove);

  function doFeint() {
    if (mode === "sleep") wake();
    const margin = 0.14;
    const mx = w * margin;
    const my = h * margin;
    const corners = [
      { x: mx, y: my },
      { x: w - mx, y: my },
      { x: mx, y: h - my },
      { x: w - mx, y: h - my },
    ];
    feint = corners[(Math.random() * corners.length) | 0];
  }

  function sleep() {
    mode = "sleep";
    sleepButton.textContent = "wake";
  }

  function wake() {
    mode = "follow";
    sleepButton.textContent = "sleep";
  }

  document.getElementById("feint").addEventListener("click", doFeint);
  sleepButton.addEventListener("click", () =>
    mode === "sleep" ? wake() : sleep(),
  );
  document.getElementById("relearn").addEventListener("click", () => relearn());
  horizonInput.addEventListener("input", () => {
    horizon = Number(horizonInput.value) / 100;
    dialValue.textContent = horizon.toFixed(2) + "s";
  });

  window.addEventListener("keydown", (event) => {
    if (event.repeat) return;
    if (event.code === "Space") {
      event.preventDefault();
      doFeint();
    } else if (event.key === "s" || event.key === "S") {
      sleep();
    } else if (event.key === "w" || event.key === "W") {
      wake();
    } else if (event.key === "r" || event.key === "R") {
      relearn();
    }
  });

  // ---- the hand ----------------------------------------------------------

  function stepHand(dt, now) {
    const target =
      mode === "sleep"
        ? { x: w / 2, y: h / 2 }
        : feint ?? (pointer.seen ? pointer : { x: w / 2, y: h / 2 });
    hand.vx += (SPRING_K * (target.x - hand.x) - SPRING_C * hand.vx) * dt;
    hand.vy += (SPRING_K * (target.y - hand.y) - SPRING_C * hand.vy) * dt;
    hand.x += hand.vx * dt;
    hand.y += hand.vy * dt;
    buffer.push({ t: now, x: hand.x, y: hand.y });
    const floor = now - horizon - BUFFER_TAIL;
    while (buffer.length && buffer[0].t < floor) buffer.shift();
    if (!reducedMotion) {
      trail.push({ x: hand.x, y: hand.y });
      if (trail.length > 36) trail.shift();
    }
  }

  // ---- the mind ----------------------------------------------------------

  function sampleAt(t) {
    if (buffer.length === 0) return { t, x: hand.x, y: hand.y };
    if (t <= buffer[0].t) return buffer[0];
    const last = buffer[buffer.length - 1];
    if (t >= last.t) return last;
    for (let i = 1; i < buffer.length; i++) {
      const a = buffer[i - 1];
      const b = buffer[i];
      if (t <= b.t) {
        const f = (t - a.t) / (b.t - a.t || 1);
        return { t, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      }
    }
    return last;
  }

  function inputsAt(t) {
    const p = sampleAt(t);
    const ahead = sampleAt(t + 0.05);
    const behind = sampleAt(t - 0.05);
    // The forward sample clamps to the newest buffer entry at the edge of
    // the buffer (prediction at `now`), so the span can be 0.05s instead of
    // 0.1s. Dividing by the actual span keeps the velocity estimate true;
    // dividing by a fixed 0.1 would halve it and push the prediction input
    // off the manifold the net trained on.
    const span = ahead.t - behind.t || 0.1;
    const vx = clamp((ahead.x - behind.x) / span, -2 * scale, 2 * scale);
    const vy = clamp((ahead.y - behind.y) / span, -2 * scale, 2 * scale);
    return [
      (p.x - w / 2) / scale,
      (p.y - h / 2) / scale,
      vx / scale,
      vy / scale,
    ];
  }

  function targetAt(t) {
    const p = sampleAt(t);
    return [(p.x - w / 2) / scale, (p.y - h / 2) / scale];
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function train(now) {
    const eligible = [];
    for (const e of buffer) if (e.t <= now - horizon) eligible.push(e);
    if (eligible.length < 8) return;
    for (let s = 0; s < TRAIN_STEPS_PER_FRAME; s++) {
      const e = eligible[(Math.random() * eligible.length) | 0];
      net.step(inputsAt(e.t), targetAt(e.t + horizon), LR);
      steps++;
    }
  }

  function predict(now) {
    const { out } = net.forward(inputsAt(now));
    const gx = clamp(out[0], -1.4, 1.4) * scale + w / 2;
    const gy = clamp(out[1], -1.4, 1.4) * scale + h / 2;
    predictions.push({ x: gx, y: gy, due: now + horizon });
    const live = [];
    for (const p of predictions) {
      if (p.due > now) {
        live.push(p);
      } else {
        const d = Math.hypot(hand.x - p.x, hand.y - p.y);
        // d is the true forecast error: how far the hand actually was from
        // where the net said it would be.
        missEma = missEma === null ? d : missEma * 0.9 + d * 0.1;
        if (d < 14 + 10 * horizon) {
          confirmed++;
          if (!reducedMotion) pops.push({ x: p.x, y: p.y, age: 0 });
        } else {
          missed++;
        }
      }
    }
    predictions = live;
    return { x: gx, y: gy };
  }

  // ---- drawing -----------------------------------------------------------

  function drawField(now, ghost) {
    field.fillStyle = FIELD_BG;
    field.fillRect(0, 0, w, h);

    field.fillStyle = FAINT;
    const grid = 48;
    for (let x = grid / 2; x < w; x += grid) {
      for (let y = grid / 2; y < h; y += grid) {
        field.fillRect(x - 0.5, y - 0.5, 1, 1);
      }
    }

    if (trail.length > 1) {
      field.lineCap = "round";
      for (let i = 1; i < trail.length; i++) {
        const f = i / trail.length;
        field.strokeStyle = `rgba(240, 233, 220, ${0.16 * f * f})`;
        field.lineWidth = 1 + 2.4 * f;
        field.beginPath();
        field.moveTo(trail[i - 1].x, trail[i - 1].y);
        field.lineTo(trail[i].x, trail[i].y);
        field.stroke();
      }
    }

    // the forecast line, then the ghost
    field.strokeStyle = "rgba(232, 161, 61, 0.22)";
    field.lineWidth = 1;
    field.setLineDash([3, 5]);
    field.beginPath();
    field.moveTo(hand.x, hand.y);
    field.lineTo(ghost.x, ghost.y);
    field.stroke();
    field.setLineDash([]);

    field.strokeStyle = AMBER;
    field.lineWidth = 1.5;
    field.beginPath();
    field.arc(ghost.x, ghost.y, 9, 0, Math.PI * 2);
    field.stroke();
    field.fillStyle = "rgba(232, 161, 61, 0.14)";
    field.fill();

    // confirmation pops
    for (const p of pops) {
      const f = p.age / 0.5;
      field.strokeStyle = `rgba(232, 161, 61, ${0.5 * (1 - f)})`;
      field.lineWidth = 1.5;
      field.beginPath();
      field.arc(p.x, p.y, 10 + 26 * f, 0, Math.PI * 2);
      field.stroke();
    }

    // the pointer, small and quiet
    if (pointer.seen && mode === "follow" && !feint) {
      field.strokeStyle = "rgba(207, 198, 180, 0.5)";
      field.lineWidth = 1;
      field.beginPath();
      field.arc(pointer.x, pointer.y, 3, 0, Math.PI * 2);
      field.stroke();
    }

    // the hand
    field.fillStyle = INK;
    field.beginPath();
    field.arc(hand.x, hand.y, 5, 0, Math.PI * 2);
    field.fill();
    field.strokeStyle = "rgba(240, 233, 220, 0.25)";
    field.lineWidth = 1;
    field.beginPath();
    field.arc(hand.x, hand.y, 10, 0, Math.PI * 2);
    field.stroke();
  }

  function drawMind() {
    const rect = mindCanvas.getBoundingClientRect();
    const mw = rect.width;
    const mh = rect.height;
    mind.fillStyle = MIND_BG;
    mind.fillRect(0, 0, mw, mh);

    const columns = LAYERS;
    const padX = 26;
    const padY = 24;
    const innerW = mw - padX * 2;
    const innerH = mh - padY * 2;
    const colX = (i) => padX + (i * innerW) / (columns.length - 1);
    const nodeY = (l, i, n) => {
      const gap = n > 1 ? Math.min(innerH / (n - 1), 20) : 0;
      return mh / 2 + (i - (n - 1) / 2) * gap;
    };

    // edges first, so nodes sit on top
    for (let l = 0; l < net.W.length; l++) {
      const W = net.W[l];
      const fanIn = columns[l];
      for (let i = 0; i < columns[l + 1]; i++) {
        for (let j = 0; j < fanIn; j++) {
          const weight = W[i * fanIn + j];
          const mag = Math.min(1, Math.abs(weight));
          mind.strokeStyle =
            weight > 0 ? AMBER : BLUE;
          mind.globalAlpha = 0.07 + 0.8 * mag;
          mind.lineWidth = 0.5 + 1.4 * mag;
          mind.beginPath();
          mind.moveTo(colX(l), nodeY(l, j, fanIn));
          mind.lineTo(colX(l + 1), nodeY(l + 1, i, columns[l + 1]));
          mind.stroke();
        }
      }
    }
    mind.globalAlpha = 1;

    for (let l = 0; l < columns.length; l++) {
      const n = columns[l];
      for (let i = 0; i < n; i++) {
        const isOutput = l === columns.length - 1;
        const isInput = l === 0;
        mind.fillStyle = isOutput
          ? AMBER
          : isInput
            ? INK
            : "rgba(240, 233, 220, 0.55)";
        mind.beginPath();
        mind.arc(colX(l), nodeY(l, i, n), isOutput || isInput ? 3 : 2.2, 0, Math.PI * 2);
        mind.fill();
      }
    }

    // caption
    mind.fillStyle = DIM;
    mind.font = "9px 'SF Mono', ui-monospace, Menlo, monospace";
    mind.textAlign = "left";
    mind.fillText("the mind — 4·8·8·2", padX, mh - 10);
    mind.textAlign = "right";
    mind.fillText("w+ warm · w− cool", mw - padX, mh - 10);
  }

  // ---- main loop ---------------------------------------------------------

  let last = performance.now();

  function frame(nowMs) {
    const now = nowMs / 1000;
    const dt = clamp((nowMs - last) / 1000, 0.001, 0.05);
    last = nowMs;

    stepHand(dt, now);
    train(now);
    const ghost = predict(now);
    for (const p of pops) p.age += dt;
    pops = pops.filter((p) => p.age < 0.5);

    drawField(now, ghost);
    drawMind();

    statError.textContent = missEma === null ? "—" : missEma.toFixed(1) + "px";
    statConfirmed.textContent = String(confirmed);
    statMissed.textContent = String(missed);
    statSteps.textContent = String(steps);

    requestAnimationFrame(frame);
  }

  window.addEventListener("resize", resize);
  resize();
  centerHand();
  relearn(1);

  // reduced motion: still learns and forecasts; trails and pops are skipped
  // where they are drawn.
  requestAnimationFrame(frame);
})();
