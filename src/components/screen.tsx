import React, { createElement, useCallback, useLayoutEffect, useRef } from 'react';
import { type BaseComponentProps, defineComponent } from '../core/component';
import { t, useTheme } from '../runner/theme';
import { type CanvasSize, type Draw, prepareCanvas } from '../utils/canvas';
import { uniform } from '../utils/distributions';
import { type ResponseKey, responseKey } from '../utils/keys';
import { halfFrameMs } from '../utils/time';

/** An answer the participant gives by a key, a button, or both. */
export type ScreenChoice = { key: ResponseKey; button?: string } | { key?: ResponseKey; button: string };

/** The answers a screen takes, and how long they count. */
export interface ScreenResponse {
  /** Keys that answer, each recorded as itself, letters in either case; `true` for any key. */
  keys?: readonly ResponseKey[] | true;
  /** Buttons that answer, each recorded as its text. */
  buttons?: readonly string[];
  /** Answers recorded by their names, each given by a key, a button, or both. */
  choices?: Record<string, ScreenChoice>;
  /** How long after the screen appears an answer counts. The screen ends then, if no answer has ended it. */
  timeLimitMs?: number;
}

/** What a content function receives: `respond` ends the screen with an answer of the content's own. */
export interface ScreenControls {
  respond: (response: unknown) => void;
}

/** The answer, the key that gave it, and how long after the screen appeared it came; all null without an answer. */
export interface ScreenData {
  response: unknown;
  key: string | null;
  reactionTimeMs: number | null;
}

type ScreenFields = {
  /** What the screen shows: React, or a function of `{ respond }` for content that answers by itself. */
  content?: React.ReactNode | ((controls: ScreenControls) => React.ReactNode);
  response?: ScreenResponse;
  /**
   * How long the content stays visible. Unless the response has a time limit, the screen ends then.
   * Without one, the screen needs another way to end: keys, buttons or choices, a time limit, or
   * content that responds.
   */
  displayDurationMs?: number;
  className?: string;
  containerClass?: string;
};

// A screen needs a way to end: an answer, a time limit, a display duration, or content that responds.
// TypeScript explains a mismatch against the last of these, so a screen without an end reads as
// missing its displayDurationMs, whose documentation lists the other ways.
type ScreenEnd =
  | { content: (controls: ScreenControls) => React.ReactNode }
  | {
      response:
        | { timeLimitMs: number }
        | { keys: readonly ResponseKey[] | true }
        | { buttons: readonly string[] }
        | { choices: Record<string, ScreenChoice> };
    }
  | { displayDurationMs: number };

export type ScreenProps = ScreenFields & ScreenEnd & BaseComponentProps<ScreenData>;

type Answer = { response: string; key?: ResponseKey; button?: string };

// The declared answers: the named choices, then the keys and buttons, which are recorded as themselves
function answersOf(response: ScreenResponse | undefined): Answer[] {
  const keys = response?.keys === true ? [] : (response?.keys ?? []);
  return [
    ...Object.entries(response?.choices ?? {}).map(([name, choice]) => ({ response: name, ...choice })),
    ...keys.map((key) => ({ response: key, key })),
    ...(response?.buttons ?? []).map((button) => ({ response: button, button })),
  ];
}

// The answer a key press gives: that of the answer whose key it is, or with `keys: true`, the key
// itself. Undefined for a key that does not answer.
function keyAnswer(response: ScreenResponse | undefined, pressed: string): { response: string; key: string } | undefined {
  for (const answer of answersOf(response)) {
    const key = answer.key === undefined ? undefined : responseKey([answer.key], pressed);
    if (key !== undefined) return { response: answer.response, key };
  }
  const key = responseKey(response?.keys === true, pressed);
  return key === undefined ? undefined : { response: key, key };
}

// A simulated answer as the browser would record it. The simulator's key says how the answer was
// given: by a key, judged as a press is, or with null, by a button or the content's respond. Left
// out, it is the declared answer's key, or with `keys: true`, the answer itself.
function recordAnswer(
  props: Pick<ScreenFields, 'content' | 'response'>,
  response: unknown,
  given: string | null | undefined,
): { response: unknown; key: string | null } {
  const declared = answersOf(props.response).find((answer) => answer.response === response);
  const anyKey = props.response?.keys === true && typeof response === 'string';
  const key = given !== undefined ? given : declared ? (declared.key ?? null) : anyKey ? response : null;
  if (key !== null) {
    const answer = keyAnswer(props.response, key);
    if (answer && typeof response === 'string' && responseKey([answer.response], response) !== undefined) return answer;
    throw new Error(
      `A simulated participant answered ${JSON.stringify(response)} with the key '${key}', which ${answer ? `gives '${answer.response}'` : 'does not answer the Screen'}.`,
    );
  }
  if (declared?.button !== undefined || typeof props.content === 'function') return { response, key: null };
  throw new Error(
    declared
      ? `A simulated participant gave the Screen's answer '${declared.response}' without its key, but it has no button.`
      : `A simulated participant answered ${JSON.stringify(response)}, which the Screen does not take. Its answers are ${answersOf(props.response).map((answer) => `'${answer.response}'`).join(', ') || 'none'}.`,
  );
}

