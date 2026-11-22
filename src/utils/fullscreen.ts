export function isFullscreen(): boolean {
  const domFs = !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
  if (!domFs) return false;
  // On macOS Chrome, `fullscreenElement` can stay set after ESC exit. When truly
  // in fullscreen, no browser chrome is visible, so outerHeight === innerHeight.
  return Math.abs(window.outerHeight - window.innerHeight) < 5;
}

// Safari before 16.4 only has the prefixed API, which reports how a request went through events
function webkitRequest(start: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const settle = (event: Event) => {
      document.removeEventListener('webkitfullscreenchange', settle);
      document.removeEventListener('webkitfullscreenerror', settle);
      if (event.type === 'webkitfullscreenerror') reject(new Error('The browser refused the fullscreen request.'));
      else resolve();
    };
    document.addEventListener('webkitfullscreenchange', settle);
    document.addEventListener('webkitfullscreenerror', settle);
    start();
  });
}

/** Asks the browser to show the page in fullscreen; rejects if it refuses or cannot. */
export function enterFullscreen(): Promise<void> {
  const element = document.documentElement as any;
  if (element.requestFullscreen) return element.requestFullscreen();
  if (element.webkitRequestFullscreen) return webkitRequest(() => element.webkitRequestFullscreen());
  return Promise.reject(new Error('This browser has no fullscreen mode.'));
}

/** Asks the browser to leave fullscreen; rejects if it refuses or cannot. */
export function exitFullscreen(): Promise<void> {
  const doc = document as any;
  if (doc.exitFullscreen) return doc.exitFullscreen();
  if (doc.webkitExitFullscreen) return webkitRequest(() => doc.webkitExitFullscreen());
  return Promise.reject(new Error('This browser has no fullscreen mode.'));
}
