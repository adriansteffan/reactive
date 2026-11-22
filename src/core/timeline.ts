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
  ResponseOf,
  RuntimeComponent,
  Simulator,
  SimulatorOverrides,
} from './component';
import { isReservedTrialName, type ReservedTrialName, sessionPrefixes } from './columns';
import { report } from './development';
import { type TrialCsv, trialCsv } from './files';
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
    <C>(trial: Trial<C, any, true, any>): ResponseOf<C>;
    <C extends AnyComponent>(component: DefinedComponent<C, any, any>, name: string): ResponseOf<C>;
  };
  /** The response of a trial, or `undefined` if it has not run (skipped branch, or not reached yet). */
  getOptional: {
    <C>(trial: Trial<C, any, true, any>): ResponseOf<C> | undefined;
    <C extends AnyComponent>(component: DefinedComponent<C, any, any>, name: string): ResponseOf<C> | undefined;
  };
}

const trialKey = (type: string, name: string) => `${type}\u0000${name}`;

export function createTimelineContext(
  data: ExperimentData,
  store: Store,
  trials: ReadonlySet<string>,
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
    slides: [],
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
  props: ContextArg<Record<string, any>>;
  // Layers of metadata, merged in order when the trial runs
  metadata?: ContextArg<Record<string, any>>[];
  csv?: TrialCsv;
  session?: boolean;
  collectRefreshRate?: boolean;
  hideParams?: readonly string[] | boolean;
  simulators?: Record<string, Simulator>;
}

/** A trial name, or the reason the types reject it: its session CSV columns would take the library's. */
export type TrialName<N extends string> = N extends ReservedTrialName
  ? `The trial name '${N}' would put its session CSV columns under url_ or session_, which the library keeps for itself`
  : N;

/**
 * A trial in the timeline, of component `C`, with default simulators `D` and params `H`; `Named` says whether
 * it has a name, which `get` needs. Every method returns a new trial and leaves this one unchanged;
 * passing `undefined` leaves a setting as it is.
 */
export interface Trial<C = any, D = any, Named extends boolean = boolean, H extends string = string> {
  readonly [TRIAL]: TrialSpec;
  // Carries the types for inference; never set
  readonly __types?: { component: C; simulators: D; named: Named; settings: H };
  /**
   * Extra values for this trial's rows, merged into those set before: under `metadata` in the data,
   * and as `meta_` columns in the CSVs.
   */
  metadata(values: ContextArg<Record<string, any>> | undefined): Trial<C, D, Named, H>;
  /**
   * Renames the CSV files of this trial's rows, which keep their component's flatteners: a name for
   * a component with one file, and for one with several, a map from its files to new names or to
   * `null`. `null` keeps the rows out of the CSVs.
   */
  csv(files: TrialCsv | undefined): Trial<C, D, Named, H>;
  /**
   * Puts this trial's columns in the session CSV, or with `false` keeps them out, whatever its
   * component does. A response that is a list has no columns there.
   */
  session(enabled: (ResponseOf<C> extends readonly unknown[] ? false : boolean) | undefined): Trial<C, D, Named, H>;
  /** Measures the screen's refresh rate while this trial runs and stores it for later canvas trials. */
  collectRefreshRate(enabled?: boolean): Trial<C, D, Named, H>;
  /** Hides the component's params from the settings screen: all of them, or the ones named. */
  hideParams(params: readonly H[] | boolean | undefined): Trial<C, D, Named, H>;
  /** Replaces some of the component's simulators for this trial, each with one that returns what it returns. */
  simulators(simulators: SimulatorOverrides<C, D> | undefined): Trial<C, D, Named, H>;
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
  metadata(this: Trial, values: ContextArg<Record<string, any>> | undefined) {
    return values === undefined ? this : withSpec(this, { metadata: [...(this[TRIAL].metadata ?? []), values] });
  },
  csv(this: Trial, csv: TrialCsv | undefined) {
    return csv === undefined ? this : withSpec(this, { csv });
  },
  session(this: Trial, enabled: boolean | undefined) {
    return enabled === undefined ? this : withSpec(this, { session: enabled });
  },
  // Turns on when called without an argument, and stays as it is when passed undefined
  collectRefreshRate(this: Trial, ...args: [boolean?]) {
    if (args.length === 0) return withSpec(this, { collectRefreshRate: true });
    return args[0] === undefined ? this : withSpec(this, { collectRefreshRate: args[0] });
  },
  hideParams(this: Trial, hideParams: readonly string[] | boolean | undefined) {
    return hideParams === undefined ? this : withSpec(this, { hideParams });
  },
  simulators(this: Trial, simulators: Record<string, Simulator> | undefined) {
    return simulators === undefined
      ? this
      : withSpec(this, { simulators: { ...this[TRIAL].simulators, ...simulators } });
  },
};

