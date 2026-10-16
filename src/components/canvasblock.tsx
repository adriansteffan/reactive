import { useRef, useEffect, useMemo, useCallback } from 'react';
import {
  advanceToNextContent,
  BLOCK,
  type BlockSpec,
  compileTimeline,
  type ExecuteContentInstruction,
  type Instruction,
} from '../core/bytecode';
import { type BaseComponentProps, defineComponent, type ParticipantState } from '../core/component';
import { arrayFlattener } from '../core/files';
import { applyMetadata } from '../core/rows';
import type { Store } from '../core/store';
import { uniform } from '../utils/distributions';
import { isFullscreen } from '../utils/fullscreen';
import { now } from '../utils/time';

/** One recorded slide: the key pressed, if any, and its timing. */
export type CanvasResultData = {
  index: number;
  trialNumber: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  key: string | null;
  reactionTimeMs: number | null;
  metadata?: Record<string, any>;
};

export type SlideSimulatorResult = {
  key: string | null;
  reactionTimeMs: number | null;
  /** Without it, the participant stays as it was. */
  participantState?: ParticipantState;
};

export type SlideSimulator = (input: {
  slide: Record<string, any>;
  participant: ParticipantState;
}) => SlideSimulatorResult;

interface CanvasSlide {
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
  displayDurationMs?: number;
  responseTimeLimitMs?: number;
  endSlideOnResponse?: boolean;
  hideOnResponse?: boolean;
  ignoreData?: boolean;
  allowedResponseKeys?: string[] | boolean;
  metadata?:
    | Record<string, any>
    | ((data?: CanvasResultData[], store?: Store) => Record<string, any>);
  nestMetadata?: boolean;
  simulate?: SlideSimulator;
}

type DynamicCanvasSlideGenerator = (data: CanvasResultData[], store: Store) => CanvasSlide;

type Condition = (data: CanvasResultData[], store: Store) => boolean;

/** CanvasBlock's own timeline: slides, plus control flow written as objects with `(data, store)` callbacks. */
export type CanvasTimelineItem =
  | CanvasSlide
  | DynamicCanvasSlideGenerator
  | { type: 'IF_BLOCK'; cond: Condition; timeline: CanvasTimelineItem[] }
  | { type: 'WHILE_BLOCK'; cond: Condition; timeline: CanvasTimelineItem[] }
  | { type: 'UPDATE_STORE'; fun: (data: CanvasResultData[], store: Store) => Record<string, any> }
  | { type: 'MARKER'; id: string }
  | { type: 'IF_GOTO'; cond: Condition; marker: string };

type CanvasCtx = { data: CanvasResultData[]; store: Store };

const block = (spec: BlockSpec<CanvasCtx>) => ({ [BLOCK]: spec });

// Translates the control-flow objects into the blocks the shared compiler understands
function toBlocks(items: CanvasTimelineItem[]): unknown[] {
  return items.map((item) => {
    if (typeof item !== 'object' || !('type' in item)) return item;
    const when = (cond: Condition) => ({ data, store }: CanvasCtx) => cond(data, store);
    switch (item.type) {
      case 'IF_BLOCK':
        return block({ kind: 'if', cond: when(item.cond), items: toBlocks(item.timeline) });
      case 'WHILE_BLOCK':
        return block({ kind: 'while', cond: when(item.cond), body: toBlocks(item.timeline) });
      case 'UPDATE_STORE':
        return block({ kind: 'updateStore', update: ({ data, store }: CanvasCtx) => item.fun(data, store) });
      case 'MARKER':
        return block({ kind: 'marker', id: item.id });
      case 'IF_GOTO':
        return block({ kind: 'ifGoto', cond: when(item.cond), marker: item.marker });
      default:
        return item;
    }
  });
}

// What a slide instruction holds: a slide, or a function that makes one from the data so far
type SlideContent = CanvasSlide | DynamicCanvasSlideGenerator;

const compileCanvasTimeline = (timeline: CanvasTimelineItem[]) =>
  compileTimeline<SlideContent, CanvasCtx>(toBlocks(timeline), (slide) => slide as SlideContent);

const slideMetadata = (slide: CanvasSlide, data: CanvasResultData[], store: Store) =>
  typeof slide.metadata === 'function' ? slide.metadata(data, store) : slide.metadata;

function isDynamicCanvasSlideGenerator(content: any): content is DynamicCanvasSlideGenerator {
  return typeof content === 'function';
}

function isCanvasSlide(content: any): content is CanvasSlide {
  return typeof content === 'object' && content !== null && typeof content.draw === 'function';
}

