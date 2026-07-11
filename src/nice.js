// Pure helper: optionally round a continuous scale's domain OUTWARD to
// human-friendly bounds via d3's `scale.nice`, so the first/last axis tick —
// and, in the input widget, the scented-KDE clip bounds — land on round values
// instead of an arbitrary data min/max.
//
// It EXTENDS the domain (adds a little empty padding at each end), so it is
// opt-in: callers who want the data flush to the edges leave it off. No d3 /
// DOM dependency, so this stays unit-testable in isolation (mirrors snap.js).
//
//   nice: false | undefined  -> unchanged
//         true               -> scale.nice()          (d3 default, ~10 steps)
//         number n           -> scale.nice(n)          (round to an ~n-step grid)
//         d3 time interval    -> scale.nice(interval)   (time scales)
//
// Scales without a `.nice` method (ordinal/band/point) are returned untouched.
// Mutates and returns the same scale (d3's nice() mutates in place).
export function applyNice(scale, nice) {
  if (!nice || typeof scale.nice !== "function") return scale;
  return nice === true ? scale.nice() : scale.nice(nice);
}
