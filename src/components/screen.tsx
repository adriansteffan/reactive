import React, { createElement, useCallback, useLayoutEffect, useRef } from 'react';
import { type BaseComponentProps, defineComponent, type SimulatorArgs } from '../core/component';
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
  /** Fades the buttons in this long after the stimulus appears, from which reaction times still count. */
  buttonDelayMs?: number;
  /** How long after the stimulus appears an answer counts. The trial ends then, if no answer has ended it. */
  timeLimitMs?: number;
  /** Whether the first answer ends the trial. Defaults to `true`; otherwise the trial ends at its time limit. */
  endsTrial?: boolean;
  /** Records every answer until the time limit, as `responses`, so the trial lasts until then. */
  recordAll?: boolean;
}

/** The answers a stimulus takes, how long they count, and whether the first ends the trial. */
// Recording every answer keeps the trial going, so it cannot also end at the first
export type ScreenResponse = ScreenResponseFields & ({ recordAll?: false } | { recordAll: true; endsTrial?: false });

/** What a content function receives: `respond` ends the trial with an answer of the content's own. */
export interface ScreenControls {
  respond: (response: unknown) => void;
}

/** An answer, the key that gave it, and how long after the stimulus appeared it came. */
export type ScreenAnswer = { response: unknown; key: string | null; reactionTimeMs: number };

/**
 * The first answer, the key that gave it, and how long after the stimulus appeared it came, all null
 * without an answer; the answers on offer as `options`; with `recordAll`, every answer as `responses`.
 */
export type ScreenData = {
  response: unknown;
  key: string | null;
  reactionTimeMs: number | null;
  options: string[];
  responses?: ScreenAnswer[];
};

type ScreenFields = {
  /** The stimulus: React, or a function of `{ respond }` for content that answers by itself. */
  content?: React.ReactNode | ((controls: ScreenControls) => React.ReactNode);
  response?: ScreenResponse;
  /**
   * How long the content stays visible. Unless the response has a time limit, the trial ends then.
   * Without one, the trial needs another way to end: a time limit, or keys, buttons, choices or
   * content that respond, whose first answer ends it.
   */
  displayDurationMs?: number;
  className?: string;
  containerClass?: string;
  /** Centers the stimulus vertically; otherwise it starts at the top of the screen. */
  centered?: boolean;
  /** Slides the stimulus and its buttons in. */
  animate?: boolean;
};

// An answer ends the trial, unless endsTrial is false or the trial records every answer
type EndsAtAnswer = { endsTrial?: true; recordAll?: false };

// A trial needs a way to end: an answer, a time limit, a display duration, or content that responds.
// TypeScript explains a mismatch against the last of these, so a trial without an end reads as
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
function answersOf(response: ScreenResponseFields | undefined): Answer[] {
  const keys = response?.keys === true ? [] : (response?.keys ?? []);
  return [
    ...Object.entries(response?.choices ?? {}).map(([name, choice]) => ({ response: name, ...choice })),
    ...keys.map((key) => ({ response: key, key })),
    ...(response?.buttons ?? []).map((button) => ({ response: button, button })),
  ];
}

