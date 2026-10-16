export function isProduction(): boolean {
  // Builds replace process.env.NODE_ENV; in a browser without a replacement, process does not exist
  try {
    return process.env.NODE_ENV === 'production';
  } catch {
    return false;
  }
}

function deepFreeze(value: unknown): void {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return;
  const prototype = Object.getPrototypeOf(value);
  // Class instances such as Blobs or typed arrays are left alone
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
}

/** Freezes the data and store that timeline callbacks read, so that mutating them throws during development and simulation. */
export function freezeInDevelopment<T>(value: T): T {
  if (!isProduction()) deepFreeze(value);
  return value;
}
