import { describe, it, expect } from 'bun:test';
import { uuidv4 } from '../src/utils/ids';

describe('uuidv4', () => {
  const ids = Array.from({ length: 100000 }, uuidv4);

  it('has the RFC 9562 version 4 format', () => {
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it('never repeats', () => {
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('sets each of the 122 random bits about half the time', () => {
    const fixedBits = new Set([48, 49, 50, 51, 64, 65]); // version nibble and the two variant bits
    const ones = new Array(128).fill(0);
    for (const id of ids) {
      const hex = id.replaceAll('-', '');
      for (let bit = 0; bit < 128; bit++) {
        if ((parseInt(hex[bit >> 2], 16) >> (3 - (bit & 3))) & 1) ones[bit]++;
      }
    }
    for (let bit = 0; bit < 128; bit++) {
      if (fixedBits.has(bit)) continue;
      // Four standard errors of a binomial proportion around 0.5
      expect(Math.abs(ones[bit] / ids.length - 0.5)).toBeLessThan(4 * Math.sqrt(0.25 / ids.length));
    }
  });
});
