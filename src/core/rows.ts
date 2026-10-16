import type { Run } from './experiment';
import { paramType } from './params';
import { type TimelineContext, resolve, type TrialContent } from './timeline';

/** One recorded row: a trial's response, its timing, and what identifies it. The first row of a session holds its params instead. */
export interface TrialData {
  index: number;
  trialNumber: number;
  /** The component's name. */
  type: string;
  name: string;
  /** Set with `.csv()`: the CSV file(s) for this row instead of its component's. `null` keeps it out of the CSVs. */
  csv?: string | string[] | null;
  responseData?: any;
  /** Set with `.metadata(values, { nested: true })`; without `nested`, the values are columns of the row itself. */
  metadata?: Record<string, any>;
  startMs: number;
  endMs: number;
  durationMs: number;
}

/** Adds metadata to a row: as columns of the row itself, or nested in one `metadata` column. */
export function applyMetadata<T extends object>(
  row: T,
  metadata: Record<string, any> | undefined,
  nested?: boolean,
): T {
  if (nested) return { ...row, metadata };
  if (metadata) return { ...metadata, ...row };
  return row;
}

/** The row a trial records when it ends, the same whether a participant or a simulation ran it. */
export function createTrialRow(
  content: TrialContent,
  trial: { index: number; trialNumber: number; startMs: number; endMs: number; responseData: unknown },
  context: TimelineContext,
): TrialData {
  const row: TrialData = {
    index: trial.index,
    trialNumber: trial.trialNumber,
    startMs: trial.startMs,
    endMs: trial.endMs,
    durationMs: trial.endMs - trial.startMs,
    type: content.type,
    name: content.name ?? '',
    ...(content.csv !== undefined ? { csv: content.csv } : {}),
    responseData: trial.responseData,
  };
  return applyMetadata(row, resolve(content.metadata, context), content.nestMetadata);
}

/** The first row of a session's data, holding its params and how it was built. */
export function createInitialRow(info: {
  userAgent: string;
  url: Record<string, unknown>;
  run: Run;
  time: number;
}): TrialData {
  const { specs, session } = info.run;
  const params: Record<string, unknown> = {};
  // URL params that nothing declares are recorded too, and appear in the CSVs with a url_ prefix
  for (const [name, value] of Object.entries(info.url)) {
    if (!(name in specs)) {
      params[name] = { value, registered: false, defaultValue: undefined, type: undefined, description: undefined };
    }
  }
  for (const [name, spec] of Object.entries(specs)) {
    params[name] = {
      value: session.params[name],
      registered: true,
      defaultValue: typeof spec.default === 'function' ? undefined : spec.default,
      type: paramType(spec),
      description: spec.description,
    };
  }

  return {
    index: -1,
    trialNumber: -1,
    startMs: info.time,
    endMs: info.time,
    durationMs: 0,
    type: '',
    name: '',
    responseData: { userAgent: info.userAgent, params, buildSeed: session.buildSeed },
  };
}
