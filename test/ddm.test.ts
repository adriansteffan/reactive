import { describe, it, expect, beforeEach } from 'bun:test';
import { simulateDDMTrial, mapDDMChoice } from '../src/utils/ddm';
import { seedDistributions } from '../src/utils/distributions';

beforeEach(() => {
  seedDistributions(42);
});

const baseParams = {
  driftRate: 0.003,
  boundaries: 0.1 as const,
  startingPoint: 0,
  noiseLevel: 0.003,
  timeLimitMs: 2000,
  stimOffsetMs: 2000,
  postStimStrategy: { type: 'continue' as const },
};

describe('simulateDDMTrial', () => {
  it('returns a valid result shape', () => {
    const result = simulateDDMTrial(baseParams);
    expect([0, 1, null]).toContain(result.choice);
    expect(result.rtMs).toBeGreaterThan(0);
    expect(typeof result.finalEvidence).toBe('number');
    expect(result.isContaminated).toBe(false);
  });

  it('is reproducible with the same seed', () => {
    seedDistributions(99);
    const a = simulateDDMTrial(baseParams);
    seedDistributions(99);
    const b = simulateDDMTrial(baseParams);
    expect(a).toEqual(b);
  });

  it('rt includes sensory and motor delays', () => {
    const result = simulateDDMTrial({
      ...baseParams,
      driftRate: 1, // very high drift for instant decision
      sensoryDelayMs: 100,
      motorDelayMs: 50,
    });
    expect(result.rtMs).toBeGreaterThanOrEqual(150);
  });

  it('clamps sensory and motor delays to >= 0', () => {
    const result = simulateDDMTrial({
      ...baseParams,
      driftRate: 1,
      sensoryDelayMs: { distribution: 'normal', mean: -1000, sd: 1 },
      motorDelayMs: { distribution: 'normal', mean: -1000, sd: 1 },
    });
    expect(result.rtMs).toBeGreaterThanOrEqual(0);
  });

  it('clamps noise level to >= 0', () => {
    // Should not throw even with a negative noise param
    const result = simulateDDMTrial({
      ...baseParams,
      noiseLevel: { distribution: 'normal', mean: -10, sd: 0.1 },
    });
    expect(result).toBeDefined();
  });

  it('returns null choice on timeout', () => {
    const result = simulateDDMTrial({
      ...baseParams,
      driftRate: 0,
      noiseLevel: 0, // no noise, no drift — never reaches boundary
      timeLimitMs: 100,
    });
    expect(result.choice).toBeNull();
    expect(result.rtMs).toBe(100);
  });

  it('supports asymmetric boundaries', () => {
    const result = simulateDDMTrial({
      ...baseParams,
      boundaries: [-0.05, 0.2], // lower closer, upper farther
      driftRate: 0,
      noiseLevel: 0.01,
    });
    expect([0, 1, null]).toContain(result.choice);
  });

  it('contamination returns isContaminated with valid rt', () => {
    const result = simulateDDMTrial({ ...baseParams, contaminationRate: 1.0 });
    expect(result.isContaminated).toBe(true);
    expect(result.rtMs).toBeGreaterThanOrEqual(0);
    expect(result.rtMs).toBeLessThanOrEqual(baseParams.timeLimitMs);
  });

  it('contamination sets finalEvidence to startingPoint', () => {
    const result = simulateDDMTrial({
      ...baseParams,
      startingPoint: 0.05,
      contaminationRate: 1.0,
    });
    expect(result.isContaminated).toBe(true);
    expect(result.finalEvidence).toBe(0.05);
  });
});

