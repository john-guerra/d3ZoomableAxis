import { axisBottom, axisTop, axisLeft, axisRight } from "d3-axis";
import { brushX, brushY } from "d3-brush";
import { dispatch } from "d3-dispatch";
import { select } from "d3-selection";
import { snapRange } from "./snap.js";

const TOP = 1, RIGHT = 2, BOTTOM = 3, LEFT = 4;
const AXIS = { [TOP]: axisTop, [RIGHT]: axisRight, [BOTTOM]: axisBottom, [LEFT]: axisLeft };

// Core d3 component: a zoomable axis. Draws a d3 axis for `scale` and overlays a
// dual-handle brush whose selection is the zoomed [lo, hi] sub-range, emitted in
// DATA space (inverted from pixels and snapped to `step`). Applied via
// `selection.call(zoomableAxis...)`. Follows the d3-axis getter/setter idiom.
function zoomableAxis(orient, scale) {
  const horizontal = orient === TOP || orient === BOTTOM;
  let value = scale ? scale.domain().slice() : [0, 1];
  let step = 1;
  let handleSize = 8;
  let tickArguments = [];
  let tickValues = null;
  let tickFormat = null;
  let tickSizeInner = 6;
  let tickSizeOuter = 6;
  let tickPadding = 3;
  const listeners = dispatch("start", "input", "end");
  const brush = horizontal ? brushX() : brushY();

  function axisSlider(context) {
    const selection = context.selection ? context.selection() : context;
    selection.each(function () {
      const g = select(this);

      // 1. the axis (ticks + labels + domain line)
      const axis = AXIS[orient](scale)
        .tickArguments(tickArguments)
        .tickSizeInner(tickSizeInner)
        .tickSizeOuter(tickSizeOuter)
        .tickPadding(tickPadding);
      if (tickValues != null) axis.tickValues(tickValues);
      if (tickFormat != null) axis.tickFormat(tickFormat);
      g.call(axis);

      // 2. the brush (handles + selection) on a thin band centered on the axis
      const [r0, r1] = rangeSorted(scale);
      brush
        .handleSize(handleSize)
        .extent(
          horizontal
            ? [[r0, -handleSize], [r1, handleSize]]
            : [[-handleSize, r0], [handleSize, r1]]
        )
        .on("start.zoom brush.zoom end.zoom", onBrush);
      g.call(brush);

      moveSilently(g);
    });
  }

  function onBrush(event) {
    if (event.sourceEvent == null) return; // ignore programmatic moves (no feedback loop)
    const sel = event.selection;
    value = sel == null
      ? scale.domain().slice()
      : snapRange(invertSelection(sel, scale), scale.domain(), step);
    listeners.call(event.type === "brush" ? "input" : event.type, axisSlider, value.slice());
  }

  function moveSilently(g) {
    g.call(brush.move, value.map(scale).sort(ascending));
  }

  axisSlider.scale = function (_) { return arguments.length ? (scale = _, axisSlider) : scale; };
  axisSlider.value = function (_) {
    return arguments.length ? (value = snapRange(_, scale.domain(), step), axisSlider) : value.slice();
  };
  axisSlider.step = function (_) { return arguments.length ? (step = +_, axisSlider) : step; };
  axisSlider.handleSize = function (_) { return arguments.length ? (handleSize = +_, axisSlider) : handleSize; };
  axisSlider.ticks = function () { tickArguments = Array.from(arguments); return axisSlider; };
  axisSlider.tickArguments = function (_) {
    return arguments.length ? (tickArguments = _ == null ? [] : Array.from(_), axisSlider) : tickArguments.slice();
  };
  axisSlider.tickValues = function (_) {
    return arguments.length ? (tickValues = _ == null ? null : Array.from(_), axisSlider) : tickValues && tickValues.slice();
  };
  axisSlider.tickFormat = function (_) { return arguments.length ? (tickFormat = _, axisSlider) : tickFormat; };
  axisSlider.tickSize = function (_) { return arguments.length ? (tickSizeInner = tickSizeOuter = +_, axisSlider) : tickSizeInner; };
  axisSlider.tickSizeInner = function (_) { return arguments.length ? (tickSizeInner = +_, axisSlider) : tickSizeInner; };
  axisSlider.tickSizeOuter = function (_) { return arguments.length ? (tickSizeOuter = +_, axisSlider) : tickSizeOuter; };
  axisSlider.tickPadding = function (_) { return arguments.length ? (tickPadding = +_, axisSlider) : tickPadding; };

  // Imperative: set the range AND notify listeners (mirrors d3 brush.move).
  axisSlider.move = function (context, range) {
    value = snapRange(range, scale.domain(), step);
    (context.selection ? context.selection() : context).each(function () {
      moveSilently(select(this));
    });
    listeners.call("input", axisSlider, value.slice());
    listeners.call("end", axisSlider, value.slice());
    return axisSlider;
  };

  axisSlider.on = function () {
    const v = listeners.on.apply(listeners, arguments);
    return v === listeners ? axisSlider : v;
  };

  return axisSlider;
}

function ascending(a, b) { return a - b; }

function rangeSorted(scale) {
  const r = scale.range();
  const a = +r[0], b = +r[r.length - 1];
  return a <= b ? [a, b] : [b, a];
}

function invertSelection(selection, scale) {
  const a = scale.invert(selection[0]);
  const b = scale.invert(selection[1]);
  return a <= b ? [a, b] : [b, a];
}

export function zoomableAxisTop(scale) { return zoomableAxis(TOP, scale); }
export function zoomableAxisRight(scale) { return zoomableAxis(RIGHT, scale); }
export function zoomableAxisBottom(scale) { return zoomableAxis(BOTTOM, scale); }
export function zoomableAxisLeft(scale) { return zoomableAxis(LEFT, scale); }
