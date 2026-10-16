import React, { useEffect, useRef } from 'react';
import { BaseComponentProps } from '../core/component';
import { now } from '../utils/time';
import { defineComponent } from '../core/component';
import { uniform } from '../utils/distributions';
import { useTheme, t } from '../runner/theme';

/** Which key or the button ended the screen. Screens with a duration record nothing. */
export type TextResponse = { key?: string; reactionTimeMs?: number };

function Text({
  content,
  buttonText = 'Continue',
  className = '',
  containerClass,
  centered = false,
  next,
  animate = false,
  allowedResponseKeys = false,
  durationMs,
}: {
  content?: React.ReactNode;
  buttonText?: string;
  className?: string;
  containerClass?: string;
  centered?: boolean;
  animate?: boolean;
  allowedResponseKeys?: string[] | boolean;
  /** Auto-advance after this many milliseconds. When set, no button is shown and key presses are ignored. */
  durationMs?: number;
} & BaseComponentProps<TextResponse>) {
  const th = t(useTheme());
  const startTimeRef = useRef<number>(0);
  const timed = durationMs != null;

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    if (!timed) return;
    const timer = setTimeout(() => next({}), durationMs);
    return () => clearTimeout(timer);
  }, [timed, durationMs, next]);

  useEffect(() => {
    if (timed) return;
    startTimeRef.current = now();

    const handleKeyPress = (event: KeyboardEvent) => {
      const keypressTime = now();

      const isKeyAllowed =
        allowedResponseKeys === true || (Array.isArray(allowedResponseKeys) && allowedResponseKeys.includes(event.key));

      if (isKeyAllowed) {
        event.preventDefault();
        const reactionTimeMs = keypressTime - startTimeRef.current;

        next({ key: event.key, reactionTimeMs });
      }
    };

    if (allowedResponseKeys) {
      window.addEventListener('keydown', handleKeyPress);
    }

    return () => {
      if (allowedResponseKeys) {
        window.removeEventListener('keydown', handleKeyPress);
      }
    };
  }, [next, allowedResponseKeys, timed]);

  const handleClick = () => {
    const clickTime = now();

    const reactionTimeMs = clickTime - startTimeRef.current;

    next({ key: 'button', reactionTimeMs });
  };

  return (
    <div className={`min-h-screen ${centered ? 'flex items-center justify-center' : ''} ${containerClass ?? th.containerBg}`}>
      <div className={`max-w-prose mx-auto ${className} pt-20 pb-20 px-4 `}>
      <article
        className={`prose prose-2xl ${th.prose} text-xl ${th.proseLink} prose-a:underline prose-h1:text-4xl prose-h1:mb-10 prose-h1:font-bold prose-p:mb-4 prose-strong:font-bold ${th.text} leading-relaxed
            ${animate ? 'animate-slide-down opacity-0' : ''}`}
      >
        {content}
      </article>

      {!timed && buttonText && (
        <div
          className={`mt-16 flex justify-center ${animate ? 'animate-fade-in opacity-0' : ''}`}
          style={animate ? { animationDelay: '1s' } : {}}
        >
          <button
            onClick={handleClick}
            tabIndex={-1}
            onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') e.preventDefault(); }}
            className={`${th.buttonBg} cursor-pointer px-8 py-3 border-2 ${th.buttonBorder} font-bold ${th.buttonText} text-lg rounded-xl ${th.buttonShadow} hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none`}
          >
            {buttonText}
          </button>
        </div>
      )}
      </div>
    </div>
  );
}

export default defineComponent({
  name: 'Text',
  component: Text,
  csv: 'text',
  simulate: ({ props, simulators, participant }) => {
    if (props.durationMs != null) {
      return { responseData: {}, durationMs: props.durationMs };
    }
    const result = simulators.respond({ props, participant });
    return {
      responseData: result.value,
      participantState: result.participantState,
      durationMs: result.value.reactionTimeMs,
    };
  },
  defaultSimulators: {
    respond: () => ({
      value: { key: 'button', reactionTimeMs: uniform(500, 2000) },
    }),
  },
});
