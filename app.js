"use strict";

const CHARACTER_SETS = {
  letters: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz".split(""),
  numbers: "0123456789".split(""),
  punctuation: ".,!?;:'\"-_/()[]{}@#$%&*+=<>".split("")
};

const state = {
  fontName: "My Pixel Font",
  gridSize: 32,
  activeGlyph: "A",
  activeTab: "letters",
  tool: "draw",
  glyphs: new Map(),
  isDrawing: false,
  lastCell: null,
  currentEdit: null,
  undoStack: [],
  zoom: 1,
  pointers: new Map(),
  pinch: null
};

const els = {
  fontName: document.querySelector("#fontName"),
  gridSize: document.querySelector("#gridSize"),
  glyphList: document.querySelector("#glyphList"),
  activeGlyphLabel: document.querySelector("#activeGlyphLabel"),
  canvasWrap: document.querySelector(".canvas-wrap"),
  canvas: document.querySelector("#glyphCanvas"),
  drawTool: document.querySelector("#drawTool"),
  eraseTool: document.querySelector("#eraseTool"),
  undoEdit: document.querySelector("#undoEdit"),
  fillGlyph: document.querySelector("#fillGlyph"),
  clearGlyph: document.querySelector("#clearGlyph"),
  mirrorPreview: document.querySelector("#mirrorPreview"),
  cellReadout: document.querySelector("#cellReadout"),
  previewText: document.querySelector("#previewText"),
  fontPreview: document.querySelector("#fontPreview"),
  exportFont: document.querySelector("#exportFont"),
  exportFontSide: document.querySelector("#exportFontSide"),
  shareFont: document.querySelector("#shareFont"),
  saveProject: document.querySelector("#saveProject"),
  openProject: document.querySelector("#openProject"),
  downloadSample: document.querySelector("#downloadSample"),
  addGlyph: document.querySelector("#addGlyph"),
  characterDialog: document.querySelector("#characterDialog"),
  newGlyphInput: document.querySelector("#newGlyphInput"),
  confirmGlyph: document.querySelector("#confirmGlyph"),
  mobileDraw: document.querySelector("#mobileDraw"),
  mobileErase: document.querySelector("#mobileErase"),
  mobileUndo: document.querySelector("#mobileUndo"),
  mobileSave: document.querySelector("#mobileSave"),
  mobileExport: document.querySelector("#mobileExport")
};

const ctx = els.canvas.getContext("2d");

function createBlankGlyph(size = state.gridSize) {
  return Array.from({ length: size }, () => Array(size).fill(0));
}

function ensureGlyph(char) {
  if (!state.glyphs.has(char)) {
    state.glyphs.set(char, createBlankGlyph());
  }
  return state.glyphs.get(char);
}

function cloneGlyphToSize(glyph, newSize) {
  const oldSize = glyph.length;
  const next = createBlankGlyph(newSize);
  for (let y = 0; y < newSize; y += 1) {
    for (let x = 0; x < newSize; x += 1) {
      const sourceX = Math.floor((x / newSize) * oldSize);
      const sourceY = Math.floor((y / newSize) * oldSize);
      next[y][x] = glyph[sourceY][sourceX] ? 1 : 0;
    }
  }
  return next;
}

function drawCanvas() {
  const size = state.gridSize;
  const width = els.canvas.width;
  const cell = width / size;
  const glyph = ensureGlyph(state.activeGlyph);
  ctx.clearRect(0, 0, width, width);
  ctx.fillStyle = "#fffefb";
  ctx.fillRect(0, 0, width, width);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--cell").trim();
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (glyph[y][x]) {
        ctx.fillRect(Math.floor(x * cell), Math.floor(y * cell), Math.ceil(cell), Math.ceil(cell));
      }
    }
  }
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--grid").trim();
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= size; i += 1) {
    const pos = Math.round(i * cell) + 0.5;
    ctx.moveTo(pos, 0);
    ctx.lineTo(pos, width);
    ctx.moveTo(0, pos);
    ctx.lineTo(width, pos);
  }
  ctx.stroke();
}

function glyphHasData(char) {
  return (state.glyphs.get(char) || []).some(row => row.some(Boolean));
}

function renderGlyphList() {
  const chars = CHARACTER_SETS[state.activeTab];
  els.glyphList.innerHTML = "";
  chars.forEach(char => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `glyph-button${char === state.activeGlyph ? " active" : ""}${glyphHasData(char) ? " has-data" : ""}`;
    button.textContent = char;
    button.title = `Edit ${char}`;
    button.addEventListener("click", () => {
      state.activeGlyph = char;
      renderAll();
    });
    els.glyphList.append(button);
  });
}

