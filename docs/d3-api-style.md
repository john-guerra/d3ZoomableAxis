# d3 Reusable-Component API Idiom — Design Reference

> Research reference produced for `@john-guerra/d3-zoomable-axis`. Primary sources: source
> files from `d3-axis@3.0.0`, `d3-brush@3.0.0`, `d3-dispatch@3.0.1`, plus
> `johnwalley/d3-simple-slider@2.0.0`. Canonical idiom from Mike Bostock, "Towards Reusable
> Charts" (bost.ocks.org/mike/chart). Style targets: Mike Bostock / Philippe Rivière (Fil).

---

## 1. The core d3 component idiom ("reusable chart" / configurable factory)

A **factory function returns a closure** (the component function). The component is applied to a
selection via `selection.call(component)`. Configuration lives in closure-scoped variables exposed
through **chainable getter/setters**.

**The canonical getter/setter pattern** (verbatim shape, from `d3-axis/src/axis.js`):

```js
axis.scale = function(_) {
  return arguments.length ? (scale = _, axis) : scale;
};
```

- `comp.foo()` → `arguments.length` is 0 → returns the current value (getter).
- `comp.foo(x)` → sets the closure variable and returns the component for chaining (setter).
- The comma operator `(set, axis)` performs the assignment then yields `axis`.

Skeleton of a reusable component:

```js
export function myComponent() {
  // 1. private config with defaults (closure state)
  var width = 100, height = 100, scale = null;

  // 2. the component function: applied via selection.call(myComponent)
  function component(context) {
    var selection = context.selection ? context.selection() : context; // transition-aware
    selection.each(function(d) {
      // `this` is the container element; render with d3.select(this)...
    });
  }

  // 3. chainable getter/setters
  component.width = function(_) { return arguments.length ? (width = +_, component) : width; };
  component.height = function(_) { return arguments.length ? (height = +_, component) : height; };
  component.scale = function(_) { return arguments.length ? (scale = _, component) : scale; };

  // 4. return the configurable function
  return component;
}
```

Usage: `d3.select("g").call(myComponent().width(300).scale(x));`

Notes from real d3 source:
- d3-axis coerces numeric setters with `+_` (`tickPadding`, `offset`, `tickSize`) and array setters
  with `Array.from(_)` (`tickArguments`, `tickValues`).
- Array getters return a **defensive copy** (`.slice()`).
- The component is **transition-aware**: `context.selection ? context.selection() : context`.

---

## 2. d3-axis (`d3/d3-axis`, v3.0.0)

**Factory functions** (each takes a scale): `axisTop(scale)`, `axisRight(scale)`, `axisBottom(scale)`,
`axisLeft(scale)`. All delegate to `axis(orient, scale)`.

**Accessors** (verbatim from `src/axis.js`):

| Accessor | Behavior |
|---|---|
| `scale(scale)` | get/set the scale (linear, band, time, …). |
| `ticks(...args)` | sets `tickArguments` from `arguments` (e.g. `.ticks(10, "s")`). |
| `tickArguments([args])` | get (copy)/set args forwarded to `scale.ticks`/`scale.tickFormat`. |
| `tickValues([values])` | get (copy)/set explicit tick values; `null` to clear. |
| `tickFormat(fn)` | get/set custom format; `null` reverts to scale default. |
| `tickSize(n)` | sets both inner and outer to `+n`; getter returns inner. |
| `tickSizeInner(n)` / `tickSizeOuter(n)` | inner/outer tick length (default 6). |
| `tickPadding(n)` | space between tick and label (default 3). |
| `offset(n)` | crisp-edge px offset (default 0.5, or 0 when `devicePixelRatio > 1`). |

**Rendering** via `selection.call(axis)`:
- Tick values: `tickValues == null ? (scale.ticks ? scale.ticks.apply(scale, tickArguments) : scale.domain()) : tickValues`.
- Domain path spans the scale's **range** in pixel space: `range = scale.range()`, `range0 = +range[0] + offset`, `range1 = +range[range.length-1] + offset`.
- Per-tick position uses `scale.copy()` so live scale mutation doesn't corrupt rendering.
- Data-join: `selection.selectAll(".tick").data(values, scale).order()`, with `<g class="tick">` (a `<line>` + `<text>`) and one `<path class="domain">`. Stores `this.__axis = position` for enter transitions.
- Orientation: `k = (top||left) ? -1 : 1`; `x = (left||right) ? "x" : "y"`.

---

## 3. d3-brush (`d3/d3-brush`, v3.0.0)

**Factories:** `brush()` (XY), `brushX()`, `brushY()`. Also `brushSelection(node)`.

**Accessors** (verbatim from `src/brush.js`):

| Accessor | Behavior |
|---|---|
| `extent(_)` | brushable region `[[x0,y0],[x1,y1]]`; constant or `(d,i) => extent`. |
| `filter(fn)` | which raw events start a brush. |
| `touchable(fn)` | touch predicate. |
| `handleSize(n)` | handle hit area px (`+_`, default 6). |
| `keyModifiers(bool)` | ALT (center) / SPACE (lock) modifiers (default true). |
| `on(typenames[, listener])` | event listeners. |
| `move(group, selectionOrFn[, event])` | **imperative** set selection. |
| `clear(group[, event])` | `brush.move(group, null, event)`. |

**Events** via `.on("start brush end", handler)`; dispatch is `dispatch("start","brush","end")`. The
handler gets a `BrushEvent`:

```js
new BrushEvent(type, {
  sourceEvent, target: brush,
  selection,  // IN PIXELS (or null) — invert via scale
  mode,       // "drag" | "space" | "handle" | "center"
  dispatch
})
```

