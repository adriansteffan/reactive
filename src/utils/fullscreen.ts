export function isFullscreen(): boolean {
  const domFs = !!(
    document.fullscreenElement ||
    (document as any).webkitFullscreenElement ||
    (document as any).mozFullScreenElement ||
    (document as any).msFullscreenElement
  );
  if (!domFs) return false;
  // On macOS Chrome, `fullscreenElement` can stay set after ESC exit. When truly
  // in fullscreen, no browser chrome is visible, so outerHeight === innerHeight.
  return Math.abs(window.outerHeight - window.innerHeight) < 5;
}
