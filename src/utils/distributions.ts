import type { AsyncLocalStorage } from 'node:async_hooks';

// --- Pseudorandom samplers (seedable) ---

// Mersenne Twister MT19937, Matsumoto & Nishimura (1998), https://doi.org/10.1145/272991.272995
// Returns the generator's 32-bit integer stream. A seed of several numbers is used as the
// reference init_by_array does, so that keys like [seed, purpose, index] never share a stream.
function mt19937(seed: number | readonly number[]): () => number {
  const state = new Uint32Array(624);
  let index = 624;
  const initialize = (value: number) => {
    state[0] = value;
    for (let i = 1; i < 624; i++) {
      state[i] = Math.imul(1812433253, state[i - 1] ^ (state[i - 1] >>> 30)) + i;
    }
  };

  if (typeof seed === 'number') {
    initialize(seed);
  } else {
    initialize(19650218);
    let i = 1;
    let j = 0;
    for (let k = Math.max(624, seed.length); k > 0; k--) {
      state[i] = (state[i] ^ Math.imul(state[i - 1] ^ (state[i - 1] >>> 30), 1664525)) + seed[j] + j;
      i++;
      j++;
      if (i >= 624) {
        state[0] = state[623];
        i = 1;
      }
      if (j >= seed.length) j = 0;
    }
    for (let k = 623; k > 0; k--) {
      state[i] = (state[i] ^ Math.imul(state[i - 1] ^ (state[i - 1] >>> 30), 1566083941)) - i;
      i++;
      if (i >= 624) {
        state[0] = state[623];
        i = 1;
      }
    }
    state[0] = 0x80000000;
  }

  return () => {
    if (index === 624) {
      for (let i = 0; i < 624; i++) {
        const y = (state[i] & 0x80000000) | (state[(i + 1) % 624] & 0x7fffffff);
        state[i] = state[(i + 397) % 624] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      index = 0;
    }
    let y = state[index++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  };
}

// Uniform in [0, 1) with 53-bit resolution, as in the reference genrand_res53
function unitFromMt19937(next: () => number): () => number {
  return () => ((next() >>> 5) * 67108864 + (next() >>> 6)) / 9007199254740992;
}

let random: () => number = Math.random;
// The stream of a running withSeed, which takes precedence over all others
let override: (() => number) | undefined;
// Participants simulated at the same time each draw from their own stream, which follows them across awaits
let streams: AsyncLocalStorage<() => number> | undefined;
let draws = 0;

// Every draw of the samplers, and of Math.random once a seed is set, comes from here
function next(): number {
  draws++;
  return (override ?? streams?.getStore() ?? random)();
}

function seedDistributions(seed: number | readonly number[]): void {
  random = unitFromMt19937(mt19937(seed));
  Math.random = next;
}

// Runs fn with its own seeded stream, then continues the stream that was active before
function withSeed<T>(seed: number, fn: () => T): T {
  const previousOverride = override;
  const previousMathRandom = Math.random;
  override = unitFromMt19937(mt19937(seed));
  Math.random = next;
  try {
    return fn();
  } finally {
    override = previousOverride;
    Math.random = previousMathRandom;
  }
}

/**
 * Runs fn with its own seeded stream, which stays with fn across awaits, so that participants
 * simulated at the same time draw exactly as if each ran alone. Only available in Bun.
 */
function withStream<T>(seed: number | readonly number[], fn: () => Promise<T>): Promise<T> {
  streams ??= new (process.getBuiltinModule('async_hooks').AsyncLocalStorage)();
  Math.random = next;
  return streams.run(unitFromMt19937(mt19937(seed)), fn);
}

/** Calls fn and counts the random numbers drawn meanwhile, through Math.random or the samplers. */
async function countDraws<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const previousMathRandom = Math.random;
  const start = draws;
  Math.random = next;
  try {
    return [await fn(), draws - start];
  } finally {
    Math.random = previousMathRandom;
  }
}

function uniform(min: number, max: number): number {
  return min + (max - min) * next();
}

// Box-Muller transform; 1 - next() lies in (0, 1], so the logarithm stays finite
function normal(mu: number, sigma: number): number {
  const radius = Math.sqrt(-2 * Math.log(1 - next()));
  return mu + sigma * radius * Math.cos(2 * Math.PI * next());
}

// Knuth's multiplication method. exp(-lambda) underflows for large means, so those are drawn
// as a sum of smaller Poisson draws, which is again Poisson distributed.
function poisson(lambda: number): number {
  if (!(lambda >= 0)) return NaN;
  let count = 0;
  for (let remaining = lambda; remaining > 0; remaining -= 500) {
    const limit = Math.exp(-Math.min(remaining, 500));
    let product = next();
    while (product > limit) {
      count++;
      product *= next();
    }
  }
  return count;
}

// --- Quantile functions ---

// Evaluates c[0] + c[1] x + c[2] x^2 + ... (Horner's method)
function polynomial(coefficients: number[], x: number): number {
  return coefficients.reduceRight((sum, c) => sum * x + c, 0);
}

// Wichura (1988), Algorithm AS 241 (PPND16), https://doi.org/10.2307/2347330
// Accurate to about 1e-16 on the open interval (0, 1).
const AS241_CENTRAL = [
  [
    3.3871328727963665, 133.14166789178438, 1971.5909503065513, 13731.69376550946,
    45921.95393154987, 67265.7709270087, 33430.57558358813, 2509.0809287301227,
  ],
  [
    1, 42.31333070160091, 687.1870074920579, 5394.196021424751, 21213.794301586597,
    39307.89580009271, 28729.085735721943, 5226.495278852854,
  ],
];
const AS241_INTERMEDIATE = [
  [
    1.4234371107496835, 4.630337846156546, 5.769497221460691, 3.6478483247632045,
    1.2704582524523684, 0.2417807251774506, 0.022723844989269184,
    0.0007745450142783414,
  ],
  [
    1, 2.053191626637759, 1.6763848301838038, 0.6897673349851,
    0.14810397642748008, 0.015198666563616457, 0.0005475938084995345,
    1.0507500716444169e-9,
  ],
];
const AS241_TAIL = [
  [
    6.657904643501103, 5.463784911164114, 1.7848265399172913, 0.29656057182850487,
    0.026532189526576124, 0.0012426609473880784, 0.000027115555687434876,
    2.0103343992922881e-7,
  ],
  [
    1, 0.599832206555888, 0.1369298809227358, 0.014875361290850615,
    0.0007868691311456133, 0.000018463183175100548, 1.421511758316446e-7,
    2.0442631033899397e-15,
  ],
];

function standardNormalQuantile(p: number): number {
  const q = p - 0.5;
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q;
    return (q * polynomial(AS241_CENTRAL[0], r)) / polynomial(AS241_CENTRAL[1], r);
  }
  const r = Math.sqrt(-Math.log(q < 0 ? p : 1 - p));
  const [numerator, denominator] = r <= 5 ? AS241_INTERMEDIATE : AS241_TAIL;
  const shifted = r <= 5 ? r - 1.6 : r - 5;
  const x = polynomial(numerator, shifted) / polynomial(denominator, shifted);
  return q < 0 ? -x : x;
}