type CanvasBlockProps = {
  timeline: CanvasTimelineItem[];
  width?: number | string;
  height?: number | string;
  styleCanvas?: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
  initCanvas?: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
} & BaseComponentProps<CanvasResultData[]>;

function CanvasBlock({
  next,
  updateStore,
  timeline,
  width,
  height,
  store,
  styleCanvas,
  initCanvas,
}: CanvasBlockProps) {
  const { instructions, markers } = useMemo(() => compileCanvasTimeline(timeline), [timeline]);

  const instructionPointerRef = useRef(0);
  const slideStartTimeRef = useRef<number>(0);
  const isDrawingVisibleRef = useRef<boolean>(true);
  const responseRegisteredRef = useRef<null | Record<string, any>>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dataRef = useRef<CanvasResultData[]>([]);
  const storeRef = useRef<Store>(store ?? {});
  const animationFrameRef = useRef<number | null>(null);
  const contentInstructionsCompletedRef = useRef(0);

  const frameIntervalRef = useRef<number | null>(null);

  // Callbacks read the latest props through this ref, so new prop identities never restart the running slide
  const propsRef = useRef({ next, updateStore, styleCanvas, initCanvas });
  propsRef.current = { next, updateStore, styleCanvas, initCanvas };

  useEffect(() => {
    const refreshRate = store?.__screenRefreshRate;
    const isValidRefreshRate =
      typeof refreshRate === 'number' && refreshRate >= 20 && refreshRate <= 300;

    frameIntervalRef.current = isValidRefreshRate ? 1000 / refreshRate : null;
  }, [store]);

  const resolveSlideContent = useCallback(
    (instruction: Instruction<SlideContent, CanvasCtx>): CanvasSlide | null => {
      if (instruction.type !== 'ExecuteContent') return null;

      const content = instruction.content;
      if (isDynamicCanvasSlideGenerator(content)) {
        try {
          return content(dataRef.current, storeRef.current);
        } catch (e) {
          console.error('Error executing dynamic canvas slide generator:', e);
          return null;
        }
      } else if (isCanvasSlide(content)) {
        return content;
      }
      console.warn(
        'ExecuteContent instruction content is not a valid CanvasSlide or Generator:',
        content,
      );
      return null;
    },
    [],
  );

  const getCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return {};
    const ctx = canvas.getContext('2d');
    if (!ctx) return {};
    const dpr = window.devicePixelRatio || 1;
    const canvasWidth = canvas.width / dpr;
    const canvasHeight = canvas.height / dpr;
    return { ctx, canvasWidth, canvasHeight };
  }, []);

  const clearCanvas = useCallback(() => {
    const { ctx, canvasWidth, canvasHeight } = getCanvas();
    if (!ctx) return;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    isDrawingVisibleRef.current = false;
  }, [getCanvas]);

  const drawSlideInternal = useCallback(
    (slide: CanvasSlide) => {
      const { ctx, canvasWidth, canvasHeight } = getCanvas();
      if (!ctx) return;
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      const { styleCanvas } = propsRef.current;
      if (styleCanvas) {
        try {
          styleCanvas(ctx, canvasWidth, canvasHeight);
        } catch (e) {
          console.error('Error during styleCanvas function:', e);
        }
      } else {
        ctx.fillStyle = 'black';
      }

      try {
        slide.draw(ctx, canvasWidth, canvasHeight);
      } catch (e) {
        console.error('Error during slide draw function:', e);
      }
      slideStartTimeRef.current = now();
      isDrawingVisibleRef.current = true;
      responseRegisteredRef.current = null;
      contentInstructionsCompletedRef.current += 1;
    },
    [getCanvas],
  );

  // tick and handleSlideEnd depend on each other, so tick reaches handleSlideEnd through a ref
  const handleSlideEndRef = useRef<() => void>(() => {});

  const tick = useCallback(() => {
    const timeNow = now();
    const currentPointer = instructionPointerRef.current;
    if (currentPointer < 0 || currentPointer >= instructions.length) {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
      return;
    }
    const currentInstruction = instructions[currentPointer];
    const currentSlide = resolveSlideContent(currentInstruction);
    if (!currentSlide) {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
      return;
    }

    const displayDuration = currentSlide.displayDurationMs ?? Infinity;
    const responseTimeLimit = currentSlide.responseTimeLimitMs ?? Infinity;
    const allowedResponseKeys = currentSlide.allowedResponseKeys ?? false;
    const noKeysAllowed =
      allowedResponseKeys === false || (Array.isArray(allowedResponseKeys) && allowedResponseKeys.length === 0);
    let shouldEndSlide = false;

    // if we know the screen refresh rate, add half the frame interval to the elapsed time to get more accurate time checking
    const elapsedSlideTime =
      timeNow -
      slideStartTimeRef.current +
      (frameIntervalRef.current !== null ? frameIntervalRef.current * 0.5 : 0);

    if (
      isDrawingVisibleRef.current &&
      displayDuration !== Infinity &&
      elapsedSlideTime >= displayDuration
    ) {
      clearCanvas();
      if (noKeysAllowed || responseTimeLimit === Infinity) {
        shouldEndSlide = true;
      }
    }

    if (
      !shouldEndSlide &&
      responseTimeLimit !== Infinity &&
      elapsedSlideTime >= responseTimeLimit
    ) {
      shouldEndSlide = true;

      if (
        isDrawingVisibleRef.current &&
        displayDuration !== Infinity &&
        elapsedSlideTime < displayDuration
      ) {
        clearCanvas();
      }
    }

    if (shouldEndSlide) {
      handleSlideEndRef.current();
    } else {
      if (
        (isDrawingVisibleRef.current &&
          displayDuration !== Infinity &&
          elapsedSlideTime < displayDuration) ||
        (responseTimeLimit !== Infinity && elapsedSlideTime < responseTimeLimit)
      ) {
        animationFrameRef.current = requestAnimationFrame(tick);
      } else {
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    }
  }, [instructions, resolveSlideContent, clearCanvas]);

  const processControlFlow = useCallback(() => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;

    const pointer = advanceToNextContent(
      { instructions, markers },
      instructionPointerRef.current,
      () => ({ data: dataRef.current, store: storeRef.current }),
      (updates) => {
        storeRef.current = { ...storeRef.current, ...updates };
      },
    );
    instructionPointerRef.current = pointer;

    if (pointer >= instructions.length) {
      propsRef.current.updateStore(storeRef.current);
      propsRef.current.next(dataRef.current);
      return;
    }

    if (!canvasRef.current) {
      console.error('Canvas element not found during control flow.');
      return;
    }

    const currentSlide = resolveSlideContent(instructions[pointer]);
    if (currentSlide) {
      drawSlideInternal(currentSlide);
      const displayDuration = currentSlide.displayDurationMs ?? Infinity;
      const responseTimeLimit = currentSlide.responseTimeLimitMs ?? Infinity;
      if (displayDuration !== Infinity || responseTimeLimit !== Infinity) {
        animationFrameRef.current = requestAnimationFrame(tick);
      }
    } else {
      console.error('Failed to resolve slide content during control flow:', instructions[pointer]);
      instructionPointerRef.current++;
      processControlFlow();
    }
  }, [instructions, markers, resolveSlideContent, drawSlideInternal, tick]);

  const handleSlideEnd = useCallback(() => {
    const responseData = responseRegisteredRef.current;
    const endTime = now();
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
    const currentPointer = instructionPointerRef.current;
    if (
      currentPointer >= instructions.length ||
      instructions[currentPointer].type !== 'ExecuteContent'
    ) {
      instructionPointerRef.current++;
      processControlFlow();
      return;
    }
    const instruction = instructions[currentPointer] as ExecuteContentInstruction<SlideContent>;
    const slide = resolveSlideContent(instruction);

    if (slide && !slide.ignoreData) {
      let trialData = {
        index: instructionPointerRef.current,
        trialNumber: contentInstructionsCompletedRef.current - 1,
        startMs: slideStartTimeRef.current,
        endMs: endTime,
        durationMs: endTime - slideStartTimeRef.current,
        key: responseData ? responseData.key : null,
        reactionTimeMs: responseData ? responseData.reactionTimeMs : null,
      } as CanvasResultData;

      trialData = applyMetadata(
        trialData,
        slideMetadata(slide, dataRef.current, storeRef.current),
        slide.nestMetadata,
      );

      dataRef.current.push(trialData);
    }

    instructionPointerRef.current++;
    responseRegisteredRef.current = null;
    processControlFlow();
  }, [instructions, resolveSlideContent, processControlFlow]);
  handleSlideEndRef.current = handleSlideEnd;

  const handleKeyPress = useCallback(
    (event: KeyboardEvent) => {
      const keypressTime = now();
      const currentPointer = instructionPointerRef.current;
      if (currentPointer >= instructions.length || !isDrawingVisibleRef.current) return;
      const instruction = instructions[currentPointer];
      if (instruction.type !== 'ExecuteContent') return;
      const currentSlide = resolveSlideContent(instruction);
      if (!currentSlide) return;

      const responseTimeLimit = currentSlide.responseTimeLimitMs ?? Infinity;
      const isWithinTimeLimit = keypressTime - slideStartTimeRef.current < responseTimeLimit;
      const allowedResponseKeys = currentSlide.allowedResponseKeys ?? false;
      const isKeyAllowed =
        allowedResponseKeys === true || (Array.isArray(allowedResponseKeys) && allowedResponseKeys.includes(event.key));

      if (isKeyAllowed && isWithinTimeLimit) {
        const endSlideOnResponse = currentSlide.endSlideOnResponse ?? true;
        const hideOnResponse = currentSlide.hideOnResponse ?? false;
        const ignoreData = currentSlide.ignoreData ?? false;
        if (!responseRegisteredRef.current || !endSlideOnResponse) {
          if (!responseRegisteredRef.current && !ignoreData) {
            responseRegisteredRef.current = {
              key: event.key,
              reactionTimeMs: keypressTime - slideStartTimeRef.current,
            };
          }

          if (hideOnResponse) clearCanvas();
          if (endSlideOnResponse) handleSlideEnd();
        }
      }
    },
    [instructions, resolveSlideContent, handleSlideEnd, clearCanvas],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const vpWidth = isFullscreen() ? window.screen.width : window.innerWidth;
    const vpHeight = isFullscreen() ? window.screen.height : window.innerHeight;
    let computedWidth: number;
    let computedHeight: number;
    const parseNonRatioDimension = (
      dim: number | string | undefined,
      vpDim: number,
    ): number | null => {
      if (typeof dim === 'number') {
        return dim;
      }
      if (typeof dim === 'string' && dim.includes('%')) {
        const p = parseFloat(dim);
        if (!Number.isNaN(p)) {
          return (vpDim * p) / 100;
        }
      }
      return null;
    };
    const initialWidthPx = parseNonRatioDimension(width, vpWidth);
    const initialHeightPx = parseNonRatioDimension(height, vpHeight);
    const isWidthRatio = typeof width === 'string' && /^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(width);
    const isHeightRatio =
      typeof height === 'string' && /^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(height);
    if (initialWidthPx !== null && initialHeightPx !== null) {
      computedWidth = initialWidthPx;
      computedHeight = initialHeightPx;
    } else if (initialWidthPx !== null && initialHeightPx === null && !isHeightRatio) {
      computedWidth = initialWidthPx;
      computedHeight = initialWidthPx;
    } else if (initialHeightPx !== null && initialWidthPx === null && !isWidthRatio) {
      computedHeight = initialHeightPx;
      computedWidth = initialHeightPx;
    } else if (
      initialWidthPx === null &&
      initialHeightPx === null &&
      !isWidthRatio &&
      !isHeightRatio
    ) {
      const s = Math.min(vpWidth, vpHeight);
      computedWidth = s;
      computedHeight = s;
    } else {
      let baseW = initialWidthPx;
      let baseH = initialHeightPx;
      if (isHeightRatio && baseW === null) {
        baseW = baseH ?? vpHeight;
      }
      if (isWidthRatio && baseH === null) {
        baseH = baseW ?? vpWidth;
      }
      if (baseW === null && baseH === null) {
        const s = Math.min(vpWidth, vpHeight);
        baseW = s;
        baseH = s;
      } else if (baseW === null) {
        baseW = baseH!;
      } else if (baseH === null) {
        baseH = baseW!;
      }
      computedWidth = baseW;
      computedHeight = baseH ?? 0;
    }
    if (isWidthRatio && !isHeightRatio) {
      try {
        const m = (width as string).match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
        if (m) {
          computedWidth = (computedHeight / parseFloat(m[2])) * parseFloat(m[1]);
        }
      } catch {
        console.error('Invalid width ratio string:', width);
      }
    } else if (isHeightRatio && !isWidthRatio) {
      try {
        const m = (height as string).match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
        if (m) {
          computedHeight = (computedWidth / parseFloat(m[1])) * parseFloat(m[2]);
        }
      } catch {
        console.error('Invalid height ratio string:', height);
      }
    } else if (isWidthRatio && isHeightRatio) {
      console.warn(`Both width (${width}) and height (${height}) are ratios. Prioritizing width.`);
      try {
        const mW = (width as string).match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
        if (mW) {
          computedWidth = (vpHeight / parseFloat(mW[2])) * parseFloat(mW[1]);
          const mH = (height as string).match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
          if (mH) {
            computedHeight = (computedWidth / parseFloat(mH[1])) * parseFloat(mH[2]);
          } else {
            computedHeight = computedWidth;
          }
        } else {
          const s = Math.min(vpWidth, vpHeight);
          computedWidth = s;
          computedHeight = s;
        }
      } catch (e) {
        console.error('Error parsing ratios:', e);
        const s = Math.min(vpWidth, vpHeight);
        computedWidth = s;
        computedHeight = s;
      }
    }
    const dpr = window.devicePixelRatio || 1;
    const finalWidth = Math.round(computedWidth);
    const finalHeight = Math.round(computedHeight);
    canvas.width = Math.round(finalWidth * dpr);
    canvas.height = Math.round(finalHeight * dpr);
    canvas.style.width = finalWidth + 'px';
    canvas.style.height = finalHeight + 'px';
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
    }

    const { initCanvas } = propsRef.current;
    if (initCanvas && ctx) {
      try {
        initCanvas(ctx, finalWidth, finalHeight);
      } catch (e) {
        console.error('Error during canvas initialization:', e);
      }
    }

    window.addEventListener('keydown', handleKeyPress);
    processControlFlow();
    return () => {
      window.removeEventListener('keydown', handleKeyPress);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [width, height, handleKeyPress, processControlFlow]);

  return (
    <div
      style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}

