(() => {
  "use strict";

  const STORAGE_KEY = "pirate-treasure-layout-designer-v1";
  const stage = document.getElementById("stage");
  if (!stage) return;

  const items = {
    frame: {
      name: "Frame",
      selector: "#frameLayer",
      x: "--frame-left",
      y: "--frame-top",
      w: "--frame-width",
      h: null,
      anchor: "topleft"
    },
    reels: {
      name: "Rulli",
      selector: "#reelsWrap",
      x: "--reels-left",
      y: "--reels-top",
      w: "--reels-width",
      h: "--reels-height",
      anchor: "topleft"
    },
    logo: {
      name: "Logo",
      selector: "#logoLayer",
      custom: true,
      anchor: "centerX"
    },
    lines: {
      name: "Linee",
      selector: "#linesPanel",
      x: "--lines-left",
      y: "--lines-top",
      w: "--lines-width",
      h: null,
      anchor: "topleft"
    },
    bet: {
      name: "Puntata",
      selector: "#betPanel",
      x: "--bet-left",
      y: "--bet-top",
      w: "--bet-width",
      h: null,
      anchor: "topleft"
    },
    total: {
      name: "Totale giocata",
      selector: "#totalPanel",
      x: "--total-left",
      y: "--total-top",
      w: "--total-width",
      h: null,
      anchor: "topleft"
    },
    winnings: {
      name: "Vincita",
      selector: "#winningsPanel",
      x: "--winnings-left",
      y: "--winnings-top",
      w: "--winnings-width",
      h: null,
      anchor: "topleft"
    },
    spin: {
      name: "SPIN",
      selector: "#spinBtn",
      x: "--spin-left",
      y: "--spin-top",
      w: "--spin-size",
      h: null,
      anchor: "center"
    }
  };

  // Marca gli elementi modificabili senza cambiare l'HTML a mano.
  for (const [key, item] of Object.entries(items)) {
    const el = document.querySelector(item.selector);
    if (el) el.dataset.designerKey = key;
  }

 /* stage.insertAdjacentHTML("beforeend", `
    <button id="designerToggle" type="button" title="Designer layout">🛠</button>

    <aside id="designerPanel">
      <h3>Designer — <span id="designerSelectedName">nessun elemento</span></h3>
      <p class="designer-note">
        Clicca un elemento, trascina il rettangolo azzurro per spostarlo e usa
        il pallino in basso a destra per ridimensionarlo.
      </p>

      <div class="designer-grid">
        <div class="designer-field"><label>X %</label><input id="designerX" type="number" step="0.05"></div>
        <div class="designer-field"><label>Y %</label><input id="designerY" type="number" step="0.05"></div>
        <div class="designer-field"><label>W %</label><input id="designerW" type="number" step="0.05"></div>
        <div class="designer-field"><label>H %</label><input id="designerH" type="number" step="0.05"></div>
      </div>

      <textarea id="designerCssOutput" readonly></textarea>

      <div class="designer-actions">
        <button id="designerCopyBtn" type="button">Copia CSS</button>
        <button id="designerSaveBtn" type="button">Salva locale</button>
        <button id="designerResetBtn" type="button">Reset</button>
      </div>
    </aside>

    <div id="designerSelectionBox">
      <div id="designerSelectionLabel"></div>
      <div id="designerResizeHandle"></div>
    </div>

    <div id="designerToast"></div>
  `);
*/
  const root = document.documentElement;
  const toggle = document.getElementById("designerToggle");
  const panel = document.getElementById("designerPanel");
  const box = document.getElementById("designerSelectionBox");
  const label = document.getElementById("designerSelectionLabel");
  const handle = document.getElementById("designerResizeHandle");
  const nameEl = document.getElementById("designerSelectedName");
  const xInput = document.getElementById("designerX");
  const yInput = document.getElementById("designerY");
  const wInput = document.getElementById("designerW");
  const hInput = document.getElementById("designerH");
  const output = document.getElementById("designerCssOutput");
  const copyBtn = document.getElementById("designerCopyBtn");
  const saveBtn = document.getElementById("designerSaveBtn");
  const resetBtn = document.getElementById("designerResetBtn");
  const toastEl = document.getElementById("designerToast");

  let enabled = false;
  let selectedKey = null;
  let gesture = null;
  let toastTimer = null;

  function toast(text) {
    clearTimeout(toastTimer);
    toastEl.textContent = text;
    toastEl.classList.add("visible");
    toastTimer = setTimeout(() => toastEl.classList.remove("visible"), 1600);
  }

  function stageRect() {
    return stage.getBoundingClientRect();
  }

  function targetEl(key) {
    return document.querySelector(items[key].selector);
  }

  function targetRect(key) {
    return targetEl(key).getBoundingClientRect();
  }

  // Leggiamo sempre la geometria VISIBILE: evita errori con transform/auto height.
  function readValues(key) {
    const s = stageRect();
    const r = targetRect(key);
    const item = items[key];

    let x;
    let y;

    if (item.anchor === "center") {
      x = ((r.left + r.width / 2 - s.left) / s.width) * 100;
      y = ((r.top + r.height / 2 - s.top) / s.height) * 100;
    } else if (item.anchor === "centerX") {
      x = ((r.left + r.width / 2 - s.left) / s.width) * 100;
      y = ((r.top - s.top) / s.height) * 100;
    } else {
      x = ((r.left - s.left) / s.width) * 100;
      y = ((r.top - s.top) / s.height) * 100;
    }

    return {
      x,
      y,
      w: (r.width / s.width) * 100,
      h: (r.height / s.height) * 100
    };
  }

  function setVar(name, value) {
    root.style.setProperty(name, `${Number(value).toFixed(3)}%`);
  }

  function writeValues(key, values) {
    const item = items[key];
    const el = targetEl(key);

    if (item.custom) {
      el.style.left = `${values.x.toFixed(3)}%`;
      el.style.top = `${values.y.toFixed(3)}%`;
      el.style.width = `${Math.max(1, values.w).toFixed(3)}%`;
      return;
    }

    setVar(item.x, values.x);
    setVar(item.y, values.y);
    setVar(item.w, Math.max(1, values.w));
    if (item.h) setVar(item.h, Math.max(1, values.h));
  }

  function updateBox() {
    if (!enabled || !selectedKey) {
      box.classList.remove("visible");
      return;
    }

    const s = stageRect();
    const r = targetRect(selectedKey);

    box.style.left = `${r.left - s.left}px`;
    box.style.top = `${r.top - s.top}px`;
    box.style.width = `${r.width}px`;
    box.style.height = `${r.height}px`;
    label.textContent = items[selectedKey].name;
    box.classList.add("visible");
  }

  function updateFields() {
    if (!selectedKey) return;
    const v = readValues(selectedKey);
    const item = items[selectedKey];

    nameEl.textContent = item.name;
    xInput.value = v.x.toFixed(3);
    yInput.value = v.y.toFixed(3);
    wInput.value = v.w.toFixed(3);
    hInput.value = v.h.toFixed(3);

    // Solo i rulli hanno altezza indipendente.
    hInput.disabled = !item.h;
  }

  function generateCss() {
    const computed = getComputedStyle(root);
    const vars = [
      "--frame-left", "--frame-top", "--frame-width",
      "--reels-left", "--reels-top", "--reels-width", "--reels-height",
      "--lines-left", "--lines-top", "--lines-width",
      "--bet-left", "--bet-top", "--bet-width",
      "--total-left", "--total-top", "--total-width",
      "--winnings-left", "--winnings-top", "--winnings-width",
      "--spin-left", "--spin-top", "--spin-size"
    ];

    const lines = [":root {"];
    for (const variable of vars) {
      lines.push(`  ${variable}: ${computed.getPropertyValue(variable).trim()};`);
    }
    lines.push("}");

    const logo = readValues("logo");
    lines.push(
      "",
      "#logoLayer {",
      `  left: ${logo.x.toFixed(3)}%;`,
      `  top: ${logo.y.toFixed(3)}%;`,
      `  width: ${logo.w.toFixed(3)}%;`,
      "}"
    );

    output.value = lines.join("\n");
  }

  function refresh() {
    updateBox();
    updateFields();
    generateCss();
  }

  function select(key) {
    if (!enabled || !items[key] || !targetEl(key)) return;
    selectedKey = key;
    refresh();
  }

  function setEnabled(value) {
    enabled = value;
    stage.classList.toggle("designer-mode", enabled);
    toggle.classList.toggle("active", enabled);
    panel.classList.toggle("visible", enabled);

    if (enabled) {
      select(selectedKey || "frame");
    } else {
      box.classList.remove("visible");
    }
  }

  toggle.addEventListener("click", () => setEnabled(!enabled));

  // Selezione: pointerdown in capture così funziona anche sopra pulsanti/pannelli.
  stage.addEventListener("pointerdown", event => {
    if (!enabled) return;
    const el = event.target.closest("[data-designer-key]");
    if (!el) return;
    event.preventDefault();
    event.stopPropagation();
    select(el.dataset.designerKey);
  }, true);

  // Blocca i click reali del gioco mentre il designer è attivo.
  stage.addEventListener("click", event => {
    if (!enabled) return;
    if (event.target.closest("[data-designer-key]")) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  function startGesture(event, type) {
    if (!enabled || !selectedKey) return;
    event.preventDefault();
    event.stopPropagation();
    box.setPointerCapture(event.pointerId);
    gesture = {
      type,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      start: readValues(selectedKey)
    };
  }

  box.addEventListener("pointerdown", event => {
    if (event.target === handle) return;
    startGesture(event, "move");
  });

  handle.addEventListener("pointerdown", event => startGesture(event, "resize"));

  box.addEventListener("pointermove", event => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    event.preventDefault();

    const s = stageRect();
    const dx = ((event.clientX - gesture.startX) / s.width) * 100;
    const dy = ((event.clientY - gesture.startY) / s.height) * 100;
    const v = { ...gesture.start };
    const item = items[selectedKey];

    if (gesture.type === "move") {
      v.x += dx;
      v.y += dy;
    } else {
      v.w = Math.max(1, v.w + dx);
      if (item.h) v.h = Math.max(1, v.h + dy);
    }

    writeValues(selectedKey, v);
    refresh();
  });

  function endGesture(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gesture = null;
    refresh();
  }

  box.addEventListener("pointerup", endGesture);
  box.addEventListener("pointercancel", endGesture);

  function applyInputs() {
    if (!selectedKey) return;
    const v = readValues(selectedKey);
    const values = {
      x: Number(xInput.value),
      y: Number(yInput.value),
      w: Number(wInput.value),
      h: Number(hInput.value)
    };

    if (Number.isFinite(values.x)) v.x = values.x;
    if (Number.isFinite(values.y)) v.y = values.y;
    if (Number.isFinite(values.w)) v.w = values.w;
    if (Number.isFinite(values.h)) v.h = values.h;

    writeValues(selectedKey, v);
    refresh();
  }

  [xInput, yInput, wInput, hInput].forEach(input => {
    input.addEventListener("change", applyInputs);
  });

  function currentLayout() {
    const data = {};
    for (const key of Object.keys(items)) {
      if (targetEl(key)) data[key] = readValues(key);
    }
    return data;
  }

  function applyLayout(data) {
    if (!data) return;
    for (const [key, values] of Object.entries(data)) {
      if (items[key] && targetEl(key) && values) writeValues(key, values);
    }
  }

  saveBtn.addEventListener("click", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentLayout()));
    toast("Layout salvato sul dispositivo");
  });

  resetBtn.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);

    const vars = [
      "--frame-left", "--frame-top", "--frame-width",
      "--reels-left", "--reels-top", "--reels-width", "--reels-height",
      "--lines-left", "--lines-top", "--lines-width",
      "--bet-left", "--bet-top", "--bet-width",
      "--total-left", "--total-top", "--total-width",
      "--winnings-left", "--winnings-top", "--winnings-width",
      "--spin-left", "--spin-top", "--spin-size"
    ];

    for (const variable of vars) root.style.removeProperty(variable);

    const logo = targetEl("logo");
    logo.style.left = "";
    logo.style.top = "";
    logo.style.width = "";

    refresh();
    toast("Layout ripristinato");
  });

  copyBtn.addEventListener("click", async () => {
    generateCss();
    try {
      await navigator.clipboard.writeText(output.value);
      toast("CSS copiato");
    } catch {
      output.focus();
      output.select();
      toast("CSS selezionato: Ctrl+C");
    }
  });

  window.addEventListener("resize", () => {
    if (enabled) refresh();
  });

  // Ripristino automatico del layout locale.
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    applyLayout(saved);
  } catch (error) {
    console.warn("Layout designer non valido", error);
  }
})();