// Smallest k with P(X <= k) >= p. The probability mass is summed in log space so that large
// means don't underflow. In double precision the sum is accurate to about 1e-11 for means in
// the thousands, so a p closer than that to a step of the distribution can land one off.
function poissonQuantile(p: number, lambda: number): number {
  if (lambda === 0) return 0;
  const logLambda = Math.log(lambda);
  let logMass = -lambda;
  let cumulative = 0;
  for (let k = 0; ; k++) {
    if (k > 0) logMass += logLambda - Math.log(k);
    const mass = Math.exp(logMass);
    cumulative += mass;
    // Past the mode, a mass of zero means rounding kept the sum just below p
    if (cumulative >= p || (k > lambda && mass === 0)) return k;
  }
}

// --- QMC dimension specs ---
// Inverse CDF transform: https://en.wikipedia.org/wiki/Inverse_transform_sampling

type UniformSpec = { distribution: 'uniform'; min: number; max: number };
type NormalSpec = { distribution: 'normal'; mean: number; sd: number };
type PoissonSpec = { distribution: 'poisson'; mean: number };
type IntegerSpec = { distribution: 'integer'; min: number; max: number };
type DiscreteSpec = { distribution: 'discrete'; outcomes: Array<{ value: number; weight: number }> };
type DimensionSpec = UniformSpec | NormalSpec | PoissonSpec | IntegerSpec | DiscreteSpec;

// Inverse CDFs return +-Infinity at exactly 0 or 1, so clamp to open interval (0, 1).
function clampUnit(value: number): number {
  return Math.max(1e-10, Math.min(1 - 1e-10, value));
}

function resolveTransform(spec: DimensionSpec): (unitValue: number) => number {
  switch (spec.distribution) {
    case 'uniform':
      return (u) => spec.min + u * (spec.max - spec.min);
    case 'normal':
      return (u) => spec.mean + spec.sd * standardNormalQuantile(clampUnit(u));
    case 'poisson':
      // QMC variance reduction is less effective on discrete distributions
      // due to integer clumping at quantile boundaries.
      return (u) => poissonQuantile(clampUnit(u), spec.mean);
    case 'integer':
      // Uniform integer in [min, max] inclusive
      return (u) => Math.floor(spec.min + u * (spec.max - spec.min + 1));
    case 'discrete': {
      // Weighted discrete distribution -> divide [0,1) into segments proportional to weights
      const totalWeight = spec.outcomes.reduce((sum, o) => sum + o.weight, 0);
      const cumulative = spec.outcomes.map((() => {
        let acc = 0;
        return (o: { value: number; weight: number }) => { acc += o.weight / totalWeight; return acc; };
      })());
      return (u) => {
        for (let i = 0; i < cumulative.length; i++) {
          if (u < cumulative[i]) return spec.outcomes[i].value;
        }
        return spec.outcomes[spec.outcomes.length - 1].value;
      };
    }
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
function radicalInverse(index: number, base: number): number {
  let result = 0;
  let fraction = 1 / base;
  for (let i = index; i > 0; i = Math.floor(i / base)) {
    result += fraction * (i % base);
    fraction /= base;
  }
  return result;
}

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
  // Start at index 1, since the first point is zero in every dimension
  const unitPoints = Array.from({ length: count }, (_, i) => bases.map((base) => radicalInverse(i + 1, base)));
  return transformPoints(unitPoints, specs);
}

type SamplingMethod = 'sobol' | 'halton' | 'random';

function sampleParticipants<T extends Record<string, DimensionSpec>>(
  method: SamplingMethod,
  count: number,
  specs: T,
): Array<{ [K in keyof T]: number } & { index: number }> {
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
    return { index: i, ...Object.fromEntries(keys.map((k, d) => [k, row[d]])) } as { [K in keyof T]: number } & { index: number };
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

function draw(spec: DimensionSpec): number {
  return resolveTransform(spec)(uniform(0, 1));
}

export { normal, poisson, uniform, seedDistributions, withSeed, withStream, countDraws, sobol, halton, sampleParticipants, draw };
// Exported for the tests, not part of the public API
export { mt19937, standardNormalQuantile, poissonQuantile, radicalInverse };
export type { DimensionSpec, UniformSpec, NormalSpec, PoissonSpec, IntegerSpec, DiscreteSpec, SamplingMethod };
