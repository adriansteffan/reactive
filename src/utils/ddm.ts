import { normal, uniform } from './distributions';

// --- Distribution & Parameter Types ---

export type NormalDist = { type: 'normal'; mean: number; sd: number };
export type UniformDist = { type: 'uniform'; min: number; max: number };
export type ParameterDef = number | NormalDist | UniformDist;

export type BoundaryDef =
  | number            // Symmetric: upper is +b, lower is -b
  | [number, number]; // Asymmetric: [lowerBound, upperBound]

export type CollapseDef = {
  rate: number;   // Speed at which boundaries shrink per ms
  delay?: number; // Pause in ms (from phase start) before collapse begins
};

// --- Post-Stimulus Strategy Types ---

export type ContinueStrategy = {
  type: 'continue';
  residualDrift?: number;      // Drift rate after stimOffset (Default: 0)
  noiseMultiplier?: number; // Multiplier for noiseLevel (Default: 1)
};

export type CollapseStrategy = {
  type: 'collapse';
  collapseDef: CollapseDef; // Takes over boundary dynamics after stimOffset
};

export type SnapshotStrategy = {
  type: 'snapshot'; // Immediate forced choice at stimOffset
};

export type PostStimStrategyDef = ContinueStrategy | CollapseStrategy | SnapshotStrategy;

// --- Main Configuration ---

export interface DDMTrialParams {
  // Core cognitive parameters (support distributions for inter-trial variability)
  driftRate: ParameterDef;
  boundaries: BoundaryDef;
  startingPoint: ParameterDef;
  noiseLevel: ParameterDef;

  // Timing parameters
  sensoryDelay?: ParameterDef; // Dead time before accumulation (ms)
  motorDelay?: ParameterDef;   // Dead time for physical execution (ms)
  timeLimit: number;           // Maximum allowed trial duration (ms)
  stimOffset: number;          // Timestamp when stimulus vanishes (ms)
  dt?: number;                 // Resolution in ms (Default: 1)

  // Global behaviors
  contaminationRate?: number;    // Probability (0-1) of a random guess
  stimulusCollapse?: CollapseDef; // Boundary dynamics DURING stimulus visibility

  // Post-stimulus behavior
  postStimStrategy: PostStimStrategyDef;
}

// --- Result ---

export interface DDMTrialResult {
  choice: 0 | 1 | null;
  rt: number;              // Total reaction time including delays (ms)
  finalEvidence: number;   // Accumulator value at trial end
  isContaminated: boolean; // True if trial was a random lapse
}

// --- Helpers ---

function resolveParam(def: ParameterDef): number {
  if (typeof def === 'number') return def;
  if (def.type === 'normal') return normal(def.mean, def.sd);
  return uniform(def.min, def.max);
}

function resolveParamClamped(def: ParameterDef): number {
  return Math.max(0, resolveParam(def));
}

// --- Simulation ---

