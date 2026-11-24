import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from 'react';
import type { CSSProperties } from 'react';
import { BaseComponentProps } from '../core/component';
import { shuffle } from '../utils/array';
import { defineComponent } from '../core/component';
import { simulateDDMTrial, mapDDMChoice } from '../utils/ddm';
import { type ResponseKey, responseKey } from '../utils/keys';

// Single source of truth for all RDK parameter defaults.
// Used by RDKCanvas, the trial component, and the simulation.
const RDK_DEFAULTS = {
  allowedResponseKeys: true as readonly ResponseKey[] | boolean,
  timeLimitMs: 1000,
  responseEndsTrial: true,
  dotCount: 300,
  dotSetCount: 1,
  direction: 0,
  coherence: 0.5,
  opposite: 0,
  speed: 60,
  dotLifetimeMs: -1,
  dotRadius: 2,
  dotColor: 'white',
  backgroundColor: 'gray',
  apertureShape: 'ellipse' as ApertureShape,
  apertureWidth: 600,
  apertureHeight: 400,
  reinsertMode: 'opposite' as ReinsertType,
  noiseMovement: 'randomDirection' as NoiseMovement,
  fixationTimeMs: 500,
  showFixation: true,
  fixationWidth: 15,
  fixationHeight: 15,
  fixationColor: 'white',
  fixationThickness: 2,
  showBorder: false,
  borderWidth: 1,
  borderColor: 'black',
};

export interface RDKMessage {
  content: string;
  durationMs: number;
}

export interface RDKFeedback {
  /** Shown when no key counted within the time limit */
  onTimeout?: RDKMessage;
  /** Shown when the response was incorrect (correct === false) */
  onIncorrect?: RDKMessage;
  /** Shown when the response was correct (correct === true) */
  onCorrect?: RDKMessage;
}

// this is assigned per dot
export type NoiseMovement = 'randomTeleport' | 'randomWalk' | 'randomDirection';
type FrameMovement = 'coherent' | 'opposite' | NoiseMovement;

type ApertureShape = 'circle' | 'ellipse' | 'square' | 'rectangle';
type ReinsertType = 'random' | 'opposite' | 'oppositeSimple' | 'wrap';

// Constants for refresh rate calibration
const CALIBRATION_FRAME_COUNT = 10;
const EMA_ALPHA = 0.1; // Smoothing factor for exponential moving average

// Generate shuffled assignments with exact counts
const generateShuffledAssignments = (
  dotCount: number,
  coherence: number,
  opposite: number,
  noiseMovement: FrameMovement,
): FrameMovement[] => {
  const nCoherent = Math.floor(dotCount * coherence);
  const nOpposite = Math.floor(dotCount * opposite);
  const assignments: FrameMovement[] = [
    ...Array(nCoherent).fill('coherent' as FrameMovement),
    ...Array(nOpposite).fill('opposite' as FrameMovement),
    ...Array(dotCount - nCoherent - nOpposite).fill(noiseMovement),
  ];
  return shuffle(assignments);
};

interface Dot {
  x: number;
  y: number;
  randomDirX: number; // x and y fields are only used when a dot currently has randomDirection movement
  randomDirY: number;
  lifeCount: number;
  assignedMovement: FrameMovement;
}

interface Aperture {
  centerX: number;
  centerY: number;
  getRandomPosition(): [number, number];
  isOutside(x: number, y: number, margin: number): boolean;
  getOppositePosition(dot: Dot, dirX: number, dirY: number): [number, number];
  getOppositePositionSimple(dot: Dot): [number, number];
  wrap(x: number, y: number): [number, number];
  clip(ctx: CanvasRenderingContext2D): void;
  drawBorder(ctx: CanvasRenderingContext2D, color: string, lineWidth: number): void;
}

const randomBetween = (min: number, max: number): number => min + Math.random() * (max - min);