function setTool(tool) {
  state.tool = tool;
  els.drawTool.classList.toggle("active", tool === "draw");
  els.eraseTool.classList.toggle("active", tool === "erase");
  els.mobileDraw.classList.toggle("active", tool === "draw");
  els.mobileErase.classList.toggle("active", tool === "erase");
}

function canvasPointToCell(event) {
  const rect = els.canvas.getBoundingClientRect();
  const x = Math.floor(((event.clientX - rect.left) / rect.width) * state.gridSize);
  const y = Math.floor(((event.clientY - rect.top) / rect.height) * state.gridSize);
  if (x < 0 || y < 0 || x >= state.gridSize || y >= state.gridSize) return null;
  return { x, y };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getCanvasBaseSize() {
  const styles = getComputedStyle(els.canvasWrap);
  const padding = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
  return Math.max(220, Math.min(704, els.canvasWrap.clientWidth - padding));
}

function updateCanvasZoom(anchor = null) {
  const oldRect = els.canvas.getBoundingClientRect();
  const oldWidth = oldRect.width || getCanvasBaseSize();
  const nextWidth = Math.round(getCanvasBaseSize() * state.zoom);
  const wrapRect = els.canvasWrap.getBoundingClientRect();
  const anchorX = anchor ? anchor.x - wrapRect.left : els.canvasWrap.clientWidth / 2;
  const anchorY = anchor ? anchor.y - wrapRect.top : els.canvasWrap.clientHeight / 2;
  const contentX = (els.canvasWrap.scrollLeft + anchorX) / oldWidth;
  const contentY = (els.canvasWrap.scrollTop + anchorY) / oldWidth;
  els.canvas.style.width = `${nextWidth}px`;
  els.canvas.style.height = `${nextWidth}px`;
  els.cellReadout.textContent = `${state.gridSize} x ${state.gridSize} cells - ${Math.round(state.zoom * 100)}%`;
  requestAnimationFrame(() => {
    els.canvasWrap.scrollLeft = contentX * nextWidth - anchorX;
    els.canvasWrap.scrollTop = contentY * nextWidth - anchorY;
  });
}

function pointerDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointerMidpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2
  };
}

function activePointerPair() {
  return [...state.pointers.values()].slice(0, 2);
}

function startPinch() {
  const [first, second] = activePointerPair();
  if (!first || !second) return;
  state.isDrawing = false;
  state.lastCell = null;
  state.pinch = {
    distance: Math.max(1, pointerDistance(first, second)),
    zoom: state.zoom,
    midpoint: pointerMidpoint(first, second)
  };
}

function updatePinchZoom() {
  if (!state.pinch || state.pointers.size < 2) return;
  const [first, second] = activePointerPair();
  const nextDistance = Math.max(1, pointerDistance(first, second));
  const midpoint = pointerMidpoint(first, second);
  els.canvasWrap.scrollLeft -= midpoint.x - state.pinch.midpoint.x;
  els.canvasWrap.scrollTop -= midpoint.y - state.pinch.midpoint.y;
  state.zoom = clamp(state.pinch.zoom * (nextDistance / state.pinch.distance), 1, 5);
  updateCanvasZoom(midpoint);
  state.pinch.midpoint = midpoint;
}

function trackPointer(event) {
  state.pointers.set(event.pointerId, {
    x: event.clientX,
    y: event.clientY,
    type: event.pointerType
  });
}

function releasePointer(event) {
  state.pointers.delete(event.pointerId);
  if (state.pointers.size < 2) {
    state.pinch = null;
  }
  if (state.pointers.size === 0) {
    state.isDrawing = false;
    state.lastCell = null;
  }
}

function setCell(x, y, value) {
  const glyph = ensureGlyph(state.activeGlyph);
  applyCellChange(glyph, state.activeGlyph, x, y, value);
  if (els.mirrorPreview.checked) {
    const mirrorX = state.gridSize - 1 - x;
    applyCellChange(glyph, state.activeGlyph, mirrorX, y, value);
  }
}

function applyCellChange(glyph, glyphName, x, y, value) {
  if (glyph[y][x] === value) return;
  rememberCellChange(glyphName, x, y, glyph[y][x]);
  glyph[y][x] = value;
}

