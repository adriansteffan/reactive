/**
 * The prefixes of the CSV columns the library writes: a trial's own fields, its metadata, response
 * fields that would otherwise start with one of these, URL params that nothing declares, the
 * Upload's `sessionData`, and a CanvasBlock's metadata next to that of its slides.
 */
export const columnPrefixes = {
  trial: 'trial_',
  meta: 'meta_',
  response: 'response_',
  url: 'url_',
  session: 'session_',
  slideblockMeta: 'slideblock_meta_',
} as const;

/** The session CSV's columns that hold the session itself, before its params and trials. */
export const sessionColumns = ['sessionId', 'userAgent', 'buildSeed'] as const;

const reserved: readonly string[] = Object.values(columnPrefixes);

/** The prefixes of the session CSV's columns that are neither params nor trials. */
export const sessionPrefixes = [columnPrefixes.url, columnPrefixes.session] as const;

/**
 * The CSV column for a field of a response. A field whose name starts with one of the prefixes gets
 * `response_` in front, so that it can never take the place of a column the library writes.
 */
export function responseColumn(field: string): string {
  return reserved.some((prefix) => field.startsWith(prefix)) ? columnPrefixes.response + field : field;
}

/** Whether a param, which is a session CSV column of its own name, would take a column the library writes. */
export function isReservedParamName(name: string): boolean {
  return (
    (sessionColumns as readonly string[]).includes(name) ||
    sessionPrefixes.some((prefix) => name.startsWith(prefix))
  );
}

/** Whether a trial, whose session CSV columns are `<name>_<field>`, would take columns the library writes. */
export function isReservedTrialName(name: string): boolean {
  return sessionPrefixes.some((prefix) => `${name}_`.startsWith(prefix));
}

type SessionPrefix = (typeof sessionPrefixes)[number];

/** The param names `isReservedParamName` rejects, for the types. */
export type ReservedParamName = (typeof sessionColumns)[number] | `${SessionPrefix}${string}`;

/** The trial names `isReservedTrialName` rejects, for the types: a prefix with or without its `_`, and names that start with one. */
export type ReservedTrialName = `${SessionPrefix}${string}` | (SessionPrefix extends `${infer Base}_` ? Base : never);
