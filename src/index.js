// @john-guerra/d3-zoomable-axis — main entry (CORE only)
//
// A d3 axis you can drag to zoom: it draws a d3 axis (ticks, labels, domain line)
// and carries a d3-brush selecting a [lo, hi] sub-range, emitting it in DATA space.
//
//   zoomableAxis{Bottom,Top,Left,Right}(scale)  — the d3-idiom core component,
//   applied via selection.call(...), chainable accessors, d3-dispatch events.
//
// The accessible reactive-widget layer (zoomableAxisInput — native <input> handles,
// scented distribution, settings panel) is a SEPARATE entry so this core stays free
// of its optional peer (reactive-widget-helper) and heavier deps:
//
//   import { zoomableAxisInput } from "@john-guerra/d3-zoomable-axis/input";
//
// See docs/DESIGN.md and docs/d3-api-style.md.

export {
  zoomableAxisBottom,
  zoomableAxisTop,
  zoomableAxisLeft,
  zoomableAxisRight,
} from "./zoomableAxis.js";

export { snapRange, snapValue } from "./snap.js";
export { applyNice } from "./nice.js";
