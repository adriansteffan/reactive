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
import { BaseComponentProps, shuffle } from '../mod';
import { registerSimulation } from '../utils/simulation';
import { registerFlattener } from '../utils/upload';
import { simulateDDMTrial, mapDDMChoice } from '../utils/ddm';

registerFlattener('RandomDotKinematogram', 'rdk');

// Single source of truth for all RDK parameter defaults.
// Used by RDKCanvas, the trial component, and the simulation.
const RDK_DEFAULTS = {
  validKeys: [] as string[],
  duration: 1000,
  responseEndsTrial: true,
  dotCount: 300,
  dotSetCount: 1,
  direction: 0,
  coherence: 0.5,
  opposite: 0,
  speed: 60,
  dotLifetime: -1,
  dotRadius: 2,
  dotColor: 'white',
  backgroundColor: 'gray',
  apertureShape: 'ellipse' as ApertureShape,
  apertureWidth: 600,
  apertureHeight: 400,
  reinsertMode: 'opposite' as ReinsertType,
  noiseMovement: 'randomDirection' as NoiseMovement,
  fixationTime: 500,
  showFixation: false,
  fixationWidth: 15,
  fixationHeight: 15,
  fixationColor: 'white',
  fixationThickness: 2,
  showBorder: false,
  borderWidth: 1,
  borderColor: 'black',
};

