// Pure helpers for turning a raw [lo, hi] range into a valid one: order the
// endpoints, clamp to the domain, and snap each to the nearest `step` measured
// from the domain minimum. Domain endpoints stay reachable even when `step`
// does not divide the span (inputs at/under dMin -> dMin, at/over dMax -> dMax).
// No d3 / DOM dependencies, so this is unit-testable in isolation.

export function snapValue(v, domain, step = 1) {
  const [dMin, dMax] = domain;
  if (v <= dMin) return dMin;
  if (v >= dMax) return dMax;
  if (!step) return v;
  const snapped = dMin + Math.round((v - dMin) / step) * step;
  return Math.max(dMin, Math.min(dMax, snapped));
}

export function snapRange([lo, hi], domain, step = 1) {
  let a = snapValue(lo, domain, step);
  let b = snapValue(hi, domain, step);
  if (a > b) [a, b] = [b, a];
  return [a, b];
}