// What a trial records from its answers: the first, the options it had, and with recordAll, every answer
function recordOf(answers: ScreenAnswer[], response: ScreenResponse | undefined): ScreenData {
  const first = answers[0] ?? { response: null, key: null, reactionTimeMs: null };
  const options = answersOf(response).map((answer) => answer.response);
  return response?.recordAll ? { ...first, options, responses: answers } : { ...first, options };
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

function Screen({ content, response, displayDurationMs, className = '', containerClass, centered = true, animate = false, next, store }: ScreenProps) {
  const th = t(useTheme());
  // The content and its buttons, hidden until the images in the content can show
  const stageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const buttonsRef = useRef<HTMLDivElement>(null);
  // Set while the trial runs; key presses, buttons and the content answer through it
  const answerRef = useRef<(response: unknown, key: string | null, timeStamp: number) => void>(() => {});
  const respond = useCallback((value: unknown) => answerRef.current(value, null, performance.now()), []);

  const refreshRate = store.__screenRefreshRate;
  // A layout effect starts the clock before the browser paints the stimulus, like a CanvasBlock's draw
  useLayoutEffect(() => {
    const timeoutMs = response?.timeLimitMs ?? displayDurationMs ?? Number.POSITIVE_INFINITY;
    const recordAll = response?.recordAll === true;
    const endsAtAnswer = response?.endsTrial !== false && !recordAll;
    const answers: ScreenAnswer[] = [];
    const halfFrame = halfFrameMs(refreshRate);
    // The frame that paints the stimulus, and the next one, with which it appears
    let paintedAt: number | undefined;
    let onset: number | undefined;
    let done = false;
    let frameId = 0;

    const end = () => {
      done = true;
      cancelAnimationFrame(frameId);
      next(recordOf(answers, response));
    };
    answerRef.current = (value, key, timeStamp) => {
      const reactionTimeMs = Math.round(Math.max(0, timeStamp - (onset ?? timeStamp)));
      // Only the first answer counts, unless the trial records every answer
      if (done || reactionTimeMs >= timeoutMs || (answers.length > 0 && !recordAll)) return;
      answers.push({ response: value, key, reactionTimeMs });
      if (endsAtAnswer) end();
    };

    const frame = (timestamp: number) => {
      if (paintedAt === undefined) {
        // Shown in a frame callback, so this frame is the one that paints it
        if (stageRef.current) {
          stageRef.current.style.visibility = 'visible';
          stageRef.current.style.animationPlayState = 'running';
        }
        paintedAt = timestamp;
      } else {
        onset ??= timestamp;
        // Half a frame more ends the trial on the frame nearest its time
        const elapsed = timestamp - paintedAt + halfFrame;
        if (elapsed >= timeoutMs) {
          end();
          return;
        }
        if (contentRef.current && elapsed >= (displayDurationMs ?? Number.POSITIVE_INFINITY)) {
          contentRef.current.style.visibility = 'hidden';
        }
        if (buttonsRef.current && elapsed >= (response?.buttonDelayMs ?? Number.POSITIVE_INFINITY)) {
          buttonsRef.current.style.visibility = 'inherit';
          buttonsRef.current.style.opacity = '1';
        }
      }
      frameId = requestAnimationFrame(frame);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      // A held key repeats, and a key pressed before the stimulus appeared does not count
      if (event.repeat || onset === undefined || event.timeStamp < onset) return;
      const answer = keyAnswer(response, event.key);
      if (!answer) return;
      event.preventDefault();
      answerRef.current(answer.response, answer.key, event.timeStamp);
    };

    window.addEventListener('keydown', onKeyDown);
    // The clock starts once every image has loaded and decoded, so their loading time is not part
    // of a reaction time; an image that fails to load shows as broken instead of holding up the trial
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
    <div className={`min-h-screen flex justify-center ${centered ? 'items-center' : ''} px-4 py-20 ${th.text} ${containerClass ?? th.containerBg}`}>
      <div
        ref={stageRef}
        className={`flex flex-col items-center gap-12 ${animate ? 'animate-slide-down opacity-0' : ''}`}
        style={{ visibility: 'hidden', animationPlayState: 'paused' }}
      >
        <div ref={contentRef} className={className}>
          {/* A function is rendered as a component, so that it can use hooks */}
          {typeof content === 'function' ? createElement(content, { respond }) : content}
        </div>
        {buttons.length > 0 && (
          <div
            ref={buttonsRef}
            className='flex flex-wrap justify-center gap-4 transition-opacity duration-500'
            // Hidden buttons take no clicks
            style={response?.buttonDelayMs === undefined ? undefined : { visibility: 'hidden', opacity: 0 }}
          >
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
                className={`grid ${th.button}`}
              >
                {/* Each button holds every text, so that all are as wide as the widest and none stands out */}
                {buttons.map((other) => (
                  <span key={other.response} className={`col-start-1 row-start-1 ${other === answer ? '' : 'invisible'}`}>
                    {other.button}
                  </span>
                ))}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A canvas in a Screen's content, which `draw` paints when the stimulus appears and again whenever
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

  // Drawn before the browser paints, so the drawing appears with the rest of the stimulus
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

/** What a Screen's `respond` simulator receives: the content, how it can be answered, and the answers so far. */
type ScreenStimulus = Pick<ScreenFields, 'content' | 'displayDurationMs'> &
  ScreenResponseFields & { answers: { answer: unknown; key: string | null; reactionTimeMs: number }[] };

/**
 * What a Screen's `respond` simulator returns: the answer and its reaction time, or nulls for none.
 * The key says how the answer was given, null for a button; left out, it is the answer's own.
 */
type ScreenSimulatorResult = { response: { answer: unknown; key?: string | null; reactionTimeMs: number | null } };

export default defineComponent({
  name: 'Screen',
  component: Screen,
  check: ({ props }) => {
    if (props === undefined) return undefined;
    const answers = answersOf(props.response);
    const endsAtAnswer = props.response?.endsTrial !== false && props.response?.recordAll !== true;
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
  // A trial that records every answer has a CSV row for each, or one without an answer
  csv: {
    screen: (row) => {
      const { responses, ...first } = row.recorded;
      return responses && responses.length > 0 ? responses.map((answer) => ({ ...answer, options: first.options })) : first;
    },
  },
  simulate: async ({ props, simulators, participant }) => {
    const timeoutMs = props.response?.timeLimitMs ?? props.displayDurationMs ?? Number.POSITIVE_INFINITY;
    const recordAll = props.response?.recordAll === true;
    const endsAtAnswer = props.response?.endsTrial !== false && !recordAll;
    const buttonDelayMs = props.response?.buttonDelayMs ?? 0;
    const answers: ScreenAnswer[] = [];
    // One answer after another, under the browser's rules: an answer counts within the trial's
    // time, and with recordAll, each after the one before
    do {
      const result = await simulators.respond({
        stimulus: {
          content: props.content,
          displayDurationMs: props.displayDurationMs,
          ...props.response,
          answers: answers.map(({ response, ...rest }) => ({ answer: response, ...rest })),
        },
        participant,
      });
      participant = result.participant ?? participant;
      const { answer: given, key, reactionTimeMs } = result.response;
      if (given === null || reactionTimeMs === null || reactionTimeMs >= timeoutMs) break;
      const previous = answers.at(-1);
      if (previous && reactionTimeMs <= previous.reactionTimeMs) {
        throw new Error(
          `A simulated participant answered a Screen at ${reactionTimeMs} ms, which is not after the answer before at ${previous.reactionTimeMs} ms.`,
        );
      }
      const answer = { ...recordAnswer(props, given, key), reactionTimeMs };
      // Content that answers by itself needs no button
      if (answer.key === null && reactionTimeMs < buttonDelayMs && typeof props.content !== 'function') {
        throw new Error(
          `A simulated participant clicked a Screen's button at ${reactionTimeMs} ms, before the buttons appear at ${buttonDelayMs} ms.`,
        );
      }
      answers.push(answer);
    } while (recordAll);

    const durationMs = endsAtAnswer && answers.length > 0 ? answers[0].reactionTimeMs : timeoutMs;
    if (durationMs === Number.POSITIVE_INFINITY) {
      throw new Error('A simulated participant gave no answer to a Screen that only an answer ends.');
    }
    return { recorded: recordOf(answers, props.response), participant, durationMs };
  },
  defaultSimulators: {
    // One answer: a trial that records every answer gets no second
    respond: ({ stimulus }: SimulatorArgs<ScreenStimulus>): ScreenSimulatorResult => {
      if (stimulus.answers.length > 0) return { response: { answer: null, reactionTimeMs: null } };
      const answers = answersOf(stimulus);
      if (answers.length > 0) {
        const answer = answers[Math.floor(uniform(0, answers.length))];
        const delayMs = answer.key === undefined ? (stimulus.buttonDelayMs ?? 0) : 0;
        return { response: { answer: answer.response, reactionTimeMs: Math.round(delayMs + uniform(300, 1500)) } };
      }
      if (stimulus.keys === true) {
        return { response: { answer: ' ', reactionTimeMs: Math.round(uniform(300, 1500)) } };
      }
      if (typeof stimulus.content === 'function') {
        throw new Error(
          "A Screen whose content answers through respond needs a simulator of its own, since the simulation cannot guess its answers. Give the trial one with .simulators({ respond: ({ participant }) => ({ response: { answer, reactionTimeMs } }) }).",
        );
      }
      return { response: { answer: null, reactionTimeMs: null } };
    },
  },
});
