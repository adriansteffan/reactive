/** Milliseconds since the page loaded, the clock that rows' times use. */
export function now() {
  return Math.round(performance.now());
}

/**
 * Half a frame at the measured refresh rate, which timed displays add to end on the frame nearest
 * their time; 0 without a plausible rate.
 */
export function halfFrameMs(refreshRate: number | undefined): number {
  return refreshRate !== undefined && refreshRate >= 20 && refreshRate <= 300 ? 500 / refreshRate : 0;
}
