import React, { createElement, useCallback, useLayoutEffect, useRef } from 'react';
import { type BaseComponentProps, defineComponent } from '../core/component';
import { t, useTheme } from '../runner/theme';
import { type CanvasSize, type Draw, prepareCanvas } from '../utils/canvas';
import { uniform } from '../utils/distributions';
import { keyAnswer, type ResponseKey, responseKey } from '../utils/keys';
import { halfFrameMs } from '../utils/time';

/** An answer the participant gives by a key, a button, or both. */
export type ScreenChoice = { key: ResponseKey; button?: string } | { key?: ResponseKey; button: string };

interface ScreenResponseFields {
  /** Keys that answer, each recorded as itself, letters in either case; `true` for any key. */
  keys?: readonly ResponseKey[] | true;
  /** Buttons that answer, each recorded as its text. */
  buttons?: readonly string[];
  /** Answers recorded by their names, each given by a key, a button, or both. */
  choices?: Record<string, ScreenChoice>;
  /** How long after the screen appears an answer counts. The screen ends then, if no answer has ended it. */
  timeLimitMs?: number;
  /** Whether the first answer ends the screen. Defaults to `true`; otherwise the screen ends at its time limit. */
  endsScreen?: boolean;
  /** Records every answer until the time limit, as `responses`, and keeps the screen on until then. */
  recordAll?: boolean;
}

/** The answers a screen takes, how long they count, and whether the first ends the screen. */
// Recording every answer keeps the screen on, so it cannot also end at the first
export type ScreenResponse = ScreenResponseFields & ({ recordAll?: false } | { recordAll: true; endsScreen?: false });

/** What a content function receives: `respond` ends the screen with an answer of the content's own. */
export interface ScreenControls {
  respond: (response: unknown) => void;
}

/** An answer, the key that gave it, and how long after the screen appeared it came. */
export type ScreenAnswer = { response: unknown; key: string | null; reactionTimeMs: number };

/**
 * The first answer, the key that gave it, and how long after the screen appeared it came, all null
 * without an answer; with `recordAll`, every answer as `responses`.
 */
export type ScreenData = {
  response: unknown;
  key: string | null;
  reactionTimeMs: number | null;
  responses?: ScreenAnswer[];
};

type ScreenFields = {
  /** What the screen shows: React, or a function of `{ respond }` for content that answers by itself. */
  content?: React.ReactNode | ((controls: ScreenControls) => React.ReactNode);
  response?: ScreenResponse;
  /**
   * How long the content stays visible. Unless the response has a time limit, the screen ends then.
   * Without one, the screen needs another way to end: a time limit, or keys, buttons, choices or
   * content that respond, whose first answer ends it.
   */
  displayDurationMs?: number;
  className?: string;
  containerClass?: string;
};

// An answer ends the screen, unless endsScreen is false or the screen records every answer
type EndsAtAnswer = { endsScreen?: true; recordAll?: false };

// A screen needs a way to end: an answer, a time limit, a display duration, or content that responds.
// TypeScript explains a mismatch against the last of these, so a screen without an end reads as
// missing its displayDurationMs, whose documentation lists the other ways.
type ScreenEnd =
  | { content: (controls: ScreenControls) => React.ReactNode; response?: EndsAtAnswer }
  | {
      response:
        | { timeLimitMs: number }
        | (EndsAtAnswer &
            ({ keys: readonly ResponseKey[] | true } | { buttons: readonly string[] } | { choices: Record<string, ScreenChoice> }));
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

// What a screen records from its answers: the first, and with recordAll, every one
function recordOf(answers: ScreenAnswer[], recordAll: boolean): ScreenData {
  const first = answers[0] ?? { response: null, key: null, reactionTimeMs: null };
  return recordAll ? { ...first, responses: answers } : { ...first };
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
    const recordAll = response?.recordAll === true;
    const endsAtAnswer = response?.endsScreen !== false && !recordAll;
    const answers: ScreenAnswer[] = [];
    const halfFrame = halfFrameMs(refreshRate);
    // The frame that paints the screen, and the next one, with which it appears
    let paintedAt: number | undefined;
    let onset: number | undefined;
    let done = false;
    let frameId = 0;

    const end = () => {
      done = true;
      cancelAnimationFrame(frameId);
      next(recordOf(answers, recordAll));
    };
    answerRef.current = (value, key, timeStamp) => {
      const reactionTimeMs = Math.round(Math.max(0, timeStamp - (onset ?? timeStamp)));
      // Only the first answer counts, unless the screen records every answer
      if (done || reactionTimeMs >= timeoutMs || (answers.length > 0 && !recordAll)) return;
      answers.push({ response: value, key, reactionTimeMs });
      if (endsAtAnswer) end();
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
          end();
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
    const endsAtAnswer = props.response?.endsScreen !== false && props.response?.recordAll !== true;
    const ends =
      (endsAtAnswer && (answers.length > 0 || props.response?.keys === true || typeof props.content === 'function')) ||
      props.response?.timeLimitMs !== undefined ||
      props.displayDurationMs !== undefined;
    if (!ends) {
      return 'A Screen would never end. Give it a displayDurationMs, or a response with a timeLimitMs, or with keys, buttons or choices whose first answer ends it.';
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
  // A screen that records every answer has a CSV row for each, or one without an answer
  csv: {
    screen: (row) => {
      const { responses, ...first } = row.recorded;
      return responses && responses.length > 0 ? responses : first;
    },
  },
  simulate: ({ props, simulators, participant }) => {
    const timeoutMs = props.response?.timeLimitMs ?? props.displayDurationMs ?? Number.POSITIVE_INFINITY;
    const recordAll = props.response?.recordAll === true;
    const endsAtAnswer = props.response?.endsScreen !== false && !recordAll;
    const answers: ScreenAnswer[] = [];
    // One answer after another, under the browser's rules: an answer counts within the screen's
    // time, and with recordAll, each after the one before
    do {
      const result = simulators.respond({ props, participant, answers });
      participant = result.participant ?? participant;
      const { response, key, reactionTimeMs } = result.value;
      if (response === null || reactionTimeMs === null || reactionTimeMs >= timeoutMs) break;
      const previous = answers.at(-1);
      if (previous && reactionTimeMs <= previous.reactionTimeMs) {
        throw new Error(
          `A simulated participant answered a Screen at ${reactionTimeMs} ms, which is not after the answer before at ${previous.reactionTimeMs} ms.`,
        );
      }
      answers.push({ ...recordAnswer(props, response, key), reactionTimeMs });
    } while (recordAll);

    const durationMs = endsAtAnswer && answers.length > 0 ? answers[0].reactionTimeMs : timeoutMs;
    if (durationMs === Number.POSITIVE_INFINITY) {
      throw new Error('A simulated participant gave no answer to a Screen that only an answer ends.');
    }
    return { recorded: recordOf(answers, recordAll), participant, durationMs };
  },
  defaultSimulators: {
    // One answer: a screen that records every answer gets no second
    respond: ({ props, answers: given }): ScreenDecision => {
      if (given.length > 0) return { value: { response: null, reactionTimeMs: null } };
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
