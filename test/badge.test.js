import { test } from "node:test";
import assert from "node:assert/strict";
import { badgeDirection, resolveStemLength } from "../src/geometry.js";

test("badgeDirection: \"out\" (default) points to the tick side", () => {
  assert.equal(badgeDirection("bottom"), 1); // down
  assert.equal(badgeDirection("top"), -1); // up
  assert.equal(badgeDirection("left"), -1); // left
  assert.equal(badgeDirection("right"), 1); // right
  for (const o of ["bottom", "top", "left", "right"]) {
    assert.equal(badgeDirection(o, "out"), badgeDirection(o));
  }
});

test("badgeDirection: \"in\" flips to the other side of the axis line", () => {
  for (const o of ["bottom", "top", "left", "right"]) {
    assert.equal(badgeDirection(o, "in"), -badgeDirection(o, "out"));
  }
});

test("badgeDirection: unknown badgeSide falls back to \"out\"", () => {
  assert.equal(badgeDirection("bottom", "inside"), 1);
  assert.equal(badgeDirection("top", undefined), -1);
});

test("resolveStemLength keeps valid lengths, defaults junk, clamps negatives", () => {
  assert.equal(resolveStemLength(6), 6);
  assert.equal(resolveStemLength(0), 0);
  assert.equal(resolveStemLength(undefined), 14);
  assert.equal(resolveStemLength(NaN), 14);
  assert.equal(resolveStemLength(Infinity), 14);
  assert.equal(resolveStemLength("6"), 14);
  assert.equal(resolveStemLength(-5), 0);
});
