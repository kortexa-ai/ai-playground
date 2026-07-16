import "./vendor/aval-element.min.js";

const SEASONS = ["winter", "spring", "summer", "autumn"];

const HOLDING = {
  winter: "winter holds — the lake is iron, the oak is ink",
  spring: "spring holds — the hill remembers how to be green",
  summer: "summer holds — the light leans long across the grass",
  autumn: "autumn holds — the oak lets its amber go slowly",
};

const painting = document.querySelector("#painting");
const status = document.querySelector("#status");
const hint = document.querySelector("#hint");
const dialButtons = [...document.querySelectorAll(".dial button")];

const AUTO_TURN_MS = 45000;
let lastTouch = Date.now();
let desired = null;
let traveling = false;

function seasonForDate(date = new Date()) {
  const m = date.getMonth();
  if (m === 11 || m <= 1) return "winter";
  if (m <= 4) return "spring";
  if (m <= 7) return "summer";
  return "autumn";
}

function setStatus(text) {
  if (status) status.textContent = text;
}

function markDial(season) {
  for (const b of dialButtons) {
    if (b.dataset.season === season) b.setAttribute("data-current", "");
    else b.removeAttribute("data-current");
  }
}

function stepToward(from, to) {
  const a = SEASONS.indexOf(from);
  const b = SEASONS.indexOf(to);
  if (a < 0 || b < 0 || a === b) return to;
  const forward = (b - a + 4) % 4;
  return forward <= 2 ? SEASONS[(a + 1) % 4] : SEASONS[(a + 3) % 4];
}

async function travel(target) {
  desired = target;
  if (traveling) return;
  traveling = true;
  try {
    while (desired && painting.visualState !== desired) {
      const hop = stepToward(painting.visualState, desired);
      await painting.setState(hop);
    }
  } catch (error) {
    if (error?.name !== "AbortError") {
      console.error("Almanac travel failed", error);
    }
  } finally {
    traveling = false;
  }
}

function turn(direction) {
  const current = SEASONS.indexOf(desired ?? painting.visualState);
  if (current < 0) return;
  travel(SEASONS[(current + direction + 4) % 4]);
}

function touch() {
  lastTouch = Date.now();
  hint?.setAttribute("data-dim", "");
}

// --- reveal once frames are actually decoding -------------------------------

const renderedReadiness = new Set([
  "visualReady",
  "interactiveReady",
  "staticReady",
]);

function revealWhenRendered() {
  if (!renderedReadiness.has(painting.readiness)) return;
  painting.removeEventListener("readinesschange", revealWhenRendered);
  requestAnimationFrame(() => {
    painting.dataset.rendered = "";
  });
}

painting?.addEventListener("readinesschange", revealWhenRendered);
if (painting) revealWhenRendered();

// --- follow the graph --------------------------------------------------------

painting?.addEventListener("readinesschange", () => {
  if (painting.readiness === "interactiveReady") {
    const season = seasonForDate();
    markDial(painting.visualState);
    setStatus(HOLDING[painting.visualState] ?? "");
    if (painting.visualState !== season) travel(season);
  } else if (painting.readiness === "staticReady") {
    markDial(painting.visualState);
    setStatus("the still version — this browser keeps the painting quiet");
  }
});

painting?.addEventListener("transitionstart", () => {
  const to = painting.requestedState ?? desired;
  const from = painting.visualState;
  if (from && to && from !== to) setStatus(`${from} is becoming ${to}…`);
});

painting?.addEventListener("visualstatechange", (event) => {
  markDial(event.detail.to);
  if (event.detail.to === (desired ?? event.detail.to)) {
    setStatus(HOLDING[event.detail.to] ?? "");
  }
});

painting?.addEventListener("fallback", () => {
  setStatus("the still version — the living one wants WebCodecs and WebGL");
});

painting?.addEventListener("error", (event) => {
  console.error("Almanac runtime failure", event.detail?.failure ?? event);
});

// --- input -------------------------------------------------------------------

painting?.addEventListener("click", () => {
  touch();
  turn(1);
});

for (const button of dialButtons) {
  button.addEventListener("click", () => {
    touch();
    travel(button.dataset.season);
  });
}

window.addEventListener("keydown", (event) => {
  if (event.key === "ArrowRight") {
    touch();
    turn(1);
  } else if (event.key === "ArrowLeft") {
    touch();
    turn(-1);
  }
});

// --- left alone, the year turns itself ---------------------------------------

setInterval(() => {
  if (document.visibilityState !== "visible") return;
  if (Date.now() - lastTouch < AUTO_TURN_MS) return;
  if (!renderedReadiness.has(painting?.readiness)) return;
  if (painting.readiness === "staticReady") return;
  lastTouch = Date.now();
  turn(1);
}, 5000);