function beginEdit(label, glyph = state.activeGlyph) {
  state.currentEdit = {
    glyph,
    label,
    changes: new Map()
  };
}

function rememberCellChange(glyph, x, y, previousValue) {
  if (!state.currentEdit) return;
  const key = `${glyph}:${x}:${y}`;
  if (!state.currentEdit.changes.has(key)) {
    state.currentEdit.changes.set(key, { glyph, x, y, previousValue });
  }
}

function commitEdit() {
  if (!state.currentEdit) return;
  if (state.currentEdit.changes.size) {
    state.undoStack.push({
      ...state.currentEdit,
      changes: [...state.currentEdit.changes.values()]
    });
    if (state.undoStack.length > 100) state.undoStack.shift();
  }
  state.currentEdit = null;
  updateUndoState();
}

function cancelEdit() {
  state.currentEdit = null;
  updateUndoState();
}

function undoLastEdit() {
  commitEdit();
  const edit = state.undoStack.pop();
  if (!edit) {
    updateUndoState();
    return;
  }
  edit.changes.forEach(change => {
    const glyph = ensureGlyph(change.glyph);
    if (glyph[change.y]) glyph[change.y][change.x] = change.previousValue;
  });
  state.activeGlyph = edit.glyph;
  renderAll();
  persist();
  updateUndoState();
}

function updateUndoState() {
  const disabled = state.undoStack.length === 0;
  els.undoEdit.disabled = disabled;
  els.mobileUndo.disabled = disabled;
}

function paintCell(event) {
  const cell = canvasPointToCell(event);
  if (!cell) return;
  if (state.lastCell && state.lastCell.x === cell.x && state.lastCell.y === cell.y) return;
  if (!state.currentEdit) beginEdit("stroke");
  setCell(cell.x, cell.y, state.tool === "draw" ? 1 : 0);
  state.lastCell = cell;
  drawCanvas();
  renderGlyphList();
  renderPreview();
  persist();
}

function makeGlyphCanvas(char, scale = 4) {
  const glyph = state.glyphs.get(char);
  const size = state.gridSize;
  const canvas = document.createElement("canvas");
  canvas.width = size * scale;
  canvas.height = size * scale;
  const previewCtx = canvas.getContext("2d");
  previewCtx.fillStyle = "transparent";
  previewCtx.clearRect(0, 0, canvas.width, canvas.height);
  previewCtx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--preview").trim();
  if (glyph) {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (glyph[y][x]) previewCtx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
  }
  return canvas;
}

function renderPreview() {
  els.fontPreview.innerHTML = "";
  const text = els.previewText.value;
  [...text].forEach(char => {
    if (char === "\n") {
      const br = document.createElement("span");
      br.className = "preview-break";
      els.fontPreview.append(br);
      return;
    }
    if (char === " ") {
      const space = document.createElement("span");
      space.className = "preview-space";
      els.fontPreview.append(space);
      return;
    }
    const img = document.createElement("img");
    img.className = "preview-glyph";
    img.alt = char;
    img.src = makeGlyphCanvas(char).toDataURL("image/png");
    els.fontPreview.append(img);
  });
}

function renderAll() {
  els.activeGlyphLabel.textContent = state.activeGlyph;
  updateCanvasZoom();
  updateUndoState();
  renderGlyphList();
  drawCanvas();
  renderPreview();
}

function persist() {
  localStorage.setItem("pixelFontMaker", JSON.stringify(serializeProject()));
}

function serializeProject() {
  return {
    fontName: state.fontName,
    gridSize: state.gridSize,
    glyphs: Object.fromEntries([...state.glyphs.entries()].map(([char, glyph]) => [char, glyph.map(row => row.join(""))]))
  };
}

function loadProject(project) {
  state.fontName = project.fontName || "My Pixel Font";
  state.gridSize = Number(project.gridSize) || 32;
  state.glyphs = new Map();
  state.currentEdit = null;
  state.undoStack = [];
  Object.entries(project.glyphs || {}).forEach(([char, rows]) => {
    const glyph = rows.map(row => [...row].map(value => value === "1" ? 1 : 0));
    state.glyphs.set(char, glyph.length === state.gridSize ? glyph : cloneGlyphToSize(glyph, state.gridSize));
  });
  els.fontName.value = state.fontName;
  els.gridSize.value = String(state.gridSize);
  ensureGlyph(state.activeGlyph);
  renderAll();
  updateUndoState();
  persist();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function shareOrDownloadBlob(blob, filename, title) {
  const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ title, files: [file] });
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }
  downloadBlob(blob, filename);
}

