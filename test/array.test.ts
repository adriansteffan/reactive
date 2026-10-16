import { expect, test } from 'bun:test';
import { chunk } from '../src/utils/array';

test('chunk splits into chunks of n items, the last one holding what is left', () => {
  expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
  expect(chunk([], 3)).toEqual([]);
});

test('arrays have the methods, without listing them in for...in', () => {
  expect([1, 2, 3, 4].chunk(2).map((part) => part.sum())).toEqual([3, 7]);
  const keys: string[] = [];
  for (const key in [10]) keys.push(key);
  expect(keys).toEqual(['0']);
});
