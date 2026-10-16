import { describe, it, expect } from 'bun:test';
import {
  sobol,
  halton,
  seedDistributions,
  withStream,
  normal,
  uniform,
  poisson,
  sampleParticipants,
  mt19937,
  standardNormalQuantile,
  poissonQuantile,
} from '../src/utils/distributions';

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

// --- Samplers and quantile functions ---

function moments(values: number[]) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return { mean, variance };
}

function draws<T>(count: number, sample: () => T): T[] {
  return Array.from({ length: count }, sample);
}

describe('mt19937', () => {
  it('matches the reference implementation for the default seed', () => {
    const next = mt19937(5489);
    const outputs = Array.from({ length: 10000 }, next);
    expect(outputs.slice(0, 5)).toEqual([3499211612, 581869302, 3890346734, 3586334585, 545404204]);
    // The C++ standard requires this value as the 10000th output of std::mt19937
    expect(outputs[9999]).toBe(4123659995);
    expect(outputs.reduce((a, b) => a + b, 0)).toBe(21571313423311);
  });

  it('matches the reference implementation for a seed of several numbers', () => {
    // The first outputs of mt19937ar.c's test program, which seeds with init_by_array
    const next = mt19937([0x123, 0x234, 0x345, 0x456]);
    expect(Array.from({ length: 10 }, next)).toEqual([
      1067595299, 955945823, 477289528, 4107218783, 4228976476, 3344332714, 3355579695, 227628506,
      810200273, 2591290167,
    ]);
  });
});

describe('streams seeded with several numbers', () => {
  const firstDraws = (seed: number[]) => withStream(seed, async () => draws(5, () => uniform(0, 1)).join());

  it('do not overlap when keys differ in any part, unlike adding an index to a seed', async () => {
    seedDistributions([42, 0]);
    const list = draws(5, () => uniform(0, 1)).join();
    expect(await firstDraws([42, 1, 0])).not.toBe(list);
    expect(await firstDraws([43, 1, 0])).not.toBe(await firstDraws([42, 1, 1]));
    expect(await firstDraws([42, 1, 7])).toBe(await firstDraws([42, 1, 7]));
  });
});

describe('seedDistributions', () => {
  const sampleAll = () => [uniform(0, 1), normal(0, 1), poisson(4), poisson(800), Math.random()];

  it('makes every sampler and Math.random reproducible', () => {
    seedDistributions(7);
    const first = draws(50, () => sampleAll()).flat();
    seedDistributions(7);
    const second = draws(50, () => sampleAll()).flat();
    expect(first).toEqual(second);
  });

  it('gives different streams for different seeds', () => {
    seedDistributions(7);
    const a = draws(20, () => uniform(0, 1));
    seedDistributions(8);
    const b = draws(20, () => uniform(0, 1));
    expect(a).not.toEqual(b);
  });

  it('produces values in [0, 1) on a 2^-53 grid', () => {
    seedDistributions(3);
    for (const u of draws(10000, () => uniform(0, 1))) {
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      expect(Number.isInteger(u * 2 ** 53)).toBe(true);
    }
  });
});

// The samplers are checked at fixed seeds against tolerances of about four standard errors
describe('uniform sampler', () => {
  it('has the moments and distribution of U(min, max)', () => {
    seedDistributions(11);
    const n = 200000;
    const values = draws(n, () => uniform(-2, 6));
    const { mean, variance } = moments(values);
    expect(Math.abs(mean - 2)).toBeLessThan(4 * Math.sqrt(64 / 12 / n));
    expect(Math.abs(variance - 64 / 12)).toBeLessThan(4 * Math.sqrt(64 ** 2 / 180 / n));
    // Kolmogorov-Smirnov distance, critical value at alpha = 0.001
    const sorted = values.map((v) => (v + 2) / 8).sort((a, b) => a - b);
    const distance = Math.max(...sorted.map((v, i) => Math.max(Math.abs((i + 1) / n - v), Math.abs(v - i / n))));
    expect(distance).toBeLessThan(1.95 / Math.sqrt(n));
  });
});

describe('normal sampler', () => {
  it('has the moments and quantiles of N(mu, sigma)', () => {
    seedDistributions(12);
    const n = 200000;
    const values = draws(n, () => normal(3, 2));
    const { mean, variance } = moments(values);
    expect(Math.abs(mean - 3)).toBeLessThan(4 * Math.sqrt(4 / n));
    expect(Math.abs(variance - 4)).toBeLessThan(4 * Math.sqrt((2 * 16) / n));
    const sorted = [...values].sort((a, b) => a - b);
    for (const q of [0.001, 0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99, 0.999]) {
      const z = standardNormalQuantile(q);
      const density = Math.exp(-(z * z) / 2) / Math.sqrt(2 * Math.PI) / 2;
      const standardError = Math.sqrt((q * (1 - q)) / n) / density;
      expect(Math.abs(sorted[Math.floor(q * n)] - (3 + 2 * z))).toBeLessThan(4 * standardError);
    }
  });
});

