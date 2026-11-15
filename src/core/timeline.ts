import {
  BLOCK,
  type BlockSpec,
  type BranchPath,
  type Bytecode,
  compileTimeline,
  isBlock,
} from './bytecode';
import type {
  AnyComponent,
  DefinedComponent,
  OwnProps,
  ResponseOf,
  RuntimeComponent,
  Simulator,
} from './component';
import { isReservedTrialName, sessionPrefixes } from './columns';
import { isProduction } from './development';
import type { ExperimentData } from './rows';
import type { SlideData, SlideTimeline } from './slides';
import type { Store, StoreUpdate } from './store';

// --- Context ---

export interface TimelineContext {
  /** Everything recorded so far: the session, and the rows of the trials that have ended. */
  data: ExperimentData;
  store: Store;
  /** The rows of the slides recorded so far by the CanvasBlock this runs in; empty outside a CanvasBlock. */
  slides: SlideData[];
  /** The response of a trial that has run. Throws if it has not run yet. */
  get: {
    <C>(trial: Trial<C, any>): ResponseOf<C>;
    <C extends AnyComponent>(component: DefinedComponent<C, any>, name: string): ResponseOf<C>;
  };
  /** The response of a trial, or `undefined` if it has not run (skipped branch, or not reached yet). */
  getOptional: {
    <C>(trial: Trial<C, any>): ResponseOf<C> | undefined;
    <C extends AnyComponent>(component: DefinedComponent<C, any>, name: string): ResponseOf<C> | undefined;
  };
}

/** A mistake in the experiment stops it during development and simulation, but only logs for real participants. */
export function report(message: string): undefined {
  if (isProduction()) {
    console.error(message);
    return undefined;
  }
  throw new Error(message);
}

const trialKey = (type: string, name: string) => `${type}\u0000${name}`;

export function createTimelineContext(
  data: ExperimentData,
  store: Store,
  trials: ReadonlySet<string>,
  slides: SlideData[] = [],
): TimelineContext {
  const read = (target: unknown, name: unknown, optional: boolean) => {
    const [type, trialName] = isTrial(target)
      ? [target[TRIAL].component.reactive.name, target[TRIAL].name]
      : [(target as DefinedComponent).reactive.name, name as string | undefined];

    if (trialName === undefined) {
      return report(`Only named trials can be read, but this ${type} trial has no name.`);
    }
    if (!trials.has(trialKey(type, trialName))) {
      return report(`There is no ${type} trial named '${trialName}' in the timeline.`);
    }
    for (let i = data.trials.length - 1; i >= 0; i--) {
      const row = data.trials[i];
      if (row.type === type && row.name === trialName) return row.responseData;
    }
    return optional ? undefined : report(`The ${type} trial '${trialName}' has not run yet.`);
  };

  return {
    data,
    store,
    slides,
    get: (target: unknown, name?: string) => read(target, name, false),
    getOptional: (target: unknown, name?: string) => read(target, name, true),
  } as TimelineContext;
}

/** A value, or a function that computes it from the context when the trial runs. */
export type ContextArg<T> = T | ((context: TimelineContext) => T);

export function resolve<T>(value: ContextArg<T>, context: TimelineContext): T {
  return typeof value === 'function' ? (value as (context: TimelineContext) => T)(context) : value;
}

// --- Trials ---

const TRIAL: unique symbol = Symbol('reactive.trial');

interface TrialSpec {
  component: RuntimeComponent;
  name?: string;
  // Layers of props, merged in order when the trial runs
  props: ContextArg<Record<string, any>>[];
  metadata?: ContextArg<Record<string, any>>;
  csv?: string | string[] | null;
  collectRefreshRate?: boolean;
  hideSettings?: string[] | boolean;
  simulators?: Record<string, Simulator>;
}

/** A trial in the timeline. Every method returns a new trial and leaves this one unchanged; passing `undefined` leaves a setting as it is. */
export interface Trial<C = any, S extends string = string> {
  readonly [TRIAL]: TrialSpec;
  // Carries the component's types for inference; never set
  readonly __types?: { component: C; simulators: S };
  /** Renames the trial, for variants of a base trial. */
  name(name: string | undefined): Trial<C, S>;
  /** Merges props into the trial's props. */
  props(props: ContextArg<Partial<OwnProps<C>>> | undefined): Trial<C, S>;
  /** Extra values for this trial's rows: under `metadata` in the data, and as `meta_` columns in the CSVs. */
  metadata(values: ContextArg<Record<string, any>> | undefined): Trial<C, S>;
  /** The CSV file(s) this trial's rows go to instead of its component's. `null` keeps them out of the CSVs. */
  csv(file: string | string[] | null | undefined): Trial<C, S>;
  /** Measures the screen's refresh rate while this trial runs and stores it for later canvas trials. */
  collectRefreshRate(enabled?: boolean): Trial<C, S>;
  /** Hides the component's settings from the settings screen: all of them, or the ones named. */
  hideSettings(settings: string[] | boolean | undefined): Trial<C, S>;
  /** Replaces some of the component's simulators for this trial. */
  simulators(simulators: Partial<Record<S, Simulator<C>>> | undefined): Trial<C, S>;
}