function sanitizeFontName(name) {
  return (name || "My Pixel Font").replace(/[^\w ]+/g, "").trim() || "My Pixel Font";
}

function saveProject() {
  downloadBlob(new Blob([JSON.stringify(serializeProject(), null, 2)], { type: "application/json" }), `${sanitizeFontName(state.fontName)}.json`);
}

function setupEvents() {
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(item => item.classList.remove("active"));
      tab.classList.add("active");
      state.activeTab = tab.dataset.tab;
      renderGlyphList();
    });
  });

  els.fontName.addEventListener("input", () => {
    state.fontName = els.fontName.value;
    persist();
  });

  els.gridSize.addEventListener("change", () => {
    const nextSize = Number(els.gridSize.value);
    state.glyphs = new Map([...state.glyphs.entries()].map(([char, glyph]) => [char, cloneGlyphToSize(glyph, nextSize)]));
    state.gridSize = nextSize;
    state.currentEdit = null;
    state.undoStack = [];
    renderAll();
    persist();
  });

  els.drawTool.addEventListener("click", () => setTool("draw"));
  els.eraseTool.addEventListener("click", () => setTool("erase"));
  els.mobileDraw.addEventListener("click", () => setTool("draw"));
  els.mobileErase.addEventListener("click", () => setTool("erase"));
  els.undoEdit.addEventListener("click", undoLastEdit);
  els.mobileUndo.addEventListener("click", undoLastEdit);
  els.fillGlyph.addEventListener("click", () => {
    beginEdit("fill");
    const glyph = ensureGlyph(state.activeGlyph);
    for (let y = 0; y < state.gridSize; y += 1) {
      for (let x = 0; x < state.gridSize; x += 1) {
        rememberCellChange(state.activeGlyph, x, y, glyph[y][x]);
      }
    }
    state.glyphs.set(state.activeGlyph, Array.from({ length: state.gridSize }, () => Array(state.gridSize).fill(1)));
    commitEdit();
    renderAll();
    persist();
  });
  els.clearGlyph.addEventListener("click", () => {
    beginEdit("clear");
    const glyph = ensureGlyph(state.activeGlyph);
    for (let y = 0; y < state.gridSize; y += 1) {
      for (let x = 0; x < state.gridSize; x += 1) {
        rememberCellChange(state.activeGlyph, x, y, glyph[y][x]);
      }
    }
    state.glyphs.set(state.activeGlyph, createBlankGlyph());
    commitEdit();
    renderAll();
    persist();
  });
  els.previewText.addEventListener("input", renderPreview);

  els.canvas.addEventListener("pointerdown", event => {
    els.canvas.setPointerCapture(event.pointerId);
    trackPointer(event);
    if (state.pointers.size >= 2) {
      cancelEdit();
      startPinch();
      return;
    }
    beginEdit("stroke");
    state.isDrawing = true;
    state.lastCell = null;
    paintCell(event);
  });
  els.canvas.addEventListener("pointermove", event => {
    if (!state.pointers.has(event.pointerId)) return;
    trackPointer(event);
    if (state.pointers.size >= 2) {
      updatePinchZoom();
      return;
    }
    if (state.isDrawing) paintCell(event);
  });
  els.canvas.addEventListener("pointerup", event => {
    releasePointer(event);
    if (state.pointers.size === 0) commitEdit();
  });
  els.canvas.addEventListener("pointercancel", event => {
    releasePointer(event);
    cancelEdit();
  });
  els.canvas.addEventListener("lostpointercapture", event => {
    releasePointer(event);
    if (state.pointers.size === 0) commitEdit();
  });

  els.exportFont.addEventListener("click", () => exportFont(false));
  els.exportFontSide.addEventListener("click", () => exportFont(false));
  els.shareFont.addEventListener("click", () => exportFont(true));
  els.mobileExport.addEventListener("click", () => exportFont(true));
  els.saveProject.addEventListener("click", saveProject);
  els.mobileSave.addEventListener("click", saveProject);
  els.openProject.addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    loadProject(JSON.parse(await file.text()));
    event.target.value = "";
  });
  els.downloadSample.addEventListener("click", exportSamplePng);
  els.addGlyph.addEventListener("click", () => {
    els.newGlyphInput.value = "";
    els.characterDialog.showModal();
    els.newGlyphInput.focus();
  });
  els.confirmGlyph.addEventListener("click", event => {
    const char = [...els.newGlyphInput.value][0];
    if (!char) {
      event.preventDefault();
      return;
    }
    if (!Object.values(CHARACTER_SETS).some(list => list.includes(char))) {
      CHARACTER_SETS.punctuation.push(char);
    }
    state.activeTab = Object.entries(CHARACTER_SETS).find(([, list]) => list.includes(char))[0];
    state.activeGlyph = char;
    document.querySelectorAll(".tab").forEach(item => item.classList.toggle("active", item.dataset.tab === state.activeTab));
    ensureGlyph(char);
    renderAll();
    persist();
  });

  window.addEventListener("resize", () => updateCanvasZoom());
  window.addEventListener("keydown", event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      undoLastEdit();
    }
  });
}