describe('poisson sampler', () => {
  // 499.5 and 500 sit on either side of the point where draws are split into chunks
  for (const lambda of [0.5, 4, 30, 499.5, 500, 1234.5]) {
    it(`has mean and variance ${lambda}`, () => {
      seedDistributions(13);
      const n = lambda > 100 ? 20000 : 100000;
      const values = draws(n, () => poisson(lambda));
      for (const v of values) expect(Number.isInteger(v) && v >= 0).toBe(true);
      const { mean, variance } = moments(values);
      expect(Math.abs(mean - lambda)).toBeLessThan(4 * Math.sqrt(lambda / n));
      expect(Math.abs(variance - lambda)).toBeLessThan(4 * Math.sqrt((lambda + 2 * lambda * lambda) / n));
    });
  }

  it('matches the Poisson probabilities for lambda 4 (chi-square test)', () => {
    seedDistributions(14);
    const n = 100000;
    const counts = new Array(12).fill(0);
    for (const v of draws(n, () => poisson(4))) counts[Math.min(v, 11)]++;
    const masses = Array.from({ length: 11 }, (_, k) => {
      let mass = Math.exp(-4);
      for (let i = 1; i <= k; i++) mass *= 4 / i;
      return mass;
    });
    masses.push(1 - masses.reduce((a, b) => a + b, 0));
    const chiSquare = counts.reduce((sum, observed, k) => sum + (observed - n * masses[k]) ** 2 / (n * masses[k]), 0);
    // Critical value for 11 degrees of freedom at alpha = 0.001
    expect(chiSquare).toBeLessThan(31.26);
  });

  it('returns NaN for a negative mean and 0 for a mean of 0', () => {
    expect(poisson(-1)).toBeNaN();
    expect(poisson(0)).toBe(0);
  });
});

describe('standardNormalQuantile', () => {
  // Exact quantiles of each input's double value, computed with mpmath at 400 digits
  const REFERENCE: [number, number][] = [
    [1e-300, -37.0470962993612],
    [1e-100, -21.273453560965326],
    [1e-20, -9.262340089798407],
    [1e-10, -6.361340902404057],
    [0.001, -3.0902323061678136],
    [0.025, -1.9599639845400543],
    [0.1, -1.2815515655446004],
    [0.3, -0.5244005127080408],
    [0.425, -0.18911842627279252],
    [0.5, 0],
    [0.6, 0.2533471031357997],
    [0.9, 1.2815515655446006],
    [0.975, 1.9599639845400538],
    [0.999, 3.090232306167813],
    [0.9999999999, 6.361340889697422],
  ];

  it('matches reference values to about 1e-14', () => {
    for (const [p, expected] of REFERENCE) {
      expect(Math.abs(standardNormalQuantile(p) - expected)).toBeLessThanOrEqual(1e-14 * Math.max(1, Math.abs(expected)));
    }
  });

  it('is symmetric and increasing', () => {
    let previous = -Infinity;
    for (let i = 1; i < 1000; i++) {
      const value = standardNormalQuantile(i / 1000);
      expect(value).toBeGreaterThan(previous);
      expect(Math.abs(value + standardNormalQuantile(1 - i / 1000))).toBeLessThan(1e-12);
      previous = value;
    }
  });
});

describe('poissonQuantile', () => {
  // [lambda, p, smallest k with P(X <= k) >= p], computed exactly with mpmath
  const REFERENCE: [number, number, number][] = [
    [0.3, 0.001, 0], [0.3, 0.5, 0], [0.3, 0.75, 1], [0.3, 0.95, 1], [0.3, 0.999, 3],
    [1, 0.001, 0], [1, 0.5, 1], [1, 0.75, 2], [1, 0.95, 3], [1, 0.999, 5],
    [4.5, 0.001, 0], [4.5, 0.05, 1], [4.5, 0.25, 3], [4.5, 0.5, 4], [4.5, 0.75, 6], [4.5, 0.95, 8], [4.5, 0.999, 12],
    [20, 0.001, 8], [20, 0.05, 13], [20, 0.25, 17], [20, 0.5, 20], [20, 0.75, 23], [20, 0.95, 28], [20, 0.999, 35],
    [150, 0.001, 114], [150, 0.05, 130], [150, 0.25, 142], [150, 0.5, 150], [150, 0.75, 158], [150, 0.95, 170], [150, 0.999, 189],
    [1000, 0.001, 904], [1000, 0.05, 948], [1000, 0.25, 979], [1000, 0.5, 1000], [1000, 0.75, 1021], [1000, 0.95, 1052], [1000, 0.999, 1099],
  ];

  it('matches exact reference values', () => {
    for (const [lambda, p, expected] of REFERENCE) {
      expect(poissonQuantile(p, lambda)).toBe(expected);
    }
  });

  it('includes the boundary: p equal to P(X <= k) gives k', () => {
    expect(poissonQuantile(Math.exp(-2), 2)).toBe(0);
    expect(poissonQuantile(Math.exp(-2) * 3, 2)).toBe(1);
  });

  it('is 0 for a mean of 0 and never decreases in p', () => {
    expect(poissonQuantile(0.9, 0)).toBe(0);
    let previous = 0;
    for (let i = 1; i < 1000; i++) {
      const value = poissonQuantile(i / 1000, 37.5);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});
