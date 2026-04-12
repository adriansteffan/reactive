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
     * Splits array into chunks
     * @param n Number of chunks to create
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
 * Applies a function to an array
 */
export function pipe<T, U>(array: T[], fn: (arr: T[]) => U): U {
  return fn(array);
}

/**
 * Splits array into chunks
 */
export function chunk<T>(array: T[], n: number): T[][] {
  const size = Math.ceil(array.length / n);
  return Array.from({ length: Math.ceil(array.length / size) }, (_, i) =>
    array.slice(i * size, i * size + size),
  );
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

/**
 * Registers array methods on the Array prototype.
 * Call this function once to make array methods available globally.
 * 
 * Example:
 * ```
 * import { registerArrayExtensions } from '@adriansteffan/reactive/array';
 * registerArrayExtensions();
 * 
 * const myArray = [1, 2, 3, 4, 5];
 * myArray.shuffle();
 * ```
 */
export function registerArrayExtensions(): void {
  if (typeof Array.prototype.sample !== 'function') {
    Array.prototype.sample = function <T>(this: T[], n?: number, options?: SampleOptions): T[] {
      return sample(this, n, options);
    };
  }
  
  if (typeof Array.prototype.shuffle !== 'function') {
    Array.prototype.shuffle = function <T>(this: T[]): T[] {
      return shuffle(this);
    };
  }
  
  if (typeof Array.prototype.pipe !== 'function') {
    Array.prototype.pipe = function <T, U>(this: T[], fn: (arr: T[]) => U): U {
      return pipe(this, fn);
    };
  }
  
  if (typeof Array.prototype.mean !== 'function') {
    Array.prototype.mean = function (this: number[]): number {
      return mean(this);
    };
  }

  if (typeof Array.prototype.sum !== 'function') {
    Array.prototype.sum = function (this: number[]): number {
      return sum(this);
    };
  }

  if (typeof Array.prototype.chunk !== 'function') {
    Array.prototype.chunk = function <T>(this: T[], n: number): T[][] {
      return chunk(this, n);
    };
  }
}