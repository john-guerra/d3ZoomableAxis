import { test } from "node:test";
import assert from "node:assert/strict";
import { snapRange, snapValue } from "../src/snap.js";

test("orders reversed endpoints", () => {
  assert.deepEqual(snapRange([40, 10], [0, 100], 1), [10, 40]);
});

test("clamps to the domain", () => {
  assert.deepEqual(snapRange([-5, 200], [0, 100], 1), [0, 100]);
});

test("snaps to the step", () => {
  assert.deepEqual(snapRange([12, 37], [0, 100], 5), [10, 35]);
});

test("keeps an in-range, on-step value unchanged", () => {
  assert.deepEqual(snapRange([20, 60], [0, 100], 10), [20, 60]);
});

test("domain endpoints stay reachable when step does not divide the span", () => {
  assert.deepEqual(snapRange([0, 99307], [0, 99307], 100), [0, 99307]);
});

test("step 0 means continuous (no snapping)", () => {
  assert.deepEqual(snapRange([12.5, 37.5], [0, 100], 0), [12.5, 37.5]);
});

test("snapValue clamps and snaps a single value", () => {
  assert.equal(snapValue(7, [0, 100], 5), 5);
  assert.equal(snapValue(-1, [0, 100], 5), 0);
  assert.equal(snapValue(1000, [0, 100], 5), 100);
});

test("Date-object domain works (time scales) — returns finite numbers, never NaN", () => {
  const lo = new Date("2020-06-15").getTime();
  const hi = new Date("2022-03-01").getTime();
  const dom = [new Date("2013-08-19"), new Date("2025-12-13")]; // as d3 scaleTime.domain() returns
  const r = snapRange([lo, hi], dom, 1);
  assert.ok(Number.isFinite(r[0]) && Number.isFinite(r[1]), `got ${r}`);
  assert.deepEqual(r, [lo, hi]); // in-range, step 1 → unchanged
  // A Date passed as the value coerces too (no NaN, no string concatenation).
  assert.equal(snapValue(new Date("2021-01-01"), dom, 0), Date.parse("2021-01-01"));
});
