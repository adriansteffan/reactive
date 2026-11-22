import { columnPrefixes, responseColumn } from './columns';
import { report } from './development';
import type { RuntimeComponent } from './component';
import type { ExperimentData, SessionData, TrialData } from './rows';
import type { Store } from './store';

/** A file the experiment saves, such as those that Upload's `generateFiles` adds. */
export interface FileUpload {
  filename: string;
  content: string;
  encoding?: 'base64' | 'utf8';
}

/** A file to save, which the server may already have from an eager upload, so that only a download includes it. */
export type UploadFile = FileUpload & { _alreadyUploaded?: boolean };

/** A row of a CSV file, by column. */
export type CsvRow = Record<string, unknown>;

/** A trial's row, with its component's response. */
export type TrialRow<R = any> = Omit<TrialData, 'responseData'> & { responseData: R };

/** Turns a trial's row into the row it stands for in a CSV file, or a list of rows. */
export type Flatten<R = any> = (item: TrialRow<R>) => CsvRow | CsvRow[];

/**
 * Where a component's rows go: a file, or files mapped to the functions that flatten rows for them
 * or to `true` for one row per trial, or `null` for none.
 */
export type ComponentCsv<R = any> = string | null | { [file: string]: Flatten<R> | true };

/**
 * A trial's columns in the session CSV, the single row per participant: `true` for its response's
 * fields, or a function that returns them. A response that is a list has no fields, so it needs the function.
 */
export type SessionColumns<R = any> = (R extends readonly unknown[] ? never : true) | ((item: TrialRow<R>) => CsvRow);

/** A CSV file that a component's rows go to, with the function that turns a row into its CSV rows. */
export type CsvTarget = { file: string; flatten?: Flatten };

/**
 * What a trial's `.csv()` takes: a new name for its component's only file, its component's files
 * mapped to new names or to `null`, or `null` for no CSV at all.
 */
export type TrialCsv = string | CsvRenames | null;
type CsvRenames = Record<string, string | null>;

/** The files a trial's rows go to: its component's, as the trial's `.csv()` renames them, each keeping its flattener. */
export function trialCsv(type: string, own: readonly CsvTarget[], csv: TrialCsv | undefined): CsvTarget[] {
  if (csv === undefined) return [...own];
  if (csv === null) return [];
  const files = own.map((target) => `'${target.file}'`).join(', ');
  let targets: CsvTarget[];
  if (typeof csv === 'string') {
    if (own.length > 1) {
      throw new Error(
        `${type} writes the CSV files ${files}, so a trial's .csv() needs to say which of them it renames, as in .csv({ ${own[0].file}: 'practice' }).`,
      );
    }
    targets = [{ file: csv, flatten: own[0]?.flatten }];
  } else {
    for (const file of Object.keys(csv)) {
      if (!own.some((target) => target.file === file)) {
        throw new Error(`A trial's .csv() renames the CSV file '${file}', but ${type} writes ${own.length > 0 ? files : 'none'}.`);
      }
    }
    targets = own.flatMap((target) => {
      if (!(target.file in csv)) return [target];
      const file = csv[target.file];
      return file === null ? [] : [{ file, flatten: target.flatten }];
    });
  }
  if (targets.some((target) => target.file === 'session')) {
    throw new Error(
      "A trial's .csv() cannot name a file 'session', which is the session CSV. To put the trial's columns in the session row, use .session(true).",
    );
  }
  return targets;
}

// Objects and lists are written as JSON, and a value with a comma, quote or line break is quoted
function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A CSV with a column for every key that any of the rows has. */
export function convertArrayOfObjectsToCSV(rows: readonly CsvRow[]): string {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return [headers, ...rows.map((row) => headers.map((header) => row[header]))]
    .map((values) => values.map(escapeCsvValue).join(','))
    .join('\n');
}

// The session's params as columns. URL params that the experiment does not declare are prefixed
// with `url_`, which sets them apart from the study's own variables.
function paramColumns(session: SessionData): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [name, param] of Object.entries(session.params)) {
    result[param.registered ? name : columnPrefixes.url + name] = param.value;
  }
  return result;
}

