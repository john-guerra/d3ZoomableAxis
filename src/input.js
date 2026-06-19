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
/* Raise the focused component above siblings so its handles are never occluded. */
.zoomable-axis-input:focus-within { z-index: 10; }
.zoomable-axis-input .za-axis path,
.zoomable-axis-input .za-axis line { stroke: #bbb; }
.zoomable-axis-input input[type=range] {
  position: absolute; margin: 0; background: transparent; pointer-events: none;
  -webkit-appearance: none; appearance: none;
}
.zoomable-axis-input input[type=range]:focus { outline: none; }
/* Native thumb is invisible; the SVG D-shape handles draw the visual instead. */
.zoomable-axis-input input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none; pointer-events: auto; cursor: grab;
  height: 20px; width: 20px; opacity: 0;
}
.zoomable-axis-input input[type=range]::-moz-range-thumb {
  pointer-events: auto; cursor: grab;
  height: 20px; width: 20px; opacity: 0;
}
.zoomable-axis-input .za-handle .za-handle-arc {
  fill: #fff; stroke: var(--za-accent); stroke-width: 2;
}
.zoomable-axis-input .za-handle .za-handle-tick {
  stroke: var(--za-accent); stroke-width: 2; stroke-linecap: round;
}
.zoomable-axis-input .za-handle.focused .za-handle-arc {
  stroke-width: 3; filter: drop-shadow(0 0 3px var(--za-accent));
}
/* Separate SVG layer so handles always paint above the scented distribution. */
.zoomable-axis-input .za-handles-svg { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; z-index: 3; }
.zoomable-axis-input .za-selected { position: absolute; background: var(--za-accent); opacity: .25; cursor: grab; }
.zoomable-axis-input .za-selected:active { cursor: grabbing; }
/* When a scented distribution is shown, the thick band would hide it: the band
   becomes a faint grabbable hit zone and a sibling thin line marks the selection. */
