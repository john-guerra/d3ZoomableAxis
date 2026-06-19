import { create } from "d3-selection";
import { scaleLinear } from "d3-scale";
import ReactiveWidget from "reactive-widget-helper";
import {
  zoomableAxisBottom,
  zoomableAxisTop,
  zoomableAxisLeft,
  zoomableAxisRight,
} from "./zoomableAxis.js";

const FACTORY = {
  bottom: zoomableAxisBottom,
  top: zoomableAxisTop,
  left: zoomableAxisLeft,
  right: zoomableAxisRight,
};

// Reactive-widget convenience (reactivewidgets.org pattern). Builds an <svg><g>,
// applies the core zoomable axis, and enhances the element with
// reactive-widget-helper so it behaves like an Observable input: `.value` is
// [lo, hi] in data space and the element dispatches "input" on change.
//
//   const weeks = view(zoomableAxisInput(x, { orient: "bottom", step: 1 }));
//
// `scale` may be a d3 scale (its range is used) or a plain [min, max] domain
// (a linear scale is built; pass `length` to set its pixel range).
export function zoomableAxisInput(scale, {
  orient = "bottom",
  step = 1,
  value,
  length,
  thickness = 40,
  margin = 20,
  ticks,
  tickFormat,
} = {}) {
  const horizontal = orient === "bottom" || orient === "top";
  let s = typeof scale === "function" ? scale : scaleLinear().domain(scale);
  if (length != null) s = s.copy().range(horizontal ? [0, length] : [length, 0]);

  const r = s.range();
  const span = Math.abs(+r[r.length - 1] - +r[0]);
  const w = horizontal ? span + margin * 2 : thickness;
  const h = horizontal ? thickness : span + margin * 2;

  const container = create("div").attr("class", "zoomable-axis");
  const svg = container.append("svg")
    .attr("width", w).attr("height", h).style("overflow", "visible");
  const g = svg.append("g").attr(
    "transform",
    horizontal
      ? `translate(${margin},${orient === "top" ? thickness - 1 : 1})`
      : `translate(${orient === "right" ? 1 : thickness - 1},${margin})`
  );

  const slider = FACTORY[orient](s).step(step);
  if (ticks != null) slider.ticks(ticks);
  if (tickFormat != null) slider.tickFormat(tickFormat);
  if (value != null) slider.value(value);

  const el = container.node();
  const widget = ReactiveWidget(el, {
    value: slider.value(),
    showValue: () => g.call(slider.value(widget.value)), // external set -> re-render
  });
  slider.on("input.widget", (v) => widget.setValue(v));   // drag -> reactive value + "input"

  g.call(slider);
  return widget;
}
