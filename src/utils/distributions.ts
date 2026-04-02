import mt19937 from '@stdlib/random-base-mt19937';
import normalFactory from '@stdlib/random-base-normal';
import poissonFactory from '@stdlib/random-base-poisson';
import uniformFactory from '@stdlib/random-base-uniform';
import normalQuantile from '@stdlib/stats-base-dists-normal-quantile';
import poissonQuantile from '@stdlib/stats-base-dists-poisson-quantile';
import generateHalton from 'halton';

// --- Pseudorandom samplers (seedable) ---

let normal: (mu: number, sigma: number) => number = normalFactory;
let poisson: (lambda: number) => number = poissonFactory;
let uniform: (min: number, max: number) => number = uniformFactory;

interface StdlibPRNG {
  normalized: () => number;
}

function seedDistributions(seed: number): void {
  const prng = mt19937.factory({ seed }) as unknown as StdlibPRNG;
  normal = normalFactory.factory({ prng: prng.normalized });
  poisson = poissonFactory.factory({ prng: prng.normalized });
  uniform = uniformFactory.factory({ prng: prng.normalized });
  Math.random = () => uniform(0, 1);
}

// --- QMC dimension specs ---
// Inverse CDF transform: https://en.wikipedia.org/wiki/Inverse_transform_sampling

type UniformSpec = { distribution: 'uniform'; min: number; max: number };
type NormalSpec = { distribution: 'normal'; mean: number; sd: number };
type PoissonSpec = { distribution: 'poisson'; mean: number };
type DimensionSpec = UniformSpec | NormalSpec | PoissonSpec;

// Inverse CDFs return +-Infinity at exactly 0 or 1, so clamp to open interval (0, 1).
function clampUnit(value: number): number {
  return Math.max(1e-10, Math.min(1 - 1e-10, value));
}

function resolveTransform(spec: DimensionSpec): (unitValue: number) => number {
  switch (spec.distribution) {
    case 'uniform':
      return (u) => spec.min + u * (spec.max - spec.min);
    case 'normal':
      return (u) => normalQuantile(clampUnit(u), spec.mean, spec.sd);
    case 'poisson':
      // QMC variance reduction is less effective on discrete distributions
      // due to integer clumping at quantile boundaries.
      return (u) => poissonQuantile(clampUnit(u), spec.mean);
  }
}

function transformPoints(unitPoints: number[][], specs: DimensionSpec[]): number[] | number[][] {
  const transforms = specs.map(resolveTransform);
  if (specs.length === 1) {
    return unitPoints.map((point) => transforms[0](point[0]));
  }
  return unitPoints.map((point) =>
    point.map((unitValue, dim) => transforms[dim](unitValue)),
  );
}

// --- Sobol sequence (browser-compatible implementation as existing packages want to use fs) ---
// Algorithm: Bratley & Fox (1988), https://doi.org/10.1145/42288.214372
// Joe-Kuo direction numbers for dimensions 2-21 (dimension 1 uses Van der Corput base 2).
// Each entry is [degree, polynomialCoefficients, initialDirectionNumbers].
// Direction numbers: Joe & Kuo (2008), https://doi.org/10.1137/070709359
// Data: https://web.maths.unsw.edu.au/~fkuo/sobol/joe-kuo-old.1111
const JOE_KUO: [number, number, number[]][] = [
  [1, 0, [1]],                          // dim 2
  [2, 1, [1, 1]],                       // dim 3
  [3, 1, [1, 3, 7]],                    // dim 4
  [3, 2, [1, 1, 5]],                    // dim 5
  [4, 1, [1, 3, 1, 1]],                 // dim 6
  [4, 4, [1, 1, 3, 7]],                 // dim 7
  [5, 2, [1, 3, 3, 9, 9]],              // dim 8
  [5, 13, [1, 3, 7, 13, 3]],            // dim 9
  [5, 7, [1, 1, 5, 11, 27]],            // dim 10
  [5, 14, [1, 3, 5, 1, 15]],            // dim 11
  [5, 11, [1, 1, 7, 3, 29]],            // dim 12
  [5, 4, [1, 3, 7, 7, 21]],             // dim 13
  [6, 1, [1, 1, 1, 9, 23, 37]],         // dim 14
  [6, 16, [1, 3, 3, 5, 19, 33]],        // dim 15
  [6, 13, [1, 1, 3, 13, 11, 7]],        // dim 16
  [6, 22, [1, 1, 7, 13, 25, 5]],        // dim 17
  [6, 19, [1, 3, 5, 11, 7, 11]],        // dim 18
  [6, 25, [1, 1, 1, 3, 13, 39]],        // dim 19
  [7, 1, [1, 3, 1, 15, 17, 63, 13]],    // dim 20
  [7, 32, [1, 1, 5, 5, 1, 59, 33]],     // dim 21
];

