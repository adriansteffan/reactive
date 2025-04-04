declare global {
  interface Array<T> {
    /**
     * Returns random elements from the array
     * @param n Number of random elements to return (defaults to 1)
     * @returns Array of randomly selected elements
     */
    sample(n?: number): Array<T>;

    /**
     * Shuffles array elements using Fisher-Yates algorithm
     * @returns A new shuffled array
     */
    shuffle(): Array<T>;
  }
}

/**
 * Returns random elements from an array
 * @param array The source array
 * @param n Number of random elements to return (defaults to 1)
 * @returns Array of randomly selected elements
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
 * @param array The source array
 * @returns A new shuffled array
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
 * Registers array methods on the Array prototype.
 * Call this function once to make array methods available globally.
 * 
 * Example:
 * ```
 * import { registerArrayExtensions } from '@adriansteffan/reactive/array';
 * registerArrayExtensions();
 * 
 * // Now you can use the methods
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
}