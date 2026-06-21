import { create, select } from "d3-selection";
import { scaleLinear } from "d3-scale";
import { axisBottom, axisTop, axisLeft, axisRight } from "d3-axis";
import { dispatch } from "d3-dispatch";
import ReactiveWidget from "reactive-widget-helper";
import { density1d } from "fast-kde";
import { snapRange } from "./snap.js";
import { axisGeometry } from "./geometry.js";

const AXIS = { bottom: axisBottom, top: axisTop, left: axisLeft, right: axisRight };

let scentClipSeq = 0; // unique clipPath ids when several axes share a page

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === "undefined") return;
  stylesInjected = true;
  const css = `
.zoomable-axis-input { position: relative; font: 10px sans-serif; --za-accent: #4682b4; z-index: 0; }
.zoomable-axis-input:focus-within { z-index: 10; }
.zoomable-axis-input .za-axis path,
.zoomable-axis-input .za-axis line { stroke: #bbb; }
.zoomable-axis-input input[type=range] {
  position: absolute; margin: 0; background: transparent; pointer-events: none;
  -webkit-appearance: none; appearance: none;
}
.zoomable-axis-input input[type=range]:focus { outline: none; }
.zoomable-axis-input input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none; pointer-events: auto; cursor: grab;
  height: 20px; width: 20px; opacity: 0;
}
.zoomable-axis-input input[type=range]::-moz-range-thumb {
  pointer-events: auto; cursor: grab; height: 20px; width: 20px; opacity: 0;
}
/* ── Musical-note / p-shape handles ─────────────────────────────────────────
   SVG layer: tick (value marker) + stem (connecting line). pointer-events:none
   on the SVG itself; individual .za-handle groups set pointer-events:all so
   the tick+stem area is directly grabbable for drag. */
.zoomable-axis-input .za-handles-svg { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; z-index: 3; }
.zoomable-axis-input .za-handle { cursor: grab; }
.zoomable-axis-input .za-handle:active,
.zoomable-axis-input .za-handle.za-dragging { cursor: grabbing; }
.zoomable-axis-input .za-handle .za-handle-tick { stroke: var(--za-accent); stroke-width: 2; stroke-linecap: round; }
.zoomable-axis-input .za-handle .za-handle-stem { stroke: var(--za-accent); stroke-width: 1.5; }
.zoomable-axis-input .za-handle.focused .za-handle-tick,
.zoomable-axis-input .za-handle.focused .za-handle-stem { stroke-width: 3; filter: drop-shadow(0 0 3px var(--za-accent)); }
.zoomable-axis-input .za-selected { position: absolute; background: var(--za-accent); opacity: .25; cursor: move; }
.zoomable-axis-input .za-selected:active { cursor: grabbing; }
.zoomable-axis-input .za-selected.za-thin { background: var(--za-accent); opacity: .08; }
.zoomable-axis-input .za-band-line { position: absolute; background: var(--za-accent); opacity: .9; pointer-events: none; border-radius: 1px; }
/* Badge: pill-shaped note head at the tip of the stem. Draggable, double-click to edit. */
.zoomable-axis-input .za-value {
  position: absolute; z-index: 4;
  pointer-events: auto; cursor: grab;
  font: 700 10px/1 "SFMono-Regular","Menlo","Monaco",ui-monospace,monospace;
  background: var(--za-accent); color: #fff;
  padding: 4px 8px; border-radius: 10px; white-space: nowrap;
  -webkit-user-select: none; user-select: none;
  box-shadow: 0 1px 4px rgba(0,0,0,.18);
  transition: box-shadow .15s;
}
.zoomable-axis-input .za-value:hover { box-shadow: 0 2px 8px rgba(0,0,0,.25); }
.zoomable-axis-input .za-value.za-dragging,
.zoomable-axis-input .za-value:active { cursor: grabbing; box-shadow: 0 4px 12px rgba(0,0,0,.28); transition: none; }
.zoomable-axis-input .za-value.za-focused { outline: 2px solid var(--za-accent); outline-offset: 2px; }
.zoomable-axis-input .za-value.za-editing {
  cursor: text; background: #fff; color: var(--za-accent);
  padding: 3px 7px; border: 1.5px solid var(--za-accent);
}
.zoomable-axis-input .za-value.za-editing input {
  border: none; outline: none; background: transparent;
  font: inherit; color: inherit; width: 5em; padding: 0; margin: 0;
  pointer-events: auto; cursor: text;
}
`;
  const s = document.createElement("style");
  s.textContent = css;
  document.head.appendChild(s);
}

