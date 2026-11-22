import { isFullscreen } from './fullscreen';

/** Pixels, a share of the screen (`'80%'`), or a ratio to the other side (`'16:9'`). */
export type CanvasSize = number | `${number}%` | `${number}:${number}`;

/** Draws on a canvas whose size, in CSS pixels, is `width` by `height`. */
export type Draw = (ctx: CanvasRenderingContext2D, width: number, height: number) => void;

/**
 * The canvas's size in CSS pixels on a screen of the given size. A number is pixels, and a percentage
 * is a share of the screen. A ratio such as `'16:9'` is width to height: it sets one side from the
 * other, or without the other, makes the largest canvas of that shape that fits the screen. Without
 * any, the canvas is the largest square that fits.
 */
export function canvasSize(
  width: CanvasSize | undefined,
  height: CanvasSize | undefined,
  screenWidth: number,
  screenHeight: number,
) {
  const pixels = (size: CanvasSize | undefined, screen: number) =>
    typeof size === 'number' ? size : size?.endsWith('%') ? (screen * Number.parseFloat(size)) / 100 : undefined;
  const ratio = (size: CanvasSize | undefined) => {
    if (typeof size !== 'string' || !size.includes(':')) return undefined;
    const [w, h] = size.split(':').map(Number);
    return w / h;
  };
  let w = pixels(width, screenWidth);
  let h = pixels(height, screenHeight);
  const shape = ratio(width) ?? ratio(height);
  if (shape === undefined) {
    w ??= h ?? Math.min(screenWidth, screenHeight);
    h ??= w;
  } else if (w !== undefined) {
    h = w / shape;
  } else if (h !== undefined) {
    w = h * shape;
  } else {
    w = Math.min(screenWidth, screenHeight * shape);
    h = w / shape;
  }
  return { width: Math.round(w), height: Math.round(h) };
}

/**
 * Sizes the canvas for the screen, or the whole display in fullscreen, at the display's pixel
 * density, so that drawing uses CSS pixels. Undefined where the browser has no 2D canvas.
 */
export function prepareCanvas(canvas: HTMLCanvasElement, width: CanvasSize | undefined, height: CanvasSize | undefined) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  const fullscreen = isFullscreen();
  const size = canvasSize(
    width,
    height,
    fullscreen ? window.screen.width : window.innerWidth,
    fullscreen ? window.screen.height : window.innerHeight,
  );
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(size.width * dpr);
  canvas.height = Math.round(size.height * dpr);
  canvas.style.width = `${size.width}px`;
  canvas.style.height = `${size.height}px`;
  ctx.scale(dpr, dpr);
  return { ctx, size };
}
