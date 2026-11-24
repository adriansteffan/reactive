// Timelines use the array methods, such as .shuffle(), so they are added wherever one is built
import '../utils/array';
import type { Theme } from '../runner/theme';
import { withSeed } from '../utils/distributions';
import { advanceToNextContent } from './bytecode';
import { isReservedParamName, sessionColumns, sessionPrefixes } from './columns';
import { freezeInDevelopment, isProduction } from './development';
import { type CheckedParams, libraryParams, type ParamSpec, type ParamSpecs, type ParamValues, resolveParams } from './params';
import { createTrialRow, type ExperimentData } from './rows';
import type { RunSimulationConfig } from './simulation';
import type { Store } from './store';
import {
  type CompiledTimeline,
  compileExperimentTimeline,
  createTimelineContext,
  describeTimeline,
  excludeEntries,
  itemsOf,
  resolve,
  type Timeline,
  type TrialContent,
} from './timeline';

// --- Definition ---

export interface ExperimentConfig {
  showProgressBar?: boolean;
  theme?: Theme;
}

export interface Experiment<Params extends Record<string, ParamSpec> = Record<string, ParamSpec>> {
  /** The experiment's inputs, read from the URL. */
  params?: Params;
  /** The trials, or a function that builds them from the params once per participant. */
  timeline: Timeline | ((params: ParamValues<Params>) => Timeline);
  config?: ExperimentConfig;
  simulation?: RunSimulationConfig;
}

export function defineExperiment<const V extends Record<string, unknown> = {}, D extends Record<string, unknown> = {}>(
  experiment: Omit<Experiment<ParamSpecs<V, D>>, 'params'> & { params?: CheckedParams<V, D> },
): Experiment<ParamSpecs<V, D>> {
  // The checked params are the declared ones, which the types only compare against what they allow
  return experiment as Experiment<ParamSpecs<V, D>>;
}

// --- Runs ---

export interface Run {
  /** The values of every param: the experiment's, those of the components in its timeline, and the library's. */
  params: Record<string, unknown>;
  /** Seeds the random draws made while the timeline is built, so that a rebuild repeats them. */
  buildSeed: number;
  compiled: CompiledTimeline;
  /** Every param of the run as declared, for recording them. */
  specs: Record<string, ParamSpec>;
}

/** What a run keeps across hot reloads, so that the rebuilt timeline matches the one the participant is in. */
export type KeptRun = Pick<Run, 'params' | 'buildSeed'>;

/** Builds the timeline for the experiment's params and returns its top-level entries, with nested lists flattened. */
export function buildTimeline(
  experiment: Experiment<any>,
  params: Record<string, unknown>,
  buildSeed: number,
): Timeline {
  const timeline = withSeed(buildSeed, () =>
    typeof experiment.timeline === 'function' ? experiment.timeline(params) : experiment.timeline,
  );
  return itemsOf(timeline) as Timeline;
}

/**
 * The params of the components in the timeline, the component that declares each, and which of
 * them some trial shows on the settings screen.
 */
export function componentParams(compiled: CompiledTimeline) {
  const specs: Record<string, ParamSpec> = {};
  const owners: Record<string, string> = {};
  const shown = new Set<string>();
  for (const instruction of compiled.bytecode.instructions) {
    if (instruction.type !== 'ExecuteContent') continue;
    const { component, hideParams } = instruction.content;
    for (const [name, spec] of Object.entries(component.reactive.params)) {
      specs[name] = spec;
      owners[name] ??= component.reactive.name;
      const hidden = hideParams === true || (Array.isArray(hideParams) && hideParams.includes(name));
      if (!hidden) shown.add(name);
    }
  }
  return { specs, owners, shown };
}

/** What the components' checks find wrong with the trials, which keeps a run from starting. */
export function checkTrials(compiled: CompiledTimeline, params: Record<string, unknown>, production: boolean): string[] {
  const contents = compiled.bytecode.instructions.flatMap((instruction) =>
    instruction.type === 'ExecuteContent' ? [instruction.content] : [],
  );
  const trials = contents.map(({ type, name }) => ({ type, name }));
  return contents.flatMap((content, index) => {
    const problem = content.component.reactive.check?.({
      props: typeof content.props === 'function' ? undefined : content.props,
      params,
      trials,
      index,
      production,
    });
    return problem ? [problem] : [];
  });
}

// What a run and the settings screen both work out: the params, the timeline they build with the
// trials the URL selects, and what the components' checks find wrong with it
function prepareRun(
  experiment: Experiment<any>,
  sources: { url: Record<string, unknown>; overrides?: Record<string, unknown> },
  previous: KeptRun | undefined,
) {
  const experimentValues = resolveParams(experiment.params, { ...sources, previous: previous?.params });
  const buildSeed = previous?.buildSeed ?? Math.floor(Math.random() * 2 ** 32);
  const entries = buildTimeline(experiment, experimentValues, buildSeed);
  // The settings screen's unchecked trials, which its link lists by name or position
  const excluded = new Set(String(sources.url.excludeSubset ?? '').split(','));
  const compiled = compileExperimentTimeline(excludeEntries(entries, excluded));
  const components = componentParams(compiled);
  const own = experiment.params ?? {};
  // The library's params come first, which keeps the order of the CSV columns
  const settings = Object.fromEntries(
    Object.entries({ ...libraryParams, ...components.specs }).filter(([name]) => !(name in own)),
  );
  for (const name of Object.keys({ ...settings, ...own })) {
    if (isReservedParamName(name)) {
      throw new Error(
        `A param cannot be named '${name}': the session CSV keeps ${sessionColumns.join(', ')} and names starting with ${sessionPrefixes.join(' or ')} for itself.`,
      );
    }
  }
  const params = { ...resolveParams(settings, { ...sources, previous: previous?.params }), ...experimentValues };
  const run: Run = { params, buildSeed, compiled, specs: { ...settings, ...own } };
  return { run, entries, components, problems: checkTrials(compiled, params, isProduction()) };
}

