/** Milliseconds since the page loaded, the clock that rows' times use. */
export function now() {
  return Math.round(performance.now());
}
