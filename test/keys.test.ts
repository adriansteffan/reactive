import { describe, expect, test } from 'bun:test';
import { responseKey } from '../src/utils/keys';

describe('response keys', () => {
  test('a press counts as the listed key it matches, whatever the case of a letter', () => {
    expect(responseKey(['f', 'J'], 'F')).toBe('f');
    expect(responseKey(['f', 'J'], 'j')).toBe('J');
    expect(responseKey(['ArrowLeft', ' '], 'ArrowLeft')).toBe('ArrowLeft');
    expect(responseKey(['ArrowLeft', ' '], ' ')).toBe(' ');
    expect(responseKey(['f'], 'g')).toBeUndefined();
  });

  test('a named key matches in any case, and counts as the list names it', () => {
    expect(responseKey(['enter', 'arrowleft'], 'Enter')).toBe('enter');
    expect(responseKey(['enter', 'arrowleft'], 'ArrowLeft')).toBe('arrowleft');
  });

  test('with any key allowed, a press counts as itself, a letter in lowercase', () => {
    expect(responseKey(true, 'F')).toBe('f');
    expect(responseKey(true, 'Enter')).toBe('Enter');
    expect(responseKey(false, 'f')).toBeUndefined();
    expect(responseKey(undefined, 'f')).toBeUndefined();
  });
});