export default defineComponent({
  name: 'CanvasBlock',
  component: CanvasBlock,
  csv: 'canvas',
  flatten: arrayFlattener,
  simulate: ({ props, store, simulators, participant }) => {
    const timeline = props.timeline;
    if (!timeline) return { responseData: [] };

    const bytecode = compileCanvasTimeline(timeline);
    const innerData: CanvasResultData[] = [];
    let innerStore: Store = { ...store };
    let currentTime = 0;
    let slideNumber = 0;

    const getContext = () => ({ data: innerData, store: innerStore });
    const applyStoreUpdates = (updates: Record<string, any>) => {
      innerStore = { ...innerStore, ...updates };
    };

    let pointer = advanceToNextContent(bytecode, 0, getContext, applyStoreUpdates);

    while (pointer < bytecode.instructions.length) {
      const content = (bytecode.instructions[pointer] as ExecuteContentInstruction<SlideContent>).content;
      const slide = typeof content === 'function' ? content(innerData, innerStore) : content;

      const result = slide.simulate
        ? slide.simulate({ slide, participant })
        : simulators.respondToSlide({ props, participant, slide });
      participant = result.participantState ?? participant;

      if (!slide.ignoreData) {
        const duration = slide.displayDurationMs || result.reactionTimeMs || 1000;

        let td: CanvasResultData = {
          index: pointer,
          trialNumber: slideNumber,
          startMs: currentTime,
          endMs: currentTime + duration,
          durationMs: duration,
          key: result.key,
          reactionTimeMs: result.reactionTimeMs,
        };

        td = applyMetadata(td, slideMetadata(slide, innerData, innerStore), slide.nestMetadata);

        innerData.push(td);
        currentTime += duration;
      }

      slideNumber++;
      pointer = advanceToNextContent(bytecode, pointer + 1, getContext, applyStoreUpdates);
    }

    return { responseData: innerData, participantState: participant, storeUpdates: innerStore, durationMs: currentTime };
  },
  defaultSimulators: {
    respondToSlide: ({ slide }): SlideSimulatorResult => {
      const keys = (slide as CanvasSlide).allowedResponseKeys;
      if (keys === true) {
        return { key: ' ', reactionTimeMs: uniform(200, 800) };
      }
      if (Array.isArray(keys) && keys.length > 0) {
        return { key: keys[Math.floor(uniform(0, keys.length))], reactionTimeMs: uniform(200, 800) };
      }
      return { key: null, reactionTimeMs: null };
    },
  },
});

/** Slides that count down from `seconds`, one second each, recording nothing. */
export function canvasCountdown(seconds: number): CanvasSlide[] {
  if (seconds <= 0) {
    return [];
  }
  return Array.from({ length: seconds }, (_, i) => {
    const number = seconds - i;

    return {
      draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => {
        ctx.save();

        ctx.fillStyle = 'black';
        ctx.font = `bold ${Math.min(w, h) * 0.02 * 2}px sans-serif`; // Make countdown text larger
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(number.toString(), w / 2, h / 2);

        ctx.restore();
      },
      displayDurationMs: 1000,
      ignoreData: true,
    };
  });
}
