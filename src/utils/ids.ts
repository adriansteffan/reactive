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
