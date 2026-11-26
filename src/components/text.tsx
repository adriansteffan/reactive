import React, { useEffect, useRef } from 'react';
import type { BaseComponentProps, SimulatorArgs } from '../core/component';
import { type ResponseKey, responseKey } from '../utils/keys';
import { now } from '../utils/time';
import { defineComponent } from '../core/component';
import { uniform } from '../utils/distributions';
import { useTheme, t } from '../runner/theme';

/** Which key or the button ended the screen. Screens with a duration record nothing. */
export type TextResponse = { key?: string; reactionTimeMs?: number };

/** What Text's `respond` simulator receives: the content, the button it shows, empty for none, and its keys. */
type TextStimulus = { content?: React.ReactNode; buttonText: string; allowedResponseKeys?: readonly ResponseKey[] | boolean };

function Text({
  content,
  buttonText,
  className = '',
  containerClass,
  centered = false,
  next,
  animate = false,
  allowedResponseKeys = false,
  durationMs,
}: {
  content?: React.ReactNode;
  /** The button that ends the screen: 'Continue' unless the screen has a duration; an empty text shows none. */
  buttonText?: string;
  className?: string;
  containerClass?: string;
  centered?: boolean;
  animate?: boolean;
  /** The keys that end the screen, letters in either case, or `true` for any key. */
  allowedResponseKeys?: readonly ResponseKey[] | boolean;
  /** Ends the screen after this many milliseconds, unless its button or keys end it first. */
  durationMs?: number;
} & Pick<BaseComponentProps<TextResponse>, 'next'>) {
  const th = t(useTheme());
  const startTimeRef = useRef<number>(0);
  const timed = durationMs != null;
  const button = buttonText ?? (timed ? '' : 'Continue');

  useEffect(() => {
    if (!timed) return;
    const timer = setTimeout(() => next({}), durationMs);
    return () => clearTimeout(timer);
  }, [timed, durationMs, next]);

  useEffect(() => {
    startTimeRef.current = now();

    const handleKeyPress = (event: KeyboardEvent) => {
      const keypressTime = now();

      const key = responseKey(allowedResponseKeys, event.key);
      if (key !== undefined) {
        event.preventDefault();
        const reactionTimeMs = keypressTime - startTimeRef.current;

        next({ key, reactionTimeMs });
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
  }, [next, allowedResponseKeys]);

  const handleClick = () => {
    const clickTime = now();

    const reactionTimeMs = clickTime - startTimeRef.current;

    next({ key: 'button', reactionTimeMs });
  };

  return (
    <div className={`min-h-screen ${centered ? 'flex items-center justify-center' : ''} ${containerClass ?? th.containerBg}`}>
      <div className={`max-w-prose mx-auto ${className} pt-20 pb-20 px-4 `}>
      <article
        className={`${th.article}
            ${animate ? 'animate-slide-down opacity-0' : ''}`}
      >
        {content}
      </article>

      {button && (
        <div
          className={`mt-16 flex justify-center ${animate ? 'animate-fade-in opacity-0' : ''}`}
          style={animate ? { animationDelay: '1s' } : {}}
        >
          <button
            onClick={handleClick}
            tabIndex={-1}
            onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') e.preventDefault(); }}
            className={th.button}
          >
            {button}
          </button>
        </div>
      )}
      </div>
    </div>
  );
}

// The words of the content's text, with those its elements hold as children
function wordsIn(node: React.ReactNode): number {
  if (typeof node === 'string' || typeof node === 'number') return String(node).split(/\s+/).filter(Boolean).length;
  if (Array.isArray(node)) return node.reduce((sum: number, child) => sum + wordsIn(child), 0);
  if (React.isValidElement(node)) return wordsIn((node.props as { children?: React.ReactNode }).children);
  return 0;
}

export default defineComponent({
  name: 'Text',
  component: Text,
  csv: 'text',
  simulate: async ({ props, simulators, participant }) => {
    const { durationMs } = props;
    if (durationMs !== undefined && !props.buttonText && !props.allowedResponseKeys) {
      return { recorded: {}, durationMs };
    }
    const result = await simulators.respond({
      stimulus: {
        content: props.content,
        buttonText: props.buttonText ?? (durationMs !== undefined ? '' : 'Continue'),
        allowedResponseKeys: props.allowedResponseKeys,
      },
      participant,
    });
    const reactionTimeMs = result.response.reactionTimeMs ?? 0;
    // A timed screen that the participant does not end in time ends after its duration
    if (durationMs !== undefined && reactionTimeMs >= durationMs) {
      return { recorded: {}, participant: result.participant, durationMs };
    }
    return {
      recorded: result.response,
      participant: result.participant,
      durationMs: reactionTimeMs,
    };
  },
  defaultSimulators: {
    // Reads the text at 200 to 300 words a minute, then takes the button, or on a screen without one, one of its keys
    respond: ({ stimulus }: SimulatorArgs<TextStimulus>) => {
      const reactionTimeMs = (wordsIn(stimulus.content) / uniform(200, 300)) * 60_000 + uniform(500, 2000);
      const keys = stimulus.allowedResponseKeys === true ? [' '] : stimulus.allowedResponseKeys || [];
      if (!stimulus.buttonText && keys.length > 0) {
        return { response: { key: keys[Math.floor(uniform(0, keys.length))], reactionTimeMs } };
      }
      return { response: { key: 'button', reactionTimeMs } };
    },
  },
});
