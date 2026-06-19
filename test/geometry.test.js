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

test("band fits between the handles, inset by handleR (horizontal)", () => {
  const g = axisGeometry({ domain: [0, 100], range: [0, 300], value: [20, 60], handleR: 8 });
  assert.equal(g.loPx, 60);
  assert.equal(g.hiPx, 180);
  assert.deepEqual(g.band, { start: 68, length: 104 }); // 60+8 .. 180-8
});

test("vertical constrained to the TOP half places the band at the top", () => {
  // domain [0,100], vertical range [300,0]; value = top half [50,100]
  const g = axisGeometry({ domain: [0, 100], range: [300, 0], value: [50, 100], handleR: 8 });
  assert.equal(g.hiPx, 0);   // max -> top
  assert.equal(g.loPx, 150); // mid
  // band spans from the top handle down to the mid handle, inset both ends
  assert.deepEqual(g.band, { start: 8, length: 134 }); // min(0,150)+8 .. (150-0)-16
});

test("vertical constrained to the BOTTOM half places the band at the bottom", () => {
  const g = axisGeometry({ domain: [0, 100], range: [300, 0], value: [0, 50], handleR: 8 });
  assert.equal(g.loPx, 300); // min -> bottom
  assert.equal(g.hiPx, 150); // mid
  assert.deepEqual(g.band, { start: 158, length: 134 }); // min(150,300)+8 .. 150-16
});

test("zero-width selection clamps band length to >= 0", () => {
  const g = axisGeometry({ domain: [0, 100], range: [0, 300], value: [50, 50], handleR: 8 });
  assert.equal(g.band.length, 0);
});