const createAperture = (
  shape: ApertureShape,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
): Aperture => {
  const horizontalAxis = width / 2;
  const verticalAxis = shape === 'circle' || shape === 'square' ? horizontalAxis : height / 2;

  // Toroidal wrap on bounding box - x and y wrap independently
  const wrapOnBounds = (x: number, y: number): [number, number] => {
    const w = horizontalAxis * 2;
    const h = verticalAxis * 2;
    const left = centerX - horizontalAxis;
    const top = centerY - verticalAxis;
    return [((((x - left) % w) + w) % w) + left, ((((y - top) % h) + h) % h) + top];
  };

  if (shape === 'circle' || shape === 'ellipse') {
    return {
      centerX,
      centerY,
      getRandomPosition() {
        const phi = randomBetween(-Math.PI, Math.PI);
        const rho = Math.sqrt(Math.random());
        return [
          Math.cos(phi) * rho * horizontalAxis + centerX,
          Math.sin(phi) * rho * verticalAxis + centerY,
        ];
      },
      isOutside(x, y, margin) {
        const effH = horizontalAxis + margin;
        const effV = verticalAxis + margin;
        const dx = (x - centerX) / effH;
        const dy = (y - centerY) / effV;
        return dx * dx + dy * dy > 1;
      },
      getOppositePosition(dot, dirX, dirY) {
        // Ray-ellipse intersection: find where backward ray hits far side of boundary
        const dirMagSq = dirX * dirX + dirY * dirY;
        if (dirMagSq > 1e-10) {
          // Normalize direction
          const mag = Math.sqrt(dirMagSq);
          const dx = dirX / mag;
          const dy = dirY / mag;

          // Position relative to center
          const xRel = dot.x - centerX;
          const yRel = dot.y - centerY;

          // Ellipse: semi-axes squared
          const a2 = horizontalAxis * horizontalAxis;
          const b2 = verticalAxis * verticalAxis;

          // Quadratic coefficients for ray-ellipse intersection
          // Ray: P(t) = (dot.x - dx*t, dot.y - dy*t)
          const A = (dx * dx) / a2 + (dy * dy) / b2;
          const B = (xRel * dx) / a2 + (yRel * dy) / b2;
          const C = (xRel * xRel) / a2 + (yRel * yRel) / b2 - 1;

          const discriminant = B * B - A * C;
          if (discriminant >= 0) {
            // Larger root gives far intersection (entry point from other side)
            const t = (B + Math.sqrt(discriminant)) / A;
            if (t > 0 && Number.isFinite(t)) {
              return [dot.x - dx * t, dot.y - dy * t];
            }
          }
        }
        // Fallback: use simple center-mirror
        return this.getOppositePositionSimple(dot);
      },
      getOppositePositionSimple(dot) {
        // Mirror through center, clamp to boundary if outside
        const mirroredX = 2 * centerX - dot.x;
        const mirroredY = 2 * centerY - dot.y;
        const mx = (mirroredX - centerX) / horizontalAxis;
        const my = (mirroredY - centerY) / verticalAxis;
        const dist = Math.sqrt(mx * mx + my * my);
        if (dist > 1) {
          return [centerX + (mx / dist) * horizontalAxis, centerY + (my / dist) * verticalAxis];
        }
        return [mirroredX, mirroredY];
      },
      wrap: wrapOnBounds,
      clip(ctx) {
        ctx.beginPath();
        ctx.ellipse(centerX, centerY, horizontalAxis, verticalAxis, 0, 0, Math.PI * 2);
        ctx.clip();
      },
      drawBorder(ctx, color, lineWidth) {
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        ctx.ellipse(
          centerX,
          centerY,
          horizontalAxis + lineWidth / 2,
          verticalAxis + lineWidth / 2,
          0,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
      },
    };
  }

  // Rectangle or square
  return {
    centerX,
    centerY,
    getRandomPosition() {
      return [
        randomBetween(centerX - horizontalAxis, centerX + horizontalAxis),
        randomBetween(centerY - verticalAxis, centerY + verticalAxis),
      ];
    },
    isOutside(x, y, margin) {
      const effH = horizontalAxis + margin;
      const effV = verticalAxis + margin;
      return x < centerX - effH || x > centerX + effH || y < centerY - effV || y > centerY + effV;
    },
    getOppositePosition(dot, dirX, dirY) {
      // Ray-rectangle intersection using slab method
      const mag = Math.sqrt(dirX * dirX + dirY * dirY);
      if (mag < 1e-10) {
        return this.getOppositePositionSimple(dot);
      }

      // Normalized backward direction (opposite of movement)
      const dx = -dirX / mag;
      const dy = -dirY / mag;

      const left = centerX - horizontalAxis;
      const right = centerX + horizontalAxis;
      const top = centerY - verticalAxis;
      const bottom = centerY + verticalAxis;

      // Compute t for each edge (Infinity when parallel to that axis)
      const tx1 = dx !== 0 ? (left - dot.x) / dx : -Infinity;
      const tx2 = dx !== 0 ? (right - dot.x) / dx : -Infinity;
      const ty1 = dy !== 0 ? (top - dot.y) / dy : -Infinity;
      const ty2 = dy !== 0 ? (bottom - dot.y) / dy : -Infinity;

      // Ray is inside rectangle when inside both slabs
      // tEnter = latest entry, tExit = earliest exit
      const tEnter = Math.max(Math.min(tx1, tx2), Math.min(ty1, ty2));
      const tExit = Math.min(Math.max(tx1, tx2), Math.max(ty1, ty2));

      // Use far intersection (tExit) for reinsertion
      if (tExit > 0 && tEnter <= tExit && Number.isFinite(tExit)) {
        return [dot.x + dx * tExit, dot.y + dy * tExit];
      }

      return this.getOppositePositionSimple(dot);
    },
    getOppositePositionSimple(dot) {
      // Flip any out-of-bounds coordinate to the opposite edge
      const left = centerX - horizontalAxis;
      const right = centerX + horizontalAxis;
      const top = centerY - verticalAxis;
      const bottom = centerY + verticalAxis;

      let x = dot.x,
        y = dot.y;

      if (dot.x < left) x = right;
      else if (dot.x > right) x = left;

      if (dot.y < top) y = bottom;
      else if (dot.y > bottom) y = top;

      return [x, y];
    },
    wrap: wrapOnBounds,
    clip(ctx) {
      ctx.beginPath();
      ctx.rect(
        centerX - horizontalAxis,
        centerY - verticalAxis,
        horizontalAxis * 2,
        verticalAxis * 2,
      );
      ctx.clip();
    },
    drawBorder(ctx, color, lineWidth) {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.strokeRect(
        centerX - horizontalAxis - lineWidth / 2,
        centerY - verticalAxis - lineWidth / 2,
        horizontalAxis * 2 + lineWidth,
        verticalAxis * 2 + lineWidth,
      );
    },
  };
};

const createDot = (
  assignedMovement: FrameMovement,
  maxDotLife: number,
  aperture: Aperture,
): Dot => {
  const [x, y] = aperture.getRandomPosition();

  // compute random direction for dots that need it
  const theta = assignedMovement === 'randomDirection' ? randomBetween(-Math.PI, Math.PI) : 0;

  return {
    x,
    y,
    randomDirX: theta ? Math.cos(theta) : 0,
    randomDirY: theta ? -Math.sin(theta) : 0,
    lifeCount: randomBetween(0, maxDotLife > 0 ? maxDotLife : 0),
    assignedMovement,
  };
};

const updateDot = (
  dot: Dot,
  distance: number,
  deltaTimeMs: number,
  maxDotLife: number,
  aperture: Aperture,
  reinsertType: ReinsertType,
  dotRadius: number,
  coherentDir: [x: number, y: number],
  reassignMovementTo?: FrameMovement,
): Dot => {
  const updated = { ...dot };
  updated.lifeCount += deltaTimeMs;

  // Check if dot's life has expired - respawn and skip movement calculation
  if (maxDotLife > 0 && updated.lifeCount >= maxDotLife) {
    [updated.x, updated.y] = aperture.getRandomPosition();
    updated.lifeCount = 0;
    return updated;
  }

  // Determine movement: use assigned method, or apply reassignment if provided
  let method = dot.assignedMovement;
  if (reassignMovementTo !== undefined) {
    method = reassignMovementTo;
    updated.assignedMovement = method;

    // Regenerate random direction if assigned to randomDirection
    if (method === 'randomDirection') {
      const theta = randomBetween(-Math.PI, Math.PI);
      updated.randomDirX = Math.cos(theta);
      updated.randomDirY = -Math.sin(theta);
    }
  }

  // Track movement direction for direction-aware reinsertion
  let moveDirX = 0;
  let moveDirY = 0;

  switch (method) {
    case 'coherent':
      moveDirX = coherentDir[0];
      moveDirY = coherentDir[1];
      break;
    case 'opposite':
      moveDirX = -coherentDir[0];
      moveDirY = -coherentDir[1];
      break;
    case 'randomTeleport':
      // Teleports to random position - no boundary check needed
      [updated.x, updated.y] = aperture.getRandomPosition();
      return updated;
    case 'randomWalk': {
      const theta = randomBetween(-Math.PI, Math.PI);
      moveDirX = Math.cos(theta);
      moveDirY = -Math.sin(theta);
      break;
    }
    case 'randomDirection':
      moveDirX = updated.randomDirX;
      moveDirY = updated.randomDirY;
      break;
  }

  // Apply movement
  updated.x += moveDirX * distance;
  updated.y += moveDirY * distance;

  // Check bounds and reinsert with direction info
  const outOfBounds = aperture.isOutside(updated.x, updated.y, dotRadius);
  if (outOfBounds) {
    if (reinsertType === 'random') {
      [updated.x, updated.y] = aperture.getRandomPosition();
    } else if (reinsertType === 'oppositeSimple') {
      [updated.x, updated.y] = aperture.getOppositePositionSimple(updated);
    } else if (reinsertType === 'opposite') {
      [updated.x, updated.y] = aperture.getOppositePosition(updated, moveDirX, moveDirY);
    } else if (reinsertType === 'wrap') {
      [updated.x, updated.y] = aperture.wrap(updated.x, updated.y);
    } else {
      throw new Error(`Unknown reinsertType: ${reinsertType satisfies never}`);
    }
  }

  return updated;
};

// ─── Standalone RDK Canvas ─────────────────────────────────────────────────────

export interface RDKCanvasProps {
  width: number;
  height: number;
  dotCount?: number;
  dotSetCount?: number;
  direction?: number;
  coherence?: number;
  opposite?: number;
  speed?: number;
  dotLifetimeMs?: number;
  updateRate?: number;
  dotRadius?: number;
  dotCharacter?: string;
  dotColor?: string;
  coherentDotColor?: string;
  backgroundColor?: string;
  apertureShape?: ApertureShape;
  apertureWidth?: number;
  apertureHeight?: number;
  apertureCenterX?: number;
  apertureCenterY?: number;
  reinsertMode?: ReinsertType;
  noiseMovement?: NoiseMovement;
  /** How often the dots' roles are drawn again: never without it, every update with 0, or every this many milliseconds. */
  reassignEveryMs?: number;
  showFixation?: boolean;
  fixationWidth?: number;
  fixationHeight?: number;
  fixationColor?: string;
  fixationThickness?: number;
  showBorder?: boolean;
  borderWidth?: number;
  borderColor?: string;
  /** When true (default), dots are animated and visible. When false, only background (+ fixation if enabled) is shown. */
  active?: boolean;
  /** Seed the refresh-rate estimator (e.g. from a prior calibration). */
  initialRefreshRate?: number;
  style?: CSSProperties;
  className?: string;
}

export interface RDKCanvasHandle {
  getStats: () => { framesDisplayed: number; measuredRefreshRate: number | null };
}

export const RDKCanvas = forwardRef<RDKCanvasHandle, RDKCanvasProps>(
  (rawProps, ref) => {
    const {
      width,
      height,
      dotCount, dotSetCount, direction, coherence, opposite, speed, dotLifetimeMs,
      updateRate, dotRadius, dotCharacter, dotColor, coherentDotColor, backgroundColor,
      apertureShape, apertureWidth, apertureHeight, apertureCenterX, apertureCenterY,
      reinsertMode, noiseMovement, reassignEveryMs,
      showFixation, fixationWidth, fixationHeight, fixationColor, fixationThickness,
      showBorder, borderWidth, borderColor,
      active = true,
      initialRefreshRate,
      style,
      className,
    } = { ...RDK_DEFAULTS, ...rawProps };
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationRef = useRef<number>();
    const lastUpdateTimeRef = useRef<number>();
    const lastFrameTimeRef = useRef<number>();
    const timeSinceReassignRef = useRef(0);
    const frameCountRef = useRef(0);

    // Refresh rate estimation
    const frameIntervalsRef = useRef<number[]>([]);
    const estimatedFrameIntervalRef = useRef<number | null>(null);

    // Default aperture center to canvas center
    const effectiveCenterX = apertureCenterX ?? width / 2;
    const effectiveCenterY = apertureCenterY ?? height / 2;

    const aperture = useMemo(
      () =>
        createAperture(
          apertureShape,
          apertureWidth,
          apertureHeight,
          effectiveCenterX,
          effectiveCenterY,
        ),
      [apertureShape, apertureWidth, apertureHeight, effectiveCenterX, effectiveCenterY],
    );

    // Unit vector for coherent direction (0=up, 90=right, 180=down, 270=left)
    const coherentDir = useMemo((): [number, number] => {
      const dirRad = ((90 - direction) * Math.PI) / 180;
      return [Math.cos(dirRad), -Math.sin(dirRad)];
    }, [direction]);

    const dotSetsRef = useRef<Dot[][]>([]);
    const currentSetRef = useRef(0);

    // Initialize dots
    useEffect(() => {
      dotSetsRef.current = Array.from({ length: dotSetCount }, () =>
        generateShuffledAssignments(dotCount, coherence, opposite, noiseMovement).map((movement) =>
          createDot(movement, dotLifetimeMs, aperture),
        ),
      );
      currentSetRef.current = 0;
    }, [dotCount, dotSetCount, coherence, opposite, noiseMovement, dotLifetimeMs, aperture]);

    // Seed refresh rate estimate
    useEffect(() => {
      if (
        typeof initialRefreshRate === 'number' &&
        initialRefreshRate >= 20 &&
        initialRefreshRate <= 300
      ) {
        estimatedFrameIntervalRef.current = 1000 / initialRefreshRate;
      }
    }, [initialRefreshRate]);

    // Expose stats via ref
    useImperativeHandle(ref, () => ({
      getStats: () => ({
        framesDisplayed: frameCountRef.current,
        measuredRefreshRate: estimatedFrameIntervalRef.current
          ? Math.round(1000 / estimatedFrameIntervalRef.current)
          : null,
      }),
    }));

    // Drawing functions
    const drawDots = useCallback(
      (ctx: CanvasRenderingContext2D, dots: Dot[]) => {
        dots.forEach((dot) => {
          const color =
            coherentDotColor && dot.assignedMovement === 'coherent' ? coherentDotColor : dotColor;
          ctx.fillStyle = color;

          if (dotCharacter) {
            const fontSize = dotRadius * 2.5;
            ctx.font = `${fontSize}px monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(dotCharacter, dot.x, dot.y);
          } else {
            ctx.beginPath();
            ctx.arc(dot.x, dot.y, dotRadius, 0, Math.PI * 2);
            ctx.fill();
          }
        });
      },
      [dotColor, coherentDotColor, dotRadius, dotCharacter],
    );

    const drawFixation = useCallback(
      (ctx: CanvasRenderingContext2D, cx: number, cy: number) => {
        if (!showFixation) return;

        ctx.fillStyle = fixationColor;

        ctx.fillRect(
          cx - fixationWidth,
          cy - fixationThickness / 2,
          fixationWidth * 2,
          fixationThickness,
        );

        ctx.fillRect(
          cx - fixationThickness / 2,
          cy - fixationHeight,
          fixationThickness,
          fixationHeight * 2,
        );
      },
      [showFixation, fixationColor, fixationThickness, fixationWidth, fixationHeight],
    );

    const drawBorder = useCallback(
      (ctx: CanvasRenderingContext2D) => {
        if (!showBorder) return;
        aperture.drawBorder(ctx, borderColor, borderWidth);
      },
      [showBorder, borderColor, borderWidth, aperture],
    );

    // Animation loop
    const animate = useCallback(
      (timestamp: number) => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;

        if (lastUpdateTimeRef.current === undefined) {
          lastUpdateTimeRef.current = timestamp;
        }
        if (lastFrameTimeRef.current === undefined) {
          lastFrameTimeRef.current = timestamp;
        }

        const frameDelta = timestamp - lastFrameTimeRef.current;
        lastFrameTimeRef.current = timestamp;
        frameCountRef.current++;

        // Update refresh rate estimate
        const estimate = estimatedFrameIntervalRef.current;
        if (frameDelta > 0 && frameDelta < 500) {
          if (estimate === null) {
            frameIntervalsRef.current.push(frameDelta);
            if (frameIntervalsRef.current.length >= CALIBRATION_FRAME_COUNT) {
              const sorted = [...frameIntervalsRef.current].sort((a, b) => a - b);
              const mid = Math.floor(sorted.length / 2);
              estimatedFrameIntervalRef.current =
                sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
            }
          } else {
            estimatedFrameIntervalRef.current = EMA_ALPHA * frameDelta + (1 - EMA_ALPHA) * estimate;
          }
        }

        // Cap delta to avoid massive jumps when returning from a backgrounded tab
        const timeSinceLastUpdate = Math.min(timestamp - lastUpdateTimeRef.current, 100);
        const updateInterval = updateRate && updateRate > 0 ? 1000 / updateRate : 0;
        const shouldUpdate = timeSinceLastUpdate >= updateInterval;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Fill only the aperture area with background color
        ctx.save();
        aperture.clip(ctx);
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();

        if (!active) {
          drawFixation(ctx, aperture.centerX, aperture.centerY);
        } else {
          if (shouldUpdate) {
            const distance = (speed * timeSinceLastUpdate) / 1000;

            // Determine if we should reassign dots
            let shouldReassign = false;
            if (reassignEveryMs !== undefined) {
              if (reassignEveryMs === 0) {
                shouldReassign = true;
              } else {
                timeSinceReassignRef.current += timeSinceLastUpdate;
                const halfFrameCorrection = (estimatedFrameIntervalRef.current ?? 0) * 0.5;
                const correctedTime = timeSinceReassignRef.current + halfFrameCorrection;
                shouldReassign = correctedTime >= reassignEveryMs;
                if (shouldReassign) {
                  timeSinceReassignRef.current %= reassignEveryMs;
                }
              }
            }

            const reassignments = shouldReassign
              ? generateShuffledAssignments(dotCount, coherence, opposite, noiseMovement)
              : null;

            const currentSet = dotSetsRef.current[currentSetRef.current];
            const updatedDots = currentSet.map((dot, i) =>
              updateDot(
                dot,
                distance,
                timeSinceLastUpdate,
                dotLifetimeMs,
                aperture,
                reinsertMode,
                dotRadius,
                coherentDir,
                reassignments?.[i],
              ),
            );
            dotSetsRef.current[currentSetRef.current] = updatedDots;

            currentSetRef.current = (currentSetRef.current + 1) % dotSetCount;
            lastUpdateTimeRef.current = timestamp;
          }

          const currentDots = dotSetsRef.current[currentSetRef.current];
          ctx.save();
          aperture.clip(ctx);
          drawDots(ctx, currentDots);
          ctx.restore();

          ctx.save();
          ctx.beginPath();
          drawFixation(ctx, aperture.centerX, aperture.centerY);
          drawBorder(ctx);
          ctx.restore();
        }

        animationRef.current = requestAnimationFrame(animate);
      },
      [
        active,
        backgroundColor,
        noiseMovement,
        coherence,
        opposite,
        dotCount,
        speed,
        dotLifetimeMs,
        aperture,
        reinsertMode,
        dotSetCount,
        dotRadius,
        coherentDir,
        updateRate,
        drawDots,
        drawFixation,
        drawBorder,
        reassignEveryMs,
      ],
    );

    // Start animation
    useEffect(() => {
      animationRef.current = requestAnimationFrame(animate);
      return () => {
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
        }
      };
    }, [animate]);

    // Setup canvas with retina display support
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(dpr, dpr);
      }
    }, [width, height]);

    return (
      <canvas
        ref={canvasRef}
        style={{ display: 'block', ...style }}
        className={className}
      />
    );
  },
);

// ─── Trial Component ────────────────────────────────────────────────────────────

// The message shown after the response, or after no response in time
const feedbackFor = (feedback: RDKFeedback | undefined, rt: number | null, correct: boolean | null) => {
  if (rt === null) return feedback?.onTimeout ?? null;
  if (correct === false) return feedback?.onIncorrect ?? null;
  if (correct === true) return feedback?.onCorrect ?? null;
  return null;
};

// Whether the key is a correct response, ignoring case like the keys that count; `null` without a key or a correct response
const isCorrect = (key: string | null, correctResponse: ResponseKey | readonly ResponseKey[] | undefined) =>
  key && correctResponse !== undefined ? responseKey([correctResponse].flat(), key) !== undefined : null;

// The canvas's settings, which a trial passes on as they are
type CanvasSettings = Omit<RDKCanvasProps, 'width' | 'height' | 'active' | 'initialRefreshRate' | 'style' | 'className'>;

/** A trial's settings: the canvas's, and how the trial takes its response. */
export interface RDKSettings extends CanvasSettings {
  /** Keys that count as a response, letters in either case; `true` for any key. */
  allowedResponseKeys?: readonly ResponseKey[] | boolean;
  correctResponse?: ResponseKey | readonly ResponseKey[];
  /** How long after the dots appear a key counts as a response. The trial ends then, if no response has ended it. */
  timeLimitMs?: number;
  /** How long the dots are shown; `timeLimitMs` by default. */
  displayDurationMs?: number;
  /** Whether the first response ends the trial. Defaults to `true`. */
  responseEndsTrial?: boolean;
  fixationTimeMs?: number;
  responseHint?: string;
  /** Timed message shown before the fixation cross. Useful for per-trial condition cues. */
  preTrialMessage?: RDKMessage;
  /** Post-response feedback. Evaluated after response/timeout, displayed before calling next(). */
  feedback?: RDKFeedback;
}

/** What a trial records: its settings, the key pressed and when, and what it showed. */
export type RDKResponse = RDKSettings & {
  key: string | null;
  /** From when the dots appeared. */
  reactionTimeMs: number | null;
  correct: boolean | null;
  framesDisplayed: number;
  measuredRefreshRate: number | null;
  feedbackShown: string | null;
  feedbackDurationMs: number | null;
};

export type RDKProps = RDKSettings & BaseComponentProps<RDKResponse>;

const RandomDotKinematogramComponent = (rawProps: RDKProps) => {
  const {
    next: _next, data: _data, store, updateStore: _updateStore, name: _name,
    allowedResponseKeys, correctResponse: _correctResponse, timeLimitMs, displayDurationMs, responseEndsTrial,
    fixationTimeMs, responseHint, preTrialMessage: _preTrialMessage, feedback: _feedback,
    ...canvasSettings
  } = { ...RDK_DEFAULTS, ...rawProps };
  const { backgroundColor } = canvasSettings;
  // Keep a ref to the latest props so endTrial can read them without recreating on every render.
  const propsRef = useRef(rawProps);
  propsRef.current = rawProps;

  const preTrialDuration = rawProps.preTrialMessage?.durationMs ?? 0;

  const canvasHandle = useRef<RDKCanvasHandle>(null);
  // When the dots appeared, which reaction times count from
  const startTimeRef = useRef(0);
  const trialEndedRef = useRef(false);
  const responseRef = useRef<string | null>(null);
  const responseTimeRef = useRef<number | null>(null);

  const [preTrialDone, setPreTrialDone] = useState(!rawProps.preTrialMessage);
  const [response, setResponse] = useState<string | null>(null);
  const [fixationComplete, setFixationComplete] = useState(fixationTimeMs <= 0);
  const [stimulusVisible, setStimulusVisible] = useState(true);
  const [feedbackMsg, setFeedbackMsg] = useState<RDKMessage | null>(null);

  const initialRefreshRate = store.__screenRefreshRate;

  // Pre-trial message timer
  // biome-ignore lint/correctness/useExhaustiveDependencies: the message is shown once per trial, a new props object must not restart it
  useEffect(() => {
    if (!rawProps.preTrialMessage) return;
    const timer = setTimeout(() => setPreTrialDone(true), rawProps.preTrialMessage.durationMs);
    return () => clearTimeout(timer);
  }, []);

  const endTrial = useCallback((key: string | null, rt: number | null) => {
    if (trialEndedRef.current) return;
    trialEndedRef.current = true;

    const { next: nextFn, data: _d, store: _s, updateStore: _u, name: _n, ...rdkProps } = propsRef.current;
    const stats = canvasHandle.current?.getStats();
    const correct = isCorrect(key, rdkProps.correctResponse);

    const recorded: RDKResponse = {
      ...RDK_DEFAULTS,
      ...rdkProps,
      key,
      reactionTimeMs: rt,
      correct,
      framesDisplayed: stats?.framesDisplayed ?? 0,
      measuredRefreshRate: stats?.measuredRefreshRate ?? null,
      feedbackShown: null,
      feedbackDurationMs: null,
    };

    const shown = feedbackFor(rdkProps.feedback, rt, correct);
    if (shown) {
      recorded.feedbackShown = shown.content;
      recorded.feedbackDurationMs = shown.durationMs;
      setFeedbackMsg(shown);
      setTimeout(() => nextFn(recorded), shown.durationMs);
    } else {
      nextFn(recorded);
    }
  }, []);

  // Fixation duration delay before showing dots (offset by preTrialDuration)
  useEffect(() => {
    if (fixationTimeMs <= 0) return;
    const timer = setTimeout(() => setFixationComplete(true), preTrialDuration + fixationTimeMs);
    return () => clearTimeout(timer);
  }, [fixationTimeMs, preTrialDuration]);

  // Stimulus duration timer (offset by preTrialDuration)
  useEffect(() => {
    const effectiveStimDur = displayDurationMs ?? timeLimitMs;
    if (effectiveStimDur <= 0) return;
    const timer = setTimeout(() => setStimulusVisible(false), preTrialDuration + fixationTimeMs + effectiveStimDur);
    return () => clearTimeout(timer);
  }, [preTrialDuration, fixationTimeMs, displayDurationMs, timeLimitMs]);

  // Trial duration timer — ends trial with whatever response was collected (offset by preTrialDuration)
  useEffect(() => {
    if (timeLimitMs <= 0) return;
    const timer = setTimeout(() => {
      endTrial(responseRef.current, responseTimeRef.current);
    }, preTrialDuration + fixationTimeMs + timeLimitMs);
    return () => clearTimeout(timer);
  }, [preTrialDuration, fixationTimeMs, timeLimitMs, endTrial]);

  // The dots appear once the pre-trial message and the fixation are over, and keys count from then on
  const stimulusShown = preTrialDone && fixationComplete;
  useEffect(() => {
    if (stimulusShown) startTimeRef.current = performance.now();
  }, [stimulusShown]);

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (trialEndedRef.current || responseRef.current || !stimulusShown) return;

      const key = responseKey(allowedResponseKeys, e.key);
      if (key !== undefined) {
        const rt = performance.now() - startTimeRef.current;
        responseRef.current = key;
        responseTimeRef.current = rt;
        setResponse(key);

        if (responseEndsTrial) {
          endTrial(key, rt);
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [allowedResponseKeys, responseEndsTrial, endTrial, stimulusShown]);

  const messageOverlay = (text: string) => (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <span style={{ color: 'white', fontSize: '2rem', fontWeight: 'bold', textAlign: 'center', padding: '0 2rem' }}>
        {text}
      </span>
    </div>
  );

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', margin: 0, padding: 0, backgroundColor }}>
      {!preTrialDone ? (
        messageOverlay(rawProps.preTrialMessage!.content)
      ) : feedbackMsg ? (
        messageOverlay(feedbackMsg.content)
      ) : (
        <>
          <RDKCanvas
            {...canvasSettings}
            ref={canvasHandle}
            width={window.innerWidth}
            height={window.innerHeight}
            active={fixationComplete && stimulusVisible}
            initialRefreshRate={initialRefreshRate}
          />
          {responseHint && !stimulusVisible && !response && (
            <div
              style={{
                position: 'absolute',
                top: '60%',
                width: '100%',
                textAlign: 'center',
                color: 'white',
                fontSize: '1.25rem',
              }}
            >
              {responseHint}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export const RandomDotKinematogram = defineComponent({
  name: 'RandomDotKinematogram',
  component: RandomDotKinematogramComponent,
  csv: 'rdk',
  simulate: async ({ props, simulators, participant }) => {
    const merged: any = { ...RDK_DEFAULTS, ...props };
    const result = await simulators.respond({ props: merged, participant });
    const { reactionTimeMs: rt, key } = result.value;

    const preTrialDuration = merged.preTrialMessage?.durationMs ?? 0;
    const elapsed = merged.responseEndsTrial && rt != null ? rt : merged.timeLimitMs;

    const correct = isCorrect(key, merged.correctResponse);

    let totalDuration = preTrialDuration + merged.fixationTimeMs + elapsed;

    const recorded: RDKResponse = {
      ...merged,
      key,
      reactionTimeMs: rt,
      correct,
      framesDisplayed: 0,
      measuredRefreshRate: null,
      feedbackShown: null as string | null,
      feedbackDurationMs: null as number | null,
    };

    const shown = feedbackFor(merged.feedback, rt, correct);
    if (shown) {
      recorded.feedbackShown = shown.content;
      recorded.feedbackDurationMs = shown.durationMs;
      totalDuration += shown.durationMs;
    }

    return {
      recorded,
      participant: result.participant,
      durationMs: totalDuration,
    };
  },
  defaultSimulators: {
    respond: ({ props }) => {
      const ddm = simulateDDMTrial({
        driftRate: { distribution: 'normal', mean: 0.005 * (props.coherence ?? RDK_DEFAULTS.coherence), sd: 0.0012 },
        boundaries: 0.75,
        startingPoint: 0,
        noiseLevel: 0.02,
        sensoryDelayMs: { distribution: 'uniform', min: 150, max: 250 },
        motorDelayMs: { distribution: 'uniform', min: 130, max: 210 },
        timeLimitMs: props.timeLimitMs ?? RDK_DEFAULTS.timeLimitMs,
        stimOffsetMs: props.displayDurationMs ?? props.timeLimitMs ?? RDK_DEFAULTS.timeLimitMs,
        postStimStrategy: { type: 'continue' },
      });

      const allowed = props.allowedResponseKeys ?? RDK_DEFAULTS.allowedResponseKeys;
      const correct = props.correctResponse === undefined ? [] : [props.correctResponse].flat();
      // With any key allowed, the simulated participant presses the correct key, or else space
      const keys = allowed === true ? [...correct, ' '] : allowed === false ? [] : allowed;
      const key = mapDDMChoice(ddm.choice, keys, props.correctResponse);

      return { value: { reactionTimeMs: key ? ddm.reactionTimeMs : null, key } };
    },
  },
});
