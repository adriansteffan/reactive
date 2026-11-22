import type { Run } from './experiment';
import type { TrialCsv } from './files';
import { report } from './development';
import { type ParamType, paramType } from './params';
import { type TimelineContext, resolve, type TrialContent } from './timeline';

/** One recorded row: a trial's response, its timing, and what identifies it. */
export interface TrialData {
  /** The order in which the participant saw the trial, from 1. */
  trialNumber: number;
  /** The component's name. */
  type: string;
  name: string;
  /** Set with `.csv()`: how the row's CSV files differ from its component's. */
  csv?: TrialCsv;
  /** Set with `.session()`: whether the row has columns in the session CSV, unlike its component's. */
  session?: boolean;
  responseData: any;
  /** Set with `.metadata()`. */
  metadata?: Record<string, any>;
  startMs: number;
  endMs: number;
  durationMs: number;
}

/** The row a trial records when it ends, the same whether a participant or a simulation ran it. */
export function createTrialRow(
  content: TrialContent,
  trial: { trialNumber: number; startMs: number; endMs: number; responseData: unknown },
  context: TimelineContext,
): TrialData {
  const metadata = resolve(content.metadata, context);
  return {
    trialNumber: trial.trialNumber,
    startMs: trial.startMs,
    endMs: trial.endMs,
    durationMs: trial.endMs - trial.startMs,
    type: content.type,
    name: content.name ?? '',
    ...(content.csv !== undefined ? { csv: content.csv } : {}),
    ...(content.session !== undefined ? { session: content.session } : {}),
    responseData: trial.responseData,
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

/** A param as the session recorded it: its value, and how the experiment declared it. */
export interface RecordedParam {
  value: unknown;
  /** `false` for a URL param that nothing declares. */
  registered: boolean;
  defaultValue: unknown;
  type: ParamType | undefined;
  description: string | undefined;
}

/** What a session records about itself when it starts. */
export interface SessionData {
  userAgent: string;
  /** Every param by name, including URL params that nothing declares. */
  params: Record<string, RecordedParam>;
  /** Seeds the random draws made while the timeline was built, so that it can be built again. */
  buildSeed: number;
  /** The timeline's named trials, which a component's `getAll` and `getLatest` check a name against. */
  namedTrials: { type: string; name: string }[];
}

/** Everything a session records: the session itself, and a row for each trial. */
export interface ExperimentData {
  session: SessionData;
  /** A row for each trial that has ended, in the order the participant saw them, so `trials[i].trialNumber` is `i + 1`. */
  trials: TrialData[];
}

/** The data a session starts with: its params and how it was built, and no trials yet. */
export function createExperimentData(info: { userAgent: string; url: Record<string, unknown>; run: Run }): ExperimentData {
  const { specs, params: values, buildSeed } = info.run;
  const params: Record<string, RecordedParam> = {};
  // URL params that nothing declares are recorded too, and appear in the CSVs with a url_ prefix
  for (const [name, value] of Object.entries(info.url)) {
    if (!(name in specs)) {
      params[name] = { value, registered: false, defaultValue: undefined, type: undefined, description: undefined };
    }
  }
  for (const [name, spec] of Object.entries(specs)) {
    params[name] = {
      value: values[name],
      registered: true,
      defaultValue: typeof spec.default === 'function' ? undefined : spec.default,
      type: paramType(spec),
      description: spec.description,
    };
  }
  return {
    session: { userAgent: info.userAgent, params, buildSeed, namedTrials: info.run.compiled.namedTrials },
    trials: [],
  };
}

/** The rows of a component's trials, or of its trial with this name, in the order they ran. */
export function rowsOf(type: string, data: ExperimentData, name?: string): TrialData[] {
  if (name !== undefined && !data.session.namedTrials.some((trial) => trial.type === type && trial.name === name)) {
    report(`There is no ${type} trial named '${name}' in the timeline.`);
  }
  return data.trials.filter((row) => row.type === type && (name === undefined || row.name === name));
}