/**
 * Starts a participant's run: resolves the experiment's params, builds and compiles its
 * timeline, and resolves the params of the components in it and the library's. A run kept
 * across a hot reload keeps its values and build seed.
 */
export function startRun(
  experiment: Experiment<any>,
  sources: { url: Record<string, unknown>; overrides?: Record<string, unknown> },
  previous?: KeptRun,
): Run {
  const { run, problems } = prepareRun(experiment, sources, previous);
  if (problems.length > 0) throw new Error(`The experiment cannot start: ${problems.join(' ')}`);
  return run;
}

/**
 * What the settings screen shows for the values in `url`: the top-level entries of the timeline
 * its params build, the settings besides the experiment's own params, by whose they are (the
 * library's under `General`, then each component's), and what would keep a run from starting. As
 * in a run, only the components of the trials that `url` selects count. Params that `url` does not
 * set take the values in `defaults`.
 */
export function previewTimeline(
  experiment: Experiment<any>,
  url: Record<string, unknown>,
  defaults: Record<string, unknown>,
) {
  const { entries, components, problems } = prepareRun(experiment, { url }, { params: defaults, buildSeed: 0 });
  const { specs, owners, shown } = components;
  const own = experiment.params ?? {};
  const settings: Record<string, Record<string, ParamSpec>> = { General: {} };
  for (const [name, spec] of Object.entries(libraryParams)) {
    if (!(name in own)) settings.General[name] = spec;
  }
  for (const name of shown) {
    if (!(name in own)) settings[owners[name]] = { ...settings[owners[name]], [name]: specs[name] };
  }
  return { entries: describeTimeline(entries), settings, problems };
}

// --- Steps ---

/** Where a participant is in their run, and what they have done so far. */
export interface RunState {
  /** The instruction of the trial on screen, or the length of the bytecode once the run is finished. */
  pointer: number;
  /** Everything recorded so far: the session, and the rows of the trials that have ended. */
  data: ExperimentData;
  store: Store;
  /** The props of the trial on screen, resolved once when it started. */
  props: Record<string, any>;
}

/** The trial at `pointer`, or `undefined` once the run is finished. */
export function trialAt(compiled: CompiledTimeline, pointer: number): TrialContent | undefined {
  const instruction = compiled.bytecode.instructions[pointer];
  return instruction?.type === 'ExecuteContent' ? instruction.content : undefined;
}

// Runs control flow from `from` up to the next trial and resolves that trial's props
function advance(compiled: CompiledTimeline, data: ExperimentData, fromStore: Store, from: number): RunState {
  const contextFor = (store: Store) => createTimelineContext(data, store);
  const { pointer, store } = advanceToNextContent(compiled.bytecode, from, fromStore, contextFor);
  const trial = trialAt(compiled, pointer);
  return { pointer, data, store, props: trial ? resolve(trial.props, contextFor(store)) : {} };
}

/** The state a run starts in, with its first trial on screen. */
export function createRunState(compiled: CompiledTimeline, data: ExperimentData, store: Store): RunState {
  return advance(compiled, freezeInDevelopment(data), freezeInDevelopment(store), 0);
}

/**
 * Ends the trial on screen: merges the changes it made to the store, records its response, and
 * moves on to the next trial.
 */
export function respond(
  compiled: CompiledTimeline,
  state: RunState,
  trial: { recorded: unknown; storeUpdates?: Record<string, any>; startMs: number; endMs: number },
): RunState {
  const content = trialAt(compiled, state.pointer);
  if (!content) return state;
  const store = freezeInDevelopment({ ...state.store, ...trial.storeUpdates });
  const row = createTrialRow(
    content,
    {
      trialNumber: state.data.trials.length + 1,
      startMs: trial.startMs,
      endMs: trial.endMs,
      recorded: trial.recorded,
    },
    createTimelineContext(state.data, store),
  );
  const data = { ...state.data, trials: [...state.data.trials, row] };
  return advance(compiled, freezeInDevelopment(data), store, state.pointer + 1);
}

/**
 * After a hot reload, finds the trial that was on screen in the rebuilt timeline: the nearest
 * trial with the same component and name, or else the next trial from the same position on.
 */
export function realign(previous: CompiledTimeline, compiled: CompiledTimeline, state: RunState): RunState {
  const shown = trialAt(previous, state.pointer);
  const { instructions } = compiled.bytecode;
  let best = -1;
  if (shown?.name !== undefined) {
    instructions.forEach((instruction, index) => {
      const same =
        instruction.type === 'ExecuteContent' &&
        instruction.content.type === shown.type &&
        instruction.content.name === shown.name;
      if (same && (best === -1 || Math.abs(index - state.pointer) < Math.abs(best - state.pointer))) best = index;
    });
  }
  const from = best !== -1 ? best : Math.min(state.pointer, instructions.length);
  // The edited timeline can name other trials, which getAll and getLatest check against
  const data = { ...state.data, session: { ...state.data.session, namedTrials: compiled.namedTrials } };
  return advance(compiled, freezeInDevelopment(data), state.store, from);
}
