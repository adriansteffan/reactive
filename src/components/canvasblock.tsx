import { useContext, useEffect, useRef } from 'react';
import { type BaseComponentProps, defineComponent } from '../core/component';
import { arrayFlattener } from '../core/files';
import {
  acceptsKey,
  compileSlides,
  endSlide,
  type Slide,
  type SlideData,
  type SlideSimulatorResult,
  type SlideTimeline,
  slideTimeoutMs,
  startSlides,
} from '../core/slides';
import { createTimelineContext } from '../core/timeline';
import { CompiledTimelineContext } from '../runner/contexts';
import { uniform } from '../utils/distributions';
import { isFullscreen } from '../utils/fullscreen';

type CanvasBlockProps = {
  /** The slides, with ifBlock, whileBlock and updateStore for control flow. */
  timeline: SlideTimeline;
  width?: number | string;
  height?: number | string;
  /** Sets colors and fonts before each slide is drawn. */
  styleCanvas?: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
  /** Runs once, after the canvas is set up. */
  initCanvas?: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
} & BaseComponentProps<SlideData[]>;

// The canvas's size in CSS pixels: a number is pixels, a percentage is of the viewport, and a ratio
// such as '16:9' sets one side from the other
function canvasSize(width: number | string | undefined, height: number | string | undefined) {
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

  return { width: Math.round(computedWidth), height: Math.round(computedHeight) };
}

function CanvasBlock({
  timeline,
  width,
  height,
  data,
  store,
  next,
  updateStore,
  styleCanvas,
  initCanvas,
}: CanvasBlockProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { trials } = useContext(CompiledTimelineContext);
  // The loop reads the latest callbacks through this ref, so new identities never restart the block
  const callbacks = useRef({ next, updateStore, styleCanvas, initCanvas });
  callbacks.current = { next, updateStore, styleCanvas, initCanvas };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const size = canvasSize(width, height);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    ctx.scale(dpr, dpr);

    // A mistake in drawing code leaves the canvas incomplete instead of stopping the experiment
    const paint = (drawing: ((ctx: CanvasRenderingContext2D, width: number, height: number) => void) | undefined) => {
      try {
        drawing?.(ctx, size.width, size.height);
      } catch (error) {
        console.error('Drawing on the canvas failed:', error);
      }
    };
    const clear = () => {
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, size.width, size.height);
    };
    paint(callbacks.current.initCanvas);

    const rate = store.__screenRefreshRate;
    const halfFrame = typeof rate === 'number' && rate >= 20 && rate <= 300 ? 500 / rate : 0;
    const compiled = compileSlides(timeline);
    const context = createTimelineContext(data, store, trials);
    let run = startSlides(compiled, context);

    // The slide on screen: the frame that drew it, the frame it appeared with, and its response
    let drawnAt = 0;
    let onset: number | undefined;
    let response: { key: string; reactionTimeMs: number } | undefined;
    let hidden = false;
    // Keys pressed since the last frame, which the next frame judges
    let pressed: { key: string; timeStamp: number }[] = [];
    let frameId = 0;

    // Draws the next slide, or ends the block once there is none
    const show = (timestamp: number) => {
      const { slide } = run;
      if (!slide) {
        callbacks.current.updateStore(run.store);
        callbacks.current.next(run.slides);
        return;
      }
      clear();
      ctx.fillStyle = 'black';
      paint(callbacks.current.styleCanvas);
      paint(slide.draw);
      drawnAt = timestamp;
      onset = undefined;
      response = undefined;
      hidden = false;
      frameId = requestAnimationFrame(frame);
    };

    const frame = (timestamp: number) => {
      const slide = run.slide as Slide;
      const timeoutMs = slideTimeoutMs(slide);
      // What a frame draws appears with the next frame
      onset ??= timestamp;
      for (const press of pressed) {
        // Key events are timestamped on the frames' clock; a key pressed before the slide appeared does not count
        const reactionTimeMs = press.timeStamp - onset;
        if (response || reactionTimeMs < 0 || reactionTimeMs >= timeoutMs || !acceptsKey(slide, press.key)) continue;
        response = { key: press.key, reactionTimeMs: Math.round(reactionTimeMs) };
        if (slide.hideOnResponse) {
          clear();
          hidden = true;
        }
      }
      pressed = [];

      // Half a frame more ends the slide on the frame nearest its time
      const elapsed = timestamp - drawnAt + halfFrame;
      if ((response && slide.endSlideOnResponse !== false) || elapsed >= timeoutMs) {
        run = endSlide(compiled, context, run, {
          startMs: Math.round(onset),
          // It disappears with the next frame, as long after this one as it appeared after the frame that drew it
          endMs: Math.round(timestamp + onset - drawnAt),
          key: response?.key ?? null,
          reactionTimeMs: response?.reactionTimeMs ?? null,
        });
        show(timestamp);
        return;
      }
      if (!hidden && elapsed >= (slide.displayDurationMs ?? Number.POSITIVE_INFINITY)) {
        clear();
        hidden = true;
      }
      frameId = requestAnimationFrame(frame);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      // A held key repeats, which is not another response
      if (!event.repeat) pressed.push({ key: event.key, timeStamp: event.timeStamp });
    };
    window.addEventListener('keydown', onKeyDown);
    frameId = requestAnimationFrame(show);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      cancelAnimationFrame(frameId);
    };
  }, [timeline, width, height, data, store, trials]);

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <canvas ref={canvasRef} />
    </div>
  );
}

export default defineComponent({
  name: 'CanvasBlock',
  component: CanvasBlock,
  csv: 'canvas',
  // Every slide's row has metadata, if only empty, so the block's own always goes to slideblock_meta_ columns
  flatten: (item) => arrayFlattener(item).map((row) => ({ metadata: {}, ...row })),
  simulate: ({ props, simulators, participant, data, store, get, getOptional }) => {
    const compiled = compileSlides(props.timeline);
    const context = { data, store, get, getOptional, slides: [] };
    let run = startSlides(compiled, context);
    let time = 0;

    while (run.slide) {
      const slide = run.slide;
      const result = slide.simulate
        ? slide.simulate({ slide, participant })
        : simulators.respondToSlide({ props, participant, slide });
      participant = result.participantState ?? participant;

      // The same rules as in the browser: a key counts within the slide's time, and ends it unless the slide says otherwise
      const timeoutMs = slideTimeoutMs(slide);
      const { key, reactionTimeMs } = result;
      const response =
        key !== null && reactionTimeMs !== null && reactionTimeMs < timeoutMs && acceptsKey(slide, key)
          ? { key, reactionTimeMs }
          : undefined;
      const durationMs = response && slide.endSlideOnResponse !== false ? response.reactionTimeMs : timeoutMs;
      if (durationMs === Number.POSITIVE_INFINITY) {
        throw new Error('A simulated participant gave no response to a slide that only a response ends.');
      }

      run = endSlide(compiled, context, run, {
        startMs: time,
        endMs: time + durationMs,
        key: response?.key ?? null,
        reactionTimeMs: response?.reactionTimeMs ?? null,
      });
      time += durationMs;
    }

    return { responseData: run.slides, participantState: participant, storeUpdates: run.store, durationMs: time };
  },
  defaultSimulators: {
    respondToSlide: ({ slide }): SlideSimulatorResult => {
      const keys = (slide as Slide).allowedResponseKeys;
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
export function canvasCountdown(seconds: number): Slide[] {
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
