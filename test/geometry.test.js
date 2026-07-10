import { test } from "node:test";
import assert from "node:assert/strict";
import { valueToPx, axisGeometry } from "../src/geometry.js";

test("valueToPx maps domain to range (horizontal)", () => {
  assert.equal(valueToPx(0, [0, 100], [0, 300]), 0);
  assert.equal(valueToPx(50, [0, 100], [0, 300]), 150);
  assert.equal(valueToPx(100, [0, 100], [0, 300]), 300);
});

test("valueToPx maps domain to inverted range (vertical: max at top=0)", () => {
  assert.equal(valueToPx(0, [0, 100], [300, 0]), 300); // min -> bottom
  assert.equal(valueToPx(100, [0, 100], [300, 0]), 0); // max -> top
  assert.equal(valueToPx(50, [0, 100], [300, 0]), 150); // mid
});

test("valueToPx returns r0 for a degenerate domain", () => {
  assert.equal(valueToPx(5, [7, 7], [0, 300]), 0);
});

test("axisGeometry returns handle pixels (horizontal)", () => {
  const g = axisGeometry({ domain: [0, 100], range: [0, 300], value: [20, 60] });
  assert.equal(g.loPx, 60);
  assert.equal(g.hiPx, 180);
});

test("axisGeometry, vertical range: max maps to the top (0)", () => {
  const g = axisGeometry({ domain: [0, 100], range: [300, 0], value: [50, 100] });
  assert.equal(g.hiPx, 0);   // max -> top
  assert.equal(g.loPx, 150); // mid
});

test("axisGeometry, vertical range: min maps to the bottom (length)", () => {
  const g = axisGeometry({ domain: [0, 100], range: [300, 0], value: [0, 50] });
  assert.equal(g.loPx, 300); // min -> bottom
  assert.equal(g.hiPx, 150); // mid
});