// The fields of a trial's row that become trial_ columns in the CSVs other than the session's
const trialColumns = ['trialNumber', 'startMs', 'endMs', 'durationMs', 'type', 'name'] as const;

// Automatically builds CSV files from trial data.
// Each trial is routed to a CSV file based on: the trial's .csv() > its component's csv > skipped.
// The session CSV is a single row, in which the trials that go there have columns namespaced by
// trial name (e.g. 'nickname_value', 'devicecheck_browser') to avoid collisions.
// All other groups produce multi-row CSVs, one row per trial (or more if the flattener expands them).
function autoBuildCSVs(
  sessionId: string,
  data: ExperimentData,
  components: ReadonlyMap<string, RuntimeComponent>,
  sessionData?: Record<string, any>,
): FileUpload[] {
  const files: FileUpload[] = [];

  // Group trials by their target CSV file name.
  // A trial's .csv() can name several files, so one trial may appear in multiple groups.
  const groups: Record<string, { item: TrialData; flatten?: Flatten }[]> = {};
  for (const item of data.trials) {
    for (const { file, flatten } of trialCsv(item.type, components.get(item.type)?.reactive.csv ?? [], item.csv)) {
      groups[file] ??= [];
      groups[file].push({ item, flatten });
    }
  }

  // The session CSV: one row per participant, with the columns of the trials that go there
  const row: CsvRow = {
    sessionId,
    userAgent: data.session.userAgent,
    buildSeed: data.session.buildSeed,
    ...paramColumns(data.session),
  };
  for (const [key, value] of Object.entries(sessionData ?? {})) row[columnPrefixes.session + key] = value;
  for (const item of data.trials) {
    const columns = components.get(item.type)?.reactive.session;
    if (!(item.session ?? columns !== undefined)) continue;
    const prefix = item.name || item.type;
    // Add metadata, namespaced by trial name
    for (const [key, value] of Object.entries(item.metadata ?? {})) row[`${prefix}_${columnPrefixes.meta}${key}`] = value;
    // Add the response's fields, or those the component's session function returns, namespaced by trial name
    const fields = typeof columns === 'function' ? columns(item) : item.responseData;
    if (fields === undefined || fields === null) continue;
    if (typeof fields !== 'object' || Array.isArray(fields)) {
      report(
        `The ${item.type} trial '${prefix}' gives the session CSV ${Array.isArray(fields) ? 'a list' : JSON.stringify(fields)}, but its one row per participant takes an object's fields as columns. Give the component a session function that returns them, as in session: (item) => ({ … }).`,
      );
      continue;
    }
    for (const [key, value] of Object.entries(fields)) row[`${prefix}_${responseColumn(key)}`] = value;
  }
  files.push({ filename: `session.${sessionId}.${Date.now()}.csv`, content: convertArrayOfObjectsToCSV([row]), encoding: 'utf8' });

  // All other groups: multi-row CSVs, through the flatteners or from the responses. Each row is
  // prepended with standard trial fields (prefixed trial_) and the trial's metadata (prefixed meta_).
  for (const [csvName, entries] of Object.entries(groups)) {
    const rows = entries.flatMap(({ item, flatten }) => {
      const base: CsvRow = {};
      for (const key of trialColumns) base[columnPrefixes.trial + key] = item[key];
      // A flattener's rows, and the items of a response that is a list, are rows of their own, which
      // can carry metadata of their own, as CanvasBlock's slides do; any other response is one row
      const output = flatten ? flatten(item) : item.responseData;
      const flatRows: { fields: Record<string, any>; metadata?: Record<string, any> }[] =
        flatten || Array.isArray(output)
          ? [output].flat().map((row) => {
              const { metadata, ...fields } = typeof row === 'object' && row !== null ? row : { value: row };
              return { fields, metadata: metadata as Record<string, any> | undefined };
            })
          : [{ fields: typeof output === 'object' && output !== null ? output : {} }];
      return flatRows.map(({ fields, metadata }) => {
        const merged = { ...base };
        // Next to a row's own metadata, the trial's moves to columns of its own
        const trialMeta = metadata ? columnPrefixes.slideblockMeta : columnPrefixes.meta;
        for (const [key, value] of Object.entries(item.metadata ?? {})) merged[trialMeta + key] = value;
        for (const [key, value] of Object.entries(metadata ?? {})) merged[columnPrefixes.meta + key] = value;
        for (const [key, value] of Object.entries(fields)) merged[responseColumn(key)] = value;
        return merged;
      });
    });
    if (rows.length > 0) {
      files.push({
        filename: `${csvName}.${sessionId}.${Date.now()}.csv`,
        content: convertArrayOfObjectsToCSV(rows),
        encoding: 'utf8',
      });
    }
  }

  return files;
}

