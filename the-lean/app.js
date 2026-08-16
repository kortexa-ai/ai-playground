// The Lean — a swarm with a want and a mood.
//
// The want is the bell: the swarm seeks it, and reaching it completes an
// errand. The mood is a bias injected into how the swarm flies: LOOK swirls
// it into orbits, OPEN throws it into sweeping dashes. The slider is the
// day's whole finding: on the big host it is an alpha dial — the mood tilts
// flight while errands keep completing — and on the small host it is a dose
// with a phase edge that moves when you reseed: below it the mood is deaf,
// above it the mood owns the swarm and the bell rings no more.

(() => {
  const canvas = document.getElementById("sky");
  const ctx = canvas.getContext("2d", { alpha: false });

  const COUNT = 230;
  const boids = [];
  const bell = { x: 0, y: 0, pulse: 0 };
  let width = 0;
  let height = 0;
  let errands = 0;
  let mood = "none";
  let host = "big";
  let dial = 0.5;
  let phaseEdge = rollEdge();
  let sweep = Math.random() * Math.PI * 2;
  let mix = { seek: 1, orbit: 0, dash: 0 };

  function rollEdge() {
    // the seed-dependent edge: somewhere in the middle, never where you
    // left it. (GF-2's per-seed 0.66 / 0.00 / 0.96, as a dial you can feel.)
    return 0.35 + Math.random() * 0.3;
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#070a10";
    ctx.fillRect(0, 0, width, height);
  }

  function placeBell() {
    const margin = 0.18;
    bell.x = (margin + Math.random() * (1 - 2 * margin)) * width;
    bell.y = (margin + Math.random() * (1 - 2 * margin)) * height;
    bell.pulse = 1;
  }

  function reset() {
    boids.length = 0;
    for (let i = 0; i < COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      boids.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: Math.cos(angle) * 1.4,
        vy: Math.sin(angle) * 1.4,
        wander: Math.random() * Math.PI * 2,
        lastForce: "seek",
      });
    }
    placeBell();
  }

  // The mood's effective grip, per host. Big: a smooth alpha. Small: a
  // phase edge with a narrow flickering band — bimodal, never a middle.
  function moodGrip() {
    if (mood === "none") return { weight: 0, possessed: false };
    if (host === "big") {
      return { weight: dial * 1.35, possessed: false };
    }
    const band = 0.035;
    if (dial < phaseEdge - band) return { weight: 0, possessed: false };
    if (dial > phaseEdge + band) return { weight: 3.2, possessed: true };
    const flicker = Math.sin(performance.now() * 0.011) > 0;
    return flicker
      ? { weight: 3.2, possessed: true }
      : { weight: 0, possessed: false };
  }

  function step() {
    const grip = moodGrip();
    const goalWeight = grip.possessed
      ? 0
      : host === "big"
        ? 1 - 0.35 * Math.min(grip.weight, 1)
        : 1;

    sweep += 0.0035;
    let cx = 0;
    let cy = 0;
    for (const b of boids) {
      cx += b.x;
      cy += b.y;
    }
    cx /= boids.length;
    cy /= boids.length;

    let nearBell = 0;
    const counts = { seek: 0, orbit: 0, dash: 0 };

    for (const b of boids) {
      let ax = 0;
      let ay = 0;

      // habit: separation from a few neighbors, mild cohesion, wander
      let sepX = 0;
      let sepY = 0;
      for (let k = 0; k < 4; k++) {
        const o = boids[(Math.random() * COUNT) | 0];
        const dx = b.x - o.x;
        const dy = b.y - o.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > 1 && d2 < 900) {
          sepX += dx / d2;
          sepY += dy / d2;
        }
      }
      ax += sepX * 26;
      ay += sepY * 26;
      ax += (cx - b.x) * 0.0004;
      ay += (cy - b.y) * 0.0004;
      b.wander += (Math.random() - 0.5) * 0.5;
      ax += Math.cos(b.wander) * 0.05;
      ay += Math.sin(b.wander) * 0.05;

      // the want: seek the bell
      const gx = bell.x - b.x;
      const gy = bell.y - b.y;
      const gd = Math.hypot(gx, gy) || 1;
      const seekMag = 0.11 * goalWeight;
      ax += (gx / gd) * seekMag;
      ay += (gy / gd) * seekMag;
      if (gd < 46) nearBell++;

      // the mood
      let moodMag = 0;
      if (grip.weight > 0) {
        if (mood === "look") {
          // orbit the swarm's own centroid — pure looking around
          const rx = b.x - cx;
          const ry = b.y - cy;
          const rd = Math.hypot(rx, ry) || 1;
          const tx = -ry / rd;
          const ty = rx / rd;
          moodMag = 0.14 * grip.weight;
          ax += tx * moodMag + (rx / rd) * 0.02 * grip.weight;
          ay += ty * moodMag + (ry / rd) * 0.02 * grip.weight;
        } else {
          // dash along a slow global sweep — opening distance, fast
          moodMag = 0.16 * grip.weight;
          ax += Math.cos(sweep) * moodMag;
          ay += Math.sin(sweep) * moodMag;
        }
      }

      b.lastForce =
        moodMag > seekMag ? (mood === "look" ? "orbit" : "dash") : "seek";
      counts[b.lastForce]++;

      b.vx = (b.vx + ax) * 0.96;
      b.vy = (b.vy + ay) * 0.96;
      const speed = Math.hypot(b.vx, b.vy);
      const cap = grip.possessed && mood === "open" ? 4.6 : 3.1;
      if (speed > cap) {
        b.vx = (b.vx / speed) * cap;
        b.vy = (b.vy / speed) * cap;
      }
      b.x += b.vx;
      b.y += b.vy;
      if (b.x < -20) b.x += width + 40;
      if (b.x > width + 20) b.x -= width + 40;
      if (b.y < -20) b.y += height + 40;
      if (b.y > height + 20) b.y -= height + 40;
    }

    const total = counts.seek + counts.orbit + counts.dash || 1;
    mix = {
      seek: counts.seek / total,
      orbit: counts.orbit / total,
      dash: counts.dash / total,
    };

    // an errand completes when a quarter of the swarm gathers at the bell
    if (nearBell > COUNT * 0.25 && goalWeight > 0) {
      errands++;
      document.getElementById("errand-count").textContent = String(errands);
      placeBell();
    }
    bell.pulse *= 0.985;
  }

  function draw() {
    ctx.fillStyle = "rgba(7, 10, 16, 0.22)";
    ctx.fillRect(0, 0, width, height);

    // the bell
    const glow = 16 + bell.pulse * 34;
    const grad = ctx.createRadialGradient(
      bell.x,
      bell.y,
      2,
      bell.x,
      bell.y,
      glow,
    );
    grad.addColorStop(0, "rgba(232, 193, 90, 0.9)");
    grad.addColorStop(1, "rgba(232, 193, 90, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(bell.x, bell.y, glow, 0, Math.PI * 2);
    ctx.fill();

    for (const b of boids) {
      ctx.fillStyle =
        b.lastForce === "seek"
          ? "rgba(232, 193, 90, 0.85)"
          : b.lastForce === "orbit"
            ? "rgba(90, 208, 232, 0.85)"
            : "rgba(232, 90, 155, 0.85)";
      ctx.fillRect(b.x - 1.1, b.y - 1.1, 2.2, 2.2);
    }
  }

  function hudTick() {
    const grip = moodGrip();
    const regime = document.getElementById("regime-label");
    let word = "habit";
    let cls = "";
    if (mood !== "none") {
      if (host === "big") {
        word = dial < 0.12 ? "habit" : dial < 0.6 ? "lean" : "strong lean";
        cls = dial >= 0.12 ? "lean" : "";
      } else if (grip.possessed) {
        word = "possession";
        cls = "possessed";
      } else {
        word = Math.abs(dial - phaseEdge) < 0.05 ? "the edge…" : "deaf";
      }
    }
    regime.textContent = word;
    regime.className = cls;
    document.getElementById("mix-seek").style.width = `${mix.seek * 100}%`;
    document.getElementById("mix-orbit").style.width = `${mix.orbit * 100}%`;
    document.getElementById("mix-dash").style.width = `${mix.dash * 100}%`;
  }

  function frame() {
    step();
    draw();
    requestAnimationFrame(frame);
  }

  // controls
  document.querySelectorAll('input[name="mood"]').forEach((el) =>
    el.addEventListener("change", () => {
      mood = el.value;
      document.getElementById("mood-label").textContent = mood;
    }),
  );
  document.querySelectorAll('input[name="host"]').forEach((el) =>
    el.addEventListener("change", () => {
      host = el.value;
      document.getElementById("host-label").textContent =
        host === "big" ? "big (27B)" : "small (230M)";
      document.getElementById("dial-name").textContent =
        host === "big" ? "α" : "dose";
    }),
  );
  const dialEl = document.getElementById("dial");
  dialEl.addEventListener("input", () => {
    dial = dialEl.value / 100;
    document.getElementById("dial-value").textContent = dial.toFixed(2);
  });
  document.getElementById("reseed").addEventListener("click", () => {
    phaseEdge = rollEdge();
  });

  window.addEventListener("resize", () => {
    resize();
  });

  resize();
  reset();
  setInterval(hudTick, 180);
  frame();
})();
