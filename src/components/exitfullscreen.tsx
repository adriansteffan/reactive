import { useCallback, useRef, useEffect } from 'react';
import { BaseComponentProps, getPlatform, isFullscreen } from '../utils/common';
import { StatusBar } from '@capacitor/status-bar';
import { ImmersiveMode } from '@adriansteffan/immersive-mode';
import { Capacitor } from '@capacitor/core';

export default function ExitFullscreen({
  next,
  delayMs = 0,
}: {
  delayMs?: number;
} & BaseComponentProps) {
  
  const listenerFallbackActive = useRef(false);
  const timeoutId = useRef<NodeJS.Timeout | null>(null);

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
    timeoutId.current = setTimeout(() => {
      timeoutId.current = null;
      next({});
    }, delayMs);
  }, [next, delayMs, cancelPendingTimeout]);

  const handleFullscreenChangeForFallback = useCallback(() => {
    if (!listenerFallbackActive.current) return;
    const currentlyFullscreen = isFullscreen();
    removeListenersAndTimeout();
    if (!currentlyFullscreen) {
      proceedWithDelay();
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

  useEffect(() => {
    const performExitFullscreen = async () => {
      if (!isFullscreen()) {
        next({});
        return;
      }
      
      if (getPlatform() === 'mobile' && Capacitor.getPlatform() === 'android') {
        StatusBar.show();
        ImmersiveMode.disable();
      }

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
  }, [proceedWithDelay, addListenersForFallback, removeListenersAndTimeout]);

  return null;
}