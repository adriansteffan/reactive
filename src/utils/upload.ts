/* eslint-disable @typescript-eslint/no-explicit-any */

import { FileUpload, Store, TrialData } from './common';

type DataObject = {
  [key: string]: string | number | boolean | null | undefined;
};


const flattenerRegistry: Record<string, {
  csv: string | null;
  flatten?: (item: TrialData) => any[];
}[]> = {};

export function registerFlattener(
  type: string,
  csv: string | null,
  flatten?: (item: TrialData) => any[],
) {
  if (!flattenerRegistry[type]) flattenerRegistry[type] = [];
  flattenerRegistry[type].push({ csv, flatten });
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

  const stringValue = String(value);

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
// Each param entry has { value, defaultValue, ... } — we pick value if set, otherwise the default.
function extractParams(data: any[]): Record<string, any> {
  const paramsSource = data?.[0]?.responseData?.params;
  if (!paramsSource || typeof paramsSource !== 'object') return {};
  const result: Record<string, any> = {};
  for (const [name, details] of Object.entries(paramsSource) as [string, any][]) {
    if (details && typeof details === 'object') {
      result[name] = details.value ?? details.defaultValue;
    }
  }
  return result;
}

// Built-in fields on every trial data object — not user data.
// Used to distinguish user-provided metadata from framework fields when building CSVs.
const trialBuiltinKeys = new Set(['index', 'trialNumber', 'start', 'end', 'duration', 'type', 'name', 'csv', 'responseData', 'metadata']);
// Subset of builtins that represent trial identity/timing — included in non-session CSVs with trial_ prefix
const trialInfoKeys = new Set(['index', 'trialNumber', 'start', 'end', 'duration', 'type', 'name']);

// Automatically builds CSV files from trial data using the flattener registry.
// Each trial is routed to a CSV file based on: item.csv override > registry default > skipped.
// The 'session' group is special: all trials merge into a single row, with keys namespaced
// by trial name (e.g. 'nickname_value', 'devicecheck_browser') to avoid collisions.
// All other groups produce multi-row CSVs, one row per trial (or more if the flattener expands them).
function autoBuildCSVs(sessionID: string, data: any[], sessionData?: Record<string, any>): FileUpload[] {
  const files: FileUpload[] = [];

  // Group trials by their target CSV file name.
  // A component can register multiple targets, so one trial may appear in multiple groups.
  // A per-item csv override replaces all registered targets.
  const groups: Record<string, { item: any; flatten?: (item: TrialData) => any[] }[]> = {};
  for (const item of data) {
    if (item.index === -1) continue; // skip initial metadata entry
    const csvOverride = item.csv;
    const targets = csvOverride
      ? (Array.isArray(csvOverride) ? csvOverride : [csvOverride]).map((csv: string) => ({ csv }))
      : flattenerRegistry[item.type] ?? [];
    for (const target of targets) {
      if (!target.csv) continue;
      if (!groups[target.csv]) groups[target.csv] = [];
      groups[target.csv].push({ item, flatten: 'flatten' in target ? target.flatten : undefined });
    }
  }

  // 'session' group: one row per participant with metadata + responseData namespaced by trial name
  if (groups['session']) {
    const row: Record<string, any> = {
      sessionID,
      userAgent: data?.[0]?.responseData?.userAgent,
      ...extractParams(data),
      ...sessionData,
    };
    for (const { item } of groups['session']) {
      const prefix = item.name || item.type;
      // Add user-provided metadata (non-builtin top-level keys), namespaced by trial name
      for (const [key, value] of Object.entries(item)) {
        if (!trialBuiltinKeys.has(key)) row[`${prefix}_${key}`] = value;
      }
      // Add responseData fields, namespaced by trial name
      if (item.responseData && typeof item.responseData === 'object' && !Array.isArray(item.responseData)) {
        for (const [key, value] of Object.entries(item.responseData)) {
          row[`${prefix}_${key}`] = value;
        }
      }
    }
    files.push({
      filename: `session.${sessionID}.${Date.now()}.csv`,
      content: convertArrayOfObjectsToCSV([row]),
      encoding: 'utf8' as const,
    });
    delete groups['session'];
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
          base[key] = value;
        }
      }
      // When no flatten function is registered, spread responseData directly.
      const flatRows = flatten
        ? flatten(item)
        : [item.responseData && typeof item.responseData === 'object' ? { ...item.responseData } : {}];
      return flatRows.map((row: any) => ({ ...base, ...row }));
    });
    if (rows.length > 0) {
      files.push({
        filename: `${csvName}.${sessionID}.${Date.now()}.csv`,
        content: convertArrayOfObjectsToCSV(rows),
        encoding: 'utf8' as const,
      });
    }
  }

  return files;
}

export function buildUploadFiles(config: {
  sessionID: string;
  data: any[];
  store?: Store;
  generateFiles?: (sessionID: string, data: any[], store?: Store) => FileUpload[];
  sessionData?: Record<string, any>;
  uploadRaw?: boolean;
}): FileUpload[] {
  const {
    sessionID,
    data,
    store,
    generateFiles,
    sessionData,
    uploadRaw = true,
  } = config;

  const files: FileUpload[] = generateFiles ? generateFiles(sessionID, data, store) : [];

  if (uploadRaw) {
    files.push({
      filename: `${sessionID}.raw.json`,
      content: JSON.stringify(data),
      encoding: 'utf8',
    });
  }

  files.push(...autoBuildCSVs(sessionID, data, sessionData));

  return files;
}
