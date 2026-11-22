import { useEffect, useRef } from 'react';
import { type BaseComponentProps, defineComponent } from '../core/component';
import {
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
import { uniform } from '../utils/distributions';
import { type CanvasSize, type Draw, prepareCanvas } from '../utils/canvas';
import { responseKey } from '../utils/keys';
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
    const prepared = canvasRef.current && prepareCanvas(canvasRef.current, width, height);
    if (!prepared) return;
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
        const key = responseKey(slide.response?.keys, press.key);
        if (response || reactionTimeMs < 0 || reactionTimeMs >= timeoutMs || key === undefined) continue;
        response = { key, reactionTimeMs: Math.round(reactionTimeMs) };
        if (slide.response?.hidesDrawing) {
          clear();
          hidden = true;
        }
      }
      pressed = [];

      // Half a frame more ends the slide on the frame nearest its time
      const elapsed = timestamp - drawnAt + halfFrame;
      if ((response && slide.response?.endsSlide !== false) || elapsed >= timeoutMs) {
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
  csv: { canvas: (item) => item.responseData.map((row) => ({ metadata: {}, ...row })) },
  simulate: ({ props, simulators, participant, data, store }) => {
    const compiled = compileSlides(props.timeline);
    const context = { data, store, slides: [] };
    let run = startSlides(compiled, context);
    let time = 0;

    while (run.slide) {
      const slide = run.slide;
      const result = simulators.respondToSlide({ props, participant, slide });
      participant = result.participant ?? participant;

      // The same rules as in the browser: a key counts within the slide's time, and ends it unless the slide says otherwise
      const timeoutMs = slideTimeoutMs(slide);
      const { key: pressed, reactionTimeMs } = result.value;
      const key = pressed === null ? undefined : responseKey(slide.response?.keys, pressed);
      const response =
        key !== undefined && reactionTimeMs !== null && reactionTimeMs < timeoutMs ? { key, reactionTimeMs } : undefined;
      const durationMs = response && slide.response?.endsSlide !== false ? response.reactionTimeMs : timeoutMs;
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

    return { responseData: run.slides, participant, storeUpdates: run.store, durationMs: time };
  },
  defaultSimulators: {
    respondToSlide: ({ slide }): SlideSimulatorResult => {
      const keys = (slide as Slide).response?.keys;
      if (keys === true) {
        return { value: { key: ' ', reactionTimeMs: uniform(200, 800) } };
      }
      if (keys && keys.length > 0) {
        return { value: { key: keys[Math.floor(uniform(0, keys.length))], reactionTimeMs: uniform(200, 800) } };
      }
      return { value: { key: null, reactionTimeMs: null } };
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
