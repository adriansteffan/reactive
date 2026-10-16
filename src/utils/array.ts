import { uniform } from './distributions';

interface SampleOptions {
  replace?: boolean;
}

declare global {
  interface Array<T> {
    /**
     * Returns random elements from the array
     * @param n Number of random elements to return (defaults to 1)
     * @param options Options object with `replace` (default: true)
     */
    sample(n?: number, options?: SampleOptions): Array<T>;
    
    /**
     * Shuffles array elements using Fisher-Yates algorithm
     */
    shuffle(): Array<T>;
    
    /**
     * Applies a function to the array
     * @param fn Function to apply to the array
     */
    pipe<U>(fn: (arr: Array<T>) => U): U;
    
    /**
     * Splits array into chunks of n items; the last chunk holds what is left
     * @param n Number of items per chunk
     */
    chunk(n: number): Array<Array<T>>;

    /**
     * Returns the arithmetic mean of the array
     */
    mean(): number;

    /**
     * Returns the sum of the array
     */
    sum(): number;
  }
}

/**
 * Returns random elements from an array
 */
export function sample<T>(array: T[], n: number = 1, options: SampleOptions = {}): T[] {
  const { replace = true } = options;
  if (array.length === 0) return [];

  if (replace) {
    const result: T[] = [];
    for (let i = 0; i < n; i++) {
      const randomIndex = Math.floor(uniform(0, 1) * array.length);
      result.push(array[randomIndex]);
    }
    return result;
  }

  // Without replacement, cycling when n > array.length
  const result: T[] = [];
  let pool: T[] = [];
  for (let i = 0; i < n; i++) {
    if (pool.length === 0) pool = shuffle(array);
    result.push(pool.pop()!);
  }
  return result;
}

/**
 * Shuffles array elements using Fisher-Yates algorithm
 */
export function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  
  for (let i = result.length - 1; i >= 0; i--) {
    const j = Math.floor(uniform(0, 1) * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Splits array into chunks of n items; the last chunk holds what is left
 */
export function chunk<T>(array: T[], n: number): T[][] {
  return Array.from({ length: Math.ceil(array.length / n) }, (_, i) => array.slice(i * n, i * n + n));
}

/**
 * Returns the arithmetic mean of a number array
 */
export function mean(array: number[]): number {
  if (array.length === 0) return 0;
  return array.reduce((a, b) => a + b, 0) / array.length;
}

/**
 * Returns the sum of a number array
 */
export function sum(array: number[]): number {
  return array.reduce((a, b) => a + b, 0);
}

const methods = {
  sample(this: unknown[], n?: number, options?: SampleOptions) {
    return sample(this, n, options);
  },
  shuffle(this: unknown[]) {
    return shuffle(this);
  },
  pipe(this: unknown[], fn: (arr: unknown[]) => unknown) {
    return fn(this);
  },
  chunk(this: unknown[], n: number) {
    return chunk(this, n);
  },
  mean(this: number[]) {
    return mean(this);
  },
  sum(this: number[]) {
    return sum(this);
  },
};

// Added to every array when the library loads. They are not enumerable, so that for...in over an
// array does not list them, and a built-in method of the same name is left in place.
for (const [name, method] of Object.entries(methods)) {
  if (!(name in Array.prototype)) {
    Object.defineProperty(Array.prototype, name, { value: method, writable: true, configurable: true });
  }
}