function exportSamplePng() {
  const text = els.previewText.value;
  const scale = 6;
  const glyphSize = state.gridSize * scale;
  const lineHeight = glyphSize + 20;
  const lines = text.split("\n");
  const width = Math.max(420, ...lines.map(line => Math.max(1, [...line].length) * (glyphSize * 0.7)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width + 40);
  canvas.height = lines.length * lineHeight + 40;
  const sampleCtx = canvas.getContext("2d");
  sampleCtx.fillStyle = "#fffdfa";
  sampleCtx.fillRect(0, 0, canvas.width, canvas.height);
  lines.forEach((line, lineIndex) => {
    let x = 20;
    [...line].forEach(char => {
      if (char === " ") {
        x += glyphSize * 0.45;
        return;
      }
      sampleCtx.drawImage(makeGlyphCanvas(char, scale), x, 20 + lineIndex * lineHeight);
      x += glyphSize * 0.72;
    });
  });
  canvas.toBlob(blob => downloadBlob(blob, `${sanitizeFontName(state.fontName)} sample.png`), "image/png");
}

function init() {
  Object.values(CHARACTER_SETS).flat().forEach(char => ensureGlyph(char));
  const saved = localStorage.getItem("pixelFontMaker");
  if (saved) {
    try {
      loadProject(JSON.parse(saved));
    } catch {
      renderAll();
    }
  } else {
    drawStarterGlyphs();
    renderAll();
  }
  setupEvents();
  registerServiceWorker();
}

function drawStarterGlyphs() {
  const patterns = {
    A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"]
  };
  Object.entries(patterns).forEach(([char, rows]) => {
    const glyph = createBlankGlyph();
    const scale = Math.floor(state.gridSize / 8);
    const offsetX = Math.floor((state.gridSize - rows[0].length * scale) / 2);
    const offsetY = Math.floor((state.gridSize - rows.length * scale) / 2);
    rows.forEach((row, y) => {
      [...row].forEach((value, x) => {
        if (value === "1") {
          for (let yy = 0; yy < scale; yy += 1) {
            for (let xx = 0; xx < scale; xx += 1) {
              glyph[offsetY + y * scale + yy][offsetX + x * scale + xx] = 1;
            }
          }
        }
      });
    });
    state.glyphs.set(char, glyph);
  });
}

function exportFont(preferShare = false) {
  const bytes = buildTrueTypeFont(sanitizeFontName(state.fontName), state.gridSize, state.glyphs);
  const blob = new Blob([bytes], { type: "font/ttf" });
  const filename = `${sanitizeFontName(state.fontName)}.ttf`;
  if (preferShare) {
    shareOrDownloadBlob(blob, filename, `${sanitizeFontName(state.fontName)} font`);
  } else {
    downloadBlob(blob, filename);
  }
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  });
}

function buildTrueTypeFont(fontName, gridSize, glyphMap) {
  const unitsPerEm = 1024;
  const ascent = 880;
  const descent = -144;
  const glyphOrder = ["\0", " ", ...[...glyphMap.keys()].filter(char => char !== " ").sort((a, b) => a.codePointAt(0) - b.codePointAt(0))];
  const glyphs = glyphOrder.map(char => char === "\0" || char === " " ? emptyGlyph() : glyphToContours(glyphMap.get(char), gridSize, unitsPerEm));
  const glyfParts = [];
  const offsets = [];
  let offset = 0;
  glyphs.forEach(glyph => {
    offsets.push(offset);
    const data = glyph.data;
    glyfParts.push(data);
    offset += data.length;
    if (offset % 2) {
      glyfParts.push(u8([0]));
      offset += 1;
    }
  });
  offsets.push(offset);
  const cmapChars = glyphOrder.slice(2).map((char, index) => ({ code: char.codePointAt(0), glyphId: index + 2 })).filter(item => item.code <= 0xffff);
  const tables = {
    cmap: makeCmap(cmapChars),
    glyf: concatBytes(glyfParts),
    head: makeHead(unitsPerEm),
    hhea: makeHhea(ascent, descent, glyphs.length),
    hmtx: makeHmtx(glyphs),
    loca: makeLoca(offsets),
    maxp: makeMaxp(glyphs.length, glyphs),
    name: makeName(fontName),
    "OS/2": makeOS2(fontName, ascent, descent),
    post: makePost()
  };
  const font = assembleFont(tables);
  const checksum = checksumAdjustment(font);
  writeUint32(font, tables.head._offset + 8, checksum);
  return font;
}