- `event.selection` is **pixels** — invert through the scale (`selection.map(scale.invert)`).
- `event.sourceEvent == null` for programmatic `brush.move` → use it to avoid feedback loops.
- Apply via `selection.call(brush)`; update via `gBrush.call(brush.move, [x0, x1])` (pixels).

**`.on` copy/forward pattern** (returns the component on set):

```js
brush.on = function() {
  var value = listeners.on.apply(listeners, arguments);
  return value === listeners ? brush : value;
};
```

---

## 4. d3-dispatch (`d3/d3-dispatch`, v3.0.1)

```js
import {dispatch} from "d3-dispatch";
const listeners = dispatch("start", "change", "end"); // no whitespace / "." in a type name
```

- **`.on(typename[, callback])`** — `type` with optional `.namespace` (`"change.foo"`); space-separated multiples allowed. With callback: registers (returns dispatch). Without: returns callback. `null` removes.
- **`.call(type, that, ...args)`** / **`.apply(type, that, argsArray)`** — invoke listeners synchronously with `this === that`.
- **`.copy()`** — per-type `slice()` copy.

Wiring in a component:

```js
function component(selection) { /* on interaction: */ listeners.call("change", this, value); }
component.on = function() {
  var value = listeners.on.apply(listeners, arguments);
  return value === listeners ? component : value;
};
```

---

## 5. d3-simple-slider (`johnwalley/d3-simple-slider`, v2.0.0) — closest precedent

A d3 slider that also draws an axis and supports a **2-handle range**.

**Factories:** `sliderHorizontal()`, `sliderVertical()`, `sliderTop()`, `sliderRight()`, `sliderBottom()`,
`sliderLeft()`. (`sliderHorizontal ≡ sliderBottom`; `sliderVertical ≡ sliderLeft`. Top/Bottom/Left/Right
choose the tick-label side, mirroring d3-axis.)

**Accessors:** `min`, `max`, `domain`, `width`, `height`, `tickFormat`, `displayFormat`, `ticks`,
`value`, `silentValue`, `default`, `step`, `tickValues`, `tickPadding`, `marks`, `handle`,
`displayValue`, `fill`, `on`.

- `default([a,b])` / `value([a,b])` → **range mode** (2-element array); handles sorted ascending.
- `silentValue(v)` sets **without** firing listeners (controlled state, no feedback loop).
- Events: `dispatch('onchange','start','end','drag')`.
- Applied via `selection.call(slider)` on a `<g>` you create/translate.

**Representative range usage (verbatim):**

```js
var slider = d3.sliderHorizontal()
  .min(0).max(10).step(1).width(300)
  .value([2, 8])
  .on('onchange', (val) => d3.select('#value').text(val));

d3.select('#slider').append('svg').attr('width', 500).attr('height', 100)
  .append('g').attr('transform', 'translate(30,30)').call(slider);
```

Runtime deps: `d3-array, d3-axis, d3-dispatch, d3-drag, d3-ease, d3-scale, d3-selection, d3-transition`.

---

## 6. Packaging conventions for d3 micro-libraries

Naming: **`d3-foo`**, one module per concern. Native ESM source (`"type":"module"`), built to UMD+ESM
via Rollup.

**`package.json` (verbatim shape from `d3-axis@3.0.0`):**

```jsonc
{
  "name": "d3-axis",
  "version": "3.0.0",
  "type": "module",
  "files": ["dist/**/*.js", "src/**/*.js"],
  "module": "src/index.js",
  "main": "src/index.js",
  "jsdelivr": "dist/d3-axis.min.js",
  "unpkg": "dist/d3-axis.min.js",
  "exports": { "umd": "./dist/d3-axis.min.js", "default": "./src/index.js" },
  "sideEffects": false
}
```

- `main` and `module` both → `src/index.js` (untranspiled ESM; consumer bundlers tree-shake).
- `unpkg`/`jsdelivr` → minified UMD for `<script>`.
- `"sideEffects": false`.

**CRITICAL — spec-compliant `exports`:** every target **must start with `"./"`** (or be `null`, or a
nested conditions object). Bare targets throw `ERR_INVALID_PACKAGE_TARGET` (the exact `time-widget@0.0.27`
failure). The d3 shorthand `{ "umd": "./…", "default": "./…" }` is valid because targets start with `./`.

**Build:** Rollup → `dist/d3-foo.js` (UMD) + `dist/d3-foo.min.js` (terser). **Sibling `d3-*` deps are
externalized** (not bundled) — UMD expects a global `d3`; the UMD wrapper merges exports into one
`window.d3`, so `d3.axisBottom`, `d3.brushX`, etc. coexist.

---

## Design takeaways (for d3-zoomable-axis)

1. Factory + closure + chainable getters/setters (`arguments.length ? (set, return component) : value`);
   coerce numbers `+_`, arrays `Array.from`, return defensive copies.
2. Render via `selection.call(component)` into a `<g>`; be transition-aware.
3. **Compose**: reuse `d3-axis` for ticks/domain, `d3-brush` for handles + pixel selection (then invert
   via the scale), `d3-dispatch` for events.
4. Emit `[lo,hi]` in **data space** (inverted + step-snapped). Provide a silent setter (no event) to
   avoid feedback loops; range = 2-element array.
5. Package as a `d3-*` micro-module: ESM source, UMD+ESM dist, externalized `d3-*` deps, `"sideEffects": false`,
   and an `exports` whose every target starts with `"./"`.