/** The file a recording is saved as: named after its trial, and unique in the session. */
export function audioFilename(label: string, trialNumber: number): string {
  return `audio_${label}_${trialNumber}.webm`;
}

// The content the server already has under each filename, from recordings uploaded early. It only
// spares sending them again, which would save the same content under the same name.
const uploadedRecordings = new Map<string, string>();

export function markRecordingUploaded(filename: string, data64: string) {
  uploadedRecordings.set(filename, data64);
}

// Scans trial data for audio recordings (type: 'audiorecording' with data64) and extracts them as
// separate .webm files. The returned rows reference the files by name instead of holding the
// binary data, which keeps CSVs and raw JSON clean.
function extractAudioRecordings(trials: TrialData[]): { files: UploadFile[]; trials: TrialData[] } {
  const files: UploadFile[] = [];

  const extract = (obj: any, label: string, trialNumber: number) => {
    if (obj?.type !== 'audiorecording' || !obj.data64) return obj;
    const filename = obj.audioFile ?? audioFilename(label, trialNumber);
    files.push({
      filename,
      content: obj.data64,
      encoding: 'base64' as const,
      _alreadyUploaded: uploadedRecordings.get(filename) === obj.data64,
    });
    const { data64: _data64, blob: _blob, url: _url, ...rest } = obj;
    return { ...rest, audioFile: filename };
  };

  const rows = trials.map((item) => {
    const rd = item.responseData;
    if (!rd || typeof rd !== 'object') return item;

    const label = item.name || item.type;
    // Direct responseData is an audio recording (VoiceRecording component)
    let responseData = extract(rd, label, item.trialNumber);

    // Nested in responseData (Quest voicerecorder questions)
    if (responseData === rd && !Array.isArray(rd)) {
      responseData = Object.fromEntries(
        Object.entries(rd).map(([key, value]) => [
          key,
          value && typeof value === 'object' ? extract(value, `${label}_${key}`, item.trialNumber) : value,
        ]),
      );
    }

    return { ...item, responseData };
  });

  return { files, trials: rows };
}

export function buildUploadFiles(config: {
  sessionId: string;
  data: ExperimentData;
  store: Store;
  /** The components of the timeline, by name, which say where their rows go. */
  components: ReadonlyMap<string, RuntimeComponent>;
  generateFiles?: (input: { sessionId: string; data: ExperimentData; store: Store }) => FileUpload[];
  sessionData?: Record<string, any>;
  uploadRaw?: boolean;
}): UploadFile[] {
  const {
    sessionId,
    data,
    store,
    components,
    generateFiles,
    sessionData,
    uploadRaw = true,
  } = config;

  const files: UploadFile[] = generateFiles ? generateFiles({ sessionId, data, store }) : [];

  // Extract audio recordings as separate files before serialization
  const recordings = extractAudioRecordings(data.trials);
  files.push(...recordings.files);
  const saved = { ...data, trials: recordings.trials };

  if (uploadRaw) {
    files.push({
      filename: `${sessionId}.raw.json`,
      content: JSON.stringify(saved),
      encoding: 'utf8',
    });
  }

  files.push(...autoBuildCSVs(sessionId, saved, components, sessionData));

  return files;
}
