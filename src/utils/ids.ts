import { uniform } from './distributions';

const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Generate a random alphanumeric string of the given length. Uses the seedable uniform PRNG so simulations are reproducible. */
export function alphanumericId(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHANUMERIC[Math.floor(uniform(0, 1) * ALPHANUMERIC.length)];
  }
  return out;
}

/** Generate a Prolific-style 24-character alphanumeric ID */
export function prolificId(): string {
  return alphanumericId(24);
}

/**
 * Random version 4 UUID.
 */
export function uuidv4(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx, RFC 9562
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
