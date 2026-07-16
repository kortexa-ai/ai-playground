(() => {
  "use strict";

  const TAU = Math.PI * 2;
  const FIXED_STEP = 1 / 60;
  const PLAYER_SPEED = 3.35;
  const PLAYER_RADIUS = 0.23;
  const STORAGE_KEY = "one-more-you-progress-v1";
  const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ECHO_COLORS = [
    "#f15b40",
    "#71c7b8",
    "#f2c84b",
    "#8a68c7",
    "#ef8da1",
    "#68a4e8",
  ];
  const CHANNEL_COLORS = {
    a: "#496fdf",
    b: "#f15b40",
    c: "#71c7b8",
    p: "#f2c84b",
  };

  const LEVELS = [
    {
      name: "THE DOOR",
      instruction: "Reach the bright doorway before the room rewinds.",
      success: "The simplest way out: walk through it while you still can.",
      duration: 12,
      map: [
        "###################",
        "#.................#",
        "#..............E..#",
        "#.................#",
        "#.................#",
        "#..S..............#",
        "#.................#",
        "#.................#",
        "###################",
      ],
    },
    {
      name: "THE FAVOR",
      instruction:
        "Stand on the blue switch, then keep that you. The next one can use the door.",
      success: "You left the door open for someone. They happened to be you.",
      duration: 12,
      map: [
        "###################",
        "#.......#.........#",
        "#.......#......E..#",
        "#.......A.........#",
        "#.......#.........#",
        "#..a....#.........#",
        "#..S....#.........#",
        "#.......#.........#",
        "###################",
      ],
    },
    {
      name: "THE HANDOFF",
      instruction:
        "Red opens red. Mint opens mint. Each earlier you can wait where the next cannot.",
      success: "A favor passed forward becomes a route.",
      duration: 12,
      map: [
        "#####################",
        "#......#......#.....#",
        "#......#......#..E..#",
        "#......B......C.....#",
        "#......#......#.....#",
        "#..b...#...c..#.....#",
        "#......#......#.....#",
        "#..S...#......#.....#",
        "#####################",
      ],
    },
    {
      name: "THE APPOINTMENT",
      instruction:
        "The yellow switch opens its door only briefly. One you must arrive so another can leave.",
      success: "Punctuality is easier when you can be in two places at once.",
      duration: 12,
      pulseDuration: 1.7,
      map: [
        "###################",
        "#........#........#",
        "#........P.....E..#",
        "#........#........#",
        "#........#........#",
        "#........#........#",
        "#........#........#",
        "#..S.....#........#",
        "#......p.#........#",
        "#........#........#",
        "###################",
      ],
    },
    {
      name: "THE QUORUM",
      instruction:
        "The two blue switches agree on everything. They open the door only together.",
      success: "One voice is a thought. Two become a decision.",
      duration: 12,
      map: [
        "###################",
        "#........#........#",
        "#..a.....#.....E..#",
        "#........#........#",
        "#........#........#",
        "#........A........#",
        "#........#........#",
        "#........#........#",
        "#..a.....#........#",
        "#.....S..#........#",
        "###################",
      ],
    },
    {
      name: "ALL OF US",
      instruction:
        "Hold blue. Keep red. Time yellow. There is room at the exit for every version of you.",
      success:
        "The room expected one of you. It was not prepared for a community.",
      duration: 12,
      pulseDuration: 1.7,
      exitRequires: ["b"],
      map: [
        "#######################",
        "#......#.......#......#",
        "#......#...b...#...E..#",
        "#......#.......#......#",
        "#......#.......#......#",
        "#......A.......P......#",
        "#......#.......#......#",
        "#..a...#.p.....#......#",
        "#..S...#.......#......#",
        "#......#.......#......#",
        "#######################",
      ],
    },
  ];

  const canvas = document.querySelector("#game-canvas");
  const context = canvas.getContext("2d", { alpha: false });
  const viewport = document.querySelector("#viewport");
  const curtain = document.querySelector("#curtain");
  const curtainCard = document.querySelector("#curtain-card");
  const roomNumber = document.querySelector("#room-number");
  const roomName = document.querySelector("#room-name");
  const loopNumber = document.querySelector("#loop-number");
  const timeLabel = document.querySelector("#time-label");
  const timelineFill = document.querySelector("#timeline-fill");
  const echoMarkers = document.querySelector("#echo-markers");
  const instruction = document.querySelector("#instruction");
  const loopButton = document.querySelector("#loop-button");
  const undoButton = document.querySelector("#undo-button");
  const restartButton = document.querySelector("#restart-button");
  const soundButton = document.querySelector("#sound-button");
  const helpButton = document.querySelector("#help-button");
  const pauseStamp = document.querySelector("#pause-stamp");
  const flash = document.querySelector("#flash");
  const liveRegion = document.querySelector("#live-region");

  const keys = new Set();
  const touchDirections = new Set();
  const pointerStick = {
    active: false,
    id: null,
    originX: 0,
    originY: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
  };

  let viewWidth = 1;
  let viewHeight = 1;
  let viewDpr = 1;
  let levelIndex = 0;
  let level = null;
  let parsed = null;
  let player = null;
  let echoes = [];
  let recording = [];
  let plateState = {};
  let previousPlateActive = {};
  let pulseUntil = -1;
  let pulseInside = [];
  let loopTime = 0;
  let started = false;
  let paused = false;
  let won = false;
  let accumulator = 0;
  let lastFrame = performance.now();
  let stepClock = 0;
  let lastStepSound = -1;
  let gateVisual = {};
  let particles = [];
  let boardTransform = { x: 0, y: 0, tile: 1 };
  let winTimer = 0;
  let progress = readProgress();

  class SoundRoom {
    constructor() {
      this.context = null;
      this.master = null;
      this.enabled = progress.sound !== false;
      this.started = false;
    }

    ensure() {
      if (!this.context) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return false;
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = this.enabled ? 0.16 : 0;
        this.master.connect(this.context.destination);
      }
      if (this.context.state === "suspended") this.context.resume();
      if (!this.started) this.startHum();
      return true;
    }

    startHum() {
      if (!this.context || this.started) return;
      this.started = true;
      const filter = this.context.createBiquadFilter();
      const bed = this.context.createGain();
      const lfo = this.context.createOscillator();
      const lfoDepth = this.context.createGain();
      filter.type = "lowpass";
      filter.frequency.value = 190;
      filter.Q.value = 0.7;
      bed.gain.value = 0.055;
      lfo.frequency.value = 0.08;
      lfoDepth.gain.value = 0.018;
      lfo.connect(lfoDepth);
      lfoDepth.connect(bed.gain);
      bed.connect(filter);
      filter.connect(this.master);
      [55, 82.5].forEach((frequency, index) => {
        const oscillator = this.context.createOscillator();
        const gain = this.context.createGain();
        oscillator.type = index ? "sine" : "triangle";
        oscillator.frequency.value = frequency;
        gain.gain.value = index ? 0.24 : 0.42;
        oscillator.connect(gain);
        gain.connect(bed);
        oscillator.start();
      });
      lfo.start();
    }

    setEnabled(enabled) {
      this.enabled = enabled;
      progress.sound = enabled;
      writeProgress();
      if (enabled) this.ensure();
      if (this.master && this.context) {
        const now = this.context.currentTime;
        this.master.gain.cancelScheduledValues(now);
        this.master.gain.setTargetAtTime(enabled ? 0.16 : 0, now, 0.025);
      }
    }

    tone(frequency, duration = 0.12, options = {}) {
      if (!this.enabled || !this.ensure()) return;
      const now = this.context.currentTime + (options.delay || 0);
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = options.type || "sine";
      oscillator.frequency.setValueAtTime(frequency, now);
      if (options.to) {
        oscillator.frequency.exponentialRampToValueAtTime(
          options.to,
          now + duration,
        );
      }
      const peak = options.gain ?? 0.2;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(peak, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(gain);
      gain.connect(this.master);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.03);
    }

    step() {
      this.tone(88 + (stepClock % 2) * 12, 0.035, {
        type: "triangle",
        gain: 0.055,
      });
    }

    plate(channel) {
      const notes = { a: 220, b: 277.18, c: 329.63 };
      const note = notes[channel] || 220;
      this.tone(note, 0.16, { type: "triangle", gain: 0.14 });
      this.tone(note * 1.5, 0.22, { delay: 0.045, gain: 0.1 });
    }

    pulse() {
      this.tone(392, 0.1, { type: "square", gain: 0.09 });
      this.tone(523.25, 0.28, { delay: 0.055, type: "triangle", gain: 0.12 });
    }

    rewind() {
      this.tone(440, 0.34, { to: 82.5, type: "sawtooth", gain: 0.12 });
      this.tone(220, 0.28, { to: 55, delay: 0.035, gain: 0.1 });
    }

    undo() {
      this.tone(185, 0.15, { to: 110, type: "triangle", gain: 0.1 });
    }

    win() {
      [261.63, 329.63, 392, 523.25].forEach((note, index) => {
        this.tone(note, 0.8 - index * 0.06, {
          delay: index * 0.075,
          type: index % 2 ? "triangle" : "sine",
          gain: 0.14,
        });
      });
    }
  }

  const sound = new SoundRoom();

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function lerp(a, b, amount) {
    return a + (b - a) * amount;
  }

  function distanceSquared(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  function readProgress() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return {
        unlocked: clamp(Number(value?.unlocked) || 0, 0, LEVELS.length),
        completed: Boolean(value?.completed),
        sound: value?.sound !== false,
      };
    } catch {
      return { unlocked: 0, completed: false, sound: true };
    }
  }

  function writeProgress() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch {
      // A private tab may decline storage. The room still works for this visit.
    }
  }

  function announce(message) {
    liveRegion.textContent = "";
    requestAnimationFrame(() => {
      liveRegion.textContent = message;
    });
  }

  function parseLevel(definition) {
    const rows = definition.map;
    const columns = rows[0].length;
    if (!rows.every((row) => row.length === columns)) {
      throw new Error(`Uneven map rows in ${definition.name}`);
    }
    const result = {
      rows: rows.length,
      columns,
      grid: rows.map((row) => [...row]),
      start: null,
      exit: null,
      plates: {},
      pulseSwitches: [],
    };
    for (let y = 0; y < result.rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        const cell = result.grid[y][x];
        const point = { x: x + 0.5, y: y + 0.5, cell, gridX: x, gridY: y };
        if (cell === "S") result.start = point;
        if (cell === "E") result.exit = point;
        if (cell >= "a" && cell <= "c") {
          (result.plates[cell] ||= []).push(point);
        }
        if (cell === "p") result.pulseSwitches.push(point);
      }
    }
    if (!result.start || !result.exit) {
      throw new Error(`Missing start or exit in ${definition.name}`);
    }
    return result;
  }

  function snapshotPlayer() {
    return {
      x: player.x,
      y: player.y,
      facingX: player.facingX,
      facingY: player.facingY,
      moving: player.moving,
    };
  }

  function echoAt(echo, time = loopTime) {
    const index = Math.min(
      echo.samples.length - 1,
      Math.max(0, Math.floor(time / FIXED_STEP)),
    );
    return echo.samples[index] || echo.samples[echo.samples.length - 1];
  }

  function activeActors() {
    return [player, ...echoes.map((echo) => echoAt(echo))];
  }

  function cellAtGrid(x, y) {
    if (!parsed || y < 0 || y >= parsed.rows || x < 0 || x >= parsed.columns) {
      return "#";
    }
    return parsed.grid[y][x];
  }

  function gateIsOpen(cell) {
    if (cell === "P") return pulseUntil > loopTime;
    if (cell >= "A" && cell <= "C") {
      return Boolean(plateState[cell.toLowerCase()]?.active);
    }
    return false;
  }

  function exitIsOpen() {
    const requirements = level.exitRequires || [];
    return requirements.every((channel) => plateState[channel]?.active);
  }

  function blockingCell(x, y) {
    const cell = cellAtGrid(x, y);
    if (cell === "#") return true;
    if ((cell >= "A" && cell <= "C") || cell === "P") {
      return !gateIsOpen(cell);
    }
    return false;
  }

  function circleHitsRoom(x, y, radius = PLAYER_RADIUS) {
    const minimumX = Math.floor(x - radius);
    const maximumX = Math.floor(x + radius);
    const minimumY = Math.floor(y - radius);
    const maximumY = Math.floor(y + radius);
    for (let gridY = minimumY; gridY <= maximumY; gridY += 1) {
      for (let gridX = minimumX; gridX <= maximumX; gridX += 1) {
        if (!blockingCell(gridX, gridY)) continue;
        const nearestX = clamp(x, gridX, gridX + 1);
        const nearestY = clamp(y, gridY, gridY + 1);
        const dx = x - nearestX;
        const dy = y - nearestY;
        if (dx * dx + dy * dy < radius * radius - 0.00001) return true;
      }
    }
    return false;
  }

  function inputVector() {
    let x = 0;
    let y = 0;
    if (keys.has("ArrowLeft") || keys.has("a") || touchDirections.has("left"))
      x -= 1;
    if (keys.has("ArrowRight") || keys.has("d") || touchDirections.has("right"))
      x += 1;
    if (keys.has("ArrowUp") || keys.has("w") || touchDirections.has("up"))
      y -= 1;
    if (keys.has("ArrowDown") || keys.has("s") || touchDirections.has("down"))
      y += 1;
    if (
      pointerStick.active &&
      Math.hypot(pointerStick.vx, pointerStick.vy) > 0.08
    ) {
      x += pointerStick.vx;
      y += pointerStick.vy;
    }
    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }
    return { x, y, length: Math.min(1, length) };
  }

  function movePlayer(delta) {
    const input = inputVector();
    player.moving = input.length > 0.06;
    if (!player.moving) return;
    player.facingX = input.x;
    player.facingY = input.y;
    const amount = PLAYER_SPEED * delta;
    const nextX = player.x + input.x * amount;
    if (!circleHitsRoom(nextX, player.y)) player.x = nextX;
    const nextY = player.y + input.y * amount;
    if (!circleHitsRoom(player.x, nextY)) player.y = nextY;
    stepClock += delta * PLAYER_SPEED;
    const step = Math.floor(stepClock * 1.65);
    if (step !== lastStepSound) {
      lastStepSound = step;
      sound.step();
    }
  }

  function actorOccupies(actor, point, radius = 0.5) {
    return distanceSquared(actor, point) <= radius * radius;
  }

  function updatePlateState(actors, makeSound = true) {
    const next = {};
    for (const [channel, plates] of Object.entries(parsed.plates)) {
      const occupied = plates.map((plate) =>
        actors.some((actor) => actorOccupies(actor, plate)),
      );
      next[channel] = {
        active: occupied.every(Boolean),
        occupied,
        count: occupied.filter(Boolean).length,
        total: plates.length,
      };
      if (makeSound && next[channel].active && !previousPlateActive[channel]) {
        sound.plate(channel);
        announce(`${channel.toUpperCase()} door unlocked.`);
      }
      previousPlateActive[channel] = next[channel].active;
    }
    plateState = next;
  }

  function updatePulseSwitches(actors) {
    if (!parsed.pulseSwitches.length) return;
    if (pulseInside.length !== actors.length) {
      pulseInside = new Array(actors.length).fill(false);
    }
    actors.forEach((actor, index) => {
      const inside = parsed.pulseSwitches.some((point) =>
        actorOccupies(actor, point),
      );
      if (inside && !pulseInside[index]) {
        pulseUntil = loopTime + (level.pulseDuration || 1.7);
        sound.pulse();
        announce("Yellow door open briefly.");
      }
      pulseInside[index] = inside;
    });
  }

  function updateInstruction() {
    if (pulseUntil > loopTime) {
      instruction.textContent = `Yellow door open — ${(pulseUntil - loopTime).toFixed(1)} seconds.`;
      return;
    }
    for (const [channel, state] of Object.entries(plateState)) {
      if (state.count > 0 && !state.active) {
        instruction.textContent = `${state.count} of ${state.total} ${channelName(channel)} switches held. Keep this you and find the other.`;
        return;
      }
      if (state.active && echoes.length === 0 && playerOnChannel(channel)) {
        instruction.textContent =
          "The switch is down. Press Space or LOOP to keep this you here.";
        return;
      }
    }
    instruction.textContent = level.instruction;
  }

  function playerOnChannel(channel) {
    return (parsed.plates[channel] || []).some((plate) =>
      actorOccupies(player, plate),
    );
  }

  function channelName(channel) {
    return { a: "blue", b: "red", c: "mint" }[channel] || channel;
  }

  function update(delta) {
    loopTime += delta;
    const before = activeActors();
    updatePlateState(before);
    movePlayer(delta);
    const actors = activeActors();
    updatePulseSwitches(actors);
    updatePlateState(actors);
    recording.push(snapshotPlayer());
    updateInstruction();

    if (exitIsOpen() && actorOccupies(player, parsed.exit, 0.48)) {
      finishLevel();
      return;
    }

    if (loopTime >= level.duration) commitLoop("timer");
  }

  function resetLoopState() {
    player = {
      x: parsed.start.x,
      y: parsed.start.y,
      facingX: 1,
      facingY: 0,
      moving: false,
    };
    recording = [snapshotPlayer()];
    loopTime = 0;
    pulseUntil = -1;
    pulseInside = new Array(echoes.length + 1).fill(false);
    previousPlateActive = {};
    updatePlateState(activeActors(), false);
    stepClock = 0;
    lastStepSound = -1;
    keys.clear();
    touchDirections.clear();
    clearPointerStick();
    updateHud();
    updateInstruction();
  }

  function commitLoop(reason = "button") {
    if (!started || paused || won || curtain.classList.contains("is-visible"))
      return;
    const actorSnapshots = activeActors().map((actor) => ({ ...actor }));
    echoes.push({
      samples: recording.map((sample) => ({ ...sample })),
      duration: clamp(loopTime, FIXED_STEP, level.duration),
      color: ECHO_COLORS[echoes.length % ECHO_COLORS.length],
    });
    burstActors(actorSnapshots, reason === "timer" ? 14 : 9);
    sound.rewind();
    triggerFlash("rewinding");
    if (navigator.vibrate && !REDUCED_MOTION) navigator.vibrate(22);
    resetLoopState();
    announce(`Loop rewound. Echo ${echoes.length} is now repeating your path.`);
  }

  function undoEcho() {
    if (!started || won || !echoes.length) return;
    echoes.pop();
    sound.undo();
    resetLoopState();
    announce("Latest echo removed.");
  }

  function restartLevel() {
    if (!started) return;
    clearTimeout(winTimer);
    echoes = [];
    won = false;
    paused = false;
    gateVisual = {};
    particles = [];
    resetLoopState();
    pauseStamp.hidden = true;
    closeCurtain();
    announce(`${level.name} restarted.`);
  }

  function loadLevel(index) {
    clearTimeout(winTimer);
    levelIndex = clamp(index, 0, LEVELS.length - 1);
    level = LEVELS[levelIndex];
    parsed = parseLevel(level);
    echoes = [];
    won = false;
    paused = false;
    gateVisual = {};
    particles = [];
    resetLoopState();
    roomNumber.textContent = `${String(levelIndex + 1).padStart(2, "0")} / ${String(LEVELS.length).padStart(2, "0")}`;
    roomName.textContent = level.name;
    canvas.setAttribute(
      "aria-label",
      `${level.name}. ${level.instruction} Use arrow keys or WASD to move. Press Space to keep this path as an echo.`,
    );
    updateHud();
  }

  function finishLevel() {
    if (won) return;
    won = true;
    progress.unlocked = Math.max(progress.unlocked, levelIndex + 1);
    if (levelIndex === LEVELS.length - 1) progress.completed = true;
    writeProgress();
    burstAt(parsed.exit.x, parsed.exit.y, 54, "#71c7b8");
    sound.win();
    triggerFlash("winning");
    if (navigator.vibrate && !REDUCED_MOTION) navigator.vibrate([30, 40, 55]);
    announce(`${level.name} complete. ${level.success}`);
    winTimer = window.setTimeout(showResult, 850);
  }

  function updateHud() {
    if (!level) return;
    const remaining = Math.max(0, level.duration - loopTime);
    const fraction = clamp(remaining / level.duration, 0, 1);
    timeLabel.textContent = remaining.toFixed(1);
    timelineFill.style.transform = `scaleX(${fraction})`;
    loopNumber.textContent = `YOU · ${String(echoes.length + 1).padStart(2, "0")}`;
    undoButton.disabled = echoes.length === 0;
    echoMarkers.replaceChildren(
      ...echoes.map((echo) => {
        const marker = document.createElement("i");
        marker.style.left = `${clamp(echo.duration / level.duration, 0, 1) * 100}%`;
        return marker;
      }),
    );
  }

  function triggerFlash(className) {
    flash.className = "flash";
    void flash.offsetWidth;
    flash.classList.add(className);
  }

  function setCurtain(html) {
    curtainCard.innerHTML = html;
    curtain.classList.add("is-visible");
  }

  function closeCurtain() {
    curtain.classList.remove("is-visible");
  }

  function showStart() {
    const resumeRoom = clamp(progress.unlocked, 0, LEVELS.length - 1);
    const canContinue = progress.unlocked > 0;
    const continuation = progress.completed
      ? "visit the final room"
      : `continue from room ${String(resumeRoom + 1).padStart(2, "0")}`;
    setCurtain(`
      <p class="curtain-index">A COOPERATIVE GAME FOR ONE PERSON</p>
      <h2>Every twelve seconds,<br />the room forgets.</h2>
      <p class="curtain-copy">Your movements don’t.</p>
      <button class="primary-button" id="start-fresh" type="button">
        enter the first room <span aria-hidden="true">→</span>
      </button>
      <button class="continue-button" id="resume-progress" type="button" ${canContinue ? "" : "hidden"}>
        ${continuation}
      </button>
    `);
    curtainCard
      .querySelector("#start-fresh")
      ?.addEventListener("click", () => startGame(0));
    curtainCard
      .querySelector("#resume-progress")
      ?.addEventListener("click", () => startGame(resumeRoom));
  }

  function startGame(index) {
    sound.ensure();
    started = true;
    loadLevel(index);
    closeCurtain();
    canvas.focus({ preventScroll: true });
    announce(`${level.name}. ${level.instruction}`);
  }

  function showHelp() {
    const returnLabel = started ? "return to the room" : "back";
    setCurtain(`
      <p class="curtain-index">HOW TO COLLABORATE WITH YOURSELF</p>
      <h2>The room forgets.<br />Your path repeats.</h2>
      <ul class="how-list">
        <li><b>01</b><span>Move with <strong>WASD</strong>, the <strong>arrow keys</strong>, the touch pad, or by dragging inside the room.</span></li>
        <li><b>02</b><span>Stand somewhere useful and press <strong>Space</strong> or <strong>Keep This You</strong>. Time rewinds.</span></li>
        <li><b>03</b><span>Your echo repeats that path on every loop. Use earlier selves to hold switches and arrive on time.</span></li>
        <li><b>04</b><span><strong>Z</strong> removes the latest echo. <strong>R</strong> starts the room over. <strong>Esc</strong> pauses.</span></li>
      </ul>
      <button class="primary-button" id="close-help" type="button">${returnLabel} <span aria-hidden="true">→</span></button>
    `);
    curtainCard.querySelector("#close-help")?.addEventListener("click", () => {
      if (started) {
        closeCurtain();
        canvas.focus({ preventScroll: true });
      } else {
        showStart();
      }
    });
  }

  function showResult() {
    if (!won) return;
    const isFinal = levelIndex === LEVELS.length - 1;
    if (isFinal) {
      setCurtain(`
        <div class="room-stamp" aria-hidden="true">✓</div>
        <p class="curtain-index">ALL SIX ROOMS REMEMBER</p>
        <h2>Thank you for<br />showing up for yourself.</h2>
        <p class="room-result">${level.success}<br />Nobody got left behind. Not even the first attempt.</p>
        <button class="primary-button" id="again-button" type="button">begin again <span aria-hidden="true">↻</span></button>
        <a class="continue-button" href="../">return to the playground</a>
      `);
      curtainCard
        .querySelector("#again-button")
        ?.addEventListener("click", () => startGame(0));
      return;
    }
    setCurtain(`
      <div class="room-stamp" aria-hidden="true">${String(levelIndex + 1).padStart(2, "0")}</div>
      <p class="curtain-index">ROOM COMPLETE · ${echoes.length} ${echoes.length === 1 ? "ECHO" : "ECHOES"}</p>
      <h2>${level.name}</h2>
      <p class="room-result">${level.success}</p>
      <button class="primary-button" id="next-room" type="button">enter room ${String(levelIndex + 2).padStart(2, "0")} <span aria-hidden="true">→</span></button>
      <button class="continue-button" id="replay-room" type="button">replay this room</button>
    `);
    curtainCard.querySelector("#next-room")?.addEventListener("click", () => {
      loadLevel(levelIndex + 1);
      closeCurtain();
      canvas.focus({ preventScroll: true });
      announce(`${level.name}. ${level.instruction}`);
    });
    curtainCard.querySelector("#replay-room")?.addEventListener("click", () => {
      loadLevel(levelIndex);
      closeCurtain();
      canvas.focus({ preventScroll: true });
    });
  }

  function togglePause(force) {
    if (!started || won || curtain.classList.contains("is-visible")) return;
    paused = typeof force === "boolean" ? force : !paused;
    pauseStamp.hidden = !paused;
    if (!paused) {
      lastFrame = performance.now();
      canvas.focus({ preventScroll: true });
      announce("Room resumed.");
    } else {
      keys.clear();
      touchDirections.clear();
      clearPointerStick();
      announce("Room paused.");
    }
  }

  function clearPointerStick() {
    pointerStick.active = false;
    pointerStick.id = null;
    pointerStick.vx = 0;
    pointerStick.vy = 0;
  }

  function pointerPosition(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function updatePointerStick(event) {
    const point = pointerPosition(event);
    pointerStick.x = point.x;
    pointerStick.y = point.y;
    const dx = point.x - pointerStick.originX;
    const dy = point.y - pointerStick.originY;
    const radius = Math.min(64, Math.max(34, viewWidth * 0.075));
    const length = Math.hypot(dx, dy);
    const strength = clamp((length - 5) / (radius - 5), 0, 1);
    pointerStick.vx = length ? (dx / length) * strength : 0;
    pointerStick.vy = length ? (dy / length) * strength : 0;
  }

  function burstActors(actors, count) {
    actors.forEach((actor, index) => {
      burstAt(actor.x, actor.y, count, ECHO_COLORS[index % ECHO_COLORS.length]);
    });
  }

  function burstAt(x, y, count, color) {
    if (REDUCED_MOTION) count = Math.min(6, count);
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * TAU + Math.random() * 0.4;
      const speed = 0.6 + Math.random() * 2.3;
      const life = 0.45 + Math.random() * 0.65;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color,
        life,
        maximumLife: life,
        size: 0.035 + Math.random() * 0.07,
      });
    }
  }

  function updateParticles(delta) {
    for (const particle of particles) {
      particle.life -= delta;
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      particle.vx *= Math.pow(0.08, delta);
      particle.vy *= Math.pow(0.08, delta);
    }
    particles = particles.filter((particle) => particle.life > 0);
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    viewDpr = Math.min(devicePixelRatio || 1, 2);
    viewWidth = Math.max(1, Math.round(rect.width));
    viewHeight = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(viewWidth * viewDpr);
    canvas.height = Math.round(viewHeight * viewDpr);
    context.setTransform(viewDpr, 0, 0, viewDpr, 0, 0);
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function setBoardTransform() {
    const padX = clamp(viewWidth * 0.055, 14, 58);
    const padY = clamp(viewHeight * 0.065, 14, 42);
    const tile = Math.min(
      (viewWidth - padX * 2) / parsed.columns,
      (viewHeight - padY * 2) / parsed.rows,
    );
    boardTransform = {
      tile,
      x: (viewWidth - parsed.columns * tile) / 2,
      y: (viewHeight - parsed.rows * tile) / 2,
    };
  }

  function worldToScreen(point) {
    return {
      x: boardTransform.x + point.x * boardTransform.tile,
      y: boardTransform.y + point.y * boardTransform.tile,
    };
  }

  function drawBackground(time) {
    const ctx = context;
    const gradient = ctx.createRadialGradient(
      viewWidth * 0.5,
      viewHeight * 0.42,
      0,
      viewWidth * 0.5,
      viewHeight * 0.5,
      Math.max(viewWidth, viewHeight) * 0.76,
    );
    gradient.addColorStop(0, "#1d2230");
    gradient.addColorStop(0.58, "#11151f");
    gradient.addColorStop(1, "#090c12");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, viewWidth, viewHeight);

    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.strokeStyle = "#fffaf1";
    ctx.lineWidth = 1;
    const spacing = Math.max(22, viewWidth / 31);
    const offset = (time * 2.5) % spacing;
    for (
      let x = -viewHeight + offset;
      x < viewWidth + viewHeight;
      x += spacing
    ) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x - viewHeight, viewHeight);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawRoom(time, delta) {
    const ctx = context;
    setBoardTransform();
    const { tile, x: originX, y: originY } = boardTransform;
    const boardWidth = parsed.columns * tile;
    const boardHeight = parsed.rows * tile;

    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.34)";
    roundedRect(
      ctx,
      originX + tile * 0.28,
      originY + tile * 0.34,
      boardWidth,
      boardHeight,
      tile * 0.16,
    );
    ctx.fill();

    ctx.fillStyle = "#ddd6c9";
    ctx.fillRect(originX, originY, boardWidth, boardHeight);

    for (let y = 0; y < parsed.rows; y += 1) {
      for (let x = 0; x < parsed.columns; x += 1) {
        if (cellAtGrid(x, y) === "#") continue;
        ctx.fillStyle = (x + y) % 2 ? "#e7e0d3" : "#eee7da";
        ctx.fillRect(originX + x * tile, originY + y * tile, tile, tile);
        ctx.strokeStyle = "rgba(19, 22, 31, 0.085)";
        ctx.lineWidth = Math.max(0.5, tile * 0.018);
        ctx.strokeRect(originX + x * tile, originY + y * tile, tile, tile);
      }
    }

    drawEchoPaths();

    for (let y = 0; y < parsed.rows; y += 1) {
      for (let x = 0; x < parsed.columns; x += 1) {
        if (cellAtGrid(x, y) === "#") drawWall(x, y);
      }
    }

    const actors = activeActors();
    for (let y = 0; y < parsed.rows; y += 1) {
      for (let x = 0; x < parsed.columns; x += 1) {
        const cell = cellAtGrid(x, y);
        if (cell >= "a" && cell <= "c") drawPlate(x, y, cell, actors, time);
        if (cell === "p") drawPulseSwitch(x, y, actors, time);
        if ((cell >= "A" && cell <= "C") || cell === "P") {
          drawGate(x, y, cell, delta, time);
        }
        if (cell === "S") drawStart(x, y, time);
        if (cell === "E") drawExit(x, y, time);
      }
    }

    echoes.forEach((echo, index) =>
      drawActor(echoAt(echo), echo.color, true, index, time),
    );
    drawActor(player, "#fffaf1", false, echoes.length, time);
    drawParticles();
    ctx.restore();
  }

  function drawWall(gridX, gridY) {
    const ctx = context;
    const { tile, x: originX, y: originY } = boardTransform;
    const x = originX + gridX * tile;
    const y = originY + gridY * tile;
    ctx.fillStyle = "#272d3b";
    ctx.fillRect(x, y, tile + 0.4, tile + 0.4);
    ctx.fillStyle = "rgba(255, 250, 241, 0.075)";
    ctx.fillRect(x, y, tile, Math.max(1, tile * 0.07));
    ctx.fillRect(x, y, Math.max(1, tile * 0.055), tile);
    if (cellAtGrid(gridX, gridY + 1) !== "#") {
      ctx.fillStyle = "rgba(4, 6, 10, 0.22)";
      ctx.fillRect(x, y + tile * 0.78, tile, tile * 0.22);
    }
  }

  function drawEchoPaths() {
    const ctx = context;
    const { tile, x: originX, y: originY } = boardTransform;
    echoes.forEach((echo, echoIndex) => {
      if (echo.samples.length < 2) return;
      ctx.save();
      ctx.beginPath();
      const stride = Math.max(1, Math.floor(echo.samples.length / 90));
      for (let index = 0; index < echo.samples.length; index += stride) {
        const sample = echo.samples[index];
        const x = originX + sample.x * tile;
        const y = originY + sample.y * tile;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = echo.color;
      ctx.globalAlpha = echoIndex === echoes.length - 1 ? 0.23 : 0.12;
      ctx.lineWidth = Math.max(1, tile * 0.055);
      ctx.setLineDash([tile * 0.12, tile * 0.18]);
      ctx.stroke();
      ctx.restore();
    });
  }

  function drawPlate(gridX, gridY, channel, actors, time) {
    const ctx = context;
    const { tile, x: originX, y: originY } = boardTransform;
    const centerX = originX + (gridX + 0.5) * tile;
    const centerY = originY + (gridY + 0.5) * tile;
    const point = { x: gridX + 0.5, y: gridY + 0.5 };
    const occupied = actors.some((actor) => actorOccupies(actor, point));
    const color = CHANNEL_COLORS[channel];
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = occupied ? color : "rgba(19, 22, 31, 0.08)";
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, tile * 0.06);
    const size = tile * (occupied ? 0.43 : 0.38);
    ctx.fillRect(-size, -size, size * 2, size * 2);
    ctx.strokeRect(-size, -size, size * 2, size * 2);
    ctx.restore();
    ctx.fillStyle = occupied ? "#fffaf1" : color;
    ctx.font = `900 ${Math.max(6, tile * 0.2)}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(channel.toUpperCase(), centerX, centerY + tile * 0.015);
    if (occupied) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.3 + Math.sin(time * 5) * 0.1;
      ctx.lineWidth = tile * 0.05;
      ctx.beginPath();
      ctx.arc(centerX, centerY, tile * 0.56, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function drawPulseSwitch(gridX, gridY, actors, time) {
    const ctx = context;
    const { tile, x: originX, y: originY } = boardTransform;
    const x = originX + (gridX + 0.5) * tile;
    const y = originY + (gridY + 0.5) * tile;
    const point = { x: gridX + 0.5, y: gridY + 0.5 };
    const occupied = actors.some((actor) => actorOccupies(actor, point));
    const active = pulseUntil > loopTime;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(time * 0.45);
    ctx.strokeStyle = CHANNEL_COLORS.p;
    ctx.lineWidth = Math.max(1.2, tile * 0.055);
    ctx.strokeRect(-tile * 0.34, -tile * 0.34, tile * 0.68, tile * 0.68);
    ctx.rotate(-time * 0.9);
    ctx.strokeRect(-tile * 0.23, -tile * 0.23, tile * 0.46, tile * 0.46);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(x, y, tile * (occupied ? 0.21 : 0.14), 0, TAU);
    ctx.fillStyle = active ? CHANNEL_COLORS.p : "#8b815e";
    ctx.fill();
    if (active) {
      const fraction = clamp(
        (pulseUntil - loopTime) / (level.pulseDuration || 1.7),
        0,
        1,
      );
      ctx.strokeStyle = CHANNEL_COLORS.p;
      ctx.lineWidth = Math.max(2, tile * 0.08);
      ctx.beginPath();
      ctx.arc(x, y, tile * 0.48, -Math.PI / 2, -Math.PI / 2 + TAU * fraction);
      ctx.stroke();
    }
  }

  function drawGate(gridX, gridY, cell, delta, time) {
    const ctx = context;
    const { tile, x: originX, y: originY } = boardTransform;
    const key = `${gridX},${gridY}`;
    const target = gateIsOpen(cell) ? 1 : 0;
    gateVisual[key] = lerp(
      gateVisual[key] ?? target,
      target,
      1 - Math.exp(-delta * 12),
    );
    const openness = gateVisual[key];
    const x = originX + gridX * tile;
    const y = originY + gridY * tile;
    const channel = cell === "P" ? "p" : cell.toLowerCase();
    const color = CHANNEL_COLORS[channel];
    const vertical =
      cellAtGrid(gridX, gridY - 1) === "#" ||
      cellAtGrid(gridX, gridY + 1) === "#";
    ctx.save();
    ctx.fillStyle = "rgba(19, 22, 31, 0.13)";
    ctx.fillRect(x, y, tile, tile);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.92;
    if (vertical) {
      const slab = (tile * (1 - openness)) / 2;
      ctx.fillRect(x + tile * 0.1, y, tile * 0.8, slab);
      ctx.fillRect(x + tile * 0.1, y + tile - slab, tile * 0.8, slab);
      ctx.strokeStyle = "rgba(255, 250, 241, 0.6)";
      ctx.lineWidth = Math.max(1, tile * 0.035);
      for (let stripe = 0.25; stripe < 0.9; stripe += 0.25) {
        if (slab > tile * stripe) {
          ctx.beginPath();
          ctx.moveTo(x + tile * 0.18, y + tile * stripe);
          ctx.lineTo(x + tile * 0.82, y + tile * stripe);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(x + tile * 0.18, y + tile * (1 - stripe));
          ctx.lineTo(x + tile * 0.82, y + tile * (1 - stripe));
          ctx.stroke();
        }
      }
    } else {
      const slab = (tile * (1 - openness)) / 2;
      ctx.fillRect(x, y + tile * 0.1, slab, tile * 0.8);
      ctx.fillRect(x + tile - slab, y + tile * 0.1, slab, tile * 0.8);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = openness > 0.7 ? color : "#fffaf1";
    ctx.font = `800 ${Math.max(6, tile * 0.2)}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      cell,
      x + tile * 0.5,
      y + tile * 0.5 + Math.sin(time * 3) * openness,
    );
    ctx.restore();
  }

  function drawStart(gridX, gridY, time) {
    const ctx = context;
    const { tile, x: originX, y: originY } = boardTransform;
    const x = originX + (gridX + 0.5) * tile;
    const y = originY + (gridY + 0.5) * tile;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(time * 0.2);
    ctx.strokeStyle = "rgba(19, 22, 31, 0.22)";
    ctx.lineWidth = Math.max(1, tile * 0.035);
    ctx.setLineDash([tile * 0.1, tile * 0.1]);
    ctx.beginPath();
    ctx.arc(0, 0, tile * 0.36, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  function drawExit(gridX, gridY, time) {
    const ctx = context;
    const { tile, x: originX, y: originY } = boardTransform;
    const x = originX + (gridX + 0.5) * tile;
    const y = originY + (gridY + 0.5) * tile;
    const open = exitIsOpen();
    const pulse = 0.5 + Math.sin(time * 3.2) * 0.5;
    ctx.save();
    ctx.translate(x, y);
    if (open) {
      ctx.shadowColor = "#71c7b8";
      ctx.shadowBlur = tile * (0.35 + pulse * 0.28);
    }
    roundedRect(
      ctx,
      -tile * 0.33,
      -tile * 0.42,
      tile * 0.66,
      tile * 0.84,
      tile * 0.3,
    );
    ctx.fillStyle = open ? "#71c7b8" : "#72756f";
    ctx.fill();
    ctx.shadowBlur = 0;
    roundedRect(
      ctx,
      -tile * 0.19,
      -tile * 0.29,
      tile * 0.38,
      tile * 0.58,
      tile * 0.18,
    );
    ctx.fillStyle = open ? "#eff9ef" : "#323640";
    ctx.fill();
    ctx.strokeStyle = open ? "rgba(19, 22, 31, 0.32)" : "#f15b40";
    ctx.lineWidth = Math.max(1.2, tile * 0.055);
    if (!open) {
      ctx.beginPath();
      ctx.moveTo(-tile * 0.15, -tile * 0.16);
      ctx.lineTo(tile * 0.15, tile * 0.16);
      ctx.moveTo(tile * 0.15, -tile * 0.16);
      ctx.lineTo(-tile * 0.15, tile * 0.16);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(-tile * 0.09, 0);
      ctx.lineTo(tile * 0.11, 0);
      ctx.lineTo(tile * 0.04, -tile * 0.08);
      ctx.moveTo(tile * 0.11, 0);
      ctx.lineTo(tile * 0.04, tile * 0.08);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawActor(actor, color, isEcho, index, time) {
    const ctx = context;
    const { tile, x: originX, y: originY } = boardTransform;
    const x = originX + actor.x * tile;
    const y = originY + actor.y * tile;
    const direction = Math.atan2(actor.facingY || 0, actor.facingX || 1);
    const bob = actor.moving ? Math.sin(time * 13 + index) * tile * 0.025 : 0;
    ctx.save();
    ctx.translate(x, y + bob);
    ctx.globalAlpha = isEcho ? 0.72 : 1;
    ctx.fillStyle = "rgba(19, 22, 31, 0.2)";
    ctx.beginPath();
    ctx.ellipse(0, tile * 0.24, tile * 0.28, tile * 0.12, 0, 0, TAU);
    ctx.fill();
    if (!isEcho) {
      ctx.shadowColor = "rgba(255, 250, 241, 0.75)";
      ctx.shadowBlur = tile * 0.22;
    }
    ctx.fillStyle = color;
    ctx.strokeStyle = isEcho ? "rgba(255, 250, 241, 0.7)" : "#13161f";
    ctx.lineWidth = Math.max(1.2, tile * 0.055);
    ctx.beginPath();
    ctx.arc(0, 0, tile * 0.245, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.rotate(direction);
    ctx.fillStyle = isEcho ? "rgba(255, 250, 241, 0.85)" : "#f15b40";
    ctx.beginPath();
    ctx.moveTo(tile * 0.33, 0);
    ctx.lineTo(tile * 0.13, -tile * 0.095);
    ctx.lineTo(tile * 0.13, tile * 0.095);
    ctx.closePath();
    ctx.fill();
    ctx.rotate(-direction);
    ctx.fillStyle = isEcho ? "#13161f" : "#13161f";
    ctx.beginPath();
    ctx.arc(0, 0, tile * 0.07, 0, TAU);
    ctx.fill();
    if (isEcho && tile > 18) {
      ctx.globalAlpha = 0.72;
      ctx.fillStyle = "#13161f";
      ctx.font = `900 ${Math.max(6, tile * 0.18)}px Arial, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(index + 1), 0, tile * 0.47);
    }
    ctx.restore();
  }

  function drawParticles() {
    const ctx = context;
    const { tile, x: originX, y: originY } = boardTransform;
    for (const particle of particles) {
      ctx.globalAlpha = clamp(particle.life / particle.maximumLife, 0, 1);
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(
        originX + particle.x * tile,
        originY + particle.y * tile,
        particle.size * tile,
        0,
        TAU,
      );
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawPointerStick() {
    if (!pointerStick.active) return;
    const ctx = context;
    const radius = Math.min(64, Math.max(34, viewWidth * 0.075));
    const knobX = pointerStick.originX + pointerStick.vx * radius;
    const knobY = pointerStick.originY + pointerStick.vy * radius;
    ctx.save();
    ctx.strokeStyle = "rgba(255, 250, 241, 0.36)";
    ctx.fillStyle = "rgba(19, 22, 31, 0.38)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pointerStick.originX, pointerStick.originY, radius, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(242, 200, 75, 0.85)";
    ctx.beginPath();
    ctx.arc(knobX, knobY, radius * 0.32, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawScreenEffects(time) {
    const ctx = context;
    ctx.save();
    ctx.globalAlpha = 0.038;
    ctx.fillStyle = "#fff";
    for (let y = 1; y < viewHeight; y += 4) ctx.fillRect(0, y, viewWidth, 1);
    ctx.restore();
    if (started && !won && loopTime > level.duration - 2.5) {
      const urgency = clamp((loopTime - (level.duration - 2.5)) / 2.5, 0, 1);
      const vignette = ctx.createRadialGradient(
        viewWidth * 0.5,
        viewHeight * 0.5,
        Math.min(viewWidth, viewHeight) * 0.25,
        viewWidth * 0.5,
        viewHeight * 0.5,
        Math.max(viewWidth, viewHeight) * 0.7,
      );
      vignette.addColorStop(0, "rgba(241, 91, 64, 0)");
      vignette.addColorStop(
        1,
        `rgba(241, 91, 64, ${urgency * (0.18 + Math.sin(time * 9) * 0.035)})`,
      );
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, viewWidth, viewHeight);
    }
  }

  function render(time, delta) {
    context.setTransform(viewDpr, 0, 0, viewDpr, 0, 0);
    drawBackground(time);
    if (parsed) drawRoom(time, delta);
    drawPointerStick();
    drawScreenEffects(time);
  }

  function frame(now) {
    const delta = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    const playing =
      started &&
      !paused &&
      !won &&
      !curtain.classList.contains("is-visible") &&
      document.visibilityState === "visible";
    if (playing) {
      accumulator = Math.min(accumulator + delta, FIXED_STEP * 4);
      while (accumulator >= FIXED_STEP) {
        update(FIXED_STEP);
        accumulator -= FIXED_STEP;
      }
      updateHud();
    } else {
      accumulator = 0;
    }
    updateParticles(delta);
    render(now / 1000, delta);
    requestAnimationFrame(frame);
  }

  window.addEventListener("keydown", (event) => {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const gameplayKey =
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(
        event.key,
      ) || ["w", "a", "s", "d", "r", "z"].includes(key);
    if (started && gameplayKey) event.preventDefault();
    if (event.key === "Escape") {
      if (curtain.classList.contains("is-visible") && started && !won) {
        closeCurtain();
      } else {
        togglePause();
      }
      return;
    }
    if (!started || paused || won || curtain.classList.contains("is-visible"))
      return;
    if (event.code === "Space" && !event.repeat) {
      loopButton.classList.add("is-pressed");
      commitLoop("button");
      return;
    }
    if (key === "r" && !event.repeat) {
      restartLevel();
      return;
    }
    if (key === "z" && !event.repeat) {
      undoEcho();
      return;
    }
    keys.add(key);
  });

  window.addEventListener("keyup", (event) => {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    keys.delete(key);
    if (event.code === "Space") loopButton.classList.remove("is-pressed");
  });

  window.addEventListener("blur", () => {
    keys.clear();
    touchDirections.clear();
    clearPointerStick();
  });

  canvas.addEventListener("pointerdown", (event) => {
    if (paused) {
      togglePause(false);
      return;
    }
    if (!started || won || curtain.classList.contains("is-visible")) return;
    const point = pointerPosition(event);
    pointerStick.active = true;
    pointerStick.id = event.pointerId;
    pointerStick.originX = point.x;
    pointerStick.originY = point.y;
    pointerStick.x = point.x;
    pointerStick.y = point.y;
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (pointerStick.active && event.pointerId === pointerStick.id) {
      updatePointerStick(event);
      event.preventDefault();
    }
  });

  function releasePointer(event) {
    if (event.pointerId === pointerStick.id) clearPointerStick();
  }

  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", releasePointer);
  canvas.addEventListener("lostpointercapture", releasePointer);

  document.querySelectorAll("[data-direction]").forEach((button) => {
    const direction = button.dataset.direction;
    const press = (event) => {
      if (paused) togglePause(false);
      touchDirections.add(direction);
      button.classList.add("is-pressed");
      button.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    };
    const release = () => {
      touchDirections.delete(direction);
      button.classList.remove("is-pressed");
    };
    button.addEventListener("pointerdown", press);
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("lostpointercapture", release);
  });

  loopButton.addEventListener("click", () => {
    sound.ensure();
    commitLoop("button");
  });
  undoButton.addEventListener("click", undoEcho);
  restartButton.addEventListener("click", restartLevel);
  helpButton.addEventListener("click", showHelp);
  soundButton.addEventListener("click", () => {
    sound.setEnabled(!sound.enabled);
    soundButton.setAttribute("aria-pressed", String(sound.enabled));
    soundButton.setAttribute(
      "aria-label",
      sound.enabled ? "Mute sound" : "Enable sound",
    );
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && started && !won) togglePause(true);
  });

  new ResizeObserver(resizeCanvas).observe(viewport);
  resizeCanvas();
  soundButton.setAttribute("aria-pressed", String(sound.enabled));
  soundButton.setAttribute(
    "aria-label",
    sound.enabled ? "Mute sound" : "Enable sound",
  );
  loadLevel(0);

  const roomParameter = Number(
    new URLSearchParams(location.search).get("room"),
  );
  if (
    Number.isFinite(roomParameter) &&
    roomParameter >= 1 &&
    roomParameter <= LEVELS.length
  ) {
    started = true;
    loadLevel(roomParameter - 1);
    closeCurtain();
  } else {
    showStart();
  }

  window.__ONE_MORE_YOU__ = {
    levelCount: LEVELS.length,
    startRoom(number) {
      startGame(clamp(Number(number) - 1, 0, LEVELS.length - 1));
    },
    state() {
      return {
        room: levelIndex + 1,
        roomName: level.name,
        loop: echoes.length + 1,
        echoes: echoes.length,
        loopTime,
        player: { x: player.x, y: player.y },
        plates: structuredClone(plateState),
        pulseOpen: pulseUntil > loopTime,
        exitOpen: exitIsOpen(),
        won,
        paused,
      };
    },
    restart: restartLevel,
  };

  requestAnimationFrame(frame);
})();
