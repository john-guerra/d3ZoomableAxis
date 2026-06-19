// @john-guerra/d3-zoomable-axis
//
// A d3 axis you can drag to zoom: it draws a d3 axis (ticks, labels, domain line)
// and carries two handles defining a [lo, hi] sub-range, emitting that range in
// DATA space. Two API layers:
//
//   1. Core d3 component (d3 idiom): zoomableAxis{Bottom,Top,Left,Right}(scale),
//      applied via selection.call(...), chainable accessors, d3-dispatch events.
//   2. Reactive-widget convenience: zoomableAxisInput(scale, opts) -> an element
//      with .value [lo,hi] that emits "input" (reactivewidgets.org pattern).
//
// See docs/DESIGN.md and docs/d3-api-style.md.

export {
  zoomableAxisBottom,
  zoomableAxisTop,
  zoomableAxisLeft,
  zoomableAxisRight,
} from "./zoomableAxis.js";

export { zoomableAxisInput } from "./input.js";

export { snapRange, snapValue } from "./snap.js";
