import { columnPrefixes, responseColumn } from './columns';
import type { RuntimeComponent } from './component';
import type { ExperimentData, SessionData, TrialData } from './rows';
import type { Store } from './store';

export interface FileUpload {
  filename: string;
  content: string;
  encoding?: 'base64' | 'utf8';
  /** The server already has this file from an eager upload, so only a download includes it. */
  _alreadyUploaded?: boolean;
}

type DataObject = {
  [key: string]: string | number | boolean | null | undefined;
};


export type Flatten = (item: TrialData) => any[];

/** A CSV file that a component's rows go to, with the function that turns a row into its CSV rows. */
export type CsvTarget = { file: string; flatten?: Flatten };

// The files a row goes to: its trial's own, which keep the component's flattener for the same file
// or its only one, or else its component's
function csvTargets(item: TrialData, components: ReadonlyMap<string, RuntimeComponent>): CsvTarget[] {
  const own = components.get(item.type)?.reactive.csv ?? [];
  if (item.csv === undefined) return own;
  return [item.csv].flat().flatMap((file) => {
    if (file === null) return [];
    const target = own.find((target) => target.file === file) ?? (own.length === 1 ? own[0] : undefined);
    return [{ file, flatten: target?.flatten }];
  });
}

// Reusable flattener for components whose responseData is an array of objects.
// Each array element becomes a CSV row. Non-array responseData produces an empty result.
export function arrayFlattener(item: TrialData): any[] {
  const responseData = item.responseData;
  if (Array.isArray(responseData)) {
    return responseData.map((i) => ({ block: item.name, ...i }));
  }
  return [];
}

export function escapeCsvValue(value: any): string {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value);

  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    const escapedValue = stringValue.replace(/"/g, '""');
    return `"${escapedValue}"`;
  }

  return stringValue;
}

export function convertArrayOfObjectsToCSV(data: DataObject[]): string {
  if (!data || data.length === 0) {
    return '';
  }

  const headerSet = new Set<string>();
  data.forEach((obj) => {
    Object.keys(obj).forEach((key) => {
      headerSet.add(key);
    });
  });
  const headers = Array.from(headerSet);

  const headerRow = headers.map((header) => escapeCsvValue(header)).join(',');

  const dataRows = data.map((obj) => {
    return headers
      .map((header) => {
        const value = obj[header];
        return escapeCsvValue(value);
      })
      .join(',');
  });

  return [headerRow, ...dataRows].join('\n');
}

// The session's params as columns: the value if set, otherwise the default. URL params that the experiment
// does not declare are prefixed with `url_`, which sets them apart from the study's own variables.
function paramColumns(session: SessionData): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [name, param] of Object.entries(session.params)) {
    result[param.registered ? name : columnPrefixes.url + name] = param.value ?? param.defaultValue;
  }
  return result;
}

// The fields of a trial's row that become trial_ columns in the CSVs other than the session's
const trialColumns = ['trialNumber', 'startMs', 'endMs', 'durationMs', 'type', 'name'] as const;

// Automatically builds CSV files from trial data.
// Each trial is routed to a CSV file based on: the trial's .csv() > its component's csv > skipped.
// The 'session' group is special: all trials merge into a single row, with keys namespaced
// by trial name (e.g. 'nickname_value', 'devicecheck_browser') to avoid collisions.
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
  const groups: Record<string, { item: any; flatten?: Flatten }[]> = {};
  for (const item of data.trials) {
    for (const { file, flatten } of csvTargets(item, components)) {
      groups[file] ??= [];
      groups[file].push({ item, flatten });
    }
  }

  // 'session' group: one row per participant with metadata + responseData namespaced by trial name
  const row: Record<string, any> = {
    sessionId,
    userAgent: data.session.userAgent,
    buildSeed: data.session.buildSeed,
    ...paramColumns(data.session),
  };
  for (const [key, value] of Object.entries(sessionData ?? {})) row[columnPrefixes.session + key] = value;
  if (groups['session']) {
    for (const { item } of groups['session']) {
      const prefix = item.name || item.type;
      // Add metadata, namespaced by trial name
      for (const [key, value] of Object.entries(item.metadata ?? {})) {
        row[`${prefix}_${columnPrefixes.meta}${key}`] = typeof value === 'object' && value !== null && !Array.isArray(value) ? JSON.stringify(value) : value;
      }
      // Add responseData fields, namespaced by trial name
      if (item.responseData && typeof item.responseData === 'object' && !Array.isArray(item.responseData)) {
        for (const [key, value] of Object.entries(item.responseData)) {
          row[`${prefix}_${responseColumn(key)}`] = typeof value === 'object' && value !== null && !Array.isArray(value) ? JSON.stringify(value) : value;
        }
      }
    }
    delete groups['session'];
  }
  if (Object.keys(row).length > 1) {
    files.push({
      filename: `session.${sessionId}.${Date.now()}.csv`,
      content: convertArrayOfObjectsToCSV([row]),
      encoding: 'utf8' as const,
    });
  }

  // All other groups: multi-row CSVs, through the flatteners or by spreading the responseData.
  // Each row is prepended with standard trial fields (prefixed trial_) and the trial's
  // metadata (prefixed meta_), followed by the fields of the flattener's output or the response.
  for (const [csvName, entries] of Object.entries(groups)) {
    const rows = entries.flatMap(({ item, flatten }) => {
      const base: Record<string, any> = {};
      for (const key of trialColumns) base[columnPrefixes.trial + key] = item[key];
      // A flattener's rows can carry metadata of their own, as CanvasBlock's slides do
      const flatRows: { fields: Record<string, any>; metadata?: Record<string, any> }[] = flatten
        ? flatten(item).map(({ metadata, ...fields }) => ({ fields, metadata }))
        : [{ fields: item.responseData && typeof item.responseData === 'object' ? item.responseData : {} }];
      return flatRows.map(({ fields, metadata }) => {
        const merged = { ...base };
        // Next to a row's own metadata, the trial's moves to columns of its own
        const trialMeta = metadata ? columnPrefixes.slideblockMeta : columnPrefixes.meta;
        for (const [key, value] of Object.entries(item.metadata ?? {})) merged[trialMeta + key] = value;
        for (const [key, value] of Object.entries(metadata ?? {})) merged[columnPrefixes.meta + key] = value;
        for (const [key, value] of Object.entries(fields)) merged[responseColumn(key)] = value;
        for (const k of Object.keys(merged)) {
          const v = merged[k];
          if (typeof v === 'object' && v !== null && !Array.isArray(v)) merged[k] = JSON.stringify(v);
        }
        return merged;
      });
    });
    if (rows.length > 0) {
      files.push({
        filename: `${csvName}.${sessionId}.${Date.now()}.csv`,
        content: convertArrayOfObjectsToCSV(rows),
        encoding: 'utf8' as const,
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
function extractAudioRecordings(trials: TrialData[]): { files: FileUpload[]; trials: TrialData[] } {
  const files: FileUpload[] = [];

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
}): FileUpload[] {
  const {
    sessionId,
    data,
    store,
    components,
    generateFiles,
    sessionData,
    uploadRaw = true,
  } = config;

  const files: FileUpload[] = generateFiles ? generateFiles({ sessionId, data, store }) : [];

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
