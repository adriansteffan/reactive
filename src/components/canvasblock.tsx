import { useEffect, useRef } from 'react';
import { type BaseComponentProps, defineComponent } from '../core/component';
import {
  compileSlides,
  endSlide,
  type Slide,
  type SlideAnswer,
  type SlideData,
  type SlideSimulatorResult,
  type SlideTimeline,
  slideTimeoutMs,
  startSlides,
} from '../core/slides';
import { createTimelineContext } from '../core/timeline';
import { uniform } from '../utils/distributions';
import { type CanvasSize, canvasSize, type Draw, prepareCanvas } from '../utils/canvas';
import { keyAnswer } from '../utils/keys';
import { halfFrameMs } from '../utils/time';

type CanvasBlockProps = {
  /** The slides, with ifBlock, whileBlock and updateStore for control flow. */
  timeline: SlideTimeline;
  width?: CanvasSize;
  height?: CanvasSize;
  /** Sets colors and fonts before each slide is drawn. */
  styleCanvas?: Draw;
  /** Runs once, after the canvas is set up. */
  initCanvas?: Draw;
} & BaseComponentProps<SlideData[]>;

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
  // The loop reads the latest callbacks through this ref, so new identities never restart the block
  const callbacks = useRef({ next, updateStore, styleCanvas, initCanvas });
  callbacks.current = { next, updateStore, styleCanvas, initCanvas };

  useEffect(() => {
    const canvas = canvasRef.current;
    const prepared = canvas && prepareCanvas(canvas, width, height);
    if (!canvas || !prepared) return;
    const { ctx, size } = prepared;

    // A mistake in drawing code leaves the canvas incomplete instead of stopping the experiment
    const paint = (drawing: Draw | undefined) => {
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

    const halfFrame = halfFrameMs(store.__screenRefreshRate);
    const compiled = compileSlides(timeline);
    const context = createTimelineContext(data, store);
    let run = startSlides(compiled, context);

    // The slide on screen: the frame that drew it, the frame it appeared with, and its response
    let drawnAt = 0;
    let onset: number | undefined;
    let answer: SlideAnswer | undefined;
    let hidden = false;
    // Key presses and clicks since the last frame, which the next frame judges
    let inputs: ({ key: string; timeStamp: number } | { x: number; y: number; timeStamp: number })[] = [];
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
      answer = undefined;
      hidden = false;
      frameId = requestAnimationFrame(frame);
    };

    const frame = (timestamp: number) => {
      const slide = run.slide as Slide;
      const timeoutMs = slideTimeoutMs(slide);
      // What a frame draws appears with the next frame
      onset ??= timestamp;
      for (const input of inputs) {
        // Inputs are timestamped on the frames' clock; one from before the slide appeared does not count
        const reactionTimeMs = input.timeStamp - onset;
        if (answer || reactionTimeMs < 0 || reactionTimeMs >= timeoutMs) continue;
        const given =
          'key' in input ? keyAnswer(slide.response, input.key) : slide.response?.click ? { x: input.x, y: input.y } : undefined;
        if (!given) continue;
        answer = { ...given, reactionTimeMs: Math.round(reactionTimeMs) };
        if (slide.response?.hidesDrawing) {
          clear();
          hidden = true;
        }
      }
      inputs = [];

      // Half a frame more ends the slide on the frame nearest its time
      const elapsed = timestamp - drawnAt + halfFrame;
      if ((answer && slide.response?.endsSlide !== false) || elapsed >= timeoutMs) {
        run = endSlide(compiled, context, run, {
          startMs: Math.round(onset),
          // It disappears with the next frame, as long after this one as it appeared after the frame that drew it
          endMs: Math.round(timestamp + onset - drawnAt),
          answer,
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
      if (!event.repeat) inputs.push({ key: event.key, timeStamp: event.timeStamp });
    };
    // In CSS pixels from the canvas's corner, the coordinates that drawing uses
    const onPointerDown = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      inputs.push({ x: event.clientX - bounds.left, y: event.clientY - bounds.top, timeStamp: event.timeStamp });
    };
    window.addEventListener('keydown', onKeyDown);
    canvas.addEventListener('pointerdown', onPointerDown);
    frameId = requestAnimationFrame(show);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      canvas.removeEventListener('pointerdown', onPointerDown);
      cancelAnimationFrame(frameId);
    };
  }, [timeline, width, height, data, store]);

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <canvas ref={canvasRef} />
    </div>
  );
}

export default defineComponent({
  name: 'CanvasBlock',
  component: CanvasBlock,
  // Every slide's row has metadata, if only empty, so the block's own always goes to slideblock_meta_ columns
  csv: { canvas: (item) => item.recorded.map((row) => ({ metadata: {}, ...row })) },
  simulate: ({ props, simulators, participant, data, store }) => {
    const compiled = compileSlides(props.timeline);
    const context = { data, store, slides: [] };
    let run = startSlides(compiled, context);
    let time = 0;

    while (run.slide) {
      const slide = run.slide;
      const result = simulators.respondToSlide({ props, participant, slide });
      participant = result.participant ?? participant;

      // The same rules as in the browser: a key or click counts within the slide's time, and ends it
      // unless the slide says otherwise
      const timeoutMs = slideTimeoutMs(slide);
      const { key, x, y, reactionTimeMs } = result.value;
      const given =
        key != null
          ? keyAnswer(slide.response, key)
          : x !== undefined && y !== undefined && slide.response?.click
            ? { x, y }
            : undefined;
      const answer = given && reactionTimeMs !== null && reactionTimeMs < timeoutMs ? { ...given, reactionTimeMs } : undefined;
      const durationMs = answer && slide.response?.endsSlide !== false ? answer.reactionTimeMs : timeoutMs;
      if (durationMs === Number.POSITIVE_INFINITY) {
        throw new Error('A simulated participant gave no response to a slide that only a response ends.');
      }

      run = endSlide(compiled, context, run, { startMs: time, endMs: time + durationMs, answer });
      time += durationMs;
    }

    return { recorded: run.slides, participant, storeUpdates: run.store, durationMs: time };
  },
  defaultSimulators: {
    // One of the slide's ways to respond, at random: a listed key, any key, a choice's key, or a click
    respondToSlide: ({ props, slide }): SlideSimulatorResult => {
      const response = (slide as Slide).response;
      const keys = response?.keys === true ? [' '] : (response?.keys ?? []);
      const options: { key?: string; x?: number; y?: number }[] = [
        ...keys.map((key) => ({ key })),
        ...Object.values(response?.choices ?? {}).map(({ key }) => ({ key })),
      ];
      if (response?.click) {
        // A point on the canvas as it would be sized on a 1920 by 1080 screen
        const size = canvasSize(props.width, props.height, 1920, 1080);
        options.push({ x: uniform(0, size.width), y: uniform(0, size.height) });
      }
      if (options.length === 0) return { value: { key: null, reactionTimeMs: null } };
      return { value: { ...options[Math.floor(uniform(0, options.length))], reactionTimeMs: uniform(200, 800) } };
    },
  },
});

/** Slides that count down from `seconds`, one second each, recording nothing. */
export function canvasCountdown(seconds: number): Slide[] {
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
