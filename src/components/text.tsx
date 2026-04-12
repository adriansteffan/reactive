import React, { useEffect, useRef } from 'react';
import { BaseComponentProps, now } from '../mod';
import { registerSimulation } from '../utils/simulation';
import { registerFlattener } from '../utils/upload';
import { uniform } from '../utils/distributions';
import { useTheme, t } from '../utils/theme';

registerFlattener('Text', 'text');

registerSimulation('Text', (trialProps, _experimentState, simulators, participant) => {
  if (trialProps.duration != null) {
    return { responseData: {}, participantState: participant, duration: trialProps.duration };
  }
  const result = simulators.respond(trialProps, participant);
  return { responseData: result.value, participantState: result.participantState, duration: result.value.reactionTime };
}, {
  respond: (_input: any, participant: any) => ({
    value: { key: 'button', time: Date.now(), reactionTime: uniform(500, 2000) },
    participantState: participant,
  }),
});

function Text({
  content,
  buttonText = 'Continue',
  className = '',
  containerClass,
  centered = false,
  next,
  animate = false,
  allowedKeys = false,
  duration,
}: {
  content: React.ReactNode;
  buttonText?: string;
  onButtonClick?: () => void;
  className?: string;
  containerClass?: string;
  centered?: boolean;
  animate?: boolean;
  allowedKeys?: string[] | boolean;
  /** Auto-advance after N ms. When set, no button is shown and key presses are ignored. */
  duration?: number;
} & BaseComponentProps) {
  const th = t(useTheme());
  const startTimeRef = useRef<number>(0);
  const timed = duration != null;

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    if (!timed) return;
    const timer = setTimeout(() => next({}), duration);
    return () => clearTimeout(timer);
  }, [timed, duration, next]);

  useEffect(() => {
    if (timed) return;
    startTimeRef.current = now();

    const handleKeyPress = (event: KeyboardEvent) => {
      const keypressTime = now();

      const isKeyAllowed =
        allowedKeys === true || (Array.isArray(allowedKeys) && allowedKeys.includes(event.key));

      if (isKeyAllowed) {
        event.preventDefault();
        const reactionTime = keypressTime - startTimeRef.current;

        next({
          key: event.key,
          time: keypressTime,
          reactionTime: reactionTime,
        });
      }
    };

    if (allowedKeys) {
      window.addEventListener('keydown', handleKeyPress);
    }

    return () => {
      if (allowedKeys) {
        window.removeEventListener('keydown', handleKeyPress);
      }
    };
  }, [next, allowedKeys, timed]);

  const handleClick = () => {
    const clickTime = now();

    const reactionTime = clickTime - startTimeRef.current;

    next({
      key: 'button',
      time: clickTime,
      reactionTime: reactionTime,
    });
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

export default Text;