function emptyGlyph() {
  return { advanceWidth: 640, xMin: 0, yMin: 0, xMax: 0, yMax: 0, points: 0, contours: 0, data: u8([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) };
}

function glyphToContours(glyph, gridSize, unitsPerEm) {
  const pixel = Math.floor((unitsPerEm * 0.86) / gridSize);
  const left = Math.floor((unitsPerEm - pixel * gridSize) / 2);
  const bottom = 64;
  const contours = [];
  let xMin = unitsPerEm;
  let yMin = unitsPerEm;
  let xMax = 0;
  let yMax = 0;
  if (glyph) {
    for (let y = 0; y < gridSize; y += 1) {
      for (let x = 0; x < gridSize; x += 1) {
        if (!glyph[y][x]) continue;
        const x0 = left + x * pixel;
        const x1 = x0 + pixel;
        const y1 = bottom + (gridSize - y) * pixel;
        const y0 = y1 - pixel;
        contours.push([[x0, y0], [x0, y1], [x1, y1], [x1, y0]]);
        xMin = Math.min(xMin, x0);
        yMin = Math.min(yMin, y0);
        xMax = Math.max(xMax, x1);
        yMax = Math.max(yMax, y1);
      }
    }
  }
  if (!contours.length) return emptyGlyph();
  const points = contours.flat();
  const endPts = contours.map((_, index) => (index + 1) * 4 - 1);
  const bytes = [];
  pushInt16(bytes, contours.length);
  pushInt16(bytes, xMin);
  pushInt16(bytes, yMin);
  pushInt16(bytes, xMax);
  pushInt16(bytes, yMax);
  endPts.forEach(point => pushUint16(bytes, point));
  pushUint16(bytes, 0);
  points.forEach(() => bytes.push(1));
  let prevX = 0;
  points.forEach(([x]) => {
    pushInt16(bytes, x - prevX);
    prevX = x;
  });
  let prevY = 0;
  points.forEach(([, y]) => {
    pushInt16(bytes, y - prevY);
    prevY = y;
  });
  return {
    advanceWidth: unitsPerEm,
    xMin,
    yMin,
    xMax,
    yMax,
    points: points.length,
    contours: contours.length,
    data: pad2(u8(bytes))
  };
}

function makeCmap(chars) {
  chars.sort((a, b) => a.code - b.code);
  const segCount = chars.length + 1;
  const searchRange = 2 * Math.pow(2, Math.floor(Math.log2(segCount)));
  const entrySelector = Math.floor(Math.log2(segCount));
  const rangeShift = 2 * segCount - searchRange;
  const length = 16 + 8 * segCount;
  const bytes = [];
  pushUint16(bytes, 0);
  pushUint16(bytes, 1);
  pushUint16(bytes, 3);
  pushUint16(bytes, 1);
  pushUint32(bytes, 12);
  pushUint16(bytes, 4);
  pushUint16(bytes, length);
  pushUint16(bytes, 0);
  pushUint16(bytes, segCount * 2);
  pushUint16(bytes, searchRange);
  pushUint16(bytes, entrySelector);
  pushUint16(bytes, rangeShift);
  chars.forEach(item => pushUint16(bytes, item.code));
  pushUint16(bytes, 0xffff);
  pushUint16(bytes, 0);
  chars.forEach(item => pushUint16(bytes, item.code));
  pushUint16(bytes, 0xffff);
  chars.forEach(item => pushInt16(bytes, item.glyphId - item.code));
  pushInt16(bytes, 1);
  chars.forEach(() => pushUint16(bytes, 0));
  pushUint16(bytes, 0);
  return u8(bytes);
}

function makeHead(unitsPerEm) {
  const bytes = [];
  pushUint32(bytes, 0x00010000);
  pushUint32(bytes, 0x00010000);
  pushUint32(bytes, 0);
  pushUint32(bytes, 0x5f0f3cf5);
  pushUint16(bytes, 0x000b);
  pushUint16(bytes, unitsPerEm);
  pushLongDate(bytes);
  pushLongDate(bytes);
  pushInt16(bytes, 0);
  pushInt16(bytes, -144);
  pushInt16(bytes, unitsPerEm);
  pushInt16(bytes, unitsPerEm);
  pushUint16(bytes, 0);
  pushUint16(bytes, 8);
  pushInt16(bytes, 2);
  pushInt16(bytes, 1);
  pushInt16(bytes, 1);
  pushInt16(bytes, 0);
  return u8(bytes);
}

function makeHhea(ascent, descent, count) {
  const bytes = [];
  pushUint32(bytes, 0x00010000);
  pushInt16(bytes, ascent);
  pushInt16(bytes, descent);
  pushInt16(bytes, 0);
  pushUint16(bytes, 1024);
  pushInt16(bytes, 0);
  pushInt16(bytes, 0);
  pushInt16(bytes, 1024);
  pushInt16(bytes, 1);
  pushInt16(bytes, 0);
  pushInt16(bytes, 0);
  for (let i = 0; i < 4; i += 1) pushInt16(bytes, 0);
  pushInt16(bytes, 0);
  pushUint16(bytes, count);
  return u8(bytes);
}

function makeHmtx(glyphs) {
  const bytes = [];
  glyphs.forEach(glyph => {
    pushUint16(bytes, glyph.advanceWidth);
    pushInt16(bytes, glyph.xMin || 0);
  });
  return u8(bytes);
}

function makeLoca(offsets) {
  const bytes = [];
  offsets.forEach(offset => pushUint32(bytes, offset));
  return u8(bytes);
}

function makeMaxp(count, glyphs) {
  const bytes = [];
  pushUint32(bytes, 0x00010000);
  pushUint16(bytes, count);
  pushUint16(bytes, Math.max(4, ...glyphs.map(glyph => glyph.points)));
  pushUint16(bytes, Math.max(1, ...glyphs.map(glyph => glyph.contours)));
  pushUint16(bytes, 0);
  pushUint16(bytes, 0);
  pushUint16(bytes, 2);
  pushUint16(bytes, 0);
  pushUint16(bytes, 0);
  pushUint16(bytes, 0);
  pushUint16(bytes, 0);
  pushUint16(bytes, 0);
  pushUint16(bytes, 0);
  pushUint16(bytes, 0);
  pushUint16(bytes, 0);
  return u8(bytes);
}

function makeName(fontName) {
  const names = [
    [1, fontName],
    [2, "Regular"],
    [3, `${fontName} Regular ${Date.now()}`],
    [4, `${fontName} Regular`],
    [5, "Version 1.0"],
    [6, fontName.replace(/\s+/g, "")]
  ];
  const records = [];
  const storage = [];
  let offset = 0;
  names.forEach(([id, value]) => {
    const encoded = encodeUtf16Be(value);
    records.push({ id, length: encoded.length, offset });
    storage.push(encoded);
    offset += encoded.length;
  });
  const bytes = [];
  pushUint16(bytes, 0);
  pushUint16(bytes, records.length);
  pushUint16(bytes, 6 + records.length * 12);
  records.forEach(record => {
    pushUint16(bytes, 3);
    pushUint16(bytes, 1);
    pushUint16(bytes, 0x0409);
    pushUint16(bytes, record.id);
    pushUint16(bytes, record.length);
    pushUint16(bytes, record.offset);
  });
  storage.forEach(chunk => bytes.push(...chunk));
  return u8(bytes);
}

function makeOS2(fontName, ascent, descent) {
  const bytes = [];
  pushUint16(bytes, 3);
  pushInt16(bytes, 500);
  pushUint16(bytes, 5);
  pushUint16(bytes, 0);
  pushInt16(bytes, 5);
  for (let i = 0; i < 10; i += 1) pushInt16(bytes, 0);
  pushInt16(bytes, 0);
  pushInt16(bytes, 0);
  pushInt16(bytes, 0);
  pushInt16(bytes, 0);
  pushUint32(bytes, 0);
  pushUint32(bytes, 0);
  pushUint32(bytes, 0);
  pushUint32(bytes, 0);
  encodeAscii(fontName.slice(0, 4).padEnd(4, " ")).forEach(byte => bytes.push(byte));
  pushUint16(bytes, 0);
  pushUint16(bytes, 0x0020);
  pushUint16(bytes, 0x007e);
  pushInt16(bytes, ascent);
  pushInt16(bytes, descent);
  pushInt16(bytes, 0);
  pushUint16(bytes, ascent);
  pushUint16(bytes, Math.abs(descent));
  pushUint32(bytes, 0);
  pushUint32(bytes, 0);
  pushInt16(bytes, 0);
  pushInt16(bytes, 0);
  pushUint16(bytes, ascent);
  pushUint16(bytes, Math.abs(descent));
  pushUint16(bytes, 0);
  pushUint16(bytes, 0);
  pushUint16(bytes, 0);
  return u8(bytes);
}

function makePost() {
  const bytes = [];
  pushUint32(bytes, 0x00030000);
  pushUint32(bytes, 0);
  pushInt16(bytes, 0);
  pushInt16(bytes, 0);
  pushUint32(bytes, 0);
  pushUint32(bytes, 0);
  pushUint32(bytes, 0);
  pushUint32(bytes, 0);
  pushUint32(bytes, 0);
  return u8(bytes);
}

function assembleFont(tables) {
  const tags = Object.keys(tables).sort();
  const numTables = tags.length;
  const searchRange = 16 * Math.pow(2, Math.floor(Math.log2(numTables)));
  const entrySelector = Math.floor(Math.log2(numTables));
  const rangeShift = numTables * 16 - searchRange;
  let offset = 12 + numTables * 16;
  tags.forEach(tag => {
    tables[tag]._offset = offset;
    tables[tag]._length = tables[tag].length;
    offset += pad4(tables[tag]).length;
  });
  const bytes = [];
  pushUint32(bytes, 0x00010000);
  pushUint16(bytes, numTables);
  pushUint16(bytes, searchRange);
  pushUint16(bytes, entrySelector);
  pushUint16(bytes, rangeShift);
  tags.forEach(tag => {
    encodeAscii(tag).forEach(byte => bytes.push(byte));
    pushUint32(bytes, tableChecksum(tables[tag]));
    pushUint32(bytes, tables[tag]._offset);
    pushUint32(bytes, tables[tag]._length);
  });
  tags.forEach(tag => bytes.push(...pad4(tables[tag])));
  return u8(bytes);
}

function checksumAdjustment(font) {
  const sum = tableChecksum(font);
  return (0xb1b0afba - sum) >>> 0;
}

function tableChecksum(data) {
  const padded = pad4(data);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) {
    sum = (sum + (((padded[i] << 24) | (padded[i + 1] << 16) | (padded[i + 2] << 8) | padded[i + 3]) >>> 0)) >>> 0;
  }
  return sum >>> 0;
}

