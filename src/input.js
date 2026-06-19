import { create, select } from "d3-selection";
import { scaleLinear } from "d3-scale";
import { axisBottom, axisTop, axisLeft, axisRight } from "d3-axis";
import { dispatch } from "d3-dispatch";
import ReactiveWidget from "reactive-widget-helper";
import { snapRange } from "./snap.js";
import { axisGeometry } from "./geometry.js";

const AXIS = { bottom: axisBottom, top: axisTop, left: axisLeft, right: axisRight };

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === "undefined") return;
  stylesInjected = true;
  const css = `
.zoomable-axis-input { position: relative; font: 10px sans-serif; --za-accent: #4682b4; }
.zoomable-axis-input .za-axis path,
.zoomable-axis-input .za-axis line { stroke: #bbb; }
.zoomable-axis-input input[type=range] {
  position: absolute; margin: 0; background: transparent; pointer-events: none;
  -webkit-appearance: none; appearance: none;
}
.zoomable-axis-input input[type=range]:focus { outline: none; }
.zoomable-axis-input input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none; pointer-events: auto; cursor: grab;
  height: 16px; width: 16px; border-radius: 50%; background: #fff;
  border: 2px solid var(--za-accent); box-shadow: 0 1px 2px rgba(0,0,0,.3);
}
.zoomable-axis-input input[type=range]::-moz-range-thumb {
  pointer-events: auto; cursor: grab;
  height: 16px; width: 16px; border-radius: 50%; background: #fff;
  border: 2px solid var(--za-accent); box-shadow: 0 1px 2px rgba(0,0,0,.3);
}
.zoomable-axis-input input[type=range]:focus-visible::-webkit-slider-thumb { outline: 2px solid var(--za-accent); outline-offset: 2px; }
.zoomable-axis-input input[type=range]:focus-visible::-moz-range-thumb { outline: 2px solid var(--za-accent); outline-offset: 2px; }
.zoomable-axis-input .za-selected { position: absolute; background: var(--za-accent); opacity: .25; cursor: grab; }
.zoomable-axis-input .za-selected:active { cursor: grabbing; }
.zoomable-axis-input .za-value {
  position: absolute; pointer-events: none; font: 600 11px/1 sans-serif;
  background: var(--za-accent); color: #fff; padding: 2px 5px; border-radius: 3px; white-space: nowrap;
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
} = {}) {
  injectStyles();
  const horizontal = orient === "bottom" || orient === "top";
  const scale = (typeof scaleOrDomain === "function" ? scaleOrDomain.copy() : scaleLinear().domain(scaleOrDomain))
    .range(horizontal ? [0, length] : [length, 0]);
  const [dMin, dMax] = scale.domain();
  const listeners = dispatch("start", "input", "end");

  let val = snapRange(value || scale.domain(), scale.domain(), step);

  const container = create("div").attr("class", "zoomable-axis-input")
    .attr("role", "group")
    .attr("aria-label", `${label || "value"} range`)
    .style("width", `${(horizontal ? length : thickness) + margin * 2}px`)
    .style("height", `${(horizontal ? thickness : length) + margin * 2}px`);
  const el = container.node();

  // d3 axis (decorative)
  const svg = container.append("svg").attr("class", "za-axis").attr("aria-hidden", "true")
    .attr("width", el.style.width).attr("height", el.style.height)
    .style("position", "absolute").style("left", 0).style("top", 0).style("overflow", "visible");
  const axisG = svg.append("g")
    .attr("transform", horizontal ? `translate(${margin},${orient === "top" ? margin : margin + thickness / 2})`
                                  : `translate(${orient === "right" ? margin : margin + thickness / 2},${margin})`);
  axisG.call(AXIS[orient](scale).tickSizeOuter(0));

  // selected-range band (drag to pan)
  const band = container.append("div").attr("class", "za-selected").node();

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
    const R = 8; // handle radius (matches the 16px thumb)
    // along-axis geometry (handles + band) from the tested pure module
    const g = axisGeometry({
      domain: scale.domain(),
      range: horizontal ? [0, length] : [length, 0],
      value: val,
      handleR: R,
    });
    if (horizontal) {
      band.style.left = `${margin + g.band.start}px`;
      band.style.top = `${margin + thickness / 2 - 6}px`;
      band.style.width = `${g.band.length}px`;
      band.style.height = `12px`;
    } else {
      band.style.left = `${margin + thickness / 2 - 6}px`;
      band.style.top = `${margin + g.band.start}px`;
      band.style.width = `12px`;
      band.style.height = `${g.band.length}px`;
    }
    // value badges on top of each handle
    const fmt = (v) => `${format(v)}${units ? " " + units : ""}`;
    labelLo.textContent = fmt(val[0]);
    labelHi.textContent = fmt(val[1]);
    if (horizontal) {
      labelLo.style.transform = labelHi.style.transform = "translate(-50%, 0)";
      const ty = `${margin + thickness / 2 - R - 18}px`;
      labelLo.style.left = `${margin + g.loPx}px`; labelLo.style.top = ty;
      labelHi.style.left = `${margin + g.hiPx}px`; labelHi.style.top = ty;
    } else {
      labelLo.style.transform = labelHi.style.transform = "translate(0, -50%)";
      const tx = `${margin + thickness / 2 + R + 6}px`;
      labelLo.style.left = tx; labelLo.style.top = `${margin + g.loPx}px`;
      labelHi.style.left = tx; labelHi.style.top = `${margin + g.hiPx}px`;
    }
  }

  function onInput(which, trusted) {
    let lo = +loInput.value, hi = +hiInput.value;
    if (lo > hi) { if (which === "lo") lo = hi; else hi = lo; } // clamp: thumbs can't cross
    val = snapRange([lo, hi], scale.domain(), step);
    layout();
    if (trusted) { listeners.call("input", el, val.slice()); widget.setValue(val.slice()); }
  }

  // drag-to-pan: move both bounds together, preserving the window width
  band.addEventListener("pointerdown", (ev) => {
    const startPx = horizontal ? ev.clientX : ev.clientY;
    const start = val.slice();
    const width = start[1] - start[0];
    band.setPointerCapture(ev.pointerId);
    const move = (e) => {
      const dPx = (horizontal ? e.clientX : e.clientY) - startPx;
      const dData = scale.invert((horizontal ? scale(dMin) : scale(dMax)) + dPx) - dMin; // delta in data units
      let lo = start[0] + (horizontal ? dData : -dData);
      lo = Math.max(dMin, Math.min(dMax - width, lo));
      val = snapRange([lo, lo + width], scale.domain(), step);
      layout();
      listeners.call("input", el, val.slice());
      widget.setValue(val.slice());
    };
    const up = (e) => { band.releasePointerCapture(ev.pointerId); band.removeEventListener("pointermove", move); band.removeEventListener("pointerup", up); listeners.call("end", el, val.slice()); };
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