registerSimulation('RandomDotKinematogram', (trialProps, _experimentState, simulators, participant) => {
  const merged: any = { ...RDK_DEFAULTS, ...trialProps };
  const result = simulators.respond(merged, participant);
  const { rt, response } = result.value;

  const fixation = merged.fixationTime ?? RDK_DEFAULTS.fixationTime;
  const trialDuration = merged.duration ?? RDK_DEFAULTS.duration;
  const responseEndsTrial = merged.responseEndsTrial ?? RDK_DEFAULTS.responseEndsTrial;
  const elapsed = (responseEndsTrial && rt != null) ? rt : trialDuration;

  const correctKeys = Array.isArray(merged.correctResponse)
    ? merged.correctResponse.map((c: string) => c.toLowerCase())
    : merged.correctResponse ? [merged.correctResponse.toLowerCase()] : null;

  return {
    responseData: {
      ...merged,
      rt,
      response,
      correct: response && correctKeys ? correctKeys.includes(response.toLowerCase()) : null,
      framesDisplayed: 0,
      measuredRefreshRate: null,
    },
    participantState: result.participantState,
    duration: fixation + elapsed,
  };
}, {
  respond: (trialProps: any, participant: any) => {
    const ddm = simulateDDMTrial({
      driftRate: 0.00074 * (trialProps.coherence ?? RDK_DEFAULTS.coherence),
      boundaries: 0.0555,
      startingPoint: 0,
      noiseLevel: 0.00316,
      sensoryDelay: { type: 'uniform', min: 150, max: 250 },
      motorDelay: { type: 'uniform', min: 130, max: 210 },
      timeLimit: trialProps.duration ?? RDK_DEFAULTS.duration,
      stimOffset: trialProps.stimulusDuration ?? trialProps.duration ?? RDK_DEFAULTS.duration,
      postStimStrategy: { type: 'continue' },
    });

    const key = mapDDMChoice(ddm.choice, trialProps.validKeys, trialProps.correctResponse);

    return {
      value: { rt: key ? ddm.rt : null, response: key },
      participantState: participant,
    };
  },
});

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
  getOppositePosition(dot: Dot, dirX?: number, dirY?: number): [number, number];
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
        if (dirX !== undefined && dirY !== undefined) {
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
      if (dirX === undefined || dirY === undefined) {
        return this.getOppositePositionSimple(dot);
      }

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
  dotLifetime?: number;
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
      dotCount, dotSetCount, direction, coherence, opposite, speed, dotLifetime,
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
    const isCalibrated = useRef(false);

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
      const nCoherent = Math.floor(dotCount * coherence);
      const nOpposite = Math.floor(dotCount * opposite);

      dotSetsRef.current = Array.from({ length: dotSetCount }, () =>
        Array.from({ length: dotCount }, (_, i) => {
          let assignedMovement: FrameMovement;
          if (i < nCoherent) assignedMovement = 'coherent';
          else if (i < nCoherent + nOpposite) assignedMovement = 'opposite';
          else assignedMovement = noiseMovement;

          return createDot(assignedMovement, dotLifetime, aperture);
        }),
      );
    }, []);

    // Seed refresh rate estimate
    useEffect(() => {
      if (
        typeof initialRefreshRate === 'number' &&
        initialRefreshRate >= 20 &&
        initialRefreshRate <= 300
      ) {
        estimatedFrameIntervalRef.current = 1000 / initialRefreshRate;
        isCalibrated.current = true;
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
        if (frameDelta > 0 && frameDelta < 500) {
          if (!isCalibrated.current) {
            frameIntervalsRef.current.push(frameDelta);
            if (frameIntervalsRef.current.length >= CALIBRATION_FRAME_COUNT) {
              const sorted = [...frameIntervalsRef.current].sort((a, b) => a - b);
              const mid = Math.floor(sorted.length / 2);
              estimatedFrameIntervalRef.current =
                sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
              isCalibrated.current = true;
            }
          } else {
            estimatedFrameIntervalRef.current =
              EMA_ALPHA * frameDelta + (1 - EMA_ALPHA) * estimatedFrameIntervalRef.current!;
          }
        }

        const rawTimeSinceLastUpdate = timestamp - (lastUpdateTimeRef.current ?? timestamp);
        // Cap delta to avoid massive jumps when returning from a backgrounded tab
        const timeSinceLastUpdate = Math.min(rawTimeSinceLastUpdate, 100);
        const updateInterval = updateRate && updateRate > 0 ? 1000 / updateRate : 0;
        const shouldUpdate = !updateRate || updateRate <= 0 || timeSinceLastUpdate >= updateInterval;

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
                const halfFrameCorrection =
                  isCalibrated.current && estimatedFrameIntervalRef.current
                    ? estimatedFrameIntervalRef.current * 0.5
                    : 0;
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
                dotLifetime,
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
        dotLifetime,
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

export interface RDKProps extends BaseComponentProps {
  validKeys?: string[];
  correctResponse?: string | string[];
  duration?: number;
  stimulusDuration?: number; // How long to show stimulus (defaults to duration)
  responseEndsTrial?: boolean;
  dotCount?: number;
  dotSetCount?: number;
  direction?: number;
  coherence?: number;
  opposite?: number;
  speed?: number;
  dotLifetime?: number;
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
  reassignEveryMs?: number; // undefined = never, 0 = every update, > 0 = every X ms
  showFixation?: boolean;
  fixationTime?: number;
  fixationWidth?: number;
  fixationHeight?: number;
  fixationColor?: string;
  fixationThickness?: number;
  showBorder?: boolean;
  borderWidth?: number;
  borderColor?: string;
  responseHint?: string;
}

export const RandomDotKinematogram = (rawProps: RDKProps) => {
  const {
    store,
    stimulusDuration, updateRate, dotCharacter, coherentDotColor,
    apertureCenterX = window.innerWidth / 2,
    apertureCenterY = window.innerHeight / 2,
    reassignEveryMs, responseHint,
    validKeys, duration, responseEndsTrial,
    dotCount, dotSetCount, direction, coherence, opposite, speed, dotLifetime,
    dotRadius, dotColor, backgroundColor,
    apertureShape, apertureWidth, apertureHeight, reinsertMode, noiseMovement,
    showFixation, fixationTime, fixationWidth, fixationHeight, fixationColor, fixationThickness,
    showBorder, borderWidth, borderColor,
  } = { ...RDK_DEFAULTS, ...rawProps };
  // Keep a ref to the latest props so endTrial can read them without recreating on every render.
  const propsRef = useRef(rawProps);
  propsRef.current = rawProps;

  const canvasHandle = useRef<RDKCanvasHandle>(null);
  const startTimeRef = useRef<number>(performance.now());
  const trialEndedRef = useRef(false);
  const responseRef = useRef<string | null>(null);
  const responseTimeRef = useRef<number | null>(null);

  const [response, setResponse] = useState<string | null>(null);
  const [fixationComplete, setFixationComplete] = useState(fixationTime <= 0);
  const [stimulusVisible, setStimulusVisible] = useState(true);

  const initialRefreshRate = store?._reactiveScreenRefreshRate;

  const endTrial = useCallback((key: string | null, rt: number | null) => {
    if (trialEndedRef.current) return;
    trialEndedRef.current = true;

    const { next: nextFn, data: _d, store: _s, updateStore: _u, ...rdkProps } = propsRef.current;
    const stats = canvasHandle.current?.getStats();
    const correctKeys = Array.isArray(rdkProps.correctResponse)
      ? rdkProps.correctResponse.map((c) => c.toLowerCase())
      : rdkProps.correctResponse
        ? [rdkProps.correctResponse.toLowerCase()]
        : null;

    nextFn({
      ...RDK_DEFAULTS,
      ...rdkProps,
      rt,
      response: key,
      correct: key && correctKeys ? correctKeys.includes(key) : null,
      framesDisplayed: stats?.framesDisplayed ?? 0,
      measuredRefreshRate: stats?.measuredRefreshRate ?? null,
    });
  }, []);

  // Fixation duration delay before showing dots
  useEffect(() => {
    if (fixationTime <= 0) return;
    const timer = setTimeout(() => setFixationComplete(true), fixationTime);
    return () => clearTimeout(timer);
  }, [fixationTime]);

  // Stimulus duration timer
  useEffect(() => {
    const effectiveStimDur = stimulusDuration ?? duration;
    if (effectiveStimDur <= 0) return;
    const timer = setTimeout(() => setStimulusVisible(false), fixationTime + effectiveStimDur);
    return () => clearTimeout(timer);
  }, [fixationTime, stimulusDuration, duration]);

  // Trial duration timer — ends trial with whatever response was collected
  useEffect(() => {
    if (duration <= 0) return;
    const timer = setTimeout(() => {
      endTrial(responseRef.current, responseTimeRef.current);
    }, fixationTime + duration);
    return () => clearTimeout(timer);
  }, [fixationTime, duration, endTrial]);

  // Handle keyboard response
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (trialEndedRef.current || responseRef.current) return;

      const key = e.key.toLowerCase();
      const allowedKeys = validKeys.length > 0 ? validKeys.map((c) => c.toLowerCase()) : null;

      if (!allowedKeys || allowedKeys.includes(key)) {
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
  }, [validKeys, responseEndsTrial, endTrial]);

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', margin: 0, padding: 0, backgroundColor }}>
      <RDKCanvas
        ref={canvasHandle}
        width={window.innerWidth}
        height={window.innerHeight}
        active={fixationComplete && stimulusVisible}
        initialRefreshRate={initialRefreshRate}
        dotCount={dotCount}
        dotSetCount={dotSetCount}
        direction={direction}
        coherence={coherence}
        opposite={opposite}
        speed={speed}
        dotLifetime={dotLifetime}
        updateRate={updateRate}
        dotRadius={dotRadius}
        dotCharacter={dotCharacter}
        dotColor={dotColor}
        coherentDotColor={coherentDotColor}
        backgroundColor={backgroundColor}
        apertureShape={apertureShape}
        apertureWidth={apertureWidth}
        apertureHeight={apertureHeight}
        apertureCenterX={apertureCenterX}
        apertureCenterY={apertureCenterY}
        reinsertMode={reinsertMode}
        noiseMovement={noiseMovement}
        reassignEveryMs={reassignEveryMs}
        showFixation={showFixation}
        fixationWidth={fixationWidth}
        fixationHeight={fixationHeight}
        fixationColor={fixationColor}
        fixationThickness={fixationThickness}
        showBorder={showBorder}
        borderWidth={borderWidth}
        borderColor={borderColor}
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
    </div>
  );
};