const BITS = 32;
const SCALE = 2 ** BITS;

function buildDirectionNumbers(dimension: number): Uint32Array {
  const directions = new Uint32Array(BITS);
  if (dimension === 0) {
    for (let i = 0; i < BITS; i++) directions[i] = 1 << (BITS - 1 - i);
    return directions;
  }
  const [degree, coefficients, initial] = JOE_KUO[dimension - 1];
  for (let i = 0; i < degree; i++) directions[i] = initial[i] << (BITS - 1 - i);
  for (let i = degree; i < BITS; i++) {
    directions[i] = directions[i - degree] ^ (directions[i - degree] >>> degree);
    for (let j = 1; j < degree; j++) {
      if ((coefficients >>> (degree - 1 - j)) & 1) directions[i] ^= directions[i - j];
    }
  }
  return directions;
}

function generateSobol(count: number, dimensions: number): number[][] {
  if (dimensions < 1 || dimensions > 21) {
    throw new RangeError('sobol() supports 1-21 dimensions');
  }
  const allDirections = Array.from({ length: dimensions }, (_, dim) => buildDirectionNumbers(dim));
  const state = new Uint32Array(dimensions);
  const points: number[][] = [new Array<number>(dimensions).fill(0)];
  for (let index = 1; index < count; index++) {
    // Find the position of the rightmost zero bit
    let rightmostZero = 0;
    let bits = index - 1;
    while ((bits & 1) === 1) { bits >>>= 1; rightmostZero++; }
    for (let dim = 0; dim < dimensions; dim++) state[dim] ^= allDirections[dim][rightmostZero];
    points.push(Array.from(state, (value) => value / SCALE));
  }
  return points;
}

// --- Halton sequence ---
// Halton (1960), https://doi.org/10.1007/BF01386213
const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73];
const HALTON_MAX_EFFECTIVE_DIMS = 6;

function sobol(count: number, specs: DimensionSpec[]): number[] | number[][] {
  // Generate count+1 and skip the first point (always zero in every dimension)
  const unitPoints = generateSobol(count + 1, specs.length).slice(1);
  return transformPoints(unitPoints, specs);
}

function halton(count: number, specs: DimensionSpec[]): number[] | number[][] {
  if (specs.length > HALTON_MAX_EFFECTIVE_DIMS) {
    console.warn(`Halton sequence quality degrades above ${HALTON_MAX_EFFECTIVE_DIMS} dimensions. Consider using sobol() instead.`);
  }
  const bases = PRIMES.slice(0, specs.length);
  // Generate count+1 and skip the first point (always zero in every dimension)
  const unitPoints = (generateHalton(count + 1, bases) as number[][]).slice(1);
  return transformPoints(unitPoints, specs);
}

type SamplingMethod = 'sobol' | 'halton' | 'random';

function sampleParticipants<T extends Record<string, DimensionSpec>>(
  method: SamplingMethod,
  count: number,
  specs: T,
): Array<{ [K in keyof T]: number }> {
  const keys = Object.keys(specs) as (keyof T & string)[];
  const dimSpecs = keys.map((k) => specs[k]);

  let points: number[] | number[][];
  switch (method) {
    case 'sobol':
      points = sobol(count, dimSpecs);
      break;
    case 'halton':
      points = halton(count, dimSpecs);
      break;
    case 'random':
      points = randomPoints(count, dimSpecs);
      break;
  }

  return Array.from({ length: count }, (_, i) => {
    const row = keys.length === 1 ? [points[i] as number] : (points[i] as number[]);
    return Object.fromEntries(keys.map((k, d) => [k, row[d]])) as { [K in keyof T]: number };
  });
}

function randomPoints(count: number, specs: DimensionSpec[]): number[] | number[][] {
  const transforms = specs.map(resolveTransform);
  if (specs.length === 1) {
    return Array.from({ length: count }, () => transforms[0](uniform(0, 1)));
  }
  return Array.from({ length: count }, () =>
    transforms.map((t) => t(uniform(0, 1))),
  );
}

export { normal, poisson, uniform, seedDistributions, sobol, halton, sampleParticipants };
export type { DimensionSpec, UniformSpec, NormalSpec, PoissonSpec, SamplingMethod };
