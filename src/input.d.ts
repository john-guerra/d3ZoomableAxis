// Type definitions for @john-guerra/d3-zoomable-axis/input — the accessible
// reactive-widget layer (native <input type=range> handles + scented overlay).

import type { ZoomRange } from "./index.js";

export type ScentType = "histogram" | "violin" | "area";
export type ScentDirection = "out" | "in";
export type ScentStyle = "kde" | "bars";

export interface ScentOptions {
  /** The raw sample the distribution is drawn from. */
  values: number[];
  /** "histogram" (bars), "violin" (symmetric KDE), or "area" (one-sided KDE). */
  type?: ScentType;
  /** Histogram bin count / KDE grid resolution. */
  bins?: number;
  /** Cross-axis extent of the drawing, in px. */
  size?: number;
  /** "out" = away from the plot (orientation-aware); "in" = toward it. Histogram + area only. */
  direction?: ScentDirection;
  /** Back-compat alias for `direction`. */
  side?: ScentDirection;
  /** "kde" (smooth, default for violin/area) or "bars". */
  style?: ScentStyle;
  color?: string;
  colorSelected?: string;
  /** fast-kde tunables. */
  bandwidth?: number;
  adjust?: number;
  pad?: number;
  /** A d3-shape curve factory, or a name: basis|natural|monotone|catmullRom|linear|step. */
  curve?: string | ((...args: any[]) => any);
  /** Show the ⚙ settings popover (default true). */
  controls?: boolean;
  /** localStorage key to persist the tuned params across sessions. */
  persistKey?: string;
}

export interface ZoomableAxisInputOptions {
  orient?: "bottom" | "top" | "left" | "right";
  /** Initial [lo, hi] (defaults to the full domain). */
  value?: ZoomRange;
  step?: number;
  /** Along-axis length in px. */
  length?: number;
  /** Cross-axis thickness in px. */
  thickness?: number;
  margin?: number;
  label?: string;
  units?: string;
  /** Format a value for the badge and aria-valuetext. */
  format?: (v: number) => string;
  /** Type of the double-click inline editor. */
  inputType?: "number" | "date" | "time" | "datetime-local";
  ticks?: number | any[];
  /**
   * Round the domain outward to human-friendly bounds (d3 `scale.nice`) so the
   * end ticks and KDE clip bounds land on round values. Opt-in (adds edge
   * padding): `true` (d3 default), a step count, or a d3 time interval.
   */
  nice?: boolean | number | any;
  scent?: ScentOptions;
}

/** The returned reactive-widget element: a DOM element with `.value` that dispatches "input". */
export interface ZoomableAxisInputElement extends HTMLElement {
  value: ZoomRange;
  setValue(value: ZoomRange): void;
  /** d3-dispatch style listeners: "start" | "input" | "end" | "scent". */
  on(typenames: string, listener?: ((...args: any[]) => void) | null): any;
}

/**
 * Build an accessible zoomable-axis input. Pass a d3 scale or a [min, max] domain.
 * Requires the optional peer `reactive-widget-helper`.
 */
export function zoomableAxisInput(
  scaleOrDomain: number[] | any,
  options?: ZoomableAxisInputOptions
): ZoomableAxisInputElement;