describe('snapshot strategy', () => {
  it('forces choice at stimOffsetMs based on boundary proximity', () => {
    const result = simulateDDMTrial({
      ...baseParams,
      driftRate: 0.01, // positive drift, evidence moves toward upper
      stimOffsetMs: 50,
      postStimStrategy: { type: 'snapshot' },
    });
    expect<(number | null)[]>([0, 1]).toContain(result.choice);
    expect(result.isContaminated).toBe(false);
  });

  it('rt reflects stimOffsetMs timing, not timeLimitMs', () => {
    const result = simulateDDMTrial({
      ...baseParams,
      driftRate: 0.0001, // slow drift, won't hit boundary before stimOffsetMs
      noiseLevel: 0.0001,
      sensoryDelayMs: 0,
      motorDelayMs: 100,
      stimOffsetMs: 200,
      timeLimitMs: 5000,
      postStimStrategy: { type: 'snapshot' },
    });
    // rt should be around stimOffsetMs + motorDelayMs, not timeLimitMs
    expect(result.rtMs).toBeLessThan(5000);
    expect(result.rtMs).toBeGreaterThanOrEqual(200);
  });
});

describe('continue strategy', () => {
  it('defaults to zero drift after stimOffsetMs', () => {
    // With zero drift and no noise after stimOffsetMs, evidence should freeze
    const result = simulateDDMTrial({
      ...baseParams,
      driftRate: 0,
      noiseLevel: 0,
      stimOffsetMs: 10,
      timeLimitMs: 100,
      postStimStrategy: { type: 'continue' },
    });
    expect(result.choice).toBeNull(); // no drift, no noise — timeout
  });

});

describe('collapse strategy', () => {
  it('eventually forces a decision', () => {
    const result = simulateDDMTrial({
      ...baseParams,
      driftRate: 0,
      noiseLevel: 0.001,
      stimOffsetMs: 0,
      timeLimitMs: 10000,
      postStimStrategy: {
        type: 'collapse',
        collapseDef: { rate: 0.001 },
      },
    });
    // Boundaries collapse, must eventually reach evidence
    expect<(number | null)[]>([0, 1]).toContain(result.choice);
  });

  it('respects collapse delay', () => {
    const fast = simulateDDMTrial({
      ...baseParams,
      driftRate: 0,
      noiseLevel: 0.0001,
      stimOffsetMs: 0,
      timeLimitMs: 10000,
      postStimStrategy: {
        type: 'collapse',
        collapseDef: { rate: 0.001, delayMs: 0 },
      },
    });
    const delayed = simulateDDMTrial({
      ...baseParams,
      driftRate: 0,
      noiseLevel: 0.0001,
      stimOffsetMs: 0,
      timeLimitMs: 10000,
      postStimStrategy: {
        type: 'collapse',
        collapseDef: { rate: 0.001, delayMs: 500 },
      },
    });
    // Delayed collapse should take longer (or at least not be faster)
    expect(delayed.rtMs).toBeGreaterThanOrEqual(fast.rtMs);
  });
});

describe('mapDDMChoice', () => {
  it('returns null for null choice', () => {
    expect(mapDDMChoice(null, ['a', 'b'])).toBeNull();
  });

  it('returns null for empty allowedResponseKeys', () => {
    expect(mapDDMChoice(1, [])).toBeNull();
  });

  it('maps choice 1 to correct key', () => {
    const key = mapDDMChoice(1, ['a', 'b'], 'a');
    expect(key).toBe('a');
  });

  it('maps choice 0 to incorrect key', () => {
    const key = mapDDMChoice(0, ['a', 'b'], 'a');
    expect(key).toBe('b');
  });

  it('handles case-insensitive correctResponse', () => {
    const key = mapDDMChoice(1, ['A', 'b'], 'a');
    expect(key?.toLowerCase()).toBe('a');
  });

  it('handles array correctResponse', () => {
    const key = mapDDMChoice(1, ['a', 'b', 'c'], ['a', 'b']);
    expect<(string | null)[]>(['a', 'b']).toContain(key);
  });

  it('returns random key when no correctResponse', () => {
    const key = mapDDMChoice(1, ['a', 'b']);
    expect<(string | null)[]>(['a', 'b']).toContain(key);
  });

  it('falls back to any key when no matching keys for choice', () => {
    // choice 0 (incorrect), but all keys are correct — no wrong keys available
    const key = mapDDMChoice(0, ['a'], 'a');
    expect(key).toBe('a');
  });
});