function concatBytes(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  parts.forEach(part => {
    out.set(part, offset);
    offset += part.length;
  });
  return out;
}

function pad2(data) {
  if (data.length % 2 === 0) return data;
  const out = new Uint8Array(data.length + 1);
  out.set(data);
  return out;
}

function pad4(data) {
  const padding = (4 - (data.length % 4)) % 4;
  if (!padding) return data;
  const out = new Uint8Array(data.length + padding);
  out.set(data);
  return out;
}

function u8(bytes) {
  return Uint8Array.from(bytes.map(byte => byte & 255));
}

function pushUint16(bytes, value) {
  bytes.push((value >>> 8) & 255, value & 255);
}

function pushInt16(bytes, value) {
  pushUint16(bytes, value < 0 ? value + 0x10000 : value);
}

function pushUint32(bytes, value) {
  bytes.push((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
}

function pushLongDate(bytes) {
  pushUint32(bytes, 0);
  pushUint32(bytes, Math.floor(Date.now() / 1000) + 2082844800);
}

function writeUint32(bytes, offset, value) {
  bytes[offset] = (value >>> 24) & 255;
  bytes[offset + 1] = (value >>> 16) & 255;
  bytes[offset + 2] = (value >>> 8) & 255;
  bytes[offset + 3] = value & 255;
}

function encodeUtf16Be(text) {
  const bytes = [];
  [...text].forEach(char => {
    const code = char.charCodeAt(0);
    bytes.push((code >>> 8) & 255, code & 255);
  });
  return bytes;
}

function encodeAscii(text) {
  return [...text].map(char => char.charCodeAt(0) & 255);
}

init();
