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
import { isProduction } from './development';
import type { TrialData } from './rows';
import type { Store, StoreUpdate } from './store';

// --- Context ---

export interface TimelineContext {
  /** Every row recorded so far, starting with the session's metadata row. */
  data: TrialData[];
  store: Store;
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

// A mistake in the experiment stops it during development and simulation, but only logs for real participants
function report(message: string): undefined {
  if (isProduction()) {
    console.error(message);
    return undefined;
  }
  throw new Error(message);
}

const trialKey = (type: string, name: string) => `${type}\u0000${name}`;

export function createTimelineContext(data: TrialData[], store: Store, trials: ReadonlySet<string>): TimelineContext {
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
    for (let i = data.length - 1; i >= 0; i--) {
      const row = data[i];
      if (row.type === type && row.name === trialName) return row.responseData;
    }
    return optional ? undefined : report(`The ${type} trial '${trialName}' has not run yet.`);
  };

  return {
    data,
    store,
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
  nestMetadata?: boolean;
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
  /** Extra columns for this trial's rows. With `{ nested: true }` they go into one `metadata` column. */
  metadata(
    values: ContextArg<Record<string, any>> | undefined,
    options?: { nested?: boolean },
  ): Trial<C, S>;
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
  metadata(this: Trial, values: ContextArg<Record<string, any>> | undefined, options?: { nested?: boolean }) {
    return values === undefined
      ? this
      : withSpec(this, { metadata: values, nestMetadata: options?.nested ?? false });
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
  name?: string;
  props: ContextArg<Record<string, any>>;
  metadata?: ContextArg<Record<string, any>>;
  nestMetadata?: boolean;
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
  else(items: Timeline | undefined): Block;
}

/** A list of trials and blocks. Nested lists are flattened, and `false`, `null` and `undefined` are skipped. */
export type Timeline = readonly TimelineEntry[];
export type TimelineEntry = Trial<any, any> | Block | Timeline | false | null | undefined;

const block = (spec: BlockSpec<TimelineContext>): Block => Object.freeze({ [BLOCK]: spec });

/** Runs the items if the condition is true when the block is reached. */
export function ifBlock(cond: (context: TimelineContext) => boolean, items: Timeline): IfBlock {
  const spec = { kind: 'if', cond, items } as const;
  return Object.freeze({
    [BLOCK]: spec,
    else: (elseItems: Timeline | undefined) =>
      elseItems === undefined ? block(spec) : block({ ...spec, else: elseItems }),
  });
}

/** Runs the items again and again while the condition is true. */
export function whileBlock(cond: (context: TimelineContext) => boolean, items: Timeline): Block {
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
}

// Two positions are exclusive when they sit in different branches of the same ifBlock
function exclusive(a: BranchPath, b: BranchPath): boolean {
  const index = a.findIndex((step, i) => step !== b[i]);
  if (index === -1 || index >= b.length) return false;
  return a[index].split(':')[0] === b[index].split(':')[0];
}

export function compileExperimentTimeline(timeline: Timeline): CompiledTimeline {
  const components = new Map<string, RuntimeComponent>();
  const named = new Map<string, { trial: Trial; branch: BranchPath }[]>();

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

    if (spec.name !== undefined) {
      const key = trialKey(type, spec.name);
      const earlier = named.get(key) ?? [];
      if (earlier.some((other) => other.trial !== item && !exclusive(other.branch, branch))) {
        throw new Error(
          `Two different ${type} trials are named '${spec.name}', so their data could not be told apart.`,
        );
      }
      named.set(key, [...earlier, { trial: item, branch }]);
    }

    return trialContent(spec);
  });

  return { bytecode, trials: new Set(named.keys()) };
}
