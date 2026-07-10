import { test } from "node:test";
import assert from "node:assert/strict";
import { scaleLinear } from "d3-scale";
import {
  zoomableAxisBottom,
  zoomableAxisTop,
  zoomableAxisLeft,
  zoomableAxisRight,
  snapRange,
} from "../src/index.js";

// The core factory produces a d3-component function BEFORE any DOM is touched
// (rendering only happens on selection.call), so its config surface is
// unit-testable without jsdom.

test("core factories return a callable component", () => {
  const s = scaleLinear().domain([0, 100]).range([0, 300]);
  for (const f of [zoomableAxisBottom, zoomableAxisTop, zoomableAxisLeft, zoomableAxisRight]) {
    assert.equal(typeof f(s), "function");
  }
});

test("accessors are chainable getter/setters (d3 idiom)", () => {
  const a = zoomableAxisBottom(scaleLinear().domain([0, 100]).range([0, 300]));
  assert.equal(a.step(5), a); // setter returns the component
  assert.equal(a.step(), 5); // getter returns the value
  assert.equal(a.handleSize(12).handleSize(), 12);
  assert.equal(a.tickPadding(4).tickPadding(), 4);
  assert.equal(a.tickSizeInner(3).tickSizeInner(), 3);
  assert.equal(a.tickSizeOuter(2).tickSizeOuter(), 2);
  assert.equal(a.tickSize(7).tickSizeInner(), 7); // tickSize sets both inner+outer
  assert.deepEqual(a.ticks(5, "s").tickArguments(), [5, "s"]);
});

test("value defaults to the scale domain and stores a snapped copy", () => {
  const a = zoomableAxisBottom(scaleLinear().domain([0, 100]).range([0, 300])).step(10);
  assert.deepEqual(a.value(), [0, 100]); // defaults to domain
  a.value([13, 47]);
  assert.deepEqual(a.value(), snapRange([13, 47], [0, 100], 10)); // setter snaps to step
  const v = a.value();
  v[0] = -999;
  assert.notEqual(a.value()[0], -999); // getter returns a fresh copy
});

test("on() registers and reads back listeners, chainable when setting", () => {
  const a = zoomableAxisBottom(scaleLinear().domain([0, 100]));
  const fn = () => {};
  assert.equal(a.on("input", fn), a);
  assert.equal(a.on("input"), fn);
});

test("scale accessor round-trips", () => {
  const a = zoomableAxisBottom(scaleLinear().domain([0, 100]));
  const s2 = scaleLinear().domain([5, 9]);
  assert.equal(a.scale(s2), a);
  assert.equal(a.scale(), s2);
});
