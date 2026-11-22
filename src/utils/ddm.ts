import { type NormalSpec, normal, type UniformSpec, uniform } from './distributions';

// --- Distribution & Parameter Types ---

export type ParameterDef = number | NormalSpec | UniformSpec;

export type BoundaryDef =
  | number            // Symmetric: upper is +b, lower is -b
  | [number, number]; // Asymmetric: [lowerBound, upperBound]

export type CollapseDef = {
  rate: number;   // Speed at which boundaries shrink per ms
  delayMs?: number; // Pause (from phase start) before collapse begins
};

// --- Post-Stimulus Strategy Types ---

export type ContinueStrategy = {
  type: 'continue';
  residualDrift?: number;      // Drift rate after stimOffsetMs (Default: 0)
  noiseMultiplier?: number; // Multiplier for noiseLevel (Default: 1)
};

export type CollapseStrategy = {
  type: 'collapse';
  collapseDef: CollapseDef; // Takes over boundary dynamics after stimOffsetMs
};

export type SnapshotStrategy = {
  type: 'snapshot'; // Immediate forced choice at stimOffsetMs
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
  sensoryDelayMs?: ParameterDef; // Dead time before accumulation
  motorDelayMs?: ParameterDef;   // Dead time for physical execution
  timeLimitMs: number;           // Maximum allowed trial duration
  stimOffsetMs: number;          // Timestamp when stimulus vanishes
  dtMs?: number;               // Resolution (Default: 1)

  // Global behaviors
  contaminationRate?: number;    // Probability (0-1) of a random guess
  stimulusCollapse?: CollapseDef; // Boundary dynamics DURING stimulus visibility

  // Post-stimulus behavior
  postStimStrategy: PostStimStrategyDef;
}

// --- Result ---

export interface DDMTrialResult {
  choice: 0 | 1 | null;
  reactionTimeMs: number;  // Total reaction time including delays
  finalEvidence: number;   // Accumulator value at trial end
  isContaminated: boolean; // True if trial was a random lapse
}

// --- Helpers ---

function resolveParam(def: ParameterDef): number {
  if (typeof def === 'number') return def;
  if (def.distribution === 'normal') return normal(def.mean, def.sd);
  return uniform(def.min, def.max);
}

function crossed(evidence: number, lower: number, upper: number): 0 | 1 | null {
  if (evidence >= upper) return 1;
  if (evidence <= lower) return 0;
  return null;
}

// --- Simulation ---

export function simulateDDMTrial(params: DDMTrialParams): DDMTrialResult {
  const dt = params.dtMs ?? 1;
  const sqrtDt = Math.sqrt(dt);

  // A1. Resolve starting point
  const startingPoint = resolveParam(params.startingPoint);

  // A2. Contamination check
  if (params.contaminationRate && uniform(0, 1) < params.contaminationRate) {
    return {
      choice: uniform(0, 1) < 0.5 ? 0 : 1,
      reactionTimeMs: uniform(0, params.timeLimitMs),
      finalEvidence: startingPoint,
      isContaminated: true,
    };
  }

  // A3. Resolve remaining distributions for this trial
  const baseDrift = resolveParam(params.driftRate);
  const baseNoise = Math.max(0, resolveParam(params.noiseLevel));
  const sensoryDelay = Math.max(0, resolveParam(params.sensoryDelayMs ?? 0));
  const motorDelay = Math.max(0, resolveParam(params.motorDelayMs ?? 0));

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
  let choice: 0 | 1 | null = null;

  // B. Simulation loop
  while (time < params.timeLimitMs) {
    time += dt;

    let currentDrift = baseDrift;
    let currentNoise = baseNoise;

    if (time <= params.stimOffsetMs) {
      // Phase 1: Stimulus visible
      if (params.stimulusCollapse) {
        const elapsed = time - sensoryDelay;
        if (elapsed > (params.stimulusCollapse.delayMs ?? 0)) {
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
          reactionTimeMs: time + motorDelay,
          finalEvidence: evidence,
          isContaminated: false,
        };
      } else if (strategy.type === 'continue') {
        currentDrift = strategy.residualDrift ?? 0;
        currentNoise = baseNoise * (strategy.noiseMultiplier ?? 1);
      } else {
        // collapse
        currentDrift = 0;
        const elapsed = time - params.stimOffsetMs;
        if (elapsed > (strategy.collapseDef.delayMs ?? 0)) {
          currentUpper -= strategy.collapseDef.rate * dt;
          currentLower += strategy.collapseDef.rate * dt;
        }
      }
    }

    // B3. A collapsing boundary can pass the evidence, so check before the step as well
    choice = crossed(evidence, currentLower, currentUpper);
    if (choice !== null) break;

    // B4. Step evidence
    evidence += currentDrift * dt + currentNoise * sqrtDt * normal(0, 1);

    // B5. Check thresholds after stepping
    choice = crossed(evidence, currentLower, currentUpper);
    if (choice !== null) break;
  }

  // C. Without a decision, the trial ends at the time limit
  return {
    choice,
    reactionTimeMs: choice === null ? params.timeLimitMs : time + motorDelay,
    finalEvidence: evidence,
    isContaminated: false,
  };
}

export function mapDDMChoice(
  choice: 0 | 1 | null,
  allowedResponseKeys: readonly string[],
  correctResponse?: string | readonly string[],
): string | null {
  if (choice == null || allowedResponseKeys.length === 0) return null;
  const correctKeys = correctResponse === undefined ? null : [correctResponse].flat().map((k) => k.toLowerCase());

  if (!correctKeys) {
    return allowedResponseKeys[Math.floor(uniform(0, allowedResponseKeys.length))];
  }

  if (choice === 1) {
    const matches = allowedResponseKeys.filter((k) => correctKeys.includes(k.toLowerCase()));
    if (matches.length > 0) return matches[Math.floor(uniform(0, matches.length))];
  } else {
    const wrong = allowedResponseKeys.filter((k) => !correctKeys.includes(k.toLowerCase()));
    if (wrong.length > 0) return wrong[Math.floor(uniform(0, wrong.length))];
  }

  return allowedResponseKeys[Math.floor(uniform(0, allowedResponseKeys.length))];
}
