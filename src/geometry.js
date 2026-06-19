// Pure geometry for the zoomable axis. Maps a [lo, hi] value to along-axis pixel
// positions for the handles and the selection band — identically for both
// orientations (the range direction encodes left/right vs bottom/top), so the
// renderer never special-cases orientation for positioning. No DOM: unit-testable.

export function valueToPx(v, domain, range) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  if (d1 === d0) return r0;
  return r0 + ((r1 - r0) * (v - d0)) / (d1 - d0);
}

// range convention:
//   horizontal → [0, length]      (min → left,   max → right)
//   vertical   → [length, 0]      (min → bottom, max → top)
// Returns along-axis pixels for each handle and the band that fits BETWEEN them
// (inset by the handle radius).
export function axisGeometry({ domain, range, value, handleR = 8 }) {
  const loPx = valueToPx(value[0], domain, range);
  const hiPx = valueToPx(value[1], domain, range);
  const a = Math.min(loPx, hiPx);
  const b = Math.max(loPx, hiPx);
  return {
    loPx,
    hiPx,
    band: { start: a + handleR, length: Math.max(0, b - a - 2 * handleR) },
  };
}
