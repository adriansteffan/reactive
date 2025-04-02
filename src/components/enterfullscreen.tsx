import React, { useState, useCallback, useRef, useEffect } from 'react'; // Import useState
import { BaseComponentProps, getPlatform, isFullscreen } from '../utils/common';
import Text from '../components/text';

import { StatusBar } from '@capacitor/status-bar';
import { ImmersiveMode } from '@adriansteffan/immersive-mode';
import { Capacitor } from '@capacitor/core';

export default function EnterFullscreen({
  content,
  buttonText,
  next,
  data,
  updateStore,
  delayMs = 0,
}: {
  prolificCode?: string;
  content?: React.ReactNode;
  buttonText?: string;
  delayMs?: number;
} & BaseComponentProps) {
  const contentWrap = (
    <div className='flex flex-col items-center'>
      {!!content && content}
      {!content && <p className=''>Please click the Button below to enter Fullscreen mode.</p>}
    </div>
  );

  const [isWaiting, setIsWaiting] = useState(false);
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
    setIsWaiting(true);
    timeoutId.current = setTimeout(() => {
        timeoutId.current = null;

        next({});
    }, delayMs);
  }, [next, delayMs, cancelPendingTimeout]);

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

 
  if (isWaiting) {
    return null;
  }

  return (
    <Text
      data={data}
      updateStore={updateStore}
      content={contentWrap}
      buttonText={buttonText ?? 'Enter Fullscreen Mode'}
      next={handleEnterFullscreenClick}
    />
  );
}