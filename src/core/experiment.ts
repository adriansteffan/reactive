// Timelines use the array methods, such as .shuffle(), so they are added wherever one is built
import '../utils/array';
import type { Theme } from '../runner/theme';
import { withSeed } from '../utils/distributions';
import { libraryParams, type ParamSpec, type ParamValues, resolveParams } from './params';
import type { RunSimulationConfig } from './simulation';
import { type CompiledTimeline, compileExperimentTimeline, describeEntry, type Timeline } from './timeline';

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

export function defineExperiment<const Params extends Record<string, ParamSpec> = {}>(
  experiment: Experiment<Params>,
): Experiment<Params> {
  return experiment;
}

// --- Runs ---

/** What stays the same for a participant across hot reloads. */
export interface Session {
  /** The values of every param: the experiment's, those of the components in its timeline, and the library's. */
  params: Record<string, unknown>;
  /** Seeds the random draws made while the timeline is built, so that a rebuild repeats them. */
  buildSeed: number;
}

export interface Run {
  session: Session;
  compiled: CompiledTimeline;
  /** Every param of the run as declared, for recording them. */
  specs: Record<string, ParamSpec>;
}

/** Builds the timeline for the experiment's params and returns its top-level entries, with nested lists flattened. */
export function buildTimeline(
  experiment: Experiment<any>,
  params: Record<string, unknown>,
  buildSeed: number,
): Timeline {
  const timeline = withSeed(buildSeed, () =>
    typeof experiment.timeline === 'function' ? experiment.timeline(params) : experiment.timeline,
  );
  const flatten = (items: Timeline): Timeline =>
    items.flatMap((item) => (Array.isArray(item) ? flatten(item) : item ? [item] : []));
  return flatten(timeline);
}

/** Whether a list of the settings screen (1-based positions and trial names) holds a top-level entry. */
export function inSubset(list: string, index: number, name: string | undefined): boolean {
  return list.split(',').some((value) => Number(value) === index + 1 || (name !== undefined && value === name));
}

// Keeps the entries chosen on the settings screen
function selectSubset(entries: Timeline, url: Record<string, unknown>): Timeline {
  const include = String(url.includeSubset ?? '');
  const exclude = String(url.excludeSubset ?? '');
  return entries.filter((entry, index) => {
    const { name } = describeEntry(entry);
    return (!include || inSubset(include, index, name)) && (!exclude || !inSubset(exclude, index, name));
  });
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
    const { component, hideSettings } = instruction.content;
    for (const [name, spec] of Object.entries(component.reactive.params)) {
      specs[name] = spec;
      owners[name] ??= component.reactive.name;
      const hidden = hideSettings === true || (Array.isArray(hideSettings) && hideSettings.includes(name));
      if (!hidden) shown.add(name);
    }
  }
  return { specs, owners, shown };
}

/**
 * Starts a participant's run: resolves the experiment's params, builds and compiles its
 * timeline, and resolves the params of the components in it and the library's. A previous
 * session, kept across a hot reload, keeps its values and build seed.
 */
export function startRun(
  experiment: Experiment<any>,
  sources: { url: Record<string, unknown>; overrides?: Record<string, unknown> },
  previous?: Session,
): Run {
  const experimentValues = resolveParams(experiment.params, { ...sources, previous: previous?.params });
  const buildSeed = previous?.buildSeed ?? Math.floor(Math.random() * 2 ** 32);
  const entries = buildTimeline(experiment, experimentValues, buildSeed);
  const compiled = compileExperimentTimeline(selectSubset(entries, sources.url));
  const own = experiment.params ?? {};
  // The library's params come first, which keeps the order of the CSV columns
  const settings = Object.fromEntries(
    Object.entries({ ...libraryParams, ...componentParams(compiled).specs }).filter(([name]) => !(name in own)),
  );
  const settingValues = resolveParams(settings, { ...sources, previous: previous?.params });
  return {
    session: { params: { ...settingValues, ...experimentValues }, buildSeed },
    compiled,
    specs: { ...settings, ...own },
  };
}

/**
 * What the settings screen shows for the values in `url`: the top-level entries of the timeline
 * its params build, and the settings besides the experiment's own params, by whose they are: the
 * library's under `General`, then each component's. As in a run, only the components of the trials
 * that `url` selects count. Params that `url` does not set take the values in `defaults`.
 */
export function previewTimeline(
  experiment: Experiment<any>,
  url: Record<string, unknown>,
  defaults: Record<string, unknown>,
) {
  const params = resolveParams(experiment.params, { url, previous: defaults });
  const entries = buildTimeline(experiment, params, 0);
  const { specs, owners, shown } = componentParams(compileExperimentTimeline(selectSubset(entries, url)));
  const own = experiment.params ?? {};
  const settings: Record<string, Record<string, ParamSpec>> = { General: {} };
  for (const [name, spec] of Object.entries(libraryParams)) {
    if (!(name in own)) settings.General[name] = spec;
  }
  for (const name of shown) {
    if (!(name in own)) settings[owners[name]] = { ...settings[owners[name]], [name]: specs[name] };
  }
  return { entries: entries.map(describeEntry), settings };
}
