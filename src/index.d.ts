// Type definitions for @john-guerra/d3-zoomable-axis — core entry.
// The accessible reactive widget is typed in ./input.d.ts.

export type ZoomRange = [number, number];

/**
 * The core zoomable-axis component. Call it a d3 way — `selection.call(axis)` —
 * to render a d3 axis plus a dual-handle brush selecting a [lo, hi] sub-range.
 * All accessors follow the d3 getter/setter idiom: no argument reads, an
 * argument writes and returns the component (chainable).
 */
export interface ZoomableAxis {
  /** Render into a selection or transition (via selection.call). */
  (context: any): void;

  scale(): any;
  scale(scale: any): this;

  /** Current [lo, hi] in data space (getter returns a copy). */
  value(): ZoomRange;
  /** Set [lo, hi] silently (snapped to step; re-renders, no event). */
  value(value: ZoomRange): this;

  step(): number;
  step(step: number): this;

  handleSize(): number;
  handleSize(size: number): this;

  ticks(...args: any[]): this;

  tickArguments(): any[];
  tickArguments(args: any[] | null): this;

  tickValues(): number[] | null;
  tickValues(values: Iterable<number> | null): this;

  tickFormat(): ((d: number) => string) | null;
  tickFormat(format: ((d: number) => string) | null): this;

  tickSize(): number;
  tickSize(size: number): this;

  tickSizeInner(): number;
  tickSizeInner(size: number): this;

  tickSizeOuter(): number;
  tickSizeOuter(size: number): this;

  tickPadding(): number;
  tickPadding(padding: number): this;

  /** Set the range AND emit input+end (mirrors d3 brush.move). */
  move(context: any, range: ZoomRange): this;

  /** d3-dispatch style listener registration ("start" | "input" | "end"). */
  on(typenames: string): ((range: ZoomRange) => void) | undefined;
  on(typenames: string, listener: ((range: ZoomRange) => void) | null): this;
}

export function zoomableAxisTop(scale: any): ZoomableAxis;
export function zoomableAxisRight(scale: any): ZoomableAxis;
export function zoomableAxisBottom(scale: any): ZoomableAxis;
export function zoomableAxisLeft(scale: any): ZoomableAxis;

/** Order, clamp to domain, and snap a range to `step` (endpoints stay reachable). */
export function snapRange(range: ZoomRange, domain: number[], step: number): ZoomRange;
/** Clamp and snap a single value to `step` within `domain`. */
export function snapValue(v: number, domain: number[], step: number): number;
