import React, { useState, useCallback, useRef, useEffect } from 'react';
import { BaseComponentProps, getPlatform, isFullscreen } from '../utils/common';
import { registerSimulation, noopSimulate } from '../utils/simulation';
import { registerFlattener } from '../utils/upload';
import { registerOverlay, OverlayProps } from '../utils/overlays';
import Text from '../components/text';
import { StatusBar } from '@capacitor/status-bar';
import { ImmersiveMode } from '@adriansteffan/immersive-mode';
import { Capacitor } from '@capacitor/core';
import { useTheme, t } from '../utils/theme';

registerFlattener('EnterFullscreen', 'session');
registerSimulation('EnterFullscreen', noopSimulate, {});

function FullscreenGuard({ store }: OverlayProps) {
  const [fs, setFs] = useState(isFullscreen());
  const cfg = store?._fullscreenGuard as FullscreenGuardConfig | undefined;
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

interface FullscreenGuardConfig {
  mode?: 'button' | 'overlay';
  buttonText?: string;
  content?: React.ReactNode;
}

registerOverlay(FullscreenGuard);

export default function EnterFullscreen({
  content,
  buttonText,
  className,
  containerClass,
  centered,
  animate,
  next,
  data,
  updateStore,
  delayMs = 0,
  keepFullscreen = false,
}: {
  prolificCode?: string;
  content?: React.ReactNode;
  buttonText?: string;
  className?: string;
  containerClass?: string;
  centered?: boolean;
  animate?: boolean;
  delayMs?: number;
  /** Show a prompt to re-enter fullscreen on every subsequent trial until ExitFullscreen runs.
   *  `true` renders a small top-left button with default text.
   *  Pass a config to customize the button text, or switch to a full-screen overlay with custom content. */
  keepFullscreen?: boolean | FullscreenGuardConfig;
} & BaseComponentProps) {
  const contentWrap = (
    <div className='flex flex-col items-center'>
      {!!content && content}
      {!content && <p className=''>Please click the Button below to enter Fullscreen mode.</p>}
    </div>
  );

  const [isWaiting, setIsWaiting] = useState(false);
  const listenerFallbackActive = useRef(false);
  const timeoutId = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPendingTimeout = useCallback(() => {
      if (timeoutId.current) {
          clearTimeout(timeoutId.current);
          timeoutId.current = null;
      }
  }, []);

  const removeListenersAndTimeout = useCallback(() => {
    document.removeEventListener('fullscreenchange', handleFullscreenChangeForFallback);
    document.removeEventListener('webkitfullscreenchange', handleFullscreenChangeForFallback);
    document.removeEventListener('mozfullscreenchange', handleFullscreenChangeForFallback);
    document.removeEventListener('MSFullscreenChange', handleFullscreenChangeForFallback);
    cancelPendingTimeout();
    listenerFallbackActive.current = false;
  }, [cancelPendingTimeout]);

  const proceedWithDelay = useCallback(() => {
    cancelPendingTimeout();
    setIsWaiting(true);
    if (keepFullscreen) {
      updateStore({ _fullscreenGuard: keepFullscreen === true ? {} : keepFullscreen });
    }
    timeoutId.current = setTimeout(() => {
        timeoutId.current = null;

        next({});
    }, delayMs);
  }, [next, delayMs, cancelPendingTimeout, keepFullscreen, updateStore]);

  const handleFullscreenChangeForFallback = useCallback(() => {
    if (!listenerFallbackActive.current) return;
    const currentlyFullscreen = isFullscreen();
    removeListenersAndTimeout();
    if (currentlyFullscreen) {
        proceedWithDelay();
    } else {
        setIsWaiting(false);
    }
  }, [proceedWithDelay, removeListenersAndTimeout]);

  const addListenersForFallback = useCallback(() => {
    removeListenersAndTimeout();
    listenerFallbackActive.current = true;
    document.addEventListener('fullscreenchange', handleFullscreenChangeForFallback);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChangeForFallback);
    document.addEventListener('mozfullscreenchange', handleFullscreenChangeForFallback);
    document.addEventListener('MSFullscreenChange', handleFullscreenChangeForFallback);
  }, [handleFullscreenChangeForFallback, removeListenersAndTimeout]);

  const handleEnterFullscreenClick = useCallback(async () => {
    setIsWaiting(true);
    removeListenersAndTimeout();

    const element = document.documentElement;

    if (getPlatform() === 'mobile' && Capacitor.getPlatform() === 'android') {
      StatusBar.hide();
      ImmersiveMode.enable();
    }

    if (element.requestFullscreen) {
      try {
        await element.requestFullscreen();
        proceedWithDelay();
        return;
      } catch (err) {
        console.error("Fullscreen request failed:", err);
        return;
      }
    }

    if ((element as any).mozRequestFullScreen) {
      (element as any).mozRequestFullScreen();
      addListenersForFallback();
    } else if ((element as any).webkitRequestFullscreen) {
      (element as any).webkitRequestFullscreen();
      addListenersForFallback();
    } else if ((element as any).msRequestFullscreen) {
      (element as any).msRequestFullscreen();
      addListenersForFallback();
    } else {
      console.warn('Fullscreen API is not supported by this browser.');
    }
  }, [proceedWithDelay, addListenersForFallback, removeListenersAndTimeout]);

  useEffect(() => {
    return () => {
      removeListenersAndTimeout();
    };
  }, [removeListenersAndTimeout]);

 
  const th = t(useTheme());

  if (isWaiting) {
    return <div className={`min-h-screen ${containerClass ?? th.containerBg}`} />;
  }

  return (
    <Text
      data={data}
      updateStore={updateStore}
      className={className}
      containerClass={containerClass}
      centered={centered}
      animate={animate}
      content={contentWrap}
      buttonText={buttonText ?? 'Enter Fullscreen Mode'}
      next={handleEnterFullscreenClick}
    />
  );
}