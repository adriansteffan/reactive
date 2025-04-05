/* eslint-disable @typescript-eslint/no-explicit-any */

import { useRef, useEffect, useMemo, useCallback } from 'react';

import {
  compileTimeline,
  TimelineItem,
  UnifiedBytecodeInstruction,
  ExecuteContentInstruction,
  Store,
  RefinedTrialData,
  CanvasResultData,
} from '../utils/bytecode';
import { BaseComponentProps, isFullscreen, now } from '../utils/common';

interface CanvasSlide {
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
  displayDuration?: number;
  responseTimeLimit?: number;
  endSlideOnResponse?: boolean;
  hideOnResponse?: boolean;
  ignoreData?: boolean;
  allowedKeys?: string[] | boolean;
  metadata?: Record<string, any>;
  nestMetadata?: boolean;
}

type DynamicCanvasSlideGenerator = (data: RefinedTrialData[], store: Store) => CanvasSlide;

function isDynamicCanvasSlideGenerator(content: any): content is DynamicCanvasSlideGenerator {
  return typeof content === 'function';
}

function isCanvasSlide(content: any): content is CanvasSlide {
  return typeof content === 'object' && content !== null && typeof content.draw === 'function';
}

type CanvasBlockProps = {
  timeline: TimelineItem[];
  width?: number | string;
  height?: number | string;
  styleCanvas?: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
  initCanvas?: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
} & BaseComponentProps;

