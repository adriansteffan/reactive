import React, { useState, useCallback, useRef, useEffect } from 'react';
import { type BaseComponentProps, defineComponent } from '../core/component';
import { getNative } from '../core/platform';
import { noopSimulate } from '../core/simulation';
import { type FullscreenGuardConfig, useSetFullscreenGuard } from '../runner/fullscreenguard';
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
  stopOnFailure = false,
  errorContent,
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
  /** Ends the experiment on this screen when the browser cannot enter fullscreen, instead of asking again. Nothing is uploaded. */
  stopOnFailure?: boolean;
  /** Shown when the browser could not enter fullscreen: above the button when asking again, or on its own when stopping. */
  errorContent?: React.ReactNode;
} & BaseComponentProps) {
  const [isWaiting, setIsWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  const setGuard = useSetFullscreenGuard();
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
      setGuard(keepFullscreen === true ? {} : keepFullscreen);
    }
    timeoutId.current = setTimeout(() => {
        timeoutId.current = null;

        next({});
    }, delayMs);
  }, [next, delayMs, cancelPendingTimeout, keepFullscreen, setGuard]);

  // In the apps, the native call is what makes the app fullscreen, so a browser that refuses does not hold the participant back
  const fail = useCallback(() => {
    if (getNative()) {
      proceedWithDelay();
      return;
    }
    setIsWaiting(false);
    setFailed(true);
  }, [proceedWithDelay]);

  const handleFullscreenChangeForFallback = useCallback(() => {
    if (!fallbackListener.current) return;
    const currentlyFullscreen = isFullscreen();
    removeListenersAndTimeout();
    if (currentlyFullscreen) {
        proceedWithDelay();
    } else {
        fail();
    }
  }, [proceedWithDelay, removeListenersAndTimeout, fail]);

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
        fail();
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
      fail();
    }
  }, [proceedWithDelay, addListenersForFallback, removeListenersAndTimeout, fail]);

  useEffect(() => {
    return () => {
      removeListenersAndTimeout();
    };
  }, [removeListenersAndTimeout]);

 
  const th = t(useTheme());

  if (isWaiting) {
    return <div className={`min-h-screen ${containerClass ?? th.containerBg}`} />;
  }

  const error =
    errorContent ??
    (stopOnFailure ? (
      <p>This study needs fullscreen mode, which could not be started on this device. Unfortunately, you cannot continue.</p>
    ) : (
      <p>Fullscreen mode could not be started. Please try again.</p>
    ));

  if (failed && stopOnFailure) {
    return (
      <Text
        data={data}
        store={store}
        updateStore={updateStore}
        className={className}
        containerClass={containerClass}
        centered={centered}
        content={error}
        buttonText=''
        next={() => {}}
      />
    );
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
      content={
        <div className='flex flex-col items-center'>
          {failed && error}
          {!!content && content}
          {!content && <p className=''>Please click the Button below to enter Fullscreen mode.</p>}
        </div>
      }
      buttonText={buttonText ?? 'Enter Fullscreen Mode'}
      next={handleEnterFullscreenClick}
    />
  );
}

export default defineComponent({
  name: 'EnterFullscreen',
  component: EnterFullscreen,
  csv: null,
  simulate: noopSimulate,
});
