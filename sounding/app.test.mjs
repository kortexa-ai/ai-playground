import test from "node:test";
import assert from "node:assert/strict";

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    names.forEach((name) => this.values.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.values.delete(name));
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.textContent = "";
    this.hidden = false;
    this.disabled = false;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = new FakeClassList();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async emit(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) await listener(event);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  focus() {}
}

test("the full survey opens, reaches the answer, and restarts", async () => {
  const ids = [
    "abyss",
    "answer",
    "contact-value",
    "depth-value",
    "instruction",
    "instrument",
    "live-region",
    "mode-value",
    "open-channel",
    "pulse-button",
    "pulse-value",
    "reading-log",
    "restart-button",
    "sound-toggle",
    "survey-code",
    "threshold",
    "winch-value",
  ];
  const elements = new Map(ids.map((id) => [id, new FakeElement(id)]));
  const context = { setTransform() {} };
  const canvas = elements.get("abyss");
  canvas.getContext = () => context;
  canvas.getBoundingClientRect = () => ({ width: 1280, height: 720 });
  canvas.animate = () => {};

  const body = new FakeElement("body");
  const windowListeners = new Map();
  let nextTimer = 1;
  const timers = new Map();
  const fakeSetTimeout = (callback) => {
    const id = nextTimer++;
    timers.set(id, callback);
    return id;
  };
  const flushTimers = () => {
    let safety = 100;
    while (timers.size && safety-- > 0) {
      const pending = [...timers.entries()];
      timers.clear();
      for (const [, callback] of pending) callback();
    }
    assert.ok(safety > 0, "timer queue should settle");
  };

  globalThis.devicePixelRatio = 1;
  globalThis.innerWidth = 1280;
  globalThis.innerHeight = 720;
  globalThis.matchMedia = () => ({ matches: true });
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.document = {
    body,
    createElement: () => new FakeElement(),
    getElementById: (id) => elements.get(id) ?? null,
  };
  globalThis.window = {
    addEventListener(type, listener) {
      const listeners = windowListeners.get(type) ?? [];
      listeners.push(listener);
      windowListeners.set(type, listeners);
    },
    setTimeout: fakeSetTimeout,
    clearTimeout: (id) => timers.delete(id),
  };

  await import(`./app.js?survey-test=${Date.now()}`);
  await elements.get("open-channel").emit("click");
  flushTimers();

  assert.equal(body.classList.contains("started"), true);
  assert.equal(elements.get("instrument").getAttribute("aria-hidden"), "false");
  assert.equal(elements.get("sound-toggle").textContent, "SOUND N/A");

  for (let pulse = 1; pulse <= 10; pulse += 1) {
    await elements.get("pulse-button").emit("click");
    flushTimers();
  }

  assert.equal(elements.get("pulse-value").textContent, "10");
  assert.equal(elements.get("depth-value").textContent, "9947");
  assert.equal(body.classList.contains("answered"), true);
  assert.equal(elements.get("answer").getAttribute("aria-hidden"), "false");
  assert.equal(elements.get("restart-button").hidden, false);

  await elements.get("restart-button").emit("click");
  flushTimers();

  assert.equal(body.classList.contains("answered"), false);
  assert.equal(elements.get("pulse-value").textContent, "00");
  assert.equal(elements.get("depth-value").textContent, "0000");
  assert.equal(elements.get("pulse-button").hidden, false);
});