// Variant A — fully accessible zoomable axis built on TWO native <input type="range">.
// Keyboard + screen reader come for free from the native controls; we add a labelled
// group, aria-valuetext, a drag-to-pan region, vertical support (CSS writing-mode), and
// a d3 axis behind for ticks. Returns a reactive-widget element (.value = [lo,hi], emits "input").
export function zoomableAxisInput(scaleOrDomain, {
  orient = "bottom",
  step = 1,
  value,
  length = 320,
  thickness = 44,
  margin = 22,
  label = "",
  units = "",
  format = (d) => `${Math.round(d)}`,
  // Scented-widget distribution drawn along the axis (Willett/Heer/Agrawala 2007):
  //   scent: { values:number[], type:"histogram"|"violin", style?:"kde"|"bars",
  //            bins?:30, size?:24, color?:"#cbd5e1", colorSelected?, side?:"out"|"in",
  //            bandwidth?, pad? }
  //   For violins, style defaults to "kde" (smooth area via fast-kde); "bars" keeps
  //   the mirrored-bars look. Histograms are always bars.
  scent = null,
} = {}) {
  const hasScent = !!(scent && scent.values && scent.values.length);
  injectStyles();
  const horizontal = orient === "bottom" || orient === "top";
  const scale = (typeof scaleOrDomain === "function" ? scaleOrDomain.copy() : scaleLinear().domain(scaleOrDomain))
    .range(horizontal ? [0, length] : [length, 0]);
  const [dMin, dMax] = scale.domain();
  const listeners = dispatch("start", "input", "end");

  let val = snapRange(value || scale.domain(), scale.domain(), step);
  let scentBars = [];          // bars mode: [{r, x0, x1}] recolored by overlap
  let scentClipRect = null;    // kde mode: <rect> that two-tones the in-view area
  let scentSize = 24;          // cross-axis extent of the scent drawing (px)
  let scentIn = "var(--za-accent)";
  let scentOut = "#cbd5e1";

  const container = create("div").attr("class", "zoomable-axis-input")
    .attr("role", "group")
    .attr("aria-label", `${label || "value"} range`)
    .style("width", `${(horizontal ? length : thickness) + margin * 2}px`)
    .style("height", `${(horizontal ? thickness : length) + margin * 2}px`);
  const el = container.node();

  // d3 axis (decorative)
  const svg = container.append("svg").attr("class", "za-axis").attr("aria-hidden", "true")
    .attr("width", el.style.width).attr("height", el.style.height)
    .style("position", "absolute").style("left", 0).style("top", 0)
    .style("overflow", "visible").style("pointer-events", "none");
  if (scent && scent.values && scent.values.length) renderScent(svg, scent);
  const axisG = svg.append("g")
    .attr("transform", horizontal ? `translate(${margin},${orient === "top" ? margin : margin + thickness / 2})`
                                  : `translate(${orient === "right" ? margin : margin + thickness / 2},${margin})`);
  axisG.call(AXIS[orient](scale).tickSizeOuter(0));

  // D-shape handle layer — placed in a SEPARATE SVG (z-index 3) so handles always
  // render above the scented distribution and above sibling axis components.
  // pointer-events:none — interaction falls through to the invisible native thumbs.
  const HR = 10; // half-length of the tick line (px, in axisG local coordinate space)
  const STEM = 14; // length of the stem from tick edge to badge (px)
  const handlesSvg = container.append("svg")
    .attr("class", "za-handles-svg").attr("aria-hidden", "true")
    .attr("width", el.style.width).attr("height", el.style.height);
  const handlesG = handlesSvg.append("g").attr("class", "za-handles")
    .attr("transform", axisG.attr("transform"));
  const mkHandleEl = () => {
    // pointer-events:all on the group so the tick+stem area is directly draggable.
    const g = handlesG.append("g").attr("class", "za-handle").attr("pointer-events", "all");
    g.append("line").attr("class", "za-handle-tick");
    g.append("line").attr("class", "za-handle-stem");
    return g;
  };
  const loHandleEl = mkHandleEl();
  const hiHandleEl = mkHandleEl();

  function updateHandleEl(handleEl, px) {
    // Musical-note / p-shape: a tick line (value marker) + a stem reaching toward
    // the badge outside the chart area. Both lo and hi stems point outward (away
    // from the chart) in the same direction for a given orient.
    //
    //   bottom axis:  tick vertical at x=px; stem goes DOWN  (positive y in SVG)
    //   top axis:     tick vertical at x=px; stem goes UP    (negative y)
    //   left axis:    tick horizontal at y=px; stem goes LEFT (negative x)
    //   right axis:   tick horizontal at y=px; stem goes RIGHT (positive x)
    let tx1, ty1, tx2, ty2, sx1, sy1, sx2, sy2;
    if (horizontal) {
      tx1 = px; ty1 = -HR; tx2 = px; ty2 = HR;
      const outY = orient === "bottom" ? 1 : -1;
      sx1 = px; sy1 = outY * HR; sx2 = px; sy2 = outY * (HR + STEM);
    } else {
      tx1 = -HR; ty1 = px; tx2 = HR; ty2 = px;
      const outX = orient === "left" ? -1 : 1;
      sx1 = outX * HR; sy1 = px; sx2 = outX * (HR + STEM); sy2 = px;
    }
    handleEl.select(".za-handle-tick").attr("x1", tx1).attr("y1", ty1).attr("x2", tx2).attr("y2", ty2);
    handleEl.select(".za-handle-stem").attr("x1", sx1).attr("y1", sy1).attr("x2", sx2).attr("y2", sy2);
  }

  // selected-range band (drag to pan). With a scent, the band is a faint hit zone
  // and bandLine is the thin visible selection marker on the domain line.
  const band = container.append("div").attr("class", hasScent ? "za-selected za-thin" : "za-selected").node();
  const bandLine = hasScent ? container.append("div").attr("class", "za-band-line").node() : null;

  // two native range inputs
  const H = 16; // input/thumb height; kept fixed so the rotate math is exact
  const mkInput = (which) => {
    const input = document.createElement("input");
    input.type = "range";
    input.min = dMin; input.max = dMax; input.step = step || "any";
    input.setAttribute("aria-label", `${which === "lo" ? "Minimum" : "Maximum"} ${label || "value"}`);
    input.setAttribute("aria-orientation", horizontal ? "horizontal" : "vertical");
    // Always a HORIZONTAL input internally (reliable thumb positioning); vertical is
    // produced by rotating it -90deg so min->bottom, max->top (matches the scale range).
    input.style.width = `${length}px`;
    input.style.height = `${H}px`;
    if (horizontal) {
      input.style.left = `${margin}px`;
      input.style.top = `${margin + thickness / 2 - H / 2}px`;
    } else {
      // left=0 keeps all thumb natural-layout x-coords ≥ 0. Chrome hit-tests
      // ::-webkit-slider-thumb at the element's natural (pre-rotation) x position,
      // so left < 0 made the lo thumb (at natural x=left+0) unreachable off-screen.
      // transform-origin is chosen so the visual axis position is identical to before:
      //   thumb at internal x → visual y = (margin+length) - x  (maps lo→bottom, hi→top).
      const ox = margin + thickness / 2 + H / 2; // = 52 for default values
      const oy = H;
      input.style.left = "0";
      input.style.top = `${length - thickness / 2 - 3 * H / 2}px`;
      input.style.transformOrigin = `${ox}px ${oy}px`;
      input.style.transform = "rotate(-90deg)";
    }
    container.node().appendChild(input);
    input.addEventListener("input", (e) => onInput(which, e.isTrusted));
    return input;
  };
  const loInput = mkInput("lo");
  const hiInput = mkInput("hi");

  // Mirror keyboard focus: highlight both the SVG handle and the badge pill.
  loInput.addEventListener("focus", () => { loHandleEl.classed("focused", true);  labelLo.classList.add("za-focused"); });
  loInput.addEventListener("blur",  () => { loHandleEl.classed("focused", false); labelLo.classList.remove("za-focused"); });
  hiInput.addEventListener("focus", () => { hiHandleEl.classed("focused", true);  labelHi.classList.add("za-focused"); });
  hiInput.addEventListener("blur",  () => { hiHandleEl.classed("focused", false); labelHi.classList.remove("za-focused"); });

  // Dual-range z-index toggling: always give the thumb NEAREST the cursor the top
  // z-index so it is the one that receives pointer events. Without this, the input
  // appended last is always on top and the lo handle becomes unreachable at the left.
  el.addEventListener("pointermove", (e) => {
    const rect = el.getBoundingClientRect();
    // Cursor position in along-axis pixel space (same coord system as scale output).
    const pxInAxis = horizontal
      ? e.clientX - rect.left - margin
      : e.clientY - rect.top  - margin;
    const loPx = scale(val[0]);
    const hiPx = scale(val[1]);
    const dLo = Math.abs(pxInAxis - loPx);
    const dHi = Math.abs(pxInAxis - hiPx);
    // When equidistant (handles overlap), prefer lo if cursor is in the lower
    // half of the range so both thumbs remain reachable even when they coincide.
    const loOnTop = dLo < dHi || (dLo === dHi && pxInAxis <= (loPx + hiPx) / 2);
    loInput.style.zIndex = loOnTop ? 2 : 1;
    hiInput.style.zIndex = loOnTop ? 1 : 2;
  });

  // Badge pill: note head at the tip of the stem. Draggable + double-click to edit.
  const mkLabel = () => { const d = document.createElement("div"); d.className = "za-value"; container.node().appendChild(d); return d; };
  const labelLo = mkLabel();
  const labelHi = mkLabel();

  // Shared drag factory: wire pointer drag on target (SVG node or div) to a range input.
  function setupDrag(target, which, clsOrClass) {
    const inputEl = which === "lo" ? loInput : hiInput;
    const [sd0, sd1] = scale.domain();
    const sr = scale.range();
    const dataPerPx = (sd1 - sd0) / (sr[sr.length - 1] - sr[0]);
    const node = target.node ? target.node() : target; // d3 selection or raw element
    node.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault(); ev.stopPropagation();
      if (target.classed) target.classed("za-dragging", true); else target.classList.add("za-dragging");
      const startPx = horizontal ? ev.clientX : ev.clientY;
      const startVal = val[which === "lo" ? 0 : 1];
      node.setPointerCapture(ev.pointerId);
      listeners.call("start", el, val.slice());
      const move = (e) => {
        const dPx = (horizontal ? e.clientX : e.clientY) - startPx;
        let nv = startVal + dPx * dataPerPx;
        nv = which === "lo" ? Math.max(dMin, Math.min(val[1], nv)) : Math.max(val[0], Math.min(dMax, nv));
        inputEl.value = nv;
        inputEl.dispatchEvent(new Event("input", { bubbles: true }));
      };
      const up = () => {
        if (target.classed) target.classed("za-dragging", false); else target.classList.remove("za-dragging");
        node.releasePointerCapture(ev.pointerId);
        node.removeEventListener("pointermove", move);
        node.removeEventListener("pointerup", up);
        listeners.call("end", el, val.slice());
      };
      node.addEventListener("pointermove", move);
      node.addEventListener("pointerup", up);
    });
  }

  // Double-click on badge → inline <input type=number> to type an exact value.
  function setupBadgeEdit(labelEl, which) {
    labelEl.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      const curVal = val[which === "lo" ? 0 : 1];
      labelEl.classList.add("za-editing");
      const inp = document.createElement("input");
      inp.type = "number"; inp.value = Math.round(curVal * 1000) / 1000; inp.step = step;
      labelEl.textContent = ""; labelEl.appendChild(inp);
      inp.focus(); inp.select();
      const commit = () => {
        const nv = Math.max(dMin, Math.min(dMax, +inp.value || curVal));
        labelEl.classList.remove("za-editing");
        const inputEl = which === "lo" ? loInput : hiInput;
        inputEl.value = nv; inputEl.dispatchEvent(new Event("input", { bubbles: true }));
      };
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        if (e.key === "Escape") { labelEl.classList.remove("za-editing"); layout(); }
      });
      inp.addEventListener("blur", () => commit());
    });
  }

  // SVG handle (tick + stem) and badge pill are both independently draggable.
  setupDrag(loHandleEl, "lo");
  setupDrag(hiHandleEl, "hi");
  setupDrag(labelLo, "lo");
  setupDrag(labelHi, "hi");
  setupBadgeEdit(labelLo, "lo");
  setupBadgeEdit(labelHi, "hi");

  function setValuetext() {
    loInput.setAttribute("aria-valuetext", `${format(val[0])}${units ? " " + units : ""}`);
    hiInput.setAttribute("aria-valuetext", `${format(val[1])}${units ? " " + units : ""}`);
  }

  function layout() {
    loInput.value = val[0];
    hiInput.value = val[1];
    setValuetext();
    // along-axis geometry (handles + band) from the tested pure module
    const g = axisGeometry({
      domain: scale.domain(),
      range: horizontal ? [0, length] : [length, 0],
      value: val,
      handleR: HR, // half-circle radius from outer scope
    });
    // Band spans from lo sticker to hi sticker (no D-shape radius inset).
    const minHit = 16;
    const bLo = Math.min(g.loPx, g.hiPx), bHi = Math.max(g.loPx, g.hiPx);
    let bStart = bLo, bLen = bHi - bLo;
    if (bLen < minHit) {
      bStart = (bLo + bHi) / 2 - minHit / 2;
      bLen = minHit;
    }
    if (horizontal) {
      band.style.left = `${margin + bStart}px`;
      band.style.top = `${margin + thickness / 2 - 6}px`;
      band.style.width = `${bLen}px`;
      band.style.height = `12px`;
    } else {
      band.style.left = `${margin + thickness / 2 - 6}px`;
      band.style.top = `${margin + bStart}px`;
      band.style.width = `12px`;
      band.style.height = `${bLen}px`;
    }
    // thin selection line on the domain line (only when a scent is shown)
    if (bandLine) {
      const lo = Math.min(g.loPx, g.hiPx), hi = Math.max(g.loPx, g.hiPx);
      const T = 3; // line thickness
      if (horizontal) {
        bandLine.style.left = `${margin + lo}px`;
        bandLine.style.top = `${margin + thickness / 2 - T / 2}px`;
        bandLine.style.width = `${hi - lo}px`;
        bandLine.style.height = `${T}px`;
      } else {
        bandLine.style.left = `${margin + thickness / 2 - T / 2}px`;
        bandLine.style.top = `${margin + lo}px`;
        bandLine.style.width = `${T}px`;
        bandLine.style.height = `${hi - lo}px`;
      }
    }
    // Update SVG musical-note handles (tick + stem).
    updateHandleEl(loHandleEl, g.loPx);
    updateHandleEl(hiHandleEl, g.hiPx);
    // Badge pills: positioned at stem tip (HR + STEM pixels out from axis line).
    const fmt = (v) => `${format(v)}${units ? " " + units : ""}`;
    labelLo.textContent = fmt(val[0]);
    labelHi.textContent = fmt(val[1]);
    if (horizontal) {
      const outDir = orient === "bottom" ? 1 : -1;
      const ty = `${margin + thickness / 2 + outDir * (HR + STEM)}px`;
      const xfm = outDir > 0 ? "translate(-50%, 0)" : "translate(-50%, -100%)";
      const containerW = length + margin * 2;
      const loW = labelLo.offsetWidth || 50;
      const hiW = labelHi.offsetWidth || 50;
      const loLeft = Math.max(loW / 2, Math.min(containerW - loW / 2, margin + g.loPx));
      const hiLeft = Math.max(hiW / 2, Math.min(containerW - hiW / 2, margin + g.hiPx));
      labelLo.style.transform = labelHi.style.transform = xfm;
      labelLo.style.left = `${loLeft}px`; labelLo.style.top = ty;
      labelHi.style.left = `${hiLeft}px`; labelHi.style.top = ty;
    } else {
      const outDir = orient === "left" ? -1 : 1;
      const tx = `${margin + thickness / 2 + outDir * (HR + STEM)}px`;
      const xfm = outDir < 0 ? "translate(-100%, -50%)" : "translate(0, -50%)";
      const containerH = length + margin * 2;
      const loH = labelLo.offsetHeight || 18;
      const hiH = labelHi.offsetHeight || 18;
      const loTop = Math.max(loH / 2, Math.min(containerH - loH / 2, margin + g.loPx));
      const hiTop = Math.max(hiH / 2, Math.min(containerH - hiH / 2, margin + g.hiPx));
      labelLo.style.transform = labelHi.style.transform = xfm;
      labelLo.style.left = tx; labelLo.style.top = `${loTop}px`;
      labelHi.style.left = tx; labelHi.style.top = `${hiTop}px`;
    }
    paintScent(); // recolor the in-view part of the distribution
  }

  // Draw a small histogram/violin of the data distribution along the axis (a
  // "scented widget": embedded info-scent so users see where the data is dense).
  function renderScent(svgSel, opts) {
    const { values, type = "histogram", bins: nBins = 30, size = 24, color = "#cbd5e1", colorSelected, side = "out",
            style, bandwidth, pad } = opts;
    scentOut = color;
    scentIn = colorSelected || "var(--za-accent)";
    scentSize = size;
    // Violins default to a smooth KDE area (style "kde"); "bars" keeps the
    // mirrored-bars look. Histograms are always bars.
    const useKde = type === "violin" && (style ?? "kde") === "kde";
    const [d0, d1] = scale.domain();
    if (useKde) { renderScentKde(svgSel, values, { nBins, size, bandwidth, pad, d0, d1 }); return; }
    // Histogram draw direction. "out" = away from the plot (axisBottom → down,
    // axisTop → up, axisLeft → left, axisRight → right); "in" = toward the plot.
    const outDir = orient === "bottom" || orient === "right" ? 1 : -1;
    const sign = (side === "in" ? -1 : 1) * outDir;
    const w = (d1 - d0) / nBins;
    const counts = new Array(nBins).fill(0);
    for (const raw of values) {
      const v = +raw;
      if (raw == null || Number.isNaN(v) || v < d0 || v > d1) continue;
      let i = Math.floor((v - d0) / w);
      if (i >= nBins) i = nBins - 1;
      if (i < 0) i = 0;
      counts[i]++;
    }
    const maxN = Math.max(1, ...counts);
    const g = svgSel.append("g").attr("class", "za-scent").attr(
      "transform",
      horizontal ? `translate(${margin},${margin + thickness / 2})` : `translate(${margin + thickness / 2},${margin})`
    );
    counts.forEach((n, i) => {
      if (!n) return;
      const x0 = d0 + i * w, x1 = d0 + (i + 1) * w;
      const a = scale(x0);
      const b = scale(x1);
      const lo = Math.min(a, b);
      const len = Math.max(1, Math.abs(b - a) - 1);
      const h = (n / maxN) * size;
      const r = g.append("rect").style("fill", scentOut).attr("fill-opacity", 0.8);
      if (horizontal) {
        const y = type === "violin" ? -h / 2 : sign > 0 ? 0 : -h;
        r.attr("x", lo).attr("width", len).attr("y", y).attr("height", h);
      } else {
        const x = type === "violin" ? -h / 2 : sign > 0 ? 0 : -h;
        r.attr("y", lo).attr("height", len).attr("x", x).attr("width", h);
      }
      scentBars.push({ r, x0, x1 });
    });
    paintScent();
  }

  // Smooth violin via fast-kde (mirrors @john-guerra/violin-plot: density1d +
  // a symmetric area). We draw the SAME area path twice — a base in the "out"
  // color and an overlay in the "in" color clipped to a rect that paintScent
  // slides to cover only the selected range. That two-tone-by-clip trick keeps
  // the silhouette continuous (no per-bin seams) while still coloring in-view.
  function renderScentKde(svgSel, values, { nBins, size, bandwidth, pad, d0, d1 }) {
    const nums = [];
    for (const raw of values) { const v = +raw; if (raw != null && !Number.isNaN(v)) nums.push(v); }
    // bandwidth/pad pass straight to fast-kde; omitted → its automatic (Scott) rule.
    const kdeOpts = { bins: nBins };
    if (bandwidth != null) kdeOpts.bandwidth = bandwidth;
    if (pad != null) kdeOpts.pad = pad;
    const dens = Array.from(density1d(nums, kdeOpts)).filter((p) => p.x >= d0 && p.x <= d1);
    if (dens.length < 2) return;
    const maxY = Math.max(...dens.map((p) => p.y)) || 1;
    const dPath = violinPath(dens, maxY, size / 2);

    const g = svgSel.append("g").attr("class", "za-scent").attr(
      "transform",
      horizontal ? `translate(${margin},${margin + thickness / 2})` : `translate(${margin + thickness / 2},${margin})`
    );
    const clipId = `za-scent-clip-${++scentClipSeq}`;
    scentClipRect = g.append("clipPath").attr("id", clipId).append("rect").node();
    g.append("path").attr("d", dPath).style("fill", scentOut).attr("fill-opacity", 0.85);        // base (out)
    g.append("path").attr("d", dPath).style("fill", scentIn).attr("fill-opacity", 0.9)            // in-view overlay
      .attr("clip-path", `url(#${clipId})`);
    paintScent();
  }

  // Build a closed symmetric area path centered on the axis line, in the scent
  // <g>'s local space (origin on the axis line). along = scale(x); the density
  // y maps to a half-thickness on each side. Mirrors violin-plot's x0/x1/y area.
  function violinPath(pts, maxY, half) {
    const along = (d) => scale(d.x);
    const cross = (d) => (d.y / maxY) * half;
    const at = (a, c) => (horizontal ? `${a},${c}` : `${c},${a}`); // swap axes when vertical
    let d = "";
    pts.forEach((p, i) => { d += (i ? "L" : "M") + at(along(p), -cross(p)) + " "; }); // top edge
    for (let i = pts.length - 1; i >= 0; i--) d += "L" + at(along(pts[i]), cross(pts[i])) + " "; // bottom edge
    return d + "Z";
  }

  // Two-tone the scent by the current selection:
  //  - bars mode: recolor each bin by overlap with [lo,hi]
  //  - kde mode: slide the clip rect to cover the selected range (along-axis),
  //    full thickness cross-axis, in the scent <g>'s local coords.
  function paintScent() {
    const [lo, hi] = val;
    for (const bar of scentBars) {
      bar.r.style("fill", bar.x1 > lo && bar.x0 < hi ? scentIn : scentOut);
    }
    if (scentClipRect) {
      const a = scale(lo), b = scale(hi);
      const p0 = Math.min(a, b), len = Math.abs(b - a);
      const r = scentClipRect;
      if (horizontal) {
        r.setAttribute("x", p0); r.setAttribute("width", len);
        r.setAttribute("y", -scentSize); r.setAttribute("height", scentSize * 2);
      } else {
        r.setAttribute("y", p0); r.setAttribute("height", len);
        r.setAttribute("x", -scentSize); r.setAttribute("width", scentSize * 2);
      }
    }
  }

  function onInput(which, trusted) {
    let lo = +loInput.value, hi = +hiInput.value;
    if (lo > hi) { if (which === "lo") lo = hi; else hi = lo; } // clamp: thumbs can't cross
    val = snapRange([lo, hi], scale.domain(), step);
    layout();
    if (trusted) { listeners.call("input", el, val.slice()); widget.setValue(val.slice()); }
  }

  // drag-to-pan: move both bounds together, preserving the window width.
  // Convert pixel delta -> data delta with the scale's slope (signed: for a
  // vertical axis range [length,0] the slope is negative, so dragging down lowers
  // the values). This works identically for both orientations.
  band.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    const startPx = horizontal ? ev.clientX : ev.clientY;
    const start = val.slice();
    const win = start[1] - start[0];
    const [d0, d1] = scale.domain();
    const r = scale.range();
    const dataPerPx = (d1 - d0) / (r[r.length - 1] - r[0]);
    band.setPointerCapture(ev.pointerId);
    const move = (e) => {
      const dPx = (horizontal ? e.clientX : e.clientY) - startPx;
      let lo = start[0] + dPx * dataPerPx;
      lo = Math.max(dMin, Math.min(dMax - win, lo));
      val = snapRange([lo, lo + win], scale.domain(), step);
      layout();
      listeners.call("input", el, val.slice());
      widget.setValue(val.slice());
    };
    const up = () => {
      band.releasePointerCapture(ev.pointerId);
      band.removeEventListener("pointermove", move);
      band.removeEventListener("pointerup", up);
      listeners.call("end", el, val.slice());
    };
    band.addEventListener("pointermove", move);
    band.addEventListener("pointerup", up);
  });

  const widget = ReactiveWidget(el, {
    value: val.slice(),
    showValue: () => { val = snapRange(widget.value, scale.domain(), step); layout(); },
  });

  // public-ish accessors mirroring the core (for parity in the comparison)
  el.value_ = () => val.slice();
  el.on = function () { const v = listeners.on.apply(listeners, arguments); return v === listeners ? el : v; };

  layout();
  return widget;
}