export function isTrial(item: unknown): item is Trial {
  return typeof item === 'object' && item !== null && TRIAL in item;
}

export function makeTrial(spec: TrialSpec): Trial {
  const trial = Object.create(trialMethods);
  trial[TRIAL] = Object.freeze(spec);
  return Object.freeze(trial);
}

function withSpec(trial: Trial, changes: Partial<TrialSpec>): Trial {
  return makeTrial({ ...trial[TRIAL], ...changes });
}

const trialMethods = {
  name(this: Trial, name: string | undefined) {
    return name === undefined ? this : withSpec(this, { name });
  },
  props(this: Trial, props: ContextArg<Record<string, any>> | undefined) {
    return props === undefined ? this : withSpec(this, { props: [...this[TRIAL].props, props] });
  },
  metadata(this: Trial, values: ContextArg<Record<string, any>> | undefined) {
    return values === undefined ? this : withSpec(this, { metadata: values });
  },
  csv(this: Trial, csv: string | string[] | null | undefined) {
    return csv === undefined ? this : withSpec(this, { csv });
  },
  // Turns on when called without an argument, and stays as it is when passed undefined
  collectRefreshRate(this: Trial, ...args: [boolean?]) {
    if (args.length === 0) return withSpec(this, { collectRefreshRate: true });
    return args[0] === undefined ? this : withSpec(this, { collectRefreshRate: args[0] });
  },
  hideSettings(this: Trial, hideSettings: string[] | boolean | undefined) {
    return hideSettings === undefined ? this : withSpec(this, { hideSettings });
  },
  simulators(this: Trial, simulators: Record<string, Simulator> | undefined) {
    return simulators === undefined
      ? this
      : withSpec(this, { simulators: { ...this[TRIAL].simulators, ...simulators } });
  },
};

/** What the runner and the simulation read for a trial. */
export interface TrialContent {
  component: RuntimeComponent;
  type: string;
  /** Its own name, or for an unnamed trial in the session CSV, its component's, numbered from the second on. */
  name?: string;
  props: ContextArg<Record<string, any>>;
  metadata?: ContextArg<Record<string, any>>;
  csv?: string | string[] | null;
  collectRefreshRate?: boolean;
  hideSettings?: string[] | boolean;
  simulators?: Record<string, Simulator>;
}

function trialContent(spec: TrialSpec): TrialContent {
  const { component, props: layers, ...settings } = spec;
  const props = layers.every((layer) => typeof layer !== 'function')
    ? Object.assign({}, ...(layers as Record<string, any>[]))
    : (context: TimelineContext) => Object.assign({}, ...layers.map((layer) => resolve(layer, context)));
  return { component, type: component.reactive.name, props, ...settings };
}

// --- Blocks ---

export interface Block {
  readonly [BLOCK]: BlockSpec<TimelineContext>;
}

export interface IfBlock extends Block {
  /** Trials to run when the condition is false. */
  else(items: Timeline | SlideTimeline | undefined): Block;
}

/** A list of trials and blocks. Nested lists are flattened, and `false`, `null` and `undefined` are skipped. */
export type Timeline = readonly TimelineEntry[];
export type TimelineEntry = Trial<any, any> | Block | Timeline | false | null | undefined;

const block = (spec: BlockSpec<TimelineContext>): Block => Object.freeze({ [BLOCK]: spec });

/** Runs the items if the condition is true when the block is reached. In a CanvasBlock, the items are slides. */
export function ifBlock(cond: (context: TimelineContext) => boolean, items: Timeline | SlideTimeline): IfBlock {
  const spec = { kind: 'if', cond, items } as const;
  return Object.freeze({
    [BLOCK]: spec,
    else: (elseItems: Timeline | SlideTimeline | undefined) =>
      elseItems === undefined ? block(spec) : block({ ...spec, else: elseItems }),
  });
}

