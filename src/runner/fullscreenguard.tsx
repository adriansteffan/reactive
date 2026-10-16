import type React from 'react';
import { useEffect, useState } from 'react';
import type { Store } from '../core/store';
import { isFullscreen } from '../utils/fullscreen';

/** Asks the participant back into fullscreen while EnterFullscreen's keepFullscreen is on. */
export function FullscreenGuard({ store }: { store: Store }) {
  const [fs, setFs] = useState(isFullscreen());
  const cfg = store?.__fullscreenGuard as FullscreenGuardConfig | undefined;
  const active = !!cfg;

  useEffect(() => {
    if (!active) return;
    setFs(isFullscreen());
    let interval: ReturnType<typeof setInterval> | null = null;
    const timeout = setTimeout(() => {
      interval = setInterval(() => setFs(isFullscreen()), 3000);
    }, 5000);
    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, [active]);
  if (!cfg || fs) return null;

  const reenter = async () => {
    const el = document.documentElement as any;
    try {
      // Clear stale DOM fullscreen state first — on macOS Chrome after ESC,
      // fullscreenElement may still be set even though the window is windowed,
      // causing requestFullscreen to silently no-op.
      if (document.fullscreenElement) {
        await document.exitFullscreen().catch(() => {});
      }
      if (el.requestFullscreen) await el.requestFullscreen();
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
      else if (el.mozRequestFullScreen) await el.mozRequestFullScreen();
      else if (el.msRequestFullscreen) await el.msRequestFullscreen();
    } catch (err) {
      console.error('[FullscreenGuard] requestFullscreen failed:', err);
    }
  };
  const buttonText = cfg.buttonText ?? 'Return to Fullscreen';
  const btnClass = 'px-6 py-3 bg-white text-black text-sm font-bold border-2 border-black rounded-xl shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none cursor-pointer';

  if (cfg.mode === 'overlay') {
    return (
      <div className='fixed inset-0 z-50 bg-white flex flex-col items-center justify-center gap-6 p-8 text-center'>
        {cfg.content ?? (
          <>
            <h1 className='text-3xl font-bold'>Please return to fullscreen</h1>
            <p>This experiment requires fullscreen mode. Click the button below to continue.</p>
          </>
        )}
        <button onClick={reenter} className={btnClass}>{buttonText}</button>
      </div>
    );
  }
  return (
    <button onClick={reenter} className={`fixed top-6 left-6 z-50 ${btnClass}`}>
      {buttonText}
    </button>
  );
}

export interface FullscreenGuardConfig {
  mode?: 'button' | 'overlay';
  buttonText?: string;
  content?: React.ReactNode;
}
