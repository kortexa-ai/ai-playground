(() => {
  "use strict";

  const TAU = Math.PI * 2;
  const LAYERS = 12;
  const EXPERTS = 14;
  const ROUTED = 3;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canvas = document.getElementById("tank");
  const context = canvas.getContext("2d");
  const budgetInput = document.getElementById("budget");
  const budgetOutput = document.getElementById("budget-output");
  const promptInput = document.getElementById("prompt");
  const releaseButton = document.getElementById("release");
  const policyOutput = document.getElementById("policy");
  const cacheOutput = document.getElementById("cache-size");
  const hitOutput = document.getElementById("hit-rate");
  const rateOutput = document.getElementById("token-rate");
  const observation = document.getElementById("observation");

  let width = 1;
  let height = 1;
  let dpr = 1;
  let lastTime = performance.now();
  let spawnClock = 0;
  let sequence = 0;
  let words = [];
  let wordCursor = 0;
  let hits = 0;
  let lookups = 0;
  let budget = Number(budgetInput.value);
  let policy = policyFor(budget);
  let experts = [];
  let tokens = [];
  let trails = [];
  const cache = Array.from({ length: LAYERS }, () => []);

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
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
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function randomAt(index, channel = 0) {
    return mix32(Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(channel + 3, 0x85ebca6b)) / 4294967296;
  }

  function policyFor(value) {
    let cacheSize;
    if (value <= 14) {
      cacheSize = Math.round(3 + (value - 4) * 0.5);
    } else {
      cacheSize = Math.round(8 + ((value - 14) / 26) * 43);
    }
    const tokenRate = value <= 14
      ? 0.62 + ((value - 4) / 10) * 1.54
      : 2.16 + ((value - 14) / 26) * 1.49;
    return {
      resident: value >= 11,
      cacheSize,
      visualCache: clamp(Math.ceil(cacheSize / 5), 1, EXPERTS),
      tokenRate,
      travelSpeed: 0.52 + tokenRate * 0.12,
    };
  }

  function parsePrompt() {
    words = promptInput.value
      .trim()
      .split(/\s+/)
      .map((word) => word.replace(/[^\p{L}\p{N}'’-]/gu, ""))
      .filter(Boolean);
    if (!words.length) words = ["silence"];
    wordCursor = 0;
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(devicePixelRatio || 1, 2);
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    const top = height * 0.19;
    const bottom = height * 0.82;
    experts = Array.from({ length: LAYERS }, (_, layer) => {
      const x = width * (0.11 + (layer / (LAYERS - 1)) * 0.78);
      return Array.from({ length: EXPERTS }, (_, expert) => {
        const row = expert % 7;
        const bank = expert < 7 ? -1 : 1;
        const wobble = (randomAt(layer * EXPERTS + expert, 2) - 0.5) * height * 0.028;
        return {
          x: x + bank * (5 + randomAt(layer * EXPERTS + expert, 3) * 8),
          y: top + (row / 6) * (bottom - top) + wobble,
          radius: 2.2 + randomAt(layer * EXPERTS + expert, 4) * 2.8,
          phase: randomAt(layer * EXPERTS + expert, 5) * TAU,
          heat: 0,
        };
      });
    });
  }

  function routeFor(word, layer, tokenSequence) {
    const seed = hashText(word) ^ Math.imul(layer + 1, 0x9e3779b1);
    const popular = mix32(seed) % 5;
    const routes = [popular];
    let turn = 1;
    while (routes.length < ROUTED) {
      const preferFamiliar = mix32(seed ^ Math.imul(tokenSequence + turn, 0x85ebca6b)) % 100 < 62;
      const candidate = preferFamiliar
        ? mix32(seed ^ Math.imul(turn, 97)) % 7
        : mix32(seed ^ Math.imul(tokenSequence + turn, 193)) % EXPERTS;
      if (!routes.includes(candidate)) routes.push(candidate);
      turn += 1;
    }
    return routes;
  }

  function touchCache(layer, routes) {
    const layerCache = cache[layer];
    let routeHits = 0;
    for (const expert of routes) {
      const at = layerCache.indexOf(expert);
      if (at !== -1) {
        routeHits += 1;
        layerCache.splice(at, 1);
      }
      layerCache.push(expert);
    }
    while (layerCache.length > policy.visualCache) layerCache.shift();
    hits += routeHits;
    lookups += routes.length;
    return routeHits === routes.length;
  }

  function targetFor(token, layer) {
    const routes = routeFor(token.word, layer, token.id);
    const warm = routes.every((expert) => cache[layer].includes(expert));
    return { routes, warm, point: experts[layer][routes[0]] };
  }

  function spawnToken(word = words[wordCursor % words.length]) {
    wordCursor += 1;
    sequence += 1;
    const token = {
      id: sequence,
      word,
      layer: 0,
      progress: 0,
      stall: 0,
      x: width * 0.025,
      y: height * (0.42 + randomAt(sequence, 11) * 0.18),
      fromX: width * 0.025,
      fromY: height * (0.42 + randomAt(sequence, 11) * 0.18),
      hue: 18 + randomAt(sequence, 12) * 34,
    };
    token.target = targetFor(token, 0);
    token.stall = token.target.warm || policy.resident ? 0 : 0.12 + 0.18 / policy.tokenRate;
    tokens.push(token);
  }

  function releasePrompt() {
    parsePrompt();
    tokens = [];
    trails = [];
    spawnClock = 0;
    const initial = Math.min(words.length, reducedMotion ? words.length : 3);
    for (let i = 0; i < initial; i += 1) spawnToken();
    observation.textContent = `“${words.join(" ")}” entered the current. Watch familiar routes become warm.`;
  }

  function advanceToken(token, dt) {
    if (token.stall > 0) {
      token.stall -= dt;
      return true;
    }
    const speed = reducedMotion ? 8 : policy.travelSpeed;
    token.progress += dt * speed;
    const amount = clamp(token.progress, 0, 1);
    const eased = amount * amount * (3 - 2 * amount);
    const bend = Math.sin(amount * Math.PI) * height * 0.035 * (token.id % 2 ? 1 : -1);
    token.x = token.fromX + (token.target.point.x - token.fromX) * eased;
    token.y = token.fromY + (token.target.point.y - token.fromY) * eased + bend;
    if (token.progress < 1) return true;

    touchCache(token.layer, token.target.routes);
    for (const expert of token.target.routes) experts[token.layer][expert].heat = 1;
    trails.push({
      x1: token.fromX,
      y1: token.fromY,
      x2: token.target.point.x,
      y2: token.target.point.y,
      hue: token.hue,
      life: 1,
    });
    token.fromX = token.target.point.x;
    token.fromY = token.target.point.y;
    token.layer += 1;
    token.progress = 0;
    if (token.layer >= LAYERS) return false;
    token.target = targetFor(token, token.layer);
    token.stall = token.target.warm || policy.resident ? 0 : 0.12 + 0.18 / policy.tokenRate;
    return true;
  }

  function update(dt) {
    const spawnEvery = clamp(1.35 / policy.tokenRate, 0.34, 1.8);
    spawnClock += dt;
    if (!reducedMotion && spawnClock >= spawnEvery && tokens.length < 11) {
      spawnClock = 0;
      spawnToken();
    }
    tokens = tokens.filter((token) => advanceToken(token, dt));
    trails.forEach((trail) => { trail.life -= dt * 0.48; });
    trails = trails.filter((trail) => trail.life > 0);
    experts.flat().forEach((expert) => { expert.heat *= Math.pow(0.2, dt); });
  }

  function drawBackground(time) {
    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#0b3442");
    gradient.addColorStop(0.48, "#082431");
    gradient.addColorStop(1, "#03131d");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    context.save();
    context.globalCompositeOperation = "lighter";
    for (let ray = 0; ray < 6; ray += 1) {
      const x = width * (0.05 + ray * 0.19 + Math.sin(time * 0.00008 + ray) * 0.025);
      const rayGradient = context.createLinearGradient(x, 0, x + width * 0.08, height * 0.72);
      rayGradient.addColorStop(0, "rgba(135, 224, 217, 0.07)");
      rayGradient.addColorStop(1, "rgba(135, 224, 217, 0)");
      context.fillStyle = rayGradient;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x + width * 0.045, 0);
      context.lineTo(x + width * 0.15, height * 0.78);
      context.lineTo(x + width * 0.08, height * 0.78);
      context.closePath();
      context.fill();
    }
    context.restore();

    context.fillStyle = "rgba(28, 64, 64, 0.46)";
    context.beginPath();
    context.moveTo(0, height);
    for (let x = 0; x <= width; x += 18) {
      context.lineTo(x, height * (0.93 + randomAt(Math.round(x / 18), 44) * 0.035));
    }
    context.lineTo(width, height);
    context.closePath();
    context.fill();

    for (let mote = 0; mote < 55; mote += 1) {
      const x = (randomAt(mote, 50) * width + time * (0.002 + randomAt(mote, 51) * 0.003)) % width;
      const y = randomAt(mote, 52) * height;
      const alpha = 0.08 + 0.16 * (Math.sin(time * 0.001 + mote) * 0.5 + 0.5);
      context.fillStyle = `rgba(190, 235, 219, ${alpha})`;
      context.fillRect(x, y, 1, 1);
    }
  }

  function drawReefs(time) {
    for (let layer = 0; layer < LAYERS; layer += 1) {
      const x = experts[layer][0].x;
      context.strokeStyle = "rgba(125, 221, 225, 0.06)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, height * 0.14);
      context.lineTo(x, height * 0.88);
      context.stroke();

      const labelEvery = width < 700 ? 3 : 1;
      if (layer % labelEvery === 0) {
        context.fillStyle = "rgba(215, 238, 233, 0.25)";
        context.font = `${Math.max(7, width * 0.0065)}px ui-monospace, SFMono-Regular, monospace`;
        context.textAlign = "center";
        context.fillText(String(layer * 4).padStart(2, "0"), x, height * 0.91);
      }

      for (let expert = 0; expert < EXPERTS; expert += 1) {
        const point = experts[layer][expert];
        const cached = cache[layer].includes(expert);
        const pulse = 0.7 + Math.sin(time * 0.002 + point.phase) * 0.3;
        if (cached) {
          context.strokeStyle = `rgba(125, 221, 225, ${0.25 + pulse * 0.3})`;
          context.lineWidth = 1;
          context.beginPath();
          context.arc(point.x, point.y, point.radius + 3.4, 0, TAU);
          context.stroke();
        }
        if (point.heat > 0.02) {
          const glow = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, 19 + point.heat * 13);
          glow.addColorStop(0, `rgba(184, 239, 135, ${point.heat * 0.6})`);
          glow.addColorStop(1, "rgba(184, 239, 135, 0)");
          context.fillStyle = glow;
          context.beginPath();
          context.arc(point.x, point.y, 20 + point.heat * 13, 0, TAU);
          context.fill();
        }
        context.fillStyle = point.heat > 0.05
          ? `rgba(198, 244, 153, ${0.5 + point.heat * 0.5})`
          : "rgba(116, 176, 164, 0.38)";
        context.beginPath();
        context.arc(point.x, point.y, point.radius + point.heat * 2, 0, TAU);
        context.fill();
      }
    }
  }

  function drawTrails() {
    context.save();
    context.globalCompositeOperation = "lighter";
    for (const trail of trails) {
      context.strokeStyle = `hsla(${trail.hue}, 88%, 72%, ${trail.life * 0.16})`;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(trail.x1, trail.y1);
      const middleX = (trail.x1 + trail.x2) / 2;
      context.bezierCurveTo(middleX, trail.y1, middleX, trail.y2, trail.x2, trail.y2);
      context.stroke();
    }
    context.restore();
  }

  function drawTokens() {
    context.save();
    context.globalCompositeOperation = "lighter";
    for (const token of tokens) {
      const tail = 9 + Math.min(18, token.word.length * 1.2);
      const gradient = context.createLinearGradient(token.x - tail, token.y, token.x + 5, token.y);
      gradient.addColorStop(0, `hsla(${token.hue}, 90%, 68%, 0)`);
      gradient.addColorStop(1, `hsla(${token.hue}, 94%, 75%, 0.8)`);
      context.strokeStyle = gradient;
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(token.x - tail, token.y + Math.sin(token.progress * Math.PI) * 2);
      context.lineTo(token.x, token.y);
      context.stroke();

      context.shadowColor = `hsla(${token.hue}, 94%, 72%, 0.9)`;
      context.shadowBlur = 12;
      context.fillStyle = `hsla(${token.hue}, 94%, 76%, 0.95)`;
      context.beginPath();
      context.ellipse(token.x, token.y, 4.5, 2.6, 0, 0, TAU);
      context.fill();
      context.shadowBlur = 0;

      if (width > 650) {
        context.fillStyle = "rgba(231, 244, 238, 0.76)";
        context.font = "9px ui-monospace, SFMono-Regular, monospace";
        context.textAlign = "left";
        context.fillText(token.word, token.x + 8, token.y - 7);
      }
    }
    context.restore();
  }

  function draw(time) {
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBackground(time);
    drawTrails();
    drawReefs(time);
    drawTokens();
  }

  function updateTelemetry() {
    policyOutput.textContent = policy.resident ? "resident reefs" : "streaming reefs";
    cacheOutput.textContent = String(policy.cacheSize);
    rateOutput.textContent = policy.tokenRate.toFixed(2);
    hitOutput.textContent = lookups ? `${Math.round((hits / lookups) * 100)}%` : "0%";
  }

  function frame(time) {
    const dt = Math.min(0.05, (time - lastTime) / 1000);
    lastTime = time;
    update(dt);
    draw(time);
    updateTelemetry();
    requestAnimationFrame(frame);
  }

  budgetInput.addEventListener("input", () => {
    budget = Number(budgetInput.value);
    policy = policyFor(budget);
    budgetOutput.value = `${budget} GiB`;
    for (const layerCache of cache) {
      while (layerCache.length > policy.visualCache) layerCache.shift();
    }
    observation.textContent = policy.resident
      ? `${budget} GiB keeps the ordinary reefs resident; ${policy.cacheSize} familiar experts per layer may stay warm.`
      : `${budget} GiB streams the reefs themselves. Cache misses pause while an expert surfaces from storage.`;
    updateTelemetry();
  });

  releaseButton.addEventListener("click", releasePrompt);
  promptInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") releasePrompt();
  });
  addEventListener("resize", resize);

  parsePrompt();
  resize();
  releasePrompt();
  updateTelemetry();
  requestAnimationFrame(frame);
})();
