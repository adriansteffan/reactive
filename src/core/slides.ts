import { advanceToNextContent, type Bytecode, compileTimeline } from './bytecode';
import type { ParticipantState } from './component';
import { freezeInDevelopment } from './development';
import type { Store } from './store';
import { type Block, report, type TimelineContext } from './timeline';

export type SlideSimulatorResult = {
  key: string | null;
  reactionTimeMs: number | null;
  /** Without it, the participant stays as it was. */
  participantState?: ParticipantState;
};

export type SlideSimulator = (input: { slide: Slide; participant: ParticipantState }) => SlideSimulatorResult;

/** One screen of a CanvasBlock. */
export interface Slide {
  /** Draws the slide on a canvas cleared to white, with black as the fill color unless the block's `styleCanvas` sets another. */
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
  /** How long the drawing stays visible. */
  displayDurationMs?: number;
  /** How long after the slide appears a key counts as a response. */
  responseTimeLimitMs?: number;
  /** The keys that count as a response, or `true` for any key. */
  allowedResponseKeys?: string[] | boolean;
  /** Whether the first response ends the slide. Defaults to `true`. */
  endSlideOnResponse?: boolean;
  /** Clears the drawing at the first response. */
  hideOnResponse?: boolean;
  /** Records no row for the slide. */
  ignoreData?: boolean;
  /** Extra values for the slide's row, as `meta_` columns in the CSV. */
  metadata?: Record<string, any>;
  /** Decides the simulated response to this slide, instead of the block's `respondToSlide` simulator. */
  simulate?: SlideSimulator;
}

/** Makes a slide when it starts, from the context: the experiment's trials and the block's slides so far. */
export type SlideFunction = (context: TimelineContext) => Slide;

/** A list of slides and blocks, nested and with `false`, `null` and `undefined` skipped like a timeline. */
export type SlideTimeline = readonly SlideEntry[];
export type SlideEntry = Slide | SlideFunction | Block | SlideTimeline | false | null | undefined;

/** The row a slide records. */
export interface SlideData {
  /** The order in which the participant saw the slide, from 1, counting the slides that record no row. */
  slideNumber: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  key: string | null;
  reactionTimeMs: number | null;
  /** Set with the slide's `metadata`. */
  metadata?: Record<string, any>;
}

export type CompiledSlides = Bytecode<Slide | SlideFunction, TimelineContext>;

export function compileSlides(timeline: SlideTimeline): CompiledSlides {
  return compileTimeline(timeline, (item) => {
    if (typeof item === 'function' || typeof (item as Partial<Slide>)?.draw === 'function') {
      return item as Slide | SlideFunction;
    }
    throw new Error(
      `A CanvasBlock's timeline can only hold slides, functions that make them, blocks and lists of them, but it holds ${JSON.stringify(item) ?? String(item)}.`,
    );
  });
}

const takesKeys = (slide: Slide) =>
  slide.allowedResponseKeys === true || (Array.isArray(slide.allowedResponseKeys) && slide.allowedResponseKeys.length > 0);

/** Whether a key counts as a response to the slide. */
export function acceptsKey(slide: Slide, key: string): boolean {
  const keys = slide.allowedResponseKeys;
  return keys === true || (Array.isArray(keys) && keys.includes(key));
}

/**
 * How long after it appears the slide ends, unless a response ends it first. A slide that takes keys
 * waits for its response time limit, or else for its display duration; any other slide ends when
 * either runs out.
 */
export function slideTimeoutMs(slide: Slide): number {
  const display = slide.displayDurationMs ?? Number.POSITIVE_INFINITY;
  const limit = slide.responseTimeLimitMs ?? Number.POSITIVE_INFINITY;
  if (!takesKeys(slide)) return Math.min(display, limit);
  return limit !== Number.POSITIVE_INFINITY ? limit : display;
}

/** Where a CanvasBlock is: the slide on screen, made once when it started, and what the block has recorded. */
export interface SlideRun {
  /** The instruction of the slide on screen, or the length of the bytecode once the block is finished. */
  pointer: number;
  /** The slide on screen, or `undefined` once the block is finished. */
  slide: Slide | undefined;
  /** How many slides the participant has seen, counting the one on screen. */
  shown: number;
  slides: SlideData[];
  /** The store with the block's changes so far, which reach the experiment when the block ends. */
  store: Store;
}

// Runs control flow from `from` up to the next slide and makes it
function advance(
  compiled: CompiledSlides,
  context: TimelineContext,
  from: number,
  slides: SlideData[],
  fromStore: Store,
  shown: number,
): SlideRun {
  const contextFor = (store: Store): TimelineContext => ({ ...context, store, slides });
  const { pointer, store } = advanceToNextContent(compiled, from, fromStore, contextFor);
  const instruction = compiled.instructions[pointer];
  if (instruction?.type !== 'ExecuteContent') return { pointer, slide: undefined, shown, slides, store };

  const content = instruction.content;
  const slide = typeof content === 'function' ? content(contextFor(store)) : content;
  if (slideTimeoutMs(slide) === Number.POSITIVE_INFINITY && (!takesKeys(slide) || slide.endSlideOnResponse === false)) {
    report(
      'A slide in a CanvasBlock would never end. Give it a displayDurationMs, a responseTimeLimitMs, or allowedResponseKeys that end it.',
    );
  }
  return { pointer, slide, shown: shown + 1, slides, store };
}

/** Starts a CanvasBlock in the context of its trial: runs control flow up to the first slide. */
export function startSlides(compiled: CompiledSlides, context: TimelineContext): SlideRun {
  return advance(compiled, context, 0, freezeInDevelopment([]), context.store, 0);
}

/** Ends the slide on screen: records its row, unless it ignores data, and moves on to the next slide. */
export function endSlide(
  compiled: CompiledSlides,
  context: TimelineContext,
  run: SlideRun,
  result: { startMs: number; endMs: number; key: string | null; reactionTimeMs: number | null },
): SlideRun {
  const { slide } = run;
  if (!slide) return run;
  const row: SlideData = {
    slideNumber: run.shown,
    startMs: result.startMs,
    endMs: result.endMs,
    durationMs: result.endMs - result.startMs,
    key: result.key,
    reactionTimeMs: result.reactionTimeMs,
    ...(slide.metadata !== undefined ? { metadata: slide.metadata } : {}),
  };
  const slides = slide.ignoreData ? run.slides : freezeInDevelopment([...run.slides, row]);
  return advance(compiled, context, run.pointer + 1, slides, run.store, run.shown);
}
