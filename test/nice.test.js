import { test } from "node:test";
import assert from "node:assert/strict";
import { scaleLinear, scaleTime } from "d3-scale";
import { applyNice } from "../src/nice.js";

test("falsy nice leaves the domain untouched", () => {
  for (const off of [false, undefined, 0, null]) {
    const s = scaleLinear().domain([3, 97]);
    applyNice(s, off);
    assert.deepEqual(s.domain(), [3, 97], `nice=${off} should be a no-op`);
  }
});

test("nice:true rounds the domain outward to human-friendly bounds", () => {
  const s = scaleLinear().domain([3, 97]);
  const ret = applyNice(s, true);
  assert.equal(ret, s, "returns the same (mutated) scale");
  const [lo, hi] = s.domain();
  assert.ok(lo <= 3 && hi >= 97, "domain only extends outward, never inward");
  assert.deepEqual([lo, hi], [0, 100]); // d3 default (~10 steps) → step 10
});

test("nice:<count> passes the tick-count hint through to d3", () => {
  const s = scaleLinear().domain([0.2, 10.8]);
  applyNice(s, 2); // coarse rounding
  const [lo, hi] = s.domain();
  assert.ok(lo <= 0.2 && hi >= 10.8, "still only extends outward");
  assert.ok(hi - lo >= 10.6, "coarse count widens at least to the data span");
});

test("time scales nice to round dates", () => {
  const from = new Date("2026-03-05T14:00:00Z");
  const to = new Date("2026-03-09T09:00:00Z");
  const s = scaleTime().domain([from, to]);
  applyNice(s, true);
  const [lo, hi] = s.domain();
  assert.ok(+lo <= +from && +hi >= +to, "domain brackets the original data range");
});

test("scales without .nice() (ordinal/band) are returned untouched", () => {
  const fake = { domain: () => ["a", "b"] }; // no .nice method
  assert.equal(applyNice(fake, true), fake);
});
