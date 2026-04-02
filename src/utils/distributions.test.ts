import { describe, it, expect } from 'vitest';
import { sobol, halton, seedDistributions, normal, uniform, poisson, sampleParticipants } from './distributions';

// Known Sobol sequence values (1D, Van der Corput base 2, skipping the zero point)
// Reference: https://en.wikipedia.org/wiki/Van_der_Corput_sequence
const SOBOL_1D_EXPECTED = [0.5, 0.75, 0.25, 0.375, 0.875, 0.625, 0.125, 0.1875];

// Known Halton sequence values (base 2 and 3, skipping the zero point)
// Reference: https://en.wikipedia.org/wiki/Halton_sequence
const HALTON_2D_EXPECTED = [
  [0.5, 1 / 3],
  [0.25, 2 / 3],
  [0.75, 1 / 9],
  [0.125, 4 / 9],
  [0.625, 7 / 9],
];

describe('sobol', () => {
  it('produces known 1D Van der Corput values', () => {
    const result = sobol(8, [{ distribution: 'uniform', min: 0, max: 1 }]) as number[];
    expect(result).toHaveLength(8);
    for (let i = 0; i < SOBOL_1D_EXPECTED.length; i++) {
      expect(result[i]).toBeCloseTo(SOBOL_1D_EXPECTED[i], 10);
    }
  });

  it('produces known 2D values', () => {
    const result = sobol(4, [
      { distribution: 'uniform', min: 0, max: 1 },
      { distribution: 'uniform', min: 0, max: 1 },
    ]) as number[][];
    // First 2D Sobol points (after skipping zero): [0.5, 0.5], [0.75, 0.25], [0.25, 0.75]
    expect(result[0]).toEqual([expect.closeTo(0.5, 10), expect.closeTo(0.5, 10)]);
    expect(result[1]).toEqual([expect.closeTo(0.75, 10), expect.closeTo(0.25, 10)]);
    expect(result[2]).toEqual([expect.closeTo(0.25, 10), expect.closeTo(0.75, 10)]);
  });

  it('scales uniform dimensions correctly', () => {
    const result = sobol(3, [{ distribution: 'uniform', min: 200, max: 800 }]) as number[];
    // 0.5 * 600 + 200 = 500, 0.75 * 600 + 200 = 650, 0.25 * 600 + 200 = 350
    expect(result[0]).toBeCloseTo(500, 10);
    expect(result[1]).toBeCloseTo(650, 10);
    expect(result[2]).toBeCloseTo(350, 10);
  });

  it('produces correct count of points', () => {
    const result = sobol(100, [{ distribution: 'uniform', min: 0, max: 1 }]) as number[];
    expect(result).toHaveLength(100);
  });

  it('returns flat array for 1D, nested for multi-D', () => {
    const r1 = sobol(3, [{ distribution: 'uniform', min: 0, max: 1 }]);
    expect(typeof r1[0]).toBe('number');

    const r2 = sobol(3, [
      { distribution: 'uniform', min: 0, max: 1 },
      { distribution: 'uniform', min: 0, max: 1 },
    ]);
    expect(Array.isArray(r2[0])).toBe(true);
  });

  it('all 1D values are in [0, 1] for unit range', () => {
    const result = sobol(1000, [{ distribution: 'uniform', min: 0, max: 1 }]) as number[];
    for (const v of result) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('produces no duplicate points in 2D', () => {
    const result = sobol(100, [
      { distribution: 'uniform', min: 0, max: 1 },
      { distribution: 'uniform', min: 0, max: 1 },
    ]) as number[][];
    const keys = new Set(result.map(([a, b]) => `${a},${b}`));
    expect(keys.size).toBe(100);
  });

  it('is deterministic (same call twice gives same result)', () => {
    const a = sobol(50, [{ distribution: 'uniform', min: 0, max: 1 }]);
    const b = sobol(50, [{ distribution: 'uniform', min: 0, max: 1 }]);
    expect(a).toEqual(b);
  });

  it('throws for dimensions > 21', () => {
    const specs = Array.from({ length: 22 }, () => ({ distribution: 'uniform' as const, min: 0, max: 1 }));
    expect(() => sobol(10, specs)).toThrow('1-21 dimensions');
  });
});

describe('halton', () => {
  it('produces known 2D values (bases 2, 3)', () => {
    const result = halton(5, [
      { distribution: 'uniform', min: 0, max: 1 },
      { distribution: 'uniform', min: 0, max: 1 },
    ]) as number[][];
    for (let i = 0; i < HALTON_2D_EXPECTED.length; i++) {
      expect(result[i][0]).toBeCloseTo(HALTON_2D_EXPECTED[i][0], 10);
      expect(result[i][1]).toBeCloseTo(HALTON_2D_EXPECTED[i][1], 10);
    }
  });

  it('is deterministic', () => {
    const a = halton(50, [{ distribution: 'uniform', min: 0, max: 1 }]);
    const b = halton(50, [{ distribution: 'uniform', min: 0, max: 1 }]);
    expect(a).toEqual(b);
  });
});

describe('normal distribution spec', () => {
  it('produces values centered around the mean', () => {
    const result = sobol(1000, [{ distribution: 'normal', mean: 500, sd: 100 }]) as number[];
    const avg = result.reduce((a, b) => a + b, 0) / result.length;
    expect(avg).toBeCloseTo(500, 0);
  });

  it('median is close to mean (symmetric distribution)', () => {
    const result = sobol(1000, [{ distribution: 'normal', mean: 500, sd: 100 }]) as number[];
    const sorted = [...result].sort((a, b) => a - b);
    const median = sorted[500];
    expect(median).toBeCloseTo(500, 0);
  });
});

describe('poisson distribution spec', () => {
  it('produces non-negative integers', () => {
    const result = sobol(100, [{ distribution: 'poisson', mean: 5 }]) as number[];
    for (const v of result) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('mean is close to lambda', () => {
    const result = sobol(1000, [{ distribution: 'poisson', mean: 5 }]) as number[];
    const avg = result.reduce((a, b) => a + b, 0) / result.length;
    expect(avg).toBeCloseTo(5, 0);
  });
});

describe('sampleParticipants', () => {
  it('returns objects with the correct keys', () => {
    const result = sampleParticipants('sobol', 5, {
      rtMean: { distribution: 'normal', mean: 500, sd: 100 },
      threshold: { distribution: 'uniform', min: 0.3, max: 0.7 },
    });
    expect(result).toHaveLength(5);
    for (const p of result) {
      expect(p).toHaveProperty('rtMean');
      expect(p).toHaveProperty('threshold');
      expect(typeof p.rtMean).toBe('number');
      expect(typeof p.threshold).toBe('number');
    }
  });

  it('sobol produces deterministic results', () => {
    const a = sampleParticipants('sobol', 10, { x: { distribution: 'uniform', min: 0, max: 1 } });
    const b = sampleParticipants('sobol', 10, { x: { distribution: 'uniform', min: 0, max: 1 } });
    expect(a).toEqual(b);
  });

  it('halton produces deterministic results', () => {
    const a = sampleParticipants('halton', 10, { x: { distribution: 'uniform', min: 0, max: 1 } });
    const b = sampleParticipants('halton', 10, { x: { distribution: 'uniform', min: 0, max: 1 } });
    expect(a).toEqual(b);
  });

  it('random method produces valid values', () => {
    const result = sampleParticipants('random', 50, {
      score: { distribution: 'poisson', mean: 5 },
    });
    expect(result).toHaveLength(50);
    for (const p of result) {
      expect(Number.isInteger(p.score)).toBe(true);
      expect(p.score).toBeGreaterThanOrEqual(0);
    }
  });

  it('works with a single dimension', () => {
    const result = sampleParticipants('sobol', 3, {
      rt: { distribution: 'uniform', min: 200, max: 800 },
    });
    expect(result[0].rt).toBeCloseTo(500, 10);
    expect(result[1].rt).toBeCloseTo(650, 10);
    expect(result[2].rt).toBeCloseTo(350, 10);
  });
});

describe('seedDistributions', () => {
  it('makes pseudorandom samplers reproducible', () => {
    seedDistributions(42);
    const a = [normal(0, 1), uniform(0, 10), poisson(5)];

    seedDistributions(42);
    const b = [normal(0, 1), uniform(0, 10), poisson(5)];

    expect(a).toEqual(b);
  });

  it('different seeds produce different sequences', () => {
    seedDistributions(1);
    const a = normal(0, 1);

    seedDistributions(2);
    const b = normal(0, 1);

    expect(a).not.toBe(b);
  });
});
