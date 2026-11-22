import { advanceToNextContent, type Bytecode, compileTimeline } from './bytecode';
import type { ParticipantState } from './component';
import { freezeInDevelopment, report } from './development';
import type { Store } from './store';
import type { ResponseKey } from '../utils/keys';
import type { Block, TimelineContext } from './timeline';

export type SlideSimulatorResult = {
  /** The key pressed, or on a slide that takes clicks the point clicked, and when; nulls for no response. */
  value: { key?: string | null; x?: number; y?: number; reactionTimeMs: number | null };
  /** Without it, the participant stays as it was. */
  participant?: ParticipantState;
};

/** A response a slide records by its name, given by its key. */
export type SlideChoice = { key: ResponseKey };

interface SlideResponseFields {
  /** The keys that count as a response, letters in either case, or `true` for any key. */
  keys?: readonly ResponseKey[] | true;
  /** Responses recorded by their names, each given by its key, such as keys counterbalanced across participants. */
  choices?: Record<string, SlideChoice>;
  /** Takes a click on the canvas as a response, recorded as its `x` and `y` in the coordinates `draw` uses. */
  click?: boolean;
  /** How long after the slide appears a key counts as a response. The slide ends then, if no response has ended it. */
  timeLimitMs?: number;
  /** Whether the first response ends the slide. Defaults to `true`. */
  endsSlide?: boolean;
  /** Clears the drawing at the first response. */
  hidesDrawing?: boolean;
}

/** What a slide takes as a response, keys, choices or a click, and what the first response does. */
export type SlideResponse = SlideResponseFields &
  ({ keys: readonly ResponseKey[] | true } | { choices: Record<string, SlideChoice> } | { click: true });

interface SlideFields {
  /** Draws the slide on a canvas cleared to white, with black as the fill color unless the block's `styleCanvas` sets another. */
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
  /** How long the drawing stays visible. Unless the response has a time limit, the slide ends then. */
  displayDurationMs?: number;
  response?: SlideResponse;
  /** Records no row for the slide. */
  ignoreData?: boolean;
  /** Extra values for the slide's row, as `meta_` columns in the CSV. */
  metadata?: Record<string, any>;
}

/**
 * One screen of a CanvasBlock. It ends at the first response, unless `endsSlide` is `false`. If no
 * response ends it, it ends when the response's time limit runs out, or, without one, when the display
 * duration does. The types require one of these ways to end.
 */
export type Slide = SlideFields &
  (
    | { displayDurationMs: number }
    | { response: SlideResponse & ({ timeLimitMs: number } | { endsSlide?: true }) }
  );

/** Makes a slide when it starts, from the context: the experiment's trials and the block's slides so far. */
export type SlideFunction = (context: TimelineContext) => Slide;

/** A list of slides and blocks, nested and with `false`, `null` and `undefined` skipped like a timeline. */
export type SlideTimeline = readonly SlideEntry[];
export type SlideEntry = Slide | SlideFunction | Block<'slides'> | SlideTimeline | false | null | undefined;

/** The row a slide records. */
export interface SlideData {
  /** The order in which the participant saw the slide, from 1, counting the slides that record no row. */
  slideNumber: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  /** On a slide with choices: the name of the choice the response gave. */
  response?: string | null;
  key: string | null;
  /** On a slide that takes clicks: where the click landed, in the coordinates `draw` uses. */
  x?: number | null;
  y?: number | null;
  reactionTimeMs: number | null;
  /** Set with the slide's `metadata`. */
  metadata?: Record<string, any>;
}

export type CompiledSlides = Bytecode<Slide | SlideFunction>;

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

const takesResponse = ({ response }: Slide) =>
  response !== undefined &&
  (response.keys === true ||
    (response.keys?.length ?? 0) > 0 ||
    Object.keys(response.choices ?? {}).length > 0 ||
    response.click === true);

/** How long after it appears the slide ends, unless a response ends it first. */
export function slideTimeoutMs(slide: Slide): number {
  return slide.response?.timeLimitMs ?? slide.displayDurationMs ?? Number.POSITIVE_INFINITY;
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
  if (slideTimeoutMs(slide) === Number.POSITIVE_INFINITY && (!takesResponse(slide) || slide.response?.endsSlide === false)) {
    report(
      'A slide in a CanvasBlock would never end. Give it a displayDurationMs, or a response with a timeLimitMs or with keys, choices or a click that end the slide.',
    );
  }
  return { pointer, slide, shown: shown + 1, slides, store };
}

/** Starts a CanvasBlock in the context of its trial: runs control flow up to the first slide. */
export function startSlides(compiled: CompiledSlides, context: TimelineContext): SlideRun {
  return advance(compiled, context, 0, freezeInDevelopment([]), context.store, 0);
}

/** A slide's response: the choice and the key that gave it, or the point clicked, and when. */
export type SlideAnswer = { response?: string; key?: string; x?: number; y?: number; reactionTimeMs: number };

/** Ends the slide on screen: records its row, unless it ignores data, and moves on to the next slide. */
export function endSlide(
  compiled: CompiledSlides,
  context: TimelineContext,
  run: SlideRun,
  result: { startMs: number; endMs: number; answer: SlideAnswer | undefined },
): SlideRun {
  const { slide } = run;
  if (!slide) return run;
  const { answer } = result;
  const row: SlideData = {
    slideNumber: run.shown,
    startMs: result.startMs,
    endMs: result.endMs,
    durationMs: result.endMs - result.startMs,
    ...(slide.response?.choices ? { response: answer?.response ?? null } : {}),
    key: answer?.key ?? null,
    ...(slide.response?.click ? { x: answer?.x ?? null, y: answer?.y ?? null } : {}),
    reactionTimeMs: answer?.reactionTimeMs ?? null,
    ...(slide.metadata !== undefined ? { metadata: slide.metadata } : {}),
  };
  const slides = slide.ignoreData ? run.slides : freezeInDevelopment([...run.slides, row]);
  return advance(compiled, context, run.pointer + 1, slides, run.store, run.shown);
}
