import type React from 'react';
import { createContext, useContext, useEffect, useState } from 'react';
import { getNative } from '../core/platform';
import { enterFullscreen, exitFullscreen, isFullscreen } from '../utils/fullscreen';
import { hoverArea } from './theme';

const SetGuardContext = createContext<(config: FullscreenGuardConfig | null) => void>(() => {});

/** Turns the fullscreen guard on with a config, or off with `null`. Unlike a store change, it takes effect at once. */
export const useSetFullscreenGuard = () => useContext(SetGuardContext);

/**
 * Asks the participant back into fullscreen while a fullscreenBlock with keepFullscreen runs, and
 * leaves fullscreen once the run is outside every fullscreenBlock, whether it ended or a jump left it.
 */
export function FullscreenGuard({ within, children }: { within: boolean; children: React.ReactNode }) {
  const [cfg, setCfg] = useState<FullscreenGuardConfig | null>(null);
  const [fs, setFs] = useState(isFullscreen());
  const active = !!cfg;

  useEffect(() => {
    if (!within) return;
    return () => {
      setCfg(null);
      getNative()?.exitFullscreen();
      if (isFullscreen()) exitFullscreen().catch((err) => console.error('Leaving fullscreen failed:', err));
    };
  }, [within]);

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

  return (
    <SetGuardContext.Provider value={setCfg}>
      {children}
      {cfg && !fs && <GuardPrompt cfg={cfg} />}
    </SetGuardContext.Provider>
  );
}

function GuardPrompt({ cfg }: { cfg: FullscreenGuardConfig }) {
  const reenter = async () => {
    try {
      // Clear stale DOM fullscreen state first — on macOS Chrome after ESC,
      // fullscreenElement may still be set even though the window is windowed,
      // causing requestFullscreen to silently no-op.
      if (document.fullscreenElement) {
        await exitFullscreen().catch(() => {});
      }
      await enterFullscreen();
    } catch (err) {
      console.error('[FullscreenGuard] requestFullscreen failed:', err);
    }
  };
  const buttonText = cfg.buttonText ?? 'Return to Fullscreen';
  const btnClass = `px-6 py-3 bg-white text-black text-sm font-bold border-2 border-black rounded-xl shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none ${hoverArea} cursor-pointer`;

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

/**
 * How a fullscreen block asks the participant back into fullscreen: with a small button in the
 * top-left corner (the default), or with a screen over the trial that shows `content` above the button.
 */
export type FullscreenGuardConfig =
  | { mode?: 'button'; buttonText?: string; content?: never }
  | { mode: 'overlay'; buttonText?: string; content?: React.ReactNode };
