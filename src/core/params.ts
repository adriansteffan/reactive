/** A param: an input of the experiment or a setting of a component, read from the URL. */
export interface ParamSpec {
  /** The values the param can take. */
  values?: readonly (string | number)[];
  /** Used when the URL does not set the param. A function is called once per participant. */
  default: unknown;
  description?: string;
}

type Widen<T> = T extends boolean
  ? boolean
  : T extends number
    ? number
    : T extends string
      ? string
      : T extends readonly (infer E)[]
        ? Widen<E>[]
        : T;

export type ParamValue<S> = S extends { values: readonly (infer V)[] }
  ? V
  : S extends { default: infer D }
    ? Widen<D extends () => infer R ? R : D>
    : never;

export type ParamValues<Params> = { [K in keyof Params]: ParamValue<Params[K]> };

/** The library's own params, available in every experiment. */
export const libraryParams: Record<string, ParamSpec> = {
  dev: { default: false, description: 'Enable the developer inspector panel' },
};

export type ParamType = 'string' | 'number' | 'boolean' | 'array' | 'json';

export function paramType(spec: ParamSpec): ParamType {
  if (spec.values) return spec.values.every((v) => typeof v === 'number') ? 'number' : 'string';
  const value = spec.default;
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object' && value !== null) return 'json';
  return 'string';
}

/** Turns a value from the URL into the param's type. */
export function parseParam(name: string, spec: ParamSpec, raw: unknown): unknown {
  if (spec.values) return spec.values.find((v) => String(v) === String(raw)) ?? raw;
  // Values from the base64 link already have their type
  if (typeof raw !== 'string') return raw;

  const fallback = spec.default;
  if (typeof fallback === 'string') return raw;
  if (typeof fallback === 'boolean') return raw.toLowerCase() === 'true';
  if (typeof fallback === 'number') {
    if (raw.trim() === '' || Number.isNaN(Number(raw))) {
      throw new Error(`The param '${name}' must be a number, but the URL sets it to '${raw}'.`);
    }
    return Number(raw);
  }
  try {
    return JSON.parse(raw);
  } catch {
    // A computed default does not say which type it has, so text that is not JSON stays text
    if (typeof fallback === 'function') return raw;
    throw new Error(`The param '${name}' must be JSON, but the URL sets it to '${raw}'.`);
  }
}

const allowed = (spec: ParamSpec, value: unknown) =>
  !spec.values || spec.values.includes(value as string | number);

/**
 * Resolves each param from, in this order: `overrides` (a simulated participant's params), the
 * URL's params, `previous` (values kept across hot reloads), and its default.
 */
export function resolveParams(
  params: Record<string, ParamSpec> = {},
  sources: {
    url?: Record<string, unknown>;
    overrides?: Record<string, unknown>;
    previous?: Record<string, unknown>;
  } = {},
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(params)) {
    const raw = sources.url?.[name];
    const previous = sources.previous;
    let value: unknown;
    if (sources.overrides && name in sources.overrides) {
      value = sources.overrides[name];
    } else if (raw !== undefined && raw !== null) {
      value = parseParam(name, spec, raw);
    } else if (previous && name in previous && allowed(spec, previous[name])) {
      value = previous[name];
    } else {
      if (previous && name in previous) {
        console.warn(`The param '${name}' no longer allows ${JSON.stringify(previous[name])}, so it was set again.`);
      }
      value = typeof spec.default === 'function' ? spec.default() : spec.default;
    }

    if (!allowed(spec, value)) {
      throw new Error(
        `The param '${name}' must be one of ${spec.values?.map((v) => JSON.stringify(v)).join(', ')}, but it is ${JSON.stringify(value)}.`,
      );
    }
    values[name] = value;
  }
  return values;
}

/** The params in a URL: the plain ones, and those in the base64 JSON of `_b`, which take precedence. */
export function urlParams(
  search = typeof window !== 'undefined' ? window.location.search : '',
): Record<string, unknown> {
  const searchParams = new URLSearchParams(search);
  const plain: Record<string, unknown> = Object.fromEntries(searchParams);
  delete plain._b;
  const encoded = searchParams.get('_b');
  if (!encoded) return plain;
  try {
    return { ...plain, ...JSON.parse(atob(encoded)) };
  } catch {
    // An unreadable _b is ignored
    return plain;
  }
}