/** Runs the items again and again while the condition is true. In a CanvasBlock, the items are slides. */
export function whileBlock(cond: (context: TimelineContext) => boolean, items: Timeline | SlideTimeline): Block {
  return block({ kind: 'while', cond, body: items });
}

/** Merges the returned values into the store. */
export function updateStore(update: (context: TimelineContext) => StoreUpdate): Block {
  return block({ kind: 'updateStore', update });
}

/** A position that `ifGoto` can jump to. */
export function marker(id: string): Block {
  return block({ kind: 'marker', id });
}

/** Jumps to the marker if the condition is true. */
export function ifGoto(cond: (context: TimelineContext) => boolean, markerId: string): Block {
  return block({ kind: 'ifGoto', cond, marker: markerId });
}

const blockNames: Record<BlockSpec<TimelineContext>['kind'], string> = {
  if: 'ifBlock',
  while: 'whileBlock',
  updateStore: 'updateStore',
  marker: 'marker',
  ifGoto: 'ifGoto',
};

/** How a top-level entry appears on the settings screen. */
export function describeEntry(entry: unknown): { type: string; name?: string } {
  if (isTrial(entry)) return { type: entry[TRIAL].component.reactive.name, name: entry[TRIAL].name };
  if (isBlock(entry)) return { type: blockNames[entry[BLOCK].kind] };
  return { type: typeof entry };
}

// --- Compiling ---

export interface CompiledTimeline {
  bytecode: Bytecode<TrialContent, TimelineContext>;
  /** Every (component, name) pair of a named trial, for `get`. */
  trials: ReadonlySet<string>;
  /** The components of the trials, by name. */
  components: ReadonlyMap<string, RuntimeComponent>;
}

// Two positions are exclusive when they sit in different branches of the same ifBlock
function exclusive(a: BranchPath, b: BranchPath): boolean {
  const index = a.findIndex((step, i) => step.block !== b[i]?.block || step.arm !== b[i]?.arm);
  if (index === -1 || index >= b.length) return false;
  return a[index].block === b[index].block;
}

export function compileExperimentTimeline(timeline: Timeline): CompiledTimeline {
  const components = new Map<string, RuntimeComponent>();
  // Trials by name, whatever their component
  const named = new Map<string, { trial: Trial; branch: BranchPath }[]>();
  // How many unnamed trials of each component go to the session CSV
  const unnamedInSession = new Map<string, number>();
  // Every (component, name) pair, for `get`
  const trials = new Set<string>();

  const bytecode = compileTimeline<TrialContent, TimelineContext>(timeline, (item, branch) => {
    if (!isTrial(item)) {
      throw new Error(
        `The timeline can only hold trials, blocks and lists of them, but it holds ${JSON.stringify(item) ?? String(item)}.`,
      );
    }
    const spec = item[TRIAL];
    const type = spec.component.reactive.name;

    const known = components.get(type);
    if (known && known !== spec.component) {
      throw new Error(`Two different components in the timeline are named '${type}'.`);
    }
    components.set(type, spec.component);

    if (spec.name !== undefined && isReservedTrialName(spec.name)) {
      throw new Error(
        `A trial cannot be named '${spec.name}': its columns in the session CSV would start with ${sessionPrefixes.join(' or ')}, which the library keeps for itself.`,
      );
    }

    // The session CSV's columns start with the trial's name, so an unnamed trial there gets one
    let name = spec.name;
    const files = spec.csv !== undefined ? [spec.csv].flat() : spec.component.reactive.csv.map((target) => target.file);
    if (name === undefined && files.includes('session')) {
      const count = (unnamedInSession.get(type) ?? 0) + 1;
      unnamedInSession.set(type, count);
      name = count === 1 ? type : `${type}_${count}`;
    }

    if (name !== undefined) {
      const earlier = named.get(name) ?? [];
      named.set(name, [...earlier, { trial: item, branch }]);
      const clash = earlier.find((other) => other.trial !== item && !exclusive(other.branch, branch))?.trial;
      if (clash && (spec.name === undefined || clash[TRIAL].name === undefined)) {
        const unnamedType = spec.name === undefined ? type : clash[TRIAL].component.reactive.name;
        throw new Error(
          `'${name}' is the name an unnamed ${unnamedType} trial gets for its columns in the session CSV, so no other trial can have it. Name one of them differently.`,
        );
      }
      if (clash) {
        throw new Error(
          `Two different trials are named '${name}' (${clash[TRIAL].component.reactive.name} and ${type}), so their data could not be told apart.`,
        );
      }
      if (spec.name !== undefined) trials.add(trialKey(type, name));
    }

    return trialContent({ ...spec, name });
  });

  return { bytecode, trials, components };
}
