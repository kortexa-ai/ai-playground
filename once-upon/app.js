/* UI shell: owns the worker, streams tokens onto the page. */
"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const cover = $("cover");
  const desk = $("desk");
  const openBtn = $("open");
  const load = $("load");
  const loadFill = $("load-fill");
  const loadNote = $("load-note");
  const composer = $("composer");
  const seed = $("seed");
  const tell = $("tell");
  const temp = $("temp");
  const tempLabel = $("temp-label");
  const lengthSel = $("length");
  const page = document.querySelector(".page");
  const story = $("story");
  const stats = $("stats");

  let worker = null;
  let writing = false;

  function setWriting(on) {
    writing = on;
    page.classList.toggle("writing", on);
    tell.textContent = on ? "hush" : "tell me a story";
    seed.disabled = on;
  }

  function startWorker() {
    worker = new Worker("worker.js");
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === "progress") {
        const pct = m.total ? Math.round((100 * m.loaded) / m.total) : 0;
        loadFill.style.width = pct + "%";
        loadNote.textContent = `waking the storyteller… ${(m.loaded / 1e6).toFixed(1)} MB`;
      } else if (m.type === "ready") {
        cover.hidden = true;
        desk.hidden = false;
        seed.focus();
        stats.textContent = `${(m.bytes / 1e6).toFixed(1)} MB of storyteller, awake`;
      } else if (m.type === "token") {
        story.textContent += m.text;
      } else if (m.type === "done") {
        setWriting(false);
        const tps = m.seconds > 0 ? (m.tokens / m.seconds).toFixed(1) : "—";
        stats.textContent = `${m.tokens} tokens in ${m.seconds.toFixed(1)}s · ${tps} tokens/s · all local`;
      } else if (m.type === "error") {
        setWriting(false);
        loadNote.textContent = "something broke: " + m.message;
        stats.textContent = "something broke: " + m.message;
      }
    };
    worker.postMessage({ type: "load" });
  }

  openBtn.addEventListener("click", () => {
    openBtn.disabled = true;
    load.hidden = false;
    startWorker();
  });

  temp.addEventListener("input", () => {
    tempLabel.textContent = Number(temp.value).toFixed(2);
  });

  composer.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!worker) return;
    if (writing) {
      worker.postMessage({ type: "stop" });
      return;
    }
    const prompt = seed.value.trim() || "Once upon a time";
    story.textContent = prompt;
    stats.textContent = "thinking…";
    setWriting(true);
    worker.postMessage({
      type: "generate",
      prompt,
      maxTokens: Number(lengthSel.value),
      temperature: Number(temp.value),
      topK: 40,
      seed: (Math.random() * 4294967296) >>> 0,
    });
  });
})();
