(() => {
  "use strict";

  const STORAGE_KEY = "longitude-loom:v1";
  const MERIDIANS = 24;
  const MAX_KNOTS = 96;
  const MAX_ROUTES = 8;
  const CROSSING_SECONDS = 18;
  const FIXED_STEP = 1 / 60;
  const TAU = Math.PI * 2;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const canvas = document.getElementById("loom");
  const context = canvas.getContext("2d", { alpha: false });
  const routeForm = document.getElementById("route-form");
  const fromInput = document.getElementById("from-place");
  const toInput = document.getElementById("to-place");
  const routeLabel = document.getElementById("route-label");
  const crossingLabel = document.getElementById("crossing-label");
  const status = document.getElementById("status");
  const announcement = document.getElementById("announcement");
  const pauseButton = document.getElementById("pause-button");
  const exportButton = document.getElementById("export-button");
  const clearButton = document.getElementById("clear-button");

  let width = 1;
  let height = 1;
  let dpr = 1;
  let progress = reducedMotion ? 0.5 : 0;
  let accumulator = 0;
  let lastFrame = 0;
  let userPaused = reducedMotion;
  let pageVisible = !document.hidden;
  let loomVisible = !("IntersectionObserver" in window);
  let animationFrame = 0;
  let clearArmedUntil = 0;
  let store = loadStore();
  let routeKey = "";
  let route = null;
  let seed = 1;
  let palette = null;

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

  function hashText(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return mix32(hash);
  }

  function randomAt(index, channel = 0) {
    return (
      mix32(
        seed ^
          Math.imul(index + 1, 0x9e3779b1) ^
          Math.imul(channel + 7, 0x85ebca6b),
      ) / 4294967296
    );
  }

  function normalizePlace(value, fallback) {
    const clean = String(value || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 36);
    return clean || fallback;
  }

  function routeId(from, to) {
    return `${from.normalize("NFKC").toLowerCase()}→${to
      .normalize("NFKC")
      .toLowerCase()}`;
  }

  function newRoute(from, to) {
    return {
      from,
      to,
      rows: 0,
      knots: [],
      updatedAt: Date.now(),
    };
  }

  function sanitizeRoute(value, fallbackFrom, fallbackTo) {
    if (!value || typeof value !== "object") {
      return newRoute(fallbackFrom, fallbackTo);
    }
    const from = normalizePlace(value.from, fallbackFrom);
    const to = normalizePlace(value.to, fallbackTo);
    const rows = clamp(Math.floor(Number(value.rows) || 0), 0, 100000);
    const knots = Array.isArray(value.knots)
      ? value.knots
          .filter(
            (knot) =>
              knot &&
              Number.isFinite(knot.startRow) &&
              Number.isFinite(knot.meridian) &&
              Number.isFinite(knot.strength) &&
              Number.isFinite(knot.phase),
          )
          .slice(-MAX_KNOTS)
          .map((knot) => ({
            startRow: clamp(Math.floor(knot.startRow), 1, 100001),
            meridian: clamp(Math.floor(knot.meridian), 0, MERIDIANS - 1),
            strength: clamp(knot.strength, 0.4, 1.8),
            phase: knot.phase % TAU,
          }))
      : [];
    return {
      from,
      to,
      rows,
      knots,
      updatedAt: Number(value.updatedAt) || Date.now(),
    };
  }

  function loadStore() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (parsed && parsed.version === 1 && parsed.routes) return parsed;
    } catch (_error) {
      // Storage can be disabled. The loom still works for this visit.
    }
    return { version: 1, routes: {} };
  }

  function saveStore() {
    if (route) {
      route.updatedAt = Date.now();
      store.routes[routeKey] = route;
    }
    const recent = Object.entries(store.routes)
      .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
      .slice(0, MAX_ROUTES);
    store.routes = Object.fromEntries(recent);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (_error) {
      setStatus("The cloth is alive, but this browser will not store it.");
    }
  }

  function makePalette() {
    const indigoHue = 214 + randomAt(1, 1) * 32;
    const copperHue = 18 + randomAt(2, 2) * 22;
    return {
      dark: `hsl(${indigoHue} 36% 7%)`,
      raised: `hsl(${indigoHue} 34% 12%)`,
      warp: `hsla(${indigoHue + 14} 56% 72% / 0.15)`,
      weft: `hsl(${indigoHue + 8} 55% 69%)`,
      weftSoft: `hsla(${indigoHue + 8} 55% 69% / 0.42)`,
      copper: `hsl(${copperHue} 58% 64%)`,
      copperGlow: `hsla(${copperHue} 72% 64% / 0.22)`,
    };
  }

  function setRoute(fromValue, toValue, announce = true) {
    const from = normalizePlace(fromValue, "Somewhere");
    const to = normalizePlace(toValue, "Elsewhere");
    routeKey = routeId(from, to);
    route = sanitizeRoute(store.routes[routeKey], from, to);
    clearArmedUntil = 0;
    clearButton.textContent = "clear cloth";
    route.from = from;
    route.to = to;
    store.routes[routeKey] = route;
    seed = hashText(`longitude-loom:${routeKey}`) || 1;
    palette = makePalette();
    progress = reducedMotion ? 0.5 : 0;
    accumulator = 0;
    fromInput.value = from;
    toInput.value = to;
    routeLabel.textContent = `${from.toUpperCase()} → ${to.toUpperCase()}`;
    updateCrossingLabel();
    saveStore();
    if (announce) {
      setStatus(
        route.rows
          ? `The ${from} to ${to} cloth remembers ${route.rows} crossings.`
          : `A new route is threaded from ${from} toward ${to}.`,
      );
    }
    draw();
    syncAnimation();
  }

  function setStatus(message, announce = true) {
    status.textContent = message;
    announcement.textContent = announce ? message : "";
  }

  function updateCrossingLabel() {
    crossingLabel.textContent = `CROSSING ${String(route.rows + 1).padStart(3, "0")}`;
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(devicePixelRatio || 1, 2);
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function loomBounds() {
    const side = clamp(width * 0.075, 35, 88);
    return {
      left: side,
      right: width - side,
      top: clamp(height * 0.1, 48, 78),
      bottom: height - clamp(height * 0.09, 48, 72),
    };
  }

  function rowDisplacement(row, u) {
    const amplitude = clamp(height * 0.012, 4.5, 9.5);
    const firstFrequency = 1.4 + randomAt(row * 5 + 3, 4) * 2.3;
    const secondFrequency = 3.2 + randomAt(row * 7 + 9, 5) * 3.1;
    let offset =
      Math.sin(u * TAU * firstFrequency + randomAt(row, 6) * TAU) *
        amplitude *
        0.46 +
      Math.sin(u * TAU * secondFrequency + randomAt(row, 7) * TAU) *
        amplitude *
        0.18;

    for (const knot of route.knots) {
      if (knot.startRow > row) continue;
      const age = row - knot.startRow;
      if (age > 60) continue;
      const knotU = knot.meridian / (MERIDIANS - 1);
      const distance = u - knotU;
      const reach = Math.exp(-Math.abs(distance) * 8.5);
      const release = Math.exp(-age / 25);
      offset +=
        Math.sin(distance * 17 - age * 0.42 + knot.phase) *
        amplitude *
        1.55 *
        knot.strength *
        reach *
        release;
    }
    return offset;
  }

  function rowY(row, currentRow, bounds, spacing) {
    if (row === currentRow) return bounds.bottom - 8;
    return bounds.bottom - 17 - (currentRow - row) * spacing;
  }

  function traceRow(row, y, fromU, toU, style, lineWidth) {
    const bounds = loomBounds();
    const steps = Math.max(2, Math.ceil(Math.abs(toU - fromU) * 72));
    context.beginPath();
    for (let step = 0; step <= steps; step += 1) {
      const u = lerp(fromU, toU, step / steps);
      const x = lerp(bounds.left, bounds.right, u);
      const pointY = y + rowDisplacement(row, u);
      if (step === 0) context.moveTo(x, pointY);
      else context.lineTo(x, pointY);
    }
    context.strokeStyle = style;
    context.lineWidth = lineWidth;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.stroke();
  }

  function drawBackground(bounds) {
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, palette.dark);
    gradient.addColorStop(0.56, palette.raised);
    gradient.addColorStop(1, "#090a13");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    const glow = context.createRadialGradient(
      bounds.right * 0.84,
      bounds.top,
      0,
      bounds.right * 0.84,
      bounds.top,
      width * 0.65,
    );
    glow.addColorStop(0, palette.copperGlow);
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);

    for (let index = 0; index < 90; index += 1) {
      const x = randomAt(index, 20) * width;
      const y = randomAt(index, 21) * height;
      const alpha = 0.025 + randomAt(index, 22) * 0.065;
      context.fillStyle = `rgba(238, 233, 223, ${alpha})`;
      context.fillRect(x, y, 0.5 + randomAt(index, 23), 0.5 + randomAt(index, 24));
    }
  }

  function drawWarp(bounds) {
    for (let meridian = 0; meridian < MERIDIANS; meridian += 1) {
      const u = meridian / (MERIDIANS - 1);
      const x = lerp(bounds.left, bounds.right, u);
      context.beginPath();
      context.moveTo(x, bounds.top);
      context.lineTo(x, bounds.bottom);
      context.strokeStyle =
        meridian === 0 || meridian === MERIDIANS - 1
          ? "rgba(238, 233, 223, 0.22)"
          : palette.warp;
      context.lineWidth = meridian % 6 === 0 ? 0.9 : 0.55;
      context.stroke();

      if (meridian % 6 === 0 || meridian === MERIDIANS - 1) {
        const zone = meridian - 12;
        context.fillStyle = "rgba(238, 233, 223, 0.31)";
        context.font = "600 7px Segoe UI, sans-serif";
        context.textAlign = "center";
        context.fillText(
          zone === 0 ? "UTC" : `UTC${zone > 0 ? "+" : ""}${zone}`,
          x,
          bounds.top - 15,
        );
      }
    }
  }

  function drawRows(bounds) {
    const maximumVisible = clamp(
      Math.floor((bounds.bottom - bounds.top) / 8.5),
      28,
      78,
    );
    const visibleCount = Math.min(route.rows, maximumVisible);
    const firstRow = Math.max(0, route.rows - visibleCount);
    const spacing = Math.min(
      8.5,
      (bounds.bottom - bounds.top - 28) / Math.max(visibleCount + 1, 2),
    );

    for (let row = firstRow; row < route.rows; row += 1) {
      const age = route.rows - row;
      const alpha = lerp(0.17, 0.66, 1 - age / Math.max(visibleCount, 1));
      const hueShift = randomAt(row, 30) * 18 - 9;
      const style = `hsla(${226 + hueShift} 52% 70% / ${alpha})`;
      traceRow(row, rowY(row, route.rows, bounds, spacing), 0, 1, style, 0.9);
    }

    const reverse = route.rows % 2 === 1;
    const startU = reverse ? 1 : 0;
    const currentU = reverse ? 1 - progress : progress;
    const currentY = rowY(route.rows, route.rows, bounds, spacing);
    traceRow(
      route.rows,
      currentY,
      startU,
      currentU,
      palette.weft,
      1.65,
    );

    drawKnots(bounds, firstRow, spacing, currentY);
    drawShuttle(bounds, currentU, currentY);
  }

  function drawKnots(bounds, firstRow, spacing, currentY) {
    for (const knot of route.knots) {
      if (knot.startRow < firstRow || knot.startRow > route.rows) continue;
      const u = knot.meridian / (MERIDIANS - 1);
      const x = lerp(bounds.left, bounds.right, u);
      const y =
        (knot.startRow === route.rows
          ? currentY
          : rowY(knot.startRow, route.rows, bounds, spacing)) +
        rowDisplacement(knot.startRow, u);
      const pulse = 0.75 + Math.sin(knot.phase) * 0.15;
      context.save();
      context.translate(x, y);
      context.rotate(Math.PI / 4);
      context.fillStyle = palette.copper;
      context.shadowColor = palette.copper;
      context.shadowBlur = 9;
      context.globalAlpha = pulse;
      context.fillRect(-2.2, -2.2, 4.4, 4.4);
      context.restore();
    }
  }

  function drawShuttle(bounds, u, baseY) {
    const x = lerp(bounds.left, bounds.right, u);
    const y = baseY + rowDisplacement(route.rows, u);
    context.save();
    context.translate(x, y);
    context.shadowColor = palette.copper;
    context.shadowBlur = 18;
    context.fillStyle = palette.copper;
    context.beginPath();
    context.moveTo(-8, 0);
    context.lineTo(0, -3.4);
    context.lineTo(8, 0);
    context.lineTo(0, 3.4);
    context.closePath();
    context.fill();
    context.restore();

    context.beginPath();
    context.arc(x, y, 14, 0, TAU);
    context.strokeStyle = palette.copperGlow;
    context.lineWidth = 0.8;
    context.stroke();
  }

  function drawBorder(bounds) {
    context.strokeStyle = "rgba(238, 233, 223, 0.12)";
    context.lineWidth = 1;
    context.strokeRect(
      bounds.left - 14,
      bounds.top - 29,
      bounds.right - bounds.left + 28,
      bounds.bottom - bounds.top + 47,
    );
  }

  function draw() {
    if (!route || !palette) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bounds = loomBounds();
    drawBackground(bounds);
    drawWarp(bounds);
    drawRows(bounds);
    drawBorder(bounds);
  }

  function completeCrossing(message) {
    route.rows = clamp(route.rows + 1, 0, 100000);
    progress = reducedMotion ? 0.5 : 0;
    accumulator = 0;
    updateCrossingLabel();
    saveStore();
    setStatus(
      message ||
        `Crossing ${String(route.rows).padStart(3, "0")} joined the cloth.`,
      Boolean(message),
    );
    draw();
  }

  function currentMeridian(pointerU = null) {
    if (reducedMotion && pointerU !== null) {
      return clamp(Math.round(pointerU * (MERIDIANS - 1)), 0, MERIDIANS - 1);
    }
    const currentU = route.rows % 2 === 1 ? 1 - progress : progress;
    return clamp(Math.round(currentU * (MERIDIANS - 1)), 0, MERIDIANS - 1);
  }

  function tieKnot(pointerU = null) {
    const meridian = currentMeridian(pointerU);
    const startRow = route.rows + 1;
    const existing = route.knots.find((knot) => knot.startRow === startRow);
    const knotSeed = mix32(seed ^ Math.imul(startRow, 0x9e3779b1) ^ meridian);
    const knot = {
      startRow,
      meridian,
      strength: 0.75 + (knotSeed / 4294967296) * 0.72,
      phase: (mix32(knotSeed ^ 0x85ebca6b) / 4294967296) * TAU,
    };
    if (existing) Object.assign(existing, knot);
    else route.knots.push(knot);
    route.knots = route.knots.slice(-MAX_KNOTS);
    saveStore();
    const zone = meridian - 12;
    const label = zone === 0 ? "UTC" : `UTC${zone > 0 ? "+" : ""}${zone}`;
    setStatus(
      existing
        ? `The waiting knot moved to ${label}.`
        : `A knot waits at ${label}; it will pull on the next crossing.`,
    );
    if (reducedMotion) completeCrossing("The knot advanced the cloth by one crossing.");
    else draw();
  }

  function togglePause() {
    if (reducedMotion) {
      completeCrossing("The cloth advanced by one quiet crossing.");
      return;
    }
    userPaused = !userPaused;
    pauseButton.textContent = userPaused ? "resume" : "pause";
    setStatus(userPaused ? "The shuttle is resting." : "The shuttle is moving again.");
    syncAnimation();
  }

  function exportCloth() {
    draw();
    canvas.toBlob((blob) => {
      if (!blob) {
        setStatus("This browser could not save the cloth.");
        return;
      }
      const link = document.createElement("a");
      const slug = `${route.from}-${route.to}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 52);
      link.href = URL.createObjectURL(blob);
      link.download = `longitude-loom-${slug || "journey"}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      setStatus("The current cloth was saved as a PNG.");
    }, "image/png");
  }

  function clearCloth() {
    const now = Date.now();
    if (now > clearArmedUntil) {
      clearArmedUntil = now + 3500;
      clearButton.textContent = "clear — are you sure?";
      setStatus("Press clear once more to forget this route's cloth.");
      setTimeout(() => {
        if (Date.now() > clearArmedUntil) clearButton.textContent = "clear cloth";
      }, 3600);
      return;
    }
    route.rows = 0;
    route.knots = [];
    progress = reducedMotion ? 0.5 : 0;
    accumulator = 0;
    clearArmedUntil = 0;
    clearButton.textContent = "clear cloth";
    updateCrossingLabel();
    saveStore();
    setStatus("The loom is empty. The route remains.");
    draw();
  }

  function pointerPosition(event) {
    const rect = canvas.getBoundingClientRect();
    const bounds = loomBounds();
    const x = ((event.clientX - rect.left) / rect.width) * width;
    return clamp((x - bounds.left) / (bounds.right - bounds.left), 0, 1);
  }

  function isTypingTarget(target) {
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLButtonElement
    );
  }

  function hasCommandModifier(event) {
    return event.altKey || event.ctrlKey || event.metaKey;
  }

  function shouldAnimate() {
    return (
      pageVisible &&
      loomVisible &&
      !userPaused &&
      !reducedMotion &&
      Boolean(route)
    );
  }

  function syncAnimation() {
    lastFrame = 0;
    if (shouldAnimate() && !animationFrame) {
      animationFrame = requestAnimationFrame(frame);
    } else if (!shouldAnimate() && animationFrame) {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
  }

  function frame(timestamp) {
    animationFrame = 0;
    if (!shouldAnimate()) return;
    const elapsed = lastFrame
      ? Math.min((timestamp - lastFrame) / 1000, 0.1)
      : 0;
    lastFrame = timestamp;
    accumulator += elapsed;
    while (accumulator >= FIXED_STEP) {
      progress += FIXED_STEP / CROSSING_SECONDS;
      accumulator -= FIXED_STEP;
      if (progress >= 1) completeCrossing();
    }
    draw();
    animationFrame = requestAnimationFrame(frame);
  }

  routeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    setRoute(fromInput.value, toInput.value);
  });

  canvas.addEventListener("pointerdown", (event) => {
    tieKnot(pointerPosition(event));
  });

  canvas.addEventListener("keydown", (event) => {
    if (
      !hasCommandModifier(event) &&
      (event.key.toLowerCase() === "k" || event.key === "Enter")
    ) {
      event.preventDefault();
      event.stopPropagation();
      tieKnot();
    }
  });

  pauseButton.addEventListener("click", togglePause);
  exportButton.addEventListener("click", exportCloth);
  clearButton.addEventListener("click", clearCloth);

  document.addEventListener("keydown", (event) => {
    if (isTypingTarget(event.target) || hasCommandModifier(event)) return;
    const key = event.key.toLowerCase();
    if (key === "k") tieKnot();
    if (key === "p") togglePause();
    if (key === "e") exportCloth();
  });

  document.addEventListener("visibilitychange", () => {
    pageVisible = !document.hidden;
    syncAnimation();
  });

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(
      ([entry]) => {
        loomVisible = entry.isIntersecting;
        syncAnimation();
      },
      { rootMargin: "100px" },
    ).observe(canvas);
  }

  if ("ResizeObserver" in window) {
    new ResizeObserver(resize).observe(canvas);
  } else {
    addEventListener("resize", resize);
  }

  if (reducedMotion) {
    pauseButton.textContent = "advance crossing";
    setStatus("Reduced motion is on. Tap a meridian to knot and advance.");
  }

  setRoute(fromInput.value, toInput.value, false);
  resize();
})();
