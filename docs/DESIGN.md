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

**Accessibility is a first-class requirement** (not a retrofit): full keyboard control, screen-reader
support, and **standard HTML form inputs** under the hood. This is the decisive reason the interaction
layer is built from native `<input type="range">` elements rather than an SVG `d3-brush` (which is not
focusable, keyboard-operable, or announced). See the Accessibility section.

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
├── d3-axis     → ticks + labels + domain line for `scale`  (decorative; aria-hidden)
├── 2× <input type="range">  → the accessible dual handles (lo + hi), overlaid on the axis
│       • native role=slider, focusable, keyboard, screen-reader announced
│       • shared min/max/step from scale.domain()/step; clamp lo ≤ hi on input
│       • aria-label per thumb + aria-valuetext (formatted value + units)
├── d3-scale    → map data <-> pixels for positioning the inputs over the axis
├── snap.js     → order / clamp / step-snap (mirrors native step)
└── d3-dispatch → start / input / end  (+ .on copy/forward)
```

The native inputs are the **source of truth and the a11y surface**; the d3 axis is the visual
ticks/labels layer behind them. (Earlier scaffolding used `d3-brush`; replaced for accessibility.)

See [d3-api-style.md](./d3-api-style.md) for the idiom, and
[history-direct-manipulation-rangesliders.md](./history-direct-manipulation-rangesliders.md) for the
Shneiderman/Plaisant dynamic-query lineage that motivates the live, tightly-coupled feedback.

## Accessibility (first-class)

Built on **two native `<input type="range">`** (a "lo" and a "hi" thumb) so the control is
accessible by construction:

- **Keyboard** (free from native inputs, plus our additions): `Tab` focuses each thumb;
  `←/↓` and `→/↑` nudge by `step`; `PageUp`/`PageDown` by a larger step; `Home`/`End` jump to that
  thumb's allowed bound. Each thumb is clamped so `lo ≤ hi`.
- **Screen readers:** each input is announced as a slider with an accessible **name**
  (`aria-label`, e.g. "Minimum Semanas" / "Maximum Semanas"), `min`/`max`/`now` (native), and a
  human-readable **`aria-valuetext`** (e.g. "30 weeks" / "1,500 g"). The pair is wrapped in a
  labelled `role="group"` (e.g. "Semanas range").
- **Standard HTML inputs:** real form controls — they participate in forms, inherit OS slider
  styling/high-contrast, respect `prefers-reduced-motion`, and need no custom ARIA-slider
  reimplementation.
- **Pointer:** the two range inputs are overlaid on the same track; `pointer-events` is toggled so
  the thumb nearer the cursor is the grabbable one (the standard accessible dual-range technique).
  Thumbs are styled to read as handles on the axis; the track is transparent so the axis line and
  ticks show through.
- **Visible focus** ring on the focused thumb; hit targets ≥ 24px (touch/WCAG target size).
- **Vertical orientation:** native vertical range via CSS `writing-mode: vertical-lr` (modern
  Chromium/Firefox/Safari); horizontal is the primary, fully-supported path. (Noted caveat below.)

Maps directly onto the direct-manipulation best practices in
[history-direct-manipulation-rangesliders.md](./history-direct-manipulation-rangesliders.md):
immediate feedback, reversibility, visible state, tight coupling — now also operable without a mouse.

**Tradeoff vs the old brush approach:** native inputs don't natively support dragging the *range
body* to pan (DM "Principle 3"). Options: (a) v1 = move both bounds via keyboard / two drags;
(b) add an optional pointer-only drag-to-pan region (mouse enhancement, not required for a11y).
Recommend (a) now, (b) later.

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

## Status (2026-06-19) — good version reached, NOT published

All handoff tasks complete and committed. 13/13 tests passing.

### What's implemented

- Native `<input type="range">` dual-handle accessible axis (keyboard / screen-reader / ARIA)
- Both orientations (horizontal + vertical via `rotate(-90)`)
- Drag-to-pan on the selection band (verified in browser)
- **D-shape SVG handles**: flat edge = value-marker line; bump faces outward
  - Bottom axis: left bump (lo) / right bump (hi)
  - Left axis: down bump (lo) / up bump (hi)
  - Separate `za-handles-svg` layer (z-index 3) so handles are never occluded by scent
  - `focus-within` z-order so active axis stays on top of siblings
- **Value badges** outside the chart (below tick labels for bottom axis, left for left axis)
  - 24px offset from axis clears standard d3 tick+label zone
  - x/y clamped so badge never overflows component bounds at domain extremes
- **Scented widget** (`scent: { values, type, bins }`):
  - `type: "histogram"` — color-coded bars (grey = out of selection, accent = in-selection)
  - `type: "violin"` — smooth KDE via `fast-kde`; two-tone clip coloring
  - `scent.style: "kde" | "bars"` selects violin rendering style
  - Thin selection band + faint hit-zone when scent is shown
- **Demo** (`examples/demo.html`): penguins scatterplot with flush-aligned scented axes,
  plus "without scent" and "plain range sliders" baseline variants

### Remaining open decisions

1. Package name `@john-guerra/d3-zoomable-axis` — OK?
2. Live-drag event: `input` (chosen, DOM/reactive cohesion) vs `change`
3. ~~d3-brush vs hand-rolled~~ → **resolved: native `<input type="range">`**
4. Ship a minimal default stylesheet, or leave unstyled with documented classes?
5. Drag-to-pan discoverability: add a hover state on the band? (currently: thin visible line
   shows selection; faint translucent rect is the drag hit zone)
6. Vertical orientation caveats (native vertical range has browser-specific quirks) — document?

### Not yet done (v1+ or never)

- `npm pack` / `npm publish` (intentionally deferred)
- Observable notebook demo
- Adopt in Explorador Canguro
