// Pure geometry for the zoomable axis. Maps a [lo, hi] value to along-axis pixel
// positions for the handles — identically for both orientations (the range
// direction encodes left/right vs bottom/top), so the renderer never
// special-cases orientation for positioning. No DOM: unit-testable.

export function valueToPx(v, domain, range) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  if (d1 === d0) return r0;
  return r0 + ((r1 - r0) * (v - d0)) / (d1 - d0);
}

// range convention:
//   horizontal → [0, length]      (min → left,   max → right)
//   vertical   → [length, 0]      (min → bottom, max → top)
// Returns the along-axis pixel position of each handle.
export function axisGeometry({ domain, range, value }) {
  return {
    loPx: valueToPx(value[0], domain, range),
    hiPx: valueToPx(value[1], domain, range),
  };
}

// Cross-axis direction (+1 = down/right in screen coords, −1 = up/left) in which
// the handles' stems and the value badges point. badgeSide "out" (the default)
// is the tick side — bottom↓ top↑ left← right→; "in" is the opposite side.
// Anything other than "in" is treated as "out".
export function badgeDirection(orient, badgeSide = "out") {
  const tickSide = orient === "bottom" || orient === "right" ? 1 : -1;
  return badgeSide === "in" ? -tickSide : tickSide;
}

// Stem length in px: non-numbers / NaN / ±Infinity fall back to the default,
// negatives clamp to 0 (a negative length would flip the stem but not the badge
// anchor — use badgeSide to change sides instead).
export function resolveStemLength(stemLength, fallback = 14) {
  const n = typeof stemLength === "number" ? stemLength : Number.NaN;
  return Number.isFinite(n) ? Math.max(0, n) : fallback;
}
