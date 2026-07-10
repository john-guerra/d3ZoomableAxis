import { create, select } from "d3-selection";
import { scaleLinear } from "d3-scale";
import { axisBottom, axisTop, axisLeft, axisRight } from "d3-axis";
import { dispatch } from "d3-dispatch";
import { area as d3area, curveMonotoneX, curveMonotoneY } from "d3-shape";
import ReactiveWidget from "reactive-widget-helper";
import { density1d } from "fast-kde";
import { snapRange } from "./snap.js";
import { axisGeometry } from "./geometry.js";

const AXIS = { bottom: axisBottom, top: axisTop, left: axisLeft, right: axisRight };

// Value <-> native-input string for the exact-entry editor. Numbers pass through;
// temporal types serialize/parse in LOCAL time (what the user sees on the axis),
// so a typed "2021-12-31 14:03:20" round-trips to the same wall-clock instant.
const pad2 = (n) => String(n).padStart(2, "0");
function valueToInputString(v, type) {
  if (type === "number") return String(Math.round(v * 1000) / 1000);
  const d = new Date(v);
  const ymd = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const hms = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  if (type === "date") return ymd;
  if (type === "time") return hms;
  return `${ymd}T${hms}`; // datetime-local
}
function inputStringToValue(s, type) {
  if (type === "number") return +s;
  if (!s) return NaN;
  // "date" has no time part → pin to local midnight (bare "YYYY-MM-DD" would
  // otherwise parse as UTC and drift by the timezone offset).
  return new Date(type === "date" ? `${s}T00:00` : s).getTime();
}

