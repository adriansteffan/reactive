import React, { useState, useCallback, useRef, useEffect } from 'react';
import { type BaseComponentProps, defineComponent } from '../core/component';
import { getNative } from '../core/platform';
import { noopSimulate } from '../core/simulation';
import type { FullscreenGuardConfig } from '../runner/fullscreenguard';
import { useTheme, t } from '../runner/theme';
import { isFullscreen } from '../utils/fullscreen';
import Text from './text';

function EnterFullscreen({
  content,
  buttonText,
  className,
  containerClass,
  centered,
  animate,
  next,
  data,
  store,
  updateStore,
  delayMs = 0,
  keepFullscreen = false,
}: {
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
  // The listener that was actually registered, since the handler is recreated when its dependencies change
  const fallbackListener = useRef<(() => void) | null>(null);
  const timeoutId = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPendingTimeout = useCallback(() => {
      if (timeoutId.current) {
          clearTimeout(timeoutId.current);
          timeoutId.current = null;
      }
  }, []);

  const removeListenersAndTimeout = useCallback(() => {
    const listener = fallbackListener.current;
    if (listener) {
      document.removeEventListener('fullscreenchange', listener);
      document.removeEventListener('webkitfullscreenchange', listener);
      document.removeEventListener('mozfullscreenchange', listener);
      document.removeEventListener('MSFullscreenChange', listener);
      fallbackListener.current = null;
    }
    cancelPendingTimeout();
  }, [cancelPendingTimeout]);

  const proceedWithDelay = useCallback(() => {
    cancelPendingTimeout();
    setIsWaiting(true);
    if (keepFullscreen) {
      updateStore({ __fullscreenGuard: keepFullscreen === true ? {} : keepFullscreen });
    }
    timeoutId.current = setTimeout(() => {
        timeoutId.current = null;

        next({});
    }, delayMs);
  }, [next, delayMs, cancelPendingTimeout, keepFullscreen, updateStore]);

  const handleFullscreenChangeForFallback = useCallback(() => {
    if (!fallbackListener.current) return;
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
    fallbackListener.current = handleFullscreenChangeForFallback;
    document.addEventListener('fullscreenchange', handleFullscreenChangeForFallback);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChangeForFallback);
    document.addEventListener('mozfullscreenchange', handleFullscreenChangeForFallback);
    document.addEventListener('MSFullscreenChange', handleFullscreenChangeForFallback);
  }, [handleFullscreenChangeForFallback, removeListenersAndTimeout]);

  const handleEnterFullscreenClick = useCallback(async () => {
    setIsWaiting(true);
    removeListenersAndTimeout();

    const element = document.documentElement;

    getNative()?.enterFullscreen();

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
      store={store}
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

export default defineComponent({
  name: 'EnterFullscreen',
  component: EnterFullscreen,
  csv: 'session',
  simulate: noopSimulate,
});
