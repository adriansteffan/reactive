import { useCallback, useRef, useEffect } from 'react';
import { BaseComponentProps } from '../core/component';
import { isFullscreen } from '../utils/fullscreen';
import { noopSimulate } from '../core/simulation';
import { defineComponent } from '../core/component';
import { getNative } from '../core/platform';

function ExitFullscreen({
  next,
  updateStore,
  delayMs = 0,
}: {
  delayMs?: number;
} & BaseComponentProps) {
  
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
    timeoutId.current = setTimeout(() => {
      timeoutId.current = null;
      next({});
    }, delayMs);
  }, [next, delayMs, cancelPendingTimeout]);

  const handleFullscreenChangeForFallback = useCallback(() => {
    if (!fallbackListener.current) return;
    const currentlyFullscreen = isFullscreen();
    removeListenersAndTimeout();
    if (!currentlyFullscreen) {
      proceedWithDelay();
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

  useEffect(() => {
    updateStore({ __fullscreenGuard: null });
    const performExitFullscreen = async () => {
      if (!isFullscreen()) {
        next({});
        return;
      }
      
      getNative()?.exitFullscreen();

      if (document.exitFullscreen) {
        try {
          await document.exitFullscreen();
          proceedWithDelay();
          return;
        } catch (err) {
          console.error("Exiting fullscreen failed:", err);
          next({});
          return;
        }
      }

      if ((document as any).mozCancelFullScreen) {
        (document as any).mozCancelFullScreen();
        addListenersForFallback();
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
        addListenersForFallback();
      } else if ((document as any).msExitFullscreen) {
        (document as any).msExitFullscreen();
        addListenersForFallback();
      } else {
        console.warn('Fullscreen API is not supported by this browser.');
        next({});
      }
    };
    
    performExitFullscreen();
    
    return () => {
      removeListenersAndTimeout();
    };
  }, [next, updateStore, proceedWithDelay, addListenersForFallback, removeListenersAndTimeout]);

  return null;
}

export default defineComponent({
  name: 'ExitFullscreen',
  component: ExitFullscreen,
  csv: 'session',
  simulate: noopSimulate,
});