export default function CanvasBlock({
  next,
  updateStore,
  timeline,
  width,
  height,
  store,
  styleCanvas,
  initCanvas,
}: CanvasBlockProps) {
  const { instructions, markers } = useMemo(() => compileTimeline(timeline), [timeline]);

  const instructionPointerRef = useRef(0);
  const slideStartTimeRef = useRef<number>(0);
  const isDrawingVisibleRef = useRef<boolean>(true);
  const responseRegisteredRef = useRef<null | Record<string, any>>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dataRef = useRef<RefinedTrialData[]>([]);
  const storeRef = useRef<Store>(store ?? {});
  const animationFrameRef = useRef<number | null>(null);
  const contentInstructionsCompletedRef = useRef(0);

  const frameIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    const refreshRate = storeRef.current._reactiveScreenRefreshRate;
    const isValidRefreshRate =
      typeof refreshRate === 'number' && refreshRate >= 20 && refreshRate <= 300;

    frameIntervalRef.current = isValidRefreshRate ? 1000 / refreshRate : null;
  }, [store]);

  const resolveSlideContent = useCallback(
    (instruction: UnifiedBytecodeInstruction): CanvasSlide | null => {
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

  // Forward declare handleSlideEnd for tick
  let handleSlideEnd: () => void;

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

    const displayDuration = currentSlide.displayDuration ?? Infinity;
    const responseTimeLimit = currentSlide.responseTimeLimit ?? Infinity;
    const allowedKeys = currentSlide.allowedKeys ?? false;
    const noKeysAllowed =
      allowedKeys === false || (Array.isArray(allowedKeys) && allowedKeys.length === 0);
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
      handleSlideEnd();
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
    let foundContentToExecute = false;
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;

    while (!foundContentToExecute && instructionPointerRef.current < instructions.length) {
      const currentInstruction = instructions[instructionPointerRef.current];

      switch (currentInstruction.type) {
        case 'IfGoto':
          if (currentInstruction.cond(storeRef.current, dataRef.current)) {
            const markerIndex = markers[currentInstruction.marker];
            if (markerIndex !== undefined) {
              instructionPointerRef.current = markerIndex;
            } else {
              console.error(`Marker ${currentInstruction.marker} not found`);
              instructionPointerRef.current++;
            }
          } else {
            instructionPointerRef.current++;
          }
          continue;

        case 'UpdateStore': {
          storeRef.current = {
            ...storeRef.current,
            ...currentInstruction.fun(storeRef.current, dataRef.current),
          };
          instructionPointerRef.current++;
          continue;
        }
        case 'ExecuteContent': {
          foundContentToExecute = true;
          if (canvasRef.current) {
            const currentSlide = resolveSlideContent(currentInstruction);
            if (currentSlide) {
              drawSlideInternal(currentSlide);
              const displayDuration = currentSlide.displayDuration ?? Infinity;
              const responseTimeLimit = currentSlide.responseTimeLimit ?? Infinity;
              if (displayDuration !== Infinity || responseTimeLimit !== Infinity) {
                animationFrameRef.current = requestAnimationFrame(tick);
              }
            } else {
              console.error(
                'Failed to resolve slide content during control flow:',
                currentInstruction,
              );
              instructionPointerRef.current++;
              foundContentToExecute = false;
              continue;
            }
          } else {
            console.error('Canvas element not found during control flow.');
            return;
          }
          break;
        }
        default:
          console.warn('Unknown instruction type during control flow:', currentInstruction);
          instructionPointerRef.current++;
          continue;
      }
    }

    if (!foundContentToExecute && instructionPointerRef.current >= instructions.length) {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
      updateStore(storeRef.current);
      next(dataRef.current);
    }
  }, [instructions, markers, resolveSlideContent, drawSlideInternal, tick, next]);

  handleSlideEnd = useCallback(() => {
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
    const instruction = instructions[currentPointer] as ExecuteContentInstruction;
    const slide = resolveSlideContent(instruction);

    if (slide && !slide.ignoreData) {
      let trialData = {
        index: instructionPointerRef.current,
        trialNumber: contentInstructionsCompletedRef.current - 1,
        start: slideStartTimeRef.current,
        end: endTime,
        duration: endTime - slideStartTimeRef.current,
        key: responseData ? responseData.key : null,
        reactionTime: responseData ? responseData.reactionTime : null,
      } as CanvasResultData;

      if (slide.nestMetadata) {
        trialData = { ...trialData, metadata: slide.metadata };
      } else trialData = { ...slide.metadata, ...trialData };

      dataRef.current.push(trialData);
    }

    instructionPointerRef.current++;
    responseRegisteredRef.current = null;
    processControlFlow();
  }, [instructions, resolveSlideContent, processControlFlow]);

  const handleKeyPress = useCallback(
    (event: KeyboardEvent) => {
      const keypressTime = now();
      const currentPointer = instructionPointerRef.current;
      if (currentPointer >= instructions.length || !isDrawingVisibleRef.current) return;
      const instruction = instructions[currentPointer];
      if (instruction.type !== 'ExecuteContent') return;
      const currentSlide = resolveSlideContent(instruction);
      if (!currentSlide) return;

      const responseTimeLimit = currentSlide.responseTimeLimit ?? Infinity;
      const isWithinTimeLimit = keypressTime - slideStartTimeRef.current < responseTimeLimit;
      const allowedKeys = currentSlide.allowedKeys ?? false;
      const isKeyAllowed =
        allowedKeys === true || (Array.isArray(allowedKeys) && allowedKeys.includes(event.key));

      if (isKeyAllowed && isWithinTimeLimit) {
        const endSlideOnResponse = currentSlide.endSlideOnResponse ?? true;
        const hideOnResponse = currentSlide.hideOnResponse ?? false;
        const ignoreData = currentSlide.ignoreData ?? false;
        if (!responseRegisteredRef.current || !endSlideOnResponse) {
          if (!responseRegisteredRef.current && !ignoreData) {
            responseRegisteredRef.current = {
              key: event.key,
              time: keypressTime,
              reactionTime: keypressTime - slideStartTimeRef.current,
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
        if (!isNaN(p)) {
          return (vpDim * p) / 100;
        }
      }
      return null;
    };
    let initialWidthPx = parseNonRatioDimension(width, vpWidth);
    let initialHeightPx = parseNonRatioDimension(height, vpHeight);
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
      } catch (e) {
        console.error('Invalid width ratio string:', width);
      }
    } else if (isHeightRatio && !isWidthRatio) {
      try {
        const m = (height as string).match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
        if (m) {
          computedHeight = (computedWidth / parseFloat(m[1])) * parseFloat(m[2]);
        }
      } catch (e) {
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
  }, [timeline, width, height, handleKeyPress, processControlFlow]);

  return (
    <div
      style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}