let scentClipSeq = 0; // unique clipPath ids when several axes share a page

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === "undefined") return;
  stylesInjected = true;
  const css = `
.zoomable-axis-input { position: relative; font: 10px sans-serif; --za-accent: #4682b4; z-index: 0;
  -webkit-user-select: none; user-select: none; }
.zoomable-axis-input:focus-within { z-index: 10; }
/* Axis is decorative: never selectable, never intercepts a drag (so dragging
   across the tick labels pans/resizes instead of selecting their text). */
.zoomable-axis-input .za-axis { pointer-events: none; }
.zoomable-axis-input .za-axis path,
.zoomable-axis-input .za-axis line { stroke: #bbb; }
/* The double-click value editor is a real text field — re-enable selection. */
.zoomable-axis-input input { -webkit-user-select: text; user-select: text; }
.zoomable-axis-input input[type=range] {
  position: absolute; margin: 0; background: transparent; pointer-events: none;
  -webkit-appearance: none; appearance: none;
}
.zoomable-axis-input input[type=range]:focus { outline: none; }
/* Thumbs are pointer-INERT: endpoint dragging is done via the SVG .za-knob
   (setupDrag), not the native thumb. The inputs stay for keyboard + a11y only,
   so there is no ambiguous full-width drag zone competing with the pan band. */
.zoomable-axis-input input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none; pointer-events: none;
  height: 20px; width: 20px; opacity: 0;
}
.zoomable-axis-input input[type=range]::-moz-range-thumb {
  pointer-events: none; height: 20px; width: 20px; opacity: 0;
}
/* ── Musical-note / p-shape handles ─────────────────────────────────────────
   SVG layer: tick (value marker) + stem (connecting line). pointer-events:none
   on the SVG itself; individual .za-handle groups set pointer-events:all so
   the tick+stem area is directly grabbable for drag. */
.zoomable-axis-input .za-handles-svg { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; z-index: 3; }
.zoomable-axis-input .za-handle { cursor: grab; }
.zoomable-axis-input .za-handle:active,
.zoomable-axis-input .za-handle.za-dragging { cursor: grabbing; }
/* All range elements share one color (--za-accent): pill, band, and handles.
   Shape — not hue — distinguishes them, so the widget stays visually calm. */
.zoomable-axis-input .za-handle .za-handle-tick { stroke: var(--za-accent); stroke-width: 2; stroke-linecap: round; }
.zoomable-axis-input .za-handle .za-handle-stem { stroke: var(--za-accent); stroke-width: 1.5; }
/* Knob: the half-disc grab affordance at each endpoint — the only place an
   endpoint drag starts. A soft translucent ring delineates it without shouting. */
.zoomable-axis-input .za-handle .za-knob { fill: var(--za-accent); stroke: rgba(255,255,255,.7); stroke-width: 1.25; }
.zoomable-axis-input .za-handle:hover .za-knob { fill: color-mix(in srgb, var(--za-accent) 82%, #fff); }
.zoomable-axis-input .za-handle.focused .za-handle-tick,
.zoomable-axis-input .za-handle.focused .za-handle-stem { stroke-width: 3; filter: drop-shadow(0 0 3px var(--za-accent)); }
.zoomable-axis-input .za-handle.focused .za-knob,
.zoomable-axis-input .za-handle.za-dragging .za-knob { stroke-width: 2; filter: drop-shadow(0 0 3px var(--za-accent)); }
/* Pan HIT AREA — a big, easy-to-grab layer spanning the selection interior and
   full body height. z-index 2 keeps it above the pointer-inert inputs so the
   region between the knobs reliably grabs to pan. It is transparent/translucent
   so it never tints the sparkline beneath. */
.zoomable-axis-input .za-selected { position: absolute; z-index: 2; background: var(--za-accent); opacity: .12; cursor: move; }
.zoomable-axis-input .za-selected:active { cursor: grabbing; }
/* Scented widgets have a separate visible marker (.za-band-line), so the hit
   layer is fully transparent — a pure grab zone that muddies no colors. */
.zoomable-axis-input .za-selected.za-thin { background: transparent; opacity: 1; }
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
  // Axis tick hint passed straight to d3's axis.ticks(): a count (e.g. 4) or a
  // d3 time interval. null keeps d3's default (~10) — too dense for a compact
  // sparkline, so callers there should pass a small count.
  ticks = null,
  // Native input type for the double-click "type an exact value" editor:
  // "number" (default) or a temporal type ("date" | "datetime-local" | "time")
  // when the axis represents time. Drives value↔string conversion below.
  inputType = "number",
  format = (d) => `${Math.round(d)}`,
  // Scented-widget distribution drawn along the axis (Willett/Heer/Agrawala 2007):
  //   scent: { values:number[], type:"histogram"|"violin"|"area", style?:"kde"|"bars",
  //            bins?:30, size?:24, color?:"#cbd5e1", colorSelected?, side?:"out"|"in"
  //            (histogram default "in" → bars grow toward the plot; area default "out"),
  //            bandwidth?, adjust?, pad?, curve? }
  //   KDE tunables (fast-kde): bandwidth (absolute), adjust (× the auto Scott
  //   bandwidth), pad (domain padding). `curve` applies to area AND violin.
  //   For violins/areas, style defaults to "kde" (smooth via fast-kde); "bars" keeps
  //   the mirrored-bars look. Histograms are always bars. "area" is a one-sided
  //   sparkline fill; `curve` is a d3-shape curve factory (default: monotone).
  scent = null,
} = {}) {
  const hasScent = !!(scent && scent.values && scent.values.length);
  injectStyles();
  const horizontal = orient === "bottom" || orient === "top";
  const scale = (typeof scaleOrDomain === "function" ? scaleOrDomain.copy() : scaleLinear().domain(scaleOrDomain))
    .range(horizontal ? [0, length] : [length, 0]);
  // Numeric domain bounds. scale.domain() returns Date objects for a d3 time
  // scale; coerce so arithmetic (snapRange, drag deltas, native input min/max)
  // stays numeric instead of concatenating strings into NaN. The axis (drawn
  // from `scale` itself, below) keeps the original scale, so time scales still
  // render date-formatted ticks.
  const [dMin, dMax] = scale.domain().map(Number);
  const listeners = dispatch("start", "input", "end");

  let val = snapRange(value || [dMin, dMax], [dMin, dMax], step);
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
  const axis = AXIS[orient](scale).tickSizeOuter(0);
  if (ticks != null) axis.ticks(ticks);
  axisG.call(axis);

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
  const KNOB_R = 8; // grab-knob radius (px) — the endpoint drag target
  const mkHandleEl = () => {
    // pointer-events:all on the group so the knob+tick+stem area is draggable.
    const g = handlesG.append("g").attr("class", "za-handle").attr("pointer-events", "all");
    g.append("line").attr("class", "za-handle-stem");
    g.append("line").attr("class", "za-handle-tick");
    // A HALF-disc (flat side on the axis line at the value, bulging OUTWARD, away
    // from the selected range) — you resize by grabbing outside the range; the
    // inside belongs to the pan band. Path `d` is set per-orientation in layout.
    g.append("path").attr("class", "za-knob");
    return g;
  };
  // Semicircle path: flat diameter through the endpoint on the axis line, curved
  // side bulging in the `outward` pixel direction (−1/+1). `outward>0` → sweep 1.
  const knobPath = (px, outward) => {
    const s = outward > 0 ? 1 : 0;
    return horizontal
      ? `M ${px} ${-KNOB_R} A ${KNOB_R} ${KNOB_R} 0 0 ${s} ${px} ${KNOB_R} Z`
      : `M ${-KNOB_R} ${px} A ${KNOB_R} ${KNOB_R} 0 0 ${s} ${KNOB_R} ${px} Z`;
  };
  // Along-axis pixel direction of INCREASING value (+1 for range [0,len], −1 for
  // [len,0]). lo bulges toward smaller values, hi toward larger — i.e. outward.
  const axisSign = Math.sign(scale.range()[1] - scale.range()[0]) || 1;
  const loHandleEl = mkHandleEl();
  const hiHandleEl = mkHandleEl();

  function updateHandleEl(handleEl, px, which) {
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
    // Half-disc bulging outward (away from the range): lo toward smaller values,
    // hi toward larger. So the grab area lives strictly OUTSIDE the selection.
    const outward = which === "hi" ? axisSign : -axisSign;
    handleEl.select(".za-knob").attr("d", knobPath(px, outward));
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

  // (Removed the dual-range z-index proximity toggle: the native thumbs are now
  // pointer-inert, so there is no thumb-vs-thumb hit-test to arbitrate. Endpoint
  // dragging happens on the SVG knobs; the inputs are keyboard/a11y only.)

  // Badge pill: note head at the tip of the stem. Draggable + double-click to edit.
  const mkLabel = () => { const d = document.createElement("div"); d.className = "za-value"; container.node().appendChild(d); return d; };
  const labelLo = mkLabel();
  const labelHi = mkLabel();

  // Shared drag factory: wire pointer drag on target (SVG node or div) to a range
  // input. A movement THRESHOLD gates the drag so a stationary press+release stays
  // a click — otherwise preventDefault-on-pointerdown would swallow the badge's
  // double-click-to-edit. We only preventDefault (and mark dragging) once the
  // pointer actually moves past the threshold.
  const DRAG_THRESH = 3; // px
  function setupDrag(target, which, focusInput = false) {
    const inputEl = which === "lo" ? loInput : hiInput;
    const sr = scale.range();
    const dataPerPx = (dMax - dMin) / (sr[sr.length - 1] - sr[0]);
    const node = target.node ? target.node() : target; // d3 selection or raw element
    node.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      // Grabbing a knob focuses its input so arrow-key nudging works afterward
      // (the native thumb no longer receives the click to do this for us).
      // preventDefault here suppresses the compat mousedown that would otherwise
      // steal focus back to the body — safe because knobs (unlike badges) have no
      // double-click-to-edit that a stationary press must preserve.
      if (focusInput) {
        ev.preventDefault();
        inputEl.focus({ preventScroll: true });
      }
      const startPx = horizontal ? ev.clientX : ev.clientY;
      const startVal = val[which === "lo" ? 0 : 1];
      let started = false;
      // Attach move/up to document so drag works even when pointer leaves the element.
      const move = (e) => {
        const dPx = (horizontal ? e.clientX : e.clientY) - startPx;
        if (!started) {
          if (Math.abs(dPx) < DRAG_THRESH) return; // still a click, let dblclick fire
          started = true;
          if (target.classed) target.classed("za-dragging", true); else target.classList.add("za-dragging");
          listeners.call("start", el, val.slice());
        }
        e.preventDefault();
        let nv = startVal + dPx * dataPerPx;
        nv = which === "lo" ? Math.max(dMin, Math.min(val[1], nv)) : Math.max(val[0], Math.min(dMax, nv));
        inputEl.value = nv;
        // Drive the shared handler directly: a synthetic dispatchEvent("input")
        // is untrusted, and onInput's trusted-gate would swallow the emit — so
        // handle drags would move the thumb but never apply the filter.
        onInput(which, true);
      };
      const up = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        if (started) {
          if (target.classed) target.classed("za-dragging", false); else target.classList.remove("za-dragging");
          listeners.call("end", el, val.slice());
        }
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
    });
  }

  // Double-click a badge → a standard native <input> to type an exact value.
  // Its type follows `inputType` (number, or date/datetime-local/time for a
  // temporal axis), so the picker is the OS-native one for that kind of value.
  function setupBadgeEdit(labelEl, which) {
    labelEl.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      const curVal = val[which === "lo" ? 0 : 1];
      labelEl.classList.add("za-editing");
      const inp = document.createElement("input");
      inp.type = inputType;
      inp.value = valueToInputString(curVal, inputType);
      // step: numeric axes keep the widget's step; temporal ones expose seconds.
      if (inputType === "number") inp.step = step;
      else if (inputType !== "date") inp.step = 1;
      // Widen for temporal types so the native date/time picker isn't clipped by
      // the narrow badge (the default 5em CSS width only fits a number).
      inp.style.width = inputType === "number" ? "5em"
        : inputType === "date" ? "8.5em"
        : inputType === "time" ? "7em" : "13em";
      labelEl.textContent = ""; labelEl.appendChild(inp);
      inp.focus(); if (inp.select) inp.select();
      const commit = () => {
        const parsed = inputStringToValue(inp.value, inputType);
        const nv = Math.max(dMin, Math.min(dMax, Number.isFinite(parsed) ? parsed : curVal));
        labelEl.classList.remove("za-editing");
        const inputEl = which === "lo" ? loInput : hiInput;
        inputEl.value = nv; onInput(which, true); // trusted-gate: emit directly (see setupDrag)
      };
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        if (e.key === "Escape") { labelEl.classList.remove("za-editing"); layout(); }
      });
      inp.addEventListener("blur", () => commit());
    });
  }

  // SVG handle (tick + stem) and badge pill are both independently draggable.
  setupDrag(loHandleEl, "lo", true);
  setupDrag(hiHandleEl, "hi", true);
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
      domain: [dMin, dMax],
      range: horizontal ? [0, length] : [length, 0],
      value: val,
      handleR: HR, // half-circle radius from outer scope
    });
    // Pan band fills the INSIDE of the selection right up to the endpoints — the
    // knobs bulge outward, so the whole interior is free to grab-and-pan. A hair
    // of inset keeps it off the value ticks. If the window is too narrow to leave
    // a usable strip, hide the band — the user resizes with the outward knobs.
    const INNER_PAD = 2;
    const MIN_PAN = 10; // px; below this there's no room to pan between endpoints
    const bLo = Math.min(g.loPx, g.hiPx), bHi = Math.max(g.loPx, g.hiPx);
    const bStart = bLo + INNER_PAD, bLen = bHi - bLo - 2 * INNER_PAD;
    // Big grab area (full body height) for comfortable panning; it's transparent
    // for scented widgets (see CSS) so the thin .za-band-line stays the visible
    // marker and the sparkline colors show through unmuddied.
    if (bLen < MIN_PAN) {
      band.style.display = "none";
    } else {
      band.style.display = "block";
      if (horizontal) {
        band.style.left = `${margin + bStart}px`;
        band.style.top = `${margin}px`;
        band.style.width = `${bLen}px`;
        band.style.height = `${thickness}px`;
      } else {
        band.style.left = `${margin}px`;
        band.style.top = `${margin + bStart}px`;
        band.style.width = `${thickness}px`;
        band.style.height = `${bLen}px`;
      }
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
    // Update SVG musical-note handles (tick + stem + outward half-knob).
    updateHandleEl(loHandleEl, g.loPx, "lo");
    updateHandleEl(hiHandleEl, g.hiPx, "hi");
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
      // Popover-style collision handling: keep each badge centered on its handle
      // when they're far apart, but once they'd overlap, push lo left and hi
      // right (splitting around their midpoint) so they never stack. GAP keeps a
      // small breathing space. Badges may overflow the widget box — that's fine
      // (the host leaves room around it), so we deliberately DON'T clamp to
      // containerW; clipping the date to fit is worse than a little overflow.
      const GAP = 6;
      let loC = margin + g.loPx, hiC = margin + g.hiPx;
      const minApart = (loW + hiW) / 2 + GAP;
      if (hiC - loC < minApart) {
        const mid = (loC + hiC) / 2;
        loC = mid - minApart / 2;
        hiC = mid + minApart / 2;
      }
      labelLo.style.transform = labelHi.style.transform = xfm;
      labelLo.style.left = `${loC}px`; labelLo.style.top = ty;
      labelHi.style.left = `${hiC}px`; labelHi.style.top = ty;
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
    const { values, type = "histogram", bins: nBins = 30, size = 24, color = "#cbd5e1", colorSelected, side,
            style, bandwidth, adjust, pad, curve } = opts;
    scentOut = color;
    scentIn = colorSelected || "var(--za-accent)";
    scentSize = size;
    // Violins/areas default to a smooth KDE (style "kde"); "bars" keeps the
    // mirrored-bars look. Histograms are always bars. "area" is a one-sided
    // sparkline fill (baseline on the axis, curve outward); "violin" mirrors it.
    const useKde = (type === "violin" || type === "area") && (style ?? "kde") === "kde";
    const [d0, d1] = scale.domain().map(Number);
    if (useKde) { renderScentKde(svgSel, values, { type, nBins, size, bandwidth, adjust, pad, curve, d0, d1 }); return; }
    // Histogram draw direction. "out" = away from the plot (axisBottom → down,
    // axisTop → up, axisLeft → left, axisRight → right); "in" = toward the plot.
    // Histograms default to "in" so bars grow UP from a bottom axis (bar-chart
    // convention); one-sided "area" sparklines default to "out" (fill below).
    const effSide = side ?? (type === "area" ? "out" : "in");
    const outDir = orient === "bottom" || orient === "right" ? 1 : -1;
    const sign = (effSide === "in" ? -1 : 1) * outDir;
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
  function renderScentKde(svgSel, values, { type = "violin", nBins, size, bandwidth, adjust, pad, curve, d0, d1 }) {
    const nums = [];
    for (const raw of values) { const v = +raw; if (raw != null && !Number.isNaN(v)) nums.push(v); }
    // fast-kde tunables (all optional): bandwidth (absolute kernel width),
    // adjust (multiplier on the automatic Scott bandwidth), pad (domain padding).
    const kdeOpts = { bins: nBins };
    if (bandwidth != null) kdeOpts.bandwidth = bandwidth;
    if (adjust != null) kdeOpts.adjust = adjust;
    if (pad != null) kdeOpts.pad = pad;
    const dens = Array.from(density1d(nums, kdeOpts)).filter((p) => p.x >= d0 && p.x <= d1);
    if (dens.length < 2) return;
    const maxY = Math.max(...dens.map((p) => p.y)) || 1;
    // "area" = one-sided fill (full `size` outward); "violin" = symmetric (± half).
    const dPath = type === "area" ? areaPath(dens, maxY, size, curve) : violinPath(dens, maxY, size / 2, curve);

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
  // <g>'s local space (origin on the axis line). along = scale(x); the density y
  // maps to a half-thickness on each side. Uses d3-shape's area generator so the
  // caller's `curve` applies to BOTH edges (straight segments ignored the curve);
  // the two edges are y0=-cross / y1=+cross (x0/x1 when vertical).
  function violinPath(pts, maxY, half, curve) {
    const along = (d) => scale(d.x);
    const cross = (d) => (d.y / maxY) * half;
    const c = curve || (horizontal ? curveMonotoneX : curveMonotoneY);
    const gen = horizontal
      ? d3area().x(along).y0((d) => -cross(d)).y1((d) => cross(d)).curve(c)
      : d3area().y(along).x0((d) => -cross(d)).x1((d) => cross(d)).curve(c);
    return gen(pts) || "";
  }

  // One-sided area (sparkline): baseline on the axis line (cross 0), the density
  // curve rises `extent` px *toward the plot* (upward for a bottom axis). The
  // drag handles/badges point outward (below), so an upward area never collides
  // with them. Uses d3-shape's area generator with a monotone curve — smoother
  // than straight segments, and monotone won't overshoot the baseline (a density
  // is non-negative, so no spurious dips below 0). Same local space as
  // violinPath, so the clip two-tone works unchanged.
  function areaPath(pts, maxY, extent, curve) {
    const upDir = orient === "bottom" || orient === "right" ? -1 : 1;
    const along = (d) => scale(d.x);
    const cross = (d) => upDir * (d.y / maxY) * extent;
    // Caller-supplied d3 curve factory wins; otherwise a monotone curve for the
    // along-axis (won't overshoot the baseline, since a density is non-negative).
    const c = curve || (horizontal ? curveMonotoneX : curveMonotoneY);
    const gen = horizontal
      ? d3area().x(along).y0(0).y1(cross).curve(c)
      : d3area().y(along).x0(0).x1(cross).curve(c);
    return gen(pts) || "";
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
    const r = scale.range();
    const dataPerPx = (dMax - dMin) / (r[r.length - 1] - r[0]);
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