function Screen({ content, response, displayDurationMs, className = '', containerClass, next, store }: ScreenProps) {
  const th = t(useTheme());
  // The content and its buttons, hidden until the images in the content can show
  const stageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // Set while the screen runs; key presses, buttons and the content answer through it
  const answerRef = useRef<(response: unknown, key: string | null, timeStamp: number) => void>(() => {});
  const respond = useCallback((value: unknown) => answerRef.current(value, null, performance.now()), []);

  const refreshRate = store.__screenRefreshRate;
  // A layout effect starts the clock before the browser paints the screen, like a CanvasBlock's draw
  useLayoutEffect(() => {
    const timeoutMs = response?.timeLimitMs ?? displayDurationMs ?? Number.POSITIVE_INFINITY;
    const halfFrame = halfFrameMs(refreshRate);
    // The frame that paints the screen, and the next one, with which it appears
    let paintedAt: number | undefined;
    let onset: number | undefined;
    let done = false;
    let frameId = 0;

    const end = (data: ScreenData) => {
      done = true;
      cancelAnimationFrame(frameId);
      next(data);
    };
    answerRef.current = (value, key, timeStamp) => {
      const reactionTimeMs = Math.round(Math.max(0, timeStamp - (onset ?? timeStamp)));
      if (!done && reactionTimeMs < timeoutMs) end({ response: value, key, reactionTimeMs });
    };

    const frame = (timestamp: number) => {
      if (paintedAt === undefined) {
        // Shown in a frame callback, so this frame is the one that paints it
        if (stageRef.current) stageRef.current.style.visibility = 'visible';
        paintedAt = timestamp;
      } else {
        onset ??= timestamp;
        // Half a frame more ends the screen on the frame nearest its time
        const elapsed = timestamp - paintedAt + halfFrame;
        if (elapsed >= timeoutMs) {
          end({ response: null, key: null, reactionTimeMs: null });
          return;
        }
        if (contentRef.current && elapsed >= (displayDurationMs ?? Number.POSITIVE_INFINITY)) {
          contentRef.current.style.visibility = 'hidden';
        }
      }
      frameId = requestAnimationFrame(frame);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      // A held key repeats, and a key pressed before the screen appeared does not count
      if (event.repeat || onset === undefined || event.timeStamp < onset) return;
      const answer = keyAnswer(response, event.key);
      if (!answer) return;
      event.preventDefault();
      answerRef.current(answer.response, answer.key, event.timeStamp);
    };

    window.addEventListener('keydown', onKeyDown);
    // The clock starts once every image has loaded and decoded, so their loading time is not part
    // of a reaction time; an image that fails to load shows as broken instead of holding the screen
    const images = Array.from(stageRef.current?.querySelectorAll('img') ?? []);
    Promise.all(images.map((image) => image.decode().catch(() => undefined))).then(() => {
      if (!done) frameId = requestAnimationFrame(frame);
    });
    return () => {
      done = true;
      window.removeEventListener('keydown', onKeyDown);
      cancelAnimationFrame(frameId);
    };
  }, [next, response, displayDurationMs, refreshRate]);

  const buttons = answersOf(response).filter((answer) => answer.button !== undefined);

  return (
    <div className={`min-h-screen flex items-center justify-center px-4 py-20 ${th.text} ${containerClass ?? th.containerBg}`}>
      <div ref={stageRef} className='flex flex-col items-center gap-12' style={{ visibility: 'hidden' }}>
        <div ref={contentRef} className={className}>
          {/* A function is rendered as a component, so that it can use hooks */}
          {typeof content === 'function' ? createElement(content, { respond }) : content}
        </div>
        {buttons.length > 0 && (
          <div className='flex flex-wrap justify-center gap-4'>
            {buttons.map((answer) => (
              <button
                key={answer.response}
                type='button'
                tabIndex={-1}
                // Keys answer through their own handler, never by pressing a focused button
                onKeyDown={(event) => {
                  if (event.key === ' ' || event.key === 'Enter') event.preventDefault();
                }}
                onClick={(event) => answerRef.current(answer.response, null, event.timeStamp)}
                className={th.button}
              >
                {answer.button}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A canvas in a Screen's content, which `draw` paints when the screen appears and again whenever
 * `draw` changes. Its size works as a CanvasBlock's does.
 */
export function Canvas({
  draw,
  width,
  height,
  onClick,
  className,
}: {
  draw: Draw;
  width?: CanvasSize;
  height?: CanvasSize;
  /** Receives where the participant clicked, in the coordinates that `draw` uses. */
  onClick?: (x: number, y: number) => void;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Drawn before the browser paints, so the drawing appears with the rest of the screen
  useLayoutEffect(() => {
    const prepared = canvasRef.current && prepareCanvas(canvasRef.current, width, height);
    if (!prepared) return;
    // A mistake in drawing code leaves the canvas incomplete instead of stopping the experiment
    try {
      draw(prepared.ctx, prepared.size.width, prepared.size.height);
    } catch (error) {
      console.error('Drawing on the canvas failed:', error);
    }
  }, [draw, width, height]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      onClick={
        onClick &&
        ((event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          onClick(event.clientX - bounds.left, event.clientY - bounds.top);
        })
      }
    />
  );
}

/**
 * What a Screen's `respond` simulator decides: the answer and its reaction time, or nulls for none.
 * The key says how the answer was given, null for a button; left out, it is the answer's own.
 */
type ScreenDecision = { value: { response: unknown; key?: string | null; reactionTimeMs: number | null } };

export default defineComponent({
  name: 'Screen',
  component: Screen,
  check: ({ props }) => {
    if (props === undefined) return undefined;
    const answers = answersOf(props.response);
    const ends =
      answers.length > 0 ||
      props.response?.keys === true ||
      props.response?.timeLimitMs !== undefined ||
      props.displayDurationMs !== undefined ||
      typeof props.content === 'function';
    if (!ends) {
      return 'A Screen would never end. Give it a displayDurationMs, or a response with keys, buttons, choices or a timeLimitMs.';
    }
    // Keys count in any case, so two that differ only in case are the same key
    const givenBy = new Map<string, string>();
    for (const answer of answers) {
      for (const way of [answer.key && `key '${answer.key.toLowerCase()}'`, answer.button && `button '${answer.button}'`]) {
        if (!way) continue;
        const other = givenBy.get(way);
        if (other !== undefined) {
          return `The Screen's answers '${other}' and '${answer.response}' share the ${way}, so only one of them can be given.`;
        }
        givenBy.set(way, answer.response);
      }
    }
    return undefined;
  },
  simulate: ({ props, simulators, participant }) => {
    const timeoutMs = props.response?.timeLimitMs ?? props.displayDurationMs ?? Number.POSITIVE_INFINITY;
    const result = simulators.respond({ props, participant });
    const { response, key, reactionTimeMs } = result.value;
    // The same rules as in the browser: an answer counts within the screen's time
    if (response !== null && reactionTimeMs !== null && reactionTimeMs < timeoutMs) {
      return {
        recorded: { ...recordAnswer(props, response, key), reactionTimeMs },
        participant: result.participant,
        durationMs: reactionTimeMs,
      };
    }
    if (timeoutMs === Number.POSITIVE_INFINITY) {
      throw new Error('A simulated participant gave no answer to a Screen that only an answer ends.');
    }
    return {
      recorded: { response: null, key: null, reactionTimeMs: null },
      participant: result.participant,
      durationMs: timeoutMs,
    };
  },
  defaultSimulators: {
    respond: ({ props }): ScreenDecision => {
      const answers = answersOf(props.response);
      if (answers.length > 0) {
        const answer = answers[Math.floor(uniform(0, answers.length))];
        return { value: { response: answer.response, reactionTimeMs: Math.round(uniform(300, 1500)) } };
      }
      if (props.response?.keys === true) {
        return { value: { response: ' ', reactionTimeMs: Math.round(uniform(300, 1500)) } };
      }
      if (typeof props.content === 'function') {
        throw new Error(
          "A Screen whose content answers through respond needs a simulator of its own, since the simulation cannot guess its answers. Give the trial one with .simulators({ respond: ({ participant }) => ({ value: { response, reactionTimeMs } }) }).",
        );
      }
      return { value: { response: null, reactionTimeMs: null } };
    },
  },
});
