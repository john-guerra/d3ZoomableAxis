# d3-zoomable-axis — Design

**Package:** `@john-guerra/d3-zoomable-axis` · **Status:** published **0.0.3** (npm), browser-verified.

## Motivation

Zooming a chart by dragging used to mean overlaying a *separate* slider on a chart's axis and
aligning it with pixel math against the chart's margins/padding/label offsets — brittle. A
**zoomable axis** collapses the two into one element: it draws the d3 axis *and* carries the
range handles, sharing the chart's scale, so it aligns by construction.

It is built in the **d3 module idiom** (Bostock/Fil): a factory returning a function applied via
`selection.call(...)`, chainable getter/setters, composing existing `d3-*` modules. On top of that
core it ships an accessible **reactive-widget** layer that drops into Observable `view()` and the
[reactivewidgets.org](https://reactivewidgets.org) ecosystem.

## Two layers, two entry points

The package ships two independent layers, each with its own entry point:

| Entry | Module | Interaction | Extra deps |
| --- | --- | --- | --- |
| `.` (main) | `src/zoomableAxis.js` | **Core** — a `d3-brush` on the axis line, pointer/touch | — |
| `./input` | `src/input.js` | **Accessible widget** — native `<input type=range>` handles + scent + settings panel | d3-scale, d3-shape, fast-kde, `reactive-widget-helper` (optional peer) |

Both share the pure `src/snap.js` (order / clamp / step-snap). They do **not** share rendering or
geometry — the core is a compact d3 component; the widget is where the rich UI lives. Keeping them
as separate imports means a core-only consumer never pulls in the widget's peer/density deps.

> Historical note: an early plan was to unify on native inputs for accessibility across *both*
> layers. In practice the core kept its `d3-brush` implementation (compact, transition-aware,
> pointer-driven), and the accessible native-input design lives only in the widget. The two are
> maintained as distinct, separately-imported layers rather than one merged component.

## Core component (`src/zoomableAxis.js`) — the `.` entry

`zoomableAxis{Bottom,Top,Left,Right}(scale)` → a component function applied via `selection.call`.

- **Render:** a d3 axis (via `d3-axis`) + a constrained brush (via `d3-brush`) on a thin band along
  the axis line. Transition-aware.
- **Value:** `[lo, hi]` in **data space**. Brush pixels are inverted through the scale and snapped to
  `step` (`src/snap.js`). `value()` returns a copy; `value([lo,hi])` sets silently (re-render, no
  event) — the controlled-state pattern that avoids feedback loops.
- **Events** (`d3-dispatch`): `start`, `input` (during drag), `end`; each listener gets `[lo,hi]`.
- **Imperative:** `move(g,[lo,hi])` sets *and* emits (mirrors `brush.move`).
- **Accessors:** `scale, value, step, handleSize, ticks, tickArguments, tickValues, tickFormat,
  tickSize, tickSizeInner, tickSizeOuter, tickPadding, on` (d3 getter/setter idiom).
- **Accessibility:** pointer/touch only — the brush is not keyboard-focusable or screen-reader
  announced. Use the widget layer when accessibility matters.

## Reactive widget (`src/input.js`) — the `./input` entry

`zoomableAxisInput(scaleOrDomain, opts)` → an `HTMLElement` enhanced with `reactive-widget-helper`:
`.value` is `[lo,hi]` and dispatches `input`; `el.on(...)` also exposes `start`/`input`/`end`/`scent`
(via `d3-dispatch`). External `setValue`/`value` re-renders silently.

**Accessible by construction:** the two handles are real `<input type="range">` elements — keyboard
(`←/↓ →/↑`, `PageUp/Down`, `Home/End`), screen-reader announced (`aria-label` + `aria-valuetext`),
standard form controls, clamped so `lo ≤ hi`. Pointer interaction is layered on top:

- **Musical-note handles:** a tick (value marker) + stem + an outward half-disc **knob** (the resize
  grab target), drawn in an SVG layer above the scent.
- **Value badges:** a pill at each stem tip showing the formatted value — **draggable**, and
  **double-click to edit** via an inline native input (`inputType`: `number`/`date`/`time`/`datetime-local`).
- **Drag-to-pan:** dragging the band between the handles moves the whole window; the outward knobs
  resize the ends.
- **Orientation-aware placement** (bottom/top/left/right) via an `axisCross` offset, so handles,
  badges, the selection line, and the scent all sit on the domain line.

### Scent (scented distribution)

`scent: { values, type, … }` draws the data distribution along the axis (Willett/Heer/Agrawala
scented widgets — see where data is dense before zooming):

- **`type`:** `"histogram"` (bars) · `"violin"` (symmetric KDE) · `"area"` (one-sided KDE sparkline).
- **`direction`** (alias `side`): `"out"` = away from the plot, orientation-aware (bottom↓ top↑
  left← right→); `"in"` = toward it. Histogram + area only (violin is symmetric). Histogram defaults
  `"out"`, area `"in"`.
- **`style`:** `"kde"` | `"bars"` (violins/areas default to smooth KDE via `fast-kde`).
- **KDE tunables:** `bandwidth`, `adjust`, `pad`; **`curve`** (a d3-shape curve factory or a name
  string: basis/natural/monotone/catmullRom/linear/step).
- **Appearance:** `bins`, `size`, `color`, `colorSelected`.
- **Two-tone by selection:** the in-range portion uses the accent color, the rest grey — bars are
  recolored per-bin; KDE shapes use a sliding clip rect.
- **Settings panel:** a ⚙ popover (`controls`, on by default) that live-tunes
  Shape/Curve/Smoothing/Pad/Bins/Height/Direction, **showing only the controls relevant to the
  chosen shape**. Optional **`persistKey`** remembers tuned params in `localStorage`; every change
  also fires a `scent` event.

### Pure helpers (`src/snap.js`, `src/geometry.js`)

- `snapRange([lo,hi],domain,step)` / `snapValue(v,domain,step)` — order, clamp to domain, snap to
  step; domain endpoints stay reachable when step doesn't divide the span. No d3/DOM deps.
- `axisGeometry(...)` — pure value→pixel mapping for the handles. No DOM deps.

## Packaging

- ESM source (`type: module`). `main`/`module` → `src/index.js` (core).
- **`exports`:** `.` → core (with a `umd` condition → the dist bundle), `./input` → the widget, plus
  `./package.json`. All targets are `./`-prefixed (avoids the `ERR_INVALID_PACKAGE_TARGET` trap).
- The **UMD bundle** (`dist/*.min.js`, `unpkg`/`jsdelivr`) is built from the **core** entry and
  expects a shared global `d3` (d3-* externalized and merged into `d3`). Core-only by design; the
  widget ships as ESM only.
- `reactive-widget-helper` is an **optional peer** — only `./input` imports it; the core entry never
  does. `d3-shape` + `fast-kde` are runtime deps used solely by the widget.
- `"sideEffects": false` is safe: styles inject at call time (`injectStyles()`), not at module load.

## Testing

- `node --test`: `test/snap.test.js` + `test/geometry.test.js` — **14 tests**, covering the pure
  helpers.
- The DOM/brush layers (`input.js`, `zoomableAxis.js`) need *trusted* events, so they are verified
  in a browser against the `examples/` pages rather than jsdom.

## Examples (`examples/`)

- **`demo.html`** — penguins scatterplot: live **zoom**, **dynamic-query filtering** (top+right
  axes), and a filter **synced to a 2D `d3-brush`** (the reactivewidgets pattern — axes ⇄ brush as
  two views of one selection). Uses CDN modules (esm.sh).
- **`test-local.html`** — offline smoke test (local `node_modules` + a small
  `reactive-widget-helper` stub) exercising both orientations + scent.

## Possible next steps

- TypeScript types (`.d.ts`) and richer `exports` conditions (`import`/`require`/`types`).
- Automated tests for the widget/brush layers (jsdom or Playwright in CI).
- Observable notebook / reactivewidgets.org entry.
- Adopt in a host app (e.g. replace overlay sliders where the chart already exposes its scales).

See [d3-api-style.md](./d3-api-style.md) for the reusable-component idiom, and
[history-direct-manipulation-rangesliders.md](./history-direct-manipulation-rangesliders.md) for the
Shneiderman/Plaisant dynamic-query lineage that motivates the live, tightly-coupled feedback.