/** What the runner and the simulation read for a trial. */
export interface TrialContent extends Omit<TrialSpec, 'props' | 'metadata'> {
  type: string;
  /** Its own name, or for an unnamed trial in the session CSV, its component's, numbered from the second on. */
  name?: string;
  props: ContextArg<Record<string, any>>;
  metadata?: ContextArg<Record<string, any>>;
}

// Layers merged in order: an object when all of them are, else a function of the context
const merge = (layers: ContextArg<Record<string, any>>[]): ContextArg<Record<string, any>> =>
  layers.every((layer) => typeof layer !== 'function')
    ? Object.assign({}, ...(layers as Record<string, any>[]))
    : (context: TimelineContext) => Object.assign({}, ...layers.map((layer) => resolve(layer, context)));

function trialContent(spec: TrialSpec): TrialContent {
  const { component, props, metadata, ...settings } = spec;
  return {
    component,
    type: component.reactive.name,
    props,
    ...(metadata ? { metadata: merge(metadata) } : {}),
    ...settings,
  };
}

// --- Blocks ---

/**
 * A block of control flow. `Holds` is what its items are, trials or slides, which keeps it to the
 * timelines of that kind; a block without items, such as updateStore, fits both.
 */
export interface Block<Holds extends 'trials' | 'slides' = never> {
  readonly [BLOCK]: BlockSpec;
  readonly __holds?: Holds;
}

// What a list of items holds: trials, slides, or never for a list that could be either, such as an empty one
type HoldsOf<T> = T extends Timeline ? (T extends SlideTimeline ? never : 'trials') : 'slides';
// The items that a block holding `H` takes
type ItemsFor<H> = [H] extends [never] ? Timeline | SlideTimeline : H extends 'trials' ? Timeline : SlideTimeline;

export interface IfBlock<Holds extends 'trials' | 'slides' = never> extends Block<Holds> {
  /** Items to run when the condition is false, of the same kind as the block's. */
  else(items: undefined): Block<Holds>;
  else<const E extends ItemsFor<Holds>>(items: E | undefined): Block<Holds | HoldsOf<E>>;
}

/** A list of trials and blocks. Nested lists are flattened, and `false`, `null` and `undefined` are skipped. */
export type Timeline = readonly TimelineEntry[];
export type TimelineEntry = Trial<any, any, any, any> | Block<'trials'> | Timeline | false | null | undefined;

const block = (spec: BlockSpec): Block => Object.freeze({ [BLOCK]: spec });

/** Runs the items if the condition is true when the block is reached. In a CanvasBlock, the items are slides. */
export function ifBlock<const T extends Timeline | SlideTimeline>(
  cond: (context: TimelineContext) => boolean,
  items: T,
): IfBlock<HoldsOf<T>> {
  const spec = { kind: 'if', cond, items } as const;
  return Object.freeze({
    [BLOCK]: spec,
    else: (elseItems: Timeline | SlideTimeline | undefined) =>
      elseItems === undefined ? block(spec) : block({ ...spec, else: elseItems }),
  }) as IfBlock<HoldsOf<T>>;
}

/** Runs the items again and again while the condition is true. In a CanvasBlock, the items are slides. */
export function whileBlock<const T extends Timeline | SlideTimeline>(
  cond: (context: TimelineContext) => boolean,
  items: T,
): Block<HoldsOf<T>> {
  return block({ kind: 'while', cond, body: items });
}

