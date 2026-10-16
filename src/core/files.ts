import type { TrialData } from './rows';
import type { Store } from './store';

export interface FileUpload {
  filename: string;
  content: string;
  encoding?: 'base64' | 'utf8';
  /** Internal flag: file was already eagerly uploaded, skip in upload but include in download. */
  _alreadyUploaded?: boolean;
}

type DataObject = {
  [key: string]: string | number | boolean | null | undefined;
};


export type Flatten = (item: TrialData) => any[];

// Rows only carry their component's name, so CSV routing is looked up by name
const flatteners: Record<string, { csv: string; flatten?: Flatten }[]> = {};

/** Sets the CSV files a component's rows go to, each with the function that turns a row into CSV rows. */
export function setFlatteners(type: string, targets: { csv: string; flatten?: Flatten }[]) {
  flatteners[type] = targets;
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

// Extracts experiment parameter values (URL params / registered params) from the initial metadata trial.
// Each param entry has { value, defaultValue, registered, ... } — we pick value if set, otherwise the default.
// Unregistered params (raw URL params that the experiment does not declare) are prefixed with `url_` so they're
// visibly distinguishable from intentional study variables in the CSV.
function extractParams(data: any[]): Record<string, any> {
  const paramsSource = data?.[0]?.responseData?.params;
  if (!paramsSource || typeof paramsSource !== 'object') return {};
  const result: Record<string, any> = {};
  for (const [name, details] of Object.entries(paramsSource) as [string, any][]) {
    if (details && typeof details === 'object') {
      const key = details.registered ? name : `url_${name}`;
      result[key] = details.value ?? details.defaultValue;
    }
  }
  return result;
}

// Built-in fields on every trial data object — not user data.
// Used to distinguish user-provided metadata from framework fields when building CSVs.
const trialBuiltinKeys = new Set(['index', 'trialNumber', 'startMs', 'endMs', 'durationMs', 'type', 'name', 'csv', 'responseData', 'metadata']);
// Subset of builtins that represent trial identity/timing — included in non-session CSVs with trial_ prefix
const trialInfoKeys = new Set(['index', 'trialNumber', 'startMs', 'endMs', 'durationMs', 'type', 'name']);

// Automatically builds CSV files from trial data.
// Each trial is routed to a CSV file based on: the trial's .csv() > its component's csv > skipped.
// The 'session' group is special: all trials merge into a single row, with keys namespaced
// by trial name (e.g. 'nickname_value', 'devicecheck_browser') to avoid collisions.
// All other groups produce multi-row CSVs, one row per trial (or more if the flattener expands them).
function autoBuildCSVs(sessionId: string, data: any[], sessionData?: Record<string, any>): FileUpload[] {
  const files: FileUpload[] = [];

  // Group trials by their target CSV file name.
  // A trial's .csv() can name several files, so one trial may appear in multiple groups.
  const groups: Record<string, { item: any; flatten?: (item: TrialData) => any[] }[]> = {};
  for (const item of data) {
    if (item.index === -1) continue; // skip initial metadata entry
    const csvOverride = item.csv;
    const targets: { csv: string | null; flatten?: Flatten }[] =
      csvOverride !== undefined
        ? (Array.isArray(csvOverride) ? csvOverride : [csvOverride]).map((csv: string | null) => ({ csv }))
        : flatteners[item.type] ?? [];
    for (const target of targets) {
      if (!target.csv) continue;
      if (!groups[target.csv]) groups[target.csv] = [];
      groups[target.csv].push({ item, flatten: target.flatten });
    }
  }

  // 'session' group: one row per participant with metadata + responseData namespaced by trial name
  const row: Record<string, any> = {
    sessionId,
    userAgent: data?.[0]?.responseData?.userAgent,
    buildSeed: data?.[0]?.responseData?.buildSeed,
    ...extractParams(data),
    ...sessionData,
  };
  if (groups['session']) {
    for (const { item } of groups['session']) {
      const prefix = item.name || item.type;
      // Add user-provided metadata (non-builtin top-level keys), namespaced by trial name
      for (const [key, value] of Object.entries(item)) {
        if (!trialBuiltinKeys.has(key)) row[`${prefix}_${key}`] = typeof value === 'object' && value !== null && !Array.isArray(value) ? JSON.stringify(value) : value;
      }
      // Add responseData fields, namespaced by trial name
      if (item.responseData && typeof item.responseData === 'object' && !Array.isArray(item.responseData)) {
        for (const [key, value] of Object.entries(item.responseData)) {
          row[`${prefix}_${key}`] = typeof value === 'object' && value !== null && !Array.isArray(value) ? JSON.stringify(value) : value;
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

  // All other groups: multi-row CSVs using registered flatteners (or raw responseData spread).
  // Each row is prepended with standard trial fields (prefixed trial_) plus any extra
  // metadata fields (unprefixed). The flattener's output overwrites these if keys collide.
  for (const [csvName, entries] of Object.entries(groups)) {
    const rows = entries.flatMap(({ item, flatten }) => {
      const base: Record<string, any> = {};
      for (const [key, value] of Object.entries(item)) {
        if (trialBuiltinKeys.has(key)) {
          if (trialInfoKeys.has(key)) base[`trial_${key}`] = value;
        } else {
          base[key] = typeof value === 'object' && value !== null && !Array.isArray(value) ? JSON.stringify(value) : value;
        }
      }
      // When no flatten function is registered, spread responseData directly.
      const flatRows = flatten
        ? flatten(item)
        : [item.responseData && typeof item.responseData === 'object' ? { ...item.responseData } : {}];
      return flatRows.map((row: any) => {
        const merged = { ...base, ...row };
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

let audioFileIndex = 0;
export function generateAudioFilename(label: string): string {
  return `audio_${label}_${audioFileIndex++}_${Date.now()}.webm`;
}

// Recordings that VoiceRecording already sent to the backend, with the filename they were saved under
const preUploadedRecordings = new WeakMap<object, string>();

export function markRecordingUploaded(recording: object, filename: string) {
  preUploadedRecordings.set(recording, filename);
}

// Scans trial data for audio recordings (type: 'audiorecording' with data64) and extracts them as
// separate .webm files. The returned rows reference the files by name instead of holding the
// binary data, which keeps CSVs and raw JSON clean.
function extractAudioRecordings(data: any[]): { files: FileUpload[]; data: any[] } {
  const files: FileUpload[] = [];

  const extract = (obj: any, nameHint: string) => {
    if (obj?.type !== 'audiorecording' || !obj.data64) return obj;
    const preUploadedFilename = preUploadedRecordings.get(obj);
    const filename = preUploadedFilename ?? generateAudioFilename(nameHint);
    files.push({
      filename,
      content: obj.data64,
      encoding: 'base64' as const,
      _alreadyUploaded: preUploadedFilename !== undefined,
    });
    const { data64: _data64, blob: _blob, url: _url, ...rest } = obj;
    return { ...rest, audioFile: filename };
  };

  const rows = data.map((item) => {
    const rd = item.responseData;
    if (!rd || typeof rd !== 'object') return item;

    // Direct responseData is an audio recording (VoiceRecording component)
    let responseData = extract(rd, item.name || item.type);

    // Nested in responseData (Quest voicerecorder questions)
    if (responseData === rd && !Array.isArray(rd)) {
      responseData = Object.fromEntries(
        Object.entries(rd).map(([key, value]) => [
          key,
          value && typeof value === 'object' ? extract(value, `${item.name || item.type}_${key}`) : value,
        ]),
      );
    }

    return { ...item, responseData };
  });

  return { files, data: rows };
}

export function buildUploadFiles(config: {
  sessionId: string;
  data: any[];
  store: Store;
  generateFiles?: (input: { sessionId: string; data: any[]; store: Store }) => FileUpload[];
  sessionData?: Record<string, any>;
  uploadRaw?: boolean;
}): FileUpload[] {
  const {
    sessionId,
    data,
    store,
    generateFiles,
    sessionData,
    uploadRaw = true,
  } = config;

  const files: FileUpload[] = generateFiles ? generateFiles({ sessionId, data, store }) : [];

  // Extract audio recordings as separate files before serialization
  const recordings = extractAudioRecordings(data);
  files.push(...recordings.files);

  if (uploadRaw) {
    files.push({
      filename: `${sessionId}.raw.json`,
      content: JSON.stringify(recordings.data),
      encoding: 'utf8',
    });
  }

  files.push(...autoBuildCSVs(sessionId, recordings.data, sessionData));

  return files;
}
