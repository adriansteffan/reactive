import React, { useEffect, useRef, useState } from 'react';
import { type BaseComponentProps, defineComponent } from '../core/component';
import { getNative } from '../core/platform';
import { noopSimulate } from '../core/simulation';
import { type Block, fullscreenSpan, type Timeline } from '../core/timeline';
import { type FullscreenGuardConfig, useSetFullscreenGuard } from '../runner/fullscreenguard';
import { useTheme, t } from '../runner/theme';
import { enterFullscreen } from '../utils/fullscreen';
import Text from './text';

/** The screen that asks the participant into fullscreen, and whether the block keeps them there. */
export interface FullscreenOptions {
  content?: React.ReactNode;
  buttonText?: string;
  className?: string;
  containerClass?: string;
  centered?: boolean;
  animate?: boolean;
  /** How long after entering fullscreen the block's first item starts. */
  delayMs?: number;
  /**
   * Shows a prompt to return to fullscreen on every trial of the block. `true` renders a small
   * top-left button with default text; a config customizes the button text, or switches to a
   * full-screen overlay with custom content.
   */
  keepFullscreen?: boolean | FullscreenGuardConfig;
  /** Ends the experiment on the screen when the browser cannot enter fullscreen, instead of asking again. Nothing is uploaded. */
  stopOnFailure?: boolean;
  /** Shown when the browser could not enter fullscreen: above the button when asking again, or on its own when stopping. */
  errorContent?: React.ReactNode;
}

function EnterFullscreen({
  content,
  buttonText,
  className,
  containerClass,
  centered,
  animate,
  next,
  delayMs = 0,
  keepFullscreen = false,
  stopOnFailure = false,
  errorContent,
}: FullscreenOptions & BaseComponentProps) {
  const [isWaiting, setIsWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  const setGuard = useSetFullscreenGuard();
  const timeoutId = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timeoutId.current), []);

  const handleEnterFullscreenClick = async () => {
    setIsWaiting(true);
    getNative()?.enterFullscreen();
    try {
      await enterFullscreen();
    } catch (error) {
      console.error('Fullscreen request failed:', error);
      // In the apps, the native call is what makes the app fullscreen, so a browser that refuses does not hold the participant back
      if (!getNative()) {
        setIsWaiting(false);
        setFailed(true);
        return;
      }
    }
    if (keepFullscreen) setGuard(keepFullscreen === true ? {} : keepFullscreen);
    timeoutId.current = setTimeout(() => next({}), delayMs);
  };

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

const EnterFullscreenScreen = defineComponent({
  name: 'EnterFullscreen',
  component: EnterFullscreen,
  csv: null,
  simulate: noopSimulate,
});

/**
 * Runs the items in fullscreen. A screen first asks the participant into it, and the experiment
 * leaves it once the run is outside the block, at its end or through a jump. On the settings
 * screen, the block's screen is an item of its own, so the items can run without it.
 */
export function fullscreenBlock(options: FullscreenOptions, items: Timeline): Block<'trials'> {
  return fullscreenSpan([EnterFullscreenScreen.trial(options), ...items]);
}