/** Runs the items in fullscreen, which the run leaves once it is outside them; fullscreenBlock puts its screen first. */
export function fullscreenSpan(items: Timeline): Block<'trials'> {
  return block({ kind: 'fullscreen', items }) as Block<'trials'>;
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

const blockNames: Record<BlockSpec['kind'], string> = {
  if: 'ifBlock',
  while: 'whileBlock',
  updateStore: 'updateStore',
  marker: 'marker',
  ifGoto: 'ifGoto',
  fullscreen: 'fullscreenBlock',
};

/** The items of a list, with nested lists flattened and `false`, `null` and `undefined` skipped. */
export function itemsOf(list: readonly unknown[]): unknown[] {
  return list.flatMap((item) =>
    Array.isArray(item) ? itemsOf(item) : item === false || item === null || item === undefined ? [] : [item],
  );
}

// The items a block holds, the else arm's after an ifBlock's own
function blockItems(spec: BlockSpec): { item: unknown; arm?: 'else' }[] {
  if (spec.kind === 'if') {
    return [...itemsOf(spec.items).map((item) => ({ item })), ...itemsOf(spec.else ?? []).map((item) => ({ item, arm: 'else' as const }))];
  }
  if (spec.kind === 'while') return itemsOf(spec.body).map((item) => ({ item }));
  return spec.kind === 'fullscreen' ? itemsOf(spec.items).map((item) => ({ item })) : [];
}

/** A trial or block as the settings screen lists it, with the items of a block. */
export interface EntryInfo {
  /** Its place in the timeline: its position, after those of the blocks it sits in (`4.2`). */
  position: string;
  /** What a link's `excludeSubset` names it by: a trial's name, or else its position. */
  id: string;
  /** The component of a trial, or the kind of a block. */
  type: string;
  /** A trial's name, or a marker's id. */
  name?: string;
  /** Set for the items of an ifBlock's else arm. */
  arm?: 'else';
  children?: EntryInfo[];
}

function describe(item: unknown, position: string, arm?: 'else'): EntryInfo {
  const at = { position, id: position, ...(arm ? { arm } : {}) };
  if (isTrial(item)) {
    const { name } = item[TRIAL];
    return { ...at, id: name ?? position, type: item[TRIAL].component.reactive.name, ...(name !== undefined ? { name } : {}) };
  }
  if (!isBlock(item)) return { ...at, type: typeof item };
  const spec = item[BLOCK];
  if (spec.kind === 'marker') return { ...at, type: 'marker', name: spec.id };
  const children = blockItems(spec).map((child, i) => describe(child.item, `${position}.${i + 1}`, child.arm));
  return { ...at, type: blockNames[spec.kind], ...(children.length > 0 ? { children } : {}) };
}

/** The timeline's entries as the settings screen lists them, with the items of blocks under them. */
export function describeTimeline(timeline: Timeline): EntryInfo[] {
  return itemsOf(timeline).map((item, i) => describe(item, `${i + 1}`));
}

// The markers in an entry, also those inside its blocks
function markersIn(entry: unknown): Block[] {
  if (!isBlock(entry)) return [];
  const spec = entry[BLOCK];
  return spec.kind === 'marker' ? [entry] : blockItems(spec).flatMap((child) => markersIn(child.item));
}

/**
 * The timeline without the entries that `excluded` names, by name or by position, also inside
 * blocks. An entry left out leaves its markers in its place, so that every ifGoto keeps its target,
 * and a block left without any of its items goes as well, so that no loop runs on without them.
 */
export function excludeEntries(timeline: Timeline, excluded: ReadonlySet<string>): Timeline {
  const select = (item: unknown, position: string): unknown[] => {
    const name = isTrial(item) ? item[TRIAL].name : undefined;
    if (excluded.has(position) || (name !== undefined && excluded.has(name))) return markersIn(item);
    if (!isBlock(item)) return [item];
    const spec = item[BLOCK];
    if (spec.kind !== 'if' && spec.kind !== 'while' && spec.kind !== 'fullscreen') return [item];
    const kept = blockItems(spec).map((child, i) => ({ ...child, kept: select(child.item, `${position}.${i + 1}`) }));
    if (kept.every((child) => child.kept.length === 1 && child.kept[0] === child.item)) return [item];
    const items = kept.flatMap((child) => child.kept);
    if (items.every((kept) => isBlock(kept) && kept[BLOCK].kind === 'marker')) return items;
    const arm = (which?: 'else') => kept.filter((child) => child.arm === which).flatMap((child) => child.kept);
    if (spec.kind === 'while') return [block({ ...spec, body: arm() })];
    if (spec.kind === 'fullscreen') return [block({ ...spec, items: arm() })];
    return [block({ ...spec, items: arm(), ...(spec.else ? { else: arm('else') } : {}) })];
  };
  return itemsOf(timeline).flatMap((item, i) => select(item, `${i + 1}`)) as Timeline;
}

// --- Compiling ---

export interface CompiledTimeline {
  bytecode: Bytecode<TrialContent>;
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

  const bytecode = compileTimeline<TrialContent>(timeline, (item, branch) => {
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
    // Checks the trial's files when the experiment loads
    trialCsv(type, spec.component.reactive.csv, spec.csv);
    if (name === undefined && (spec.session ?? spec.component.reactive.session !== undefined)) {
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