.zoomable-axis-input .za-selected.za-thin { background: var(--za-accent); opacity: .08; }
.zoomable-axis-input .za-band-line { position: absolute; background: var(--za-accent); opacity: .9; pointer-events: none; border-radius: 1px; }
.zoomable-axis-input .za-value {
  position: absolute; pointer-events: none; font: 600 11px/1 sans-serif;
  background: var(--za-accent); color: #fff; padding: 2px 5px; border-radius: 3px; white-space: nowrap;
  -webkit-user-select: none; user-select: none;
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
  const HR = 10; // half-circle radius (px, in axisG local coordinate space)
  const handlesSvg = container.append("svg")
    .attr("class", "za-handles-svg").attr("aria-hidden", "true")
    .attr("width", el.style.width).attr("height", el.style.height);
  const handlesG = handlesSvg.append("g").attr("class", "za-handles")
    .attr("transform", axisG.attr("transform"));
  const mkHandleEl = () => {
    const g = handlesG.append("g").attr("class", "za-handle");
    g.append("path").attr("class", "za-handle-arc");
    g.append("line").attr("class", "za-handle-tick");
    return g;
  };
  const loHandleEl = mkHandleEl();
  const hiHandleEl = mkHandleEl();

  function updateHandleEl(handleEl, px, which) {
    // Each handle is a D-shape. The FLAT EDGE is the value-marker line at the
    // exact selected data position. The bump extends perpendicular to the axis:
    //
    //   Horizontal axis: flat edge = VERTICAL line at x=px (y from -HR to +HR)
    //     lo → bump LEFT  (CCW sweep=0 arcs through x<px)
    //     hi → bump RIGHT (CW  sweep=1 arcs through x>px)
    //     Together they form matching brackets: C ... D
    //
    //   Vertical axis ("horizontal half-circles"):
    //     flat edge = HORIZONTAL line at y=px (x from -HR to +HR)
    //     lo (large py, near bottom) → bump DOWN (CW  sweep=1, arcs through y>px)
    //     hi (small py, near top)   → bump UP   (CCW sweep=0, arcs through y<px)
    let arcD, lx1, ly1, lx2, ly2;
    if (horizontal) {
      const sweep = which === "lo" ? 0 : 1;
      arcD = `M ${px} ${-HR} A ${HR} ${HR} 0 0 ${sweep} ${px} ${HR} Z`;
      lx1 = px; ly1 = -HR; lx2 = px; ly2 = HR; // flat edge = vertical value marker
    } else {
      const sweep = which === "lo" ? 1 : 0;
      arcD = `M ${-HR} ${px} A ${HR} ${HR} 0 0 ${sweep} ${HR} ${px} Z`;
      lx1 = -HR; ly1 = px; lx2 = HR; ly2 = px; // flat edge = horizontal value marker
    }
    handleEl.select(".za-handle-arc").attr("d", arcD);
    handleEl.select(".za-handle-tick").attr("x1", lx1).attr("y1", ly1).attr("x2", lx2).attr("y2", ly2);
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
      input.style.transformOrigin = "center center";
      input.style.transform = "rotate(-90deg)";
      input.style.left = `${margin + thickness / 2 - length / 2}px`;
      input.style.top = `${margin + length / 2 - H / 2}px`;
    }
    container.node().appendChild(input);
    input.addEventListener("input", (e) => onInput(which, e.isTrusted));
    return input;
  };
  const loInput = mkInput("lo");
  const hiInput = mkInput("hi");

  // Mirror keyboard focus from native inputs to SVG handle elements (for a focus ring).
  loInput.addEventListener("focus", () => loHandleEl.classed("focused", true));
  loInput.addEventListener("blur",  () => loHandleEl.classed("focused", false));
  hiInput.addEventListener("focus", () => hiHandleEl.classed("focused", true));
  hiInput.addEventListener("blur",  () => hiHandleEl.classed("focused", false));

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

  // live value badges shown on top of each handle
  const mkLabel = () => { const d = document.createElement("div"); d.className = "za-value"; container.node().appendChild(d); return d; };
  const labelLo = mkLabel();
  const labelHi = mkLabel();

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
    // Keep the band grabbable even for a small selection: enforce a minimum
    // along-axis hit length, centered between the handles. (Fixes pan not working
    // when the range is small, esp. on the vertical axis.)
    const minHit = 16;
    let bStart = g.band.start, bLen = g.band.length;
    if (bLen < minHit) {
      const lo = Math.min(g.loPx, g.hiPx), hi = Math.max(g.loPx, g.hiPx);
      bStart = (lo + hi) / 2 - minHit / 2;
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
    // value badges on top of each handle
    const fmt = (v) => `${format(v)}${units ? " " + units : ""}`;
    labelLo.textContent = fmt(val[0]);
    labelHi.textContent = fmt(val[1]);
    // Value badges appear OUTSIDE the chart (same side as tick labels).
    // Offset 24px from axis line clears standard d3 tick+label zone (6+3+11=20px).
    // Clamp badge along the axis to stay within component bounds.
    if (horizontal) {
      const outDir = orient === "bottom" ? 1 : -1;
      const ty = `${margin + thickness / 2 + outDir * 24}px`;
      const xfm = orient === "bottom" ? "translate(-50%, 0)" : "translate(-50%, -100%)";
      const containerW = length + margin * 2;
      const loW = labelLo.offsetWidth || 50;
      const hiW = labelHi.offsetWidth || 50;
      // Center badge on handle, clamped so it doesn't overflow left/right edge.
      const loLeft = Math.max(loW / 2, Math.min(containerW - loW / 2, margin + g.loPx));
      const hiLeft = Math.max(hiW / 2, Math.min(containerW - hiW / 2, margin + g.hiPx));
      labelLo.style.transform = labelHi.style.transform = xfm;
      labelLo.style.left = `${loLeft}px`; labelLo.style.top = ty;
      labelHi.style.left = `${hiLeft}px`; labelHi.style.top = ty;
    } else {
      const outDir = orient === "left" ? -1 : 1;
      const tx = `${margin + thickness / 2 + outDir * 24}px`;
      const xfm = orient === "left" ? "translate(-100%, -50%)" : "translate(0, -50%)";
      const containerH = length + margin * 2;
      const loH = labelLo.offsetHeight || 18;
      const hiH = labelHi.offsetHeight || 18;
      // Center badge on handle, clamped so it doesn't overflow top/bottom edge.
      const loTop = Math.max(loH / 2, Math.min(containerH - loH / 2, margin + g.loPx));
      const hiTop = Math.max(hiH / 2, Math.min(containerH - hiH / 2, margin + g.hiPx));
      labelLo.style.transform = labelHi.style.transform = xfm;
      labelLo.style.left = tx; labelLo.style.top = `${loTop}px`;
      labelHi.style.left = tx; labelHi.style.top = `${hiTop}px`;
    }
    // Update SVG D-shape handles to current value positions
    updateHandleEl(loHandleEl, g.loPx, "lo");
    updateHandleEl(hiHandleEl, g.hiPx, "hi");
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
