# d3-zoomable-axis — Design

**Package:** `@john-guerra/d3-zoomable-axis` · **Status:** core implemented, browser-verification + adoption pending.

## Motivation

Zooming a chart by dragging used to mean overlaying a *separate* slider on a chart's axis and
aligning it with pixel math against the chart's margins/padding/label offsets — brittle. A
**zoomable axis** collapses the two into one element: it draws the d3 axis *and* carries the
range handles, sharing the chart's scale, so it aligns by construction.

It is built in the **d3 module idiom** (Bostock/Fil): a factory returning a function applied via
`selection.call(...)`, chainable getter/setters, composing existing `d3-*` modules. It also ships
a thin **reactive-widget** wrapper so it drops into Observable `view()` and the reactivewidgets.org
ecosystem.

## API

### Core component (`src/zoomableAxis.js`)

`zoomableAxis{Bottom,Top,Left,Right}(scale)` → a component function.

- **Render:** `selection.call(slider)` draws a d3 axis (via `d3-axis`) + a constrained brush
  (via `d3-brush`) on a thin band along the axis line. Transition-aware.
- **Value:** `[lo, hi]` in **data space**. Brush selection (pixels) is inverted through the scale
  and snapped to `step` (`src/snap.js`). `value()` getter returns a copy; `value([lo,hi])` sets
  silently (re-renders, no event) — the controlled-state pattern that prevents feedback loops.
- **Events** (`d3-dispatch`): `start`, `input` (during drag), `end`; each listener gets `[lo,hi]`.
- **Imperative:** `move(g, [lo,hi])` sets *and* emits (mirrors `brush.move`).
- **Accessors:** `scale, value, step, handleSize, ticks, tickArguments, tickValues, tickFormat,
  tickSize, tickSizeInner, tickSizeOuter, tickPadding, on` — d3-axis getter/setter idiom
  (`arguments.length ? (set, component) : value`).

### Reactive-widget convenience (`src/input.js`)

`zoomableAxisInput(scaleOrDomain, opts)` → an `HTMLElement` enhanced with `reactive-widget-helper`:
`.value` is `[lo,hi]`, dispatches `input`. Builds its own `<svg><g>`, applies the core component,
bridges core `input` → `widget.setValue` → `input` event; external `setValue`/`value` re-renders
the core. Optional peer dep (only this layer needs it).

### Pure helpers (`src/snap.js`)

`snapRange([lo,hi], domain, step)` / `snapValue(v, domain, step)` — order, clamp to domain, snap to
step; domain endpoints stay reachable when step doesn't divide the span. No d3/DOM deps; unit-tested.

## Internals

```
zoomableAxis(orient, scale)
├── d3-axis     → ticks + labels + domain line for `scale`
├── d3-brush    → handles + selection band along the axis (pixels)
├── d3-scale    → scale.invert(px) <-> scale(data)
├── snap.js     → order / clamp / step-snap
└── d3-dispatch → start / input / end  (+ .on copy/forward)
```

See [d3-api-style.md](./d3-api-style.md) for the idiom, and
[history-direct-manipulation-rangesliders.md](./history-direct-manipulation-rangesliders.md) for the
Shneiderman/Plaisant dynamic-query lineage that motivates the live, tightly-coupled feedback.

## Packaging

- ESM source (`type: module`), `main`/`module` → `src/index.js`; `unpkg`/`jsdelivr` → minified UMD.
- `exports` targets all start with `./` (avoids the `ERR_INVALID_PACKAGE_TARGET` trap).
- `d3-*` are runtime deps, **externalized** in the Rollup UMD build (merge into global `d3`).
- `reactive-widget-helper` is an **optional peer**.
- `"sideEffects": false` for tree-shaking.

## Testing

- `node --test` for `snap` (pure).
- Brush gestures need *trusted* events, so render + drag is verified in a browser (Playwright) when
  adopted in a host app / demo page — not jsdom.

## Status / next steps

1. ✅ Core component, reactive wrapper, pure helper, packaging scaffold.
2. ⏳ Browser verification (render + real drag → emits data-space range; reset; orientation).
3. ⏳ Rollup build + `npm pack` sanity.
4. ⏳ Observable notebook demo (reactivewidgets.org entry).
5. ⏳ Adopt in Explorador Canguro: replace the overlay sliders; ideally have TimeWidget expose its
   x/y scales (and optionally suppress its own axes) so the zoomable axes align by shared scale.

## Open decisions

1. Package name `@john-guerra/d3-zoomable-axis` (npm-lowercase; folder `d3ZoomableAxis`). OK?
2. Live-drag event name: `input` (chosen, DOM/reactive cohesion) vs `change`.
3. Interaction: reuse `d3-brush` (chosen for v1) vs hand-rolled handles.
4. Ship a minimal default stylesheet for the handles, or leave unstyled with documented classes?
