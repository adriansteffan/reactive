declare global {
  interface Array<T> {
    /**
     * Returns random elements from the array
     * @param n Number of random elements to return (defaults to 1)
     */
    sample(n?: number): Array<T>;
    
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
  }
}

/**
 * Returns random elements from an array
 */
export function sample<T>(array: T[], n: number = 1): T[] {
  const result: T[] = [];
  
  if (array.length === 0) {
    return result;
  }
  
  for (let i = 0; i < n; i++) {
    const randomIndex = Math.floor(Math.random() * array.length);
    result.push(array[randomIndex]);
  }
  
  return result;
}

/**
 * Shuffles array elements using Fisher-Yates algorithm
 */
export function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  
  for (let i = result.length - 1; i >= 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
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
    Array.prototype.sample = function <T>(this: T[], n?: number): T[] {
      return sample(this, n);
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
  
  if (typeof Array.prototype.chunk !== 'function') {
    Array.prototype.chunk = function <T>(this: T[], n: number): T[][] {
      return chunk(this, n);
    };
  }
}