export function simulateDDMTrial(params: DDMTrialParams): DDMTrialResult {
  const dt = params.dt ?? 1;
  const sqrtDt = Math.sqrt(dt);

  // A1. Resolve starting point
  const startingPoint = resolveParam(params.startingPoint);

  // A2. Contamination check
  if (params.contaminationRate && uniform(0, 1) < params.contaminationRate) {
    return {
      choice: uniform(0, 1) < 0.5 ? 0 : 1,
      rt: uniform(0, params.timeLimit),
      finalEvidence: startingPoint,
      isContaminated: true,
    };
  }

  // A3. Resolve remaining distributions for this trial
  const baseDrift = resolveParam(params.driftRate);
  const baseNoise = Math.max(0, resolveParam(params.noiseLevel));
  const sensoryDelay = params.sensoryDelay != null ? resolveParamClamped(params.sensoryDelay) : 0;
  const motorDelay = params.motorDelay != null ? resolveParamClamped(params.motorDelay) : 0;

  // A4. Resolve boundaries
  let currentUpper: number;
  let currentLower: number;
  if (Array.isArray(params.boundaries)) {
    currentLower = params.boundaries[0];
    currentUpper = params.boundaries[1];
  } else {
    currentUpper = params.boundaries;
    currentLower = -params.boundaries;
  }

  // A5. Fast-forward clock past sensory delay
  let time = sensoryDelay;
  let evidence = startingPoint;
  let boundaryHit = false;
  let choice: 0 | 1 | null = null;

  // B. Simulation loop
  while (time < params.timeLimit) {
    time += dt;

    let currentDrift = baseDrift;
    let currentNoise = baseNoise;

    if (time <= params.stimOffset) {
      // Phase 1: Stimulus visible
      if (params.stimulusCollapse) {
        const elapsed = time - sensoryDelay;
        if (elapsed > (params.stimulusCollapse.delay ?? 0)) {
          currentUpper -= params.stimulusCollapse.rate * dt;
          currentLower += params.stimulusCollapse.rate * dt;
        }
      }
    } else {
      // Phase 2: Post-stimulus
      const strategy = params.postStimStrategy;
      if (strategy.type === 'snapshot') {
        const distToUpper = Math.abs(evidence - currentUpper);
        const distToLower = Math.abs(evidence - currentLower);
        return {
          choice: distToUpper <= distToLower ? 1 : 0,
          rt: time + motorDelay,
          finalEvidence: evidence,
          isContaminated: false,
        };
      } else if (strategy.type === 'continue') {
        currentDrift = strategy.residualDrift ?? 0;
        currentNoise = baseNoise * (strategy.noiseMultiplier ?? 1);
      } else {
        // collapse
        currentDrift = 0;
        const elapsed = time - params.stimOffset;
        if (elapsed > (strategy.collapseDef.delay ?? 0)) {
          currentUpper -= strategy.collapseDef.rate * dt;
          currentLower += strategy.collapseDef.rate * dt;
        }
      }
    }

    // B3. Check if evidence crossed or was passed by a boundary
    if (evidence >= currentUpper) {
      choice = 1;
      boundaryHit = true;
      break;
    }
    if (evidence <= currentLower) {
      choice = 0;
      boundaryHit = true;
      break;
    }

    // B4. Step evidence
    evidence += currentDrift * dt + currentNoise * sqrtDt * normal(0, 1);

    // B5. Check thresholds after stepping
    if (evidence >= currentUpper) {
      choice = 1;
      boundaryHit = true;
      break;
    }
    if (evidence <= currentLower) {
      choice = 0;
      boundaryHit = true;
      break;
    }
  }

  // C. Finalize output
  let rt: number;
  if (boundaryHit) {
    rt = time + motorDelay;
  } else {
    // timeLimit reached; no decision made
    rt = params.timeLimit;
    choice = null;
  }

  return { choice, rt, finalEvidence: evidence, isContaminated: false };
}

export function mapDDMChoice(
  choice: 0 | 1 | null,
  validKeys: string[],
  correctResponse?: string | string[],
): string | null {
  if (choice == null || validKeys.length === 0) return null;
  const correctKeys = Array.isArray(correctResponse)
    ? correctResponse.map((k) => k.toLowerCase())
    : correctResponse ? [correctResponse.toLowerCase()] : null;

  if (!correctKeys) {
    return validKeys[Math.floor(uniform(0, validKeys.length))];
  }

  if (choice === 1) {
    const matches = validKeys.filter((k) => correctKeys.includes(k.toLowerCase()));
    if (matches.length > 0) return matches[Math.floor(uniform(0, matches.length))];
  } else {
    const wrong = validKeys.filter((k) => !correctKeys.includes(k.toLowerCase()));
    if (wrong.length > 0) return wrong[Math.floor(uniform(0, wrong.length))];
  }

  return validKeys[Math.floor(uniform(0, validKeys.length))];
}
