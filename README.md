# d3-zoomable-axis

**A d3 axis you can drag to zoom.** It combines a [d3 axis](https://d3js.org/d3-axis)
(ticks, labels, domain line) with a dual-handle range control: drag the handles to select a
`[lo, hi]` sub-range, which it emits in **data space**. One scale, one element — the axis *is*
the zoom control, so it lines up with your chart by construction (no pixel-offset hacks).

> npm: `@john-guerra/d3-zoomable-axis` · status: **early (0.0.x)**

Two API layers:

1. **Core d3 component** — the [d3 idiom](./docs/d3-api-style.md): a factory applied via
   `selection.call(...)`, chainable accessors, `d3-dispatch` events.
2. **Reactive-widget convenience** — the [reactivewidgets.org](https://reactivewidgets.org)
   pattern: returns a DOM element with `.value` `[lo,hi]` that dispatches `input`, so it works
   with Observable `view()`.

## Install

```bash
npm install @john-guerra/d3-zoomable-axis
```

## Core component (d3 idiom)

```js
import * as d3 from "d3";
import { zoomableAxisBottom } from "@john-guerra/d3-zoomable-axis";

const x = d3.scaleLinear().domain([24, 92]).range([0, 600]);

const slider = zoomableAxisBottom(x)
  .step(1)
  .ticks(10)
  .value([30, 60])                  // initial [lo, hi] in data space
  .on("input", (v) => chart.zoomX(v))  // fires while dragging
  .on("end",   (v) => persist(v));

d3.select("svg").append("g")
  .attr("transform", "translate(20,40)")
  .call(slider);

slider.value();          // -> [30, 60]
slider.value([40, 70]);  // set + re-render, no event
```

Factories: `zoomableAxisBottom`, `zoomableAxisTop`, `zoomableAxisLeft`, `zoomableAxisRight`
(orientation mirrors d3-axis). Accessors: `scale`, `value`, `step`, `handleSize`, `ticks`,
`tickArguments`, `tickValues`, `tickFormat`, `tickSize`, `tickSizeInner`, `tickSizeOuter`,
`tickPadding`, `on`. Events (`d3-dispatch`): `start`, `input`, `end` — each receives `[lo, hi]`
in data space (inverted from pixels, snapped to `step`). Imperative `slider.move(g, [lo,hi])`
sets and emits; `slider.value([lo,hi])` sets silently.

## Reactive-widget (Observable / reactivewidgets.org)

```js
import { zoomableAxisInput } from "@john-guerra/d3-zoomable-axis";

const weeks = view(zoomableAxisInput([24, 92], {
  orient: "bottom", step: 1, length: 600, value: [30, 60],
}));
// `weeks` is reactive [lo, hi]; the element has .value and dispatches "input".
```

## Design & background

- [docs/DESIGN.md](./docs/DESIGN.md) — architecture, API, packaging plan.
- [docs/d3-api-style.md](./docs/d3-api-style.md) — the d3 reusable-component idiom reference.
- [docs/history-direct-manipulation-rangesliders.md](./docs/history-direct-manipulation-rangesliders.md)
  — Shneiderman & Plaisant dynamic-query range sliders and design takeaways.

## License

ISC © John Alexis Guerra Gómez
