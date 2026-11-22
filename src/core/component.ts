import type { ReactNode } from 'react';
import type { ComponentCsv, CsvTarget, SessionColumns } from './files';
import type { CheckedParams, ParamSpec, ParamValues } from './params';
import type { ExperimentData } from './rows';
import type { Store } from './store';
import type { ReservedTrialName } from './columns';
import { type TimelineContext, type ContextArg, makeTrial, type Trial, type TrialName } from './timeline';

export type ParticipantState = Record<string, any>;

/** Props the runner passes to every component. `R` is the type of the response the component records with `next`. */
export interface BaseComponentProps<R = unknown> {
  /** Ends the trial with its response, which can only be left out if the response allows `undefined`. */
  next: undefined extends R ? (data?: R) => void : (data: R) => void;
  /** Everything recorded so far: the session, and the rows of the trials that have ended. */
  data: ExperimentData;
  store: Store;
  updateStore: (mergeIn: Store) => void;
  /** The trial's name, for naming what the component produces before its row is recorded. */
  name?: string;
}

export type AnyComponent = (props: any) => ReactNode;

type PropsOf<C> = C extends (props: infer P) => any ? P : never;

/** The props a trial passes to its component: everything except what the runner provides. */
export type OwnProps<C> = DistributiveOmit<PropsOf<C>, keyof BaseComponentProps>;

// Omits from each variant of a union of props, which keep their own fields
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** The response a component records with `next`. */
export type ResponseOf<C> =
  PropsOf<C> extends { next: (data: infer R, ...rest: any[]) => void } ? R : unknown;

/** What a simulator receives: the trial's props, the participant, and whatever else the component's simulation passes along. */
export type SimulatorInput<C = any> = {
  props: OwnProps<C>;
  participant: ParticipantState;
  [extra: string]: any;
};

/** A simulator's decision, as `value`. Without `participant`, the participant stays as it was. */
export type SimulatorResult = { value?: any; participant?: ParticipantState };

/** Decides one part of a simulated participant's behavior. */
export type Simulator<C = any> = (input: SimulatorInput<C>) => SimulatorResult;

/** A trial's replacement for a default simulator, which it receives to build on. */
export type SimulatorReplacement = (input: SimulatorInput, defaultSimulator: Simulator) => SimulatorResult;

// A replacement takes what a simulator of the component takes, along with the default simulator,
// returns what the default returns, and may leave the participant as it was
type Replacement<C, F> = F extends (...args: any[]) => infer R
  ? (
      input: SimulatorInput<C>,
      defaultSimulator: (input: SimulatorInput<C>) => R,
    ) => Omit<R, 'participant'> & { participant?: ParticipantState }
  : never;

/** Replacements for some of the default simulators `D` of component `C`. */
export type SimulatorOverrides<C, D> = { [K in keyof D]?: Replacement<C, D[K]> };

export type SimulateResult<R = unknown> = {
  responseData: R;
  /** Without it, the participant stays as it was. */
  participant?: ParticipantState;
  durationMs?: number;
  storeUpdates?: Record<string, any>;
};

/** What a component's simulation receives: the context of the trial, plus its props, the participant and the simulators. */
export type SimulateInput<C = any, S extends string = string> = TimelineContext & {
  props: OwnProps<C>;
  participant: ParticipantState;
  /** The participant as the simulation started it. */
  initialParticipant: ParticipantState;
  simulators: Record<S, Simulator<C>>;
  /** The components of the timeline, by name, for building the CSV files. */
  components: ReadonlyMap<string, RuntimeComponent>;
};

export type SimulateFunction<C = any, S extends string = string> = (
  input: SimulateInput<C, S>,
) => SimulateResult<ResponseOf<C>> | Promise<SimulateResult<ResponseOf<C>>>;

/** What a component's `check` sees of one of its trials when the experiment loads. */
export interface TrialCheck<C = any, P = {}> {
  /** The trial's props, or `undefined` when they are computed during the run. */
  props: OwnProps<C> | undefined;
  /** The run's params: the experiment's, the components' and the library's. */
  params: ParamValues<P> & Record<string, unknown>;
  /** Every trial of the timeline, in order. */
  trials: readonly { type: string; name?: string }[];
  /** This trial's position in `trials`. */
  index: number;
  /**
   * Whether this is a production build. A check for what only the real link provides, such as a
   * URL param, can leave development and simulation alone.
   */
  production: boolean;
}

export interface ComponentInfo {
  name: string;
  /** The CSV files its rows go to. */
  csv: CsvTarget[];
  /** Its trials' columns in the session CSV, if they go there. */
  session?: SessionColumns;
  params: Record<string, ParamSpec>;
  defaultSimulators: Record<string, Simulator>;
  simulate?: SimulateFunction;
  check?: (trial: TrialCheck) => string | undefined;
}

/** A defined component as the runner sees it, whatever its props. */
export type RuntimeComponent = AnyComponent & { reactive: ComponentInfo };

type HasRequired<T> = {} extends T ? false : true;

// Props are an object, so that a name is never taken for them, even by a component without props of its own
type TrialProps<C> = ContextArg<OwnProps<C> & object>;

// TypeScript reports the error of the last overload, so a name that reaches it, being taken or
// missing the props after it, is turned into a message about the name
type PropsOrName<C, P> = [P] extends [string]
  ? P extends ReservedTrialName
    ? TrialName<P>
    : `The trial '${P & string}' needs its props after its name`
  : TrialProps<C>;

type TrialFunction<C, D, H extends string> =
  HasRequired<OwnProps<C>> extends true
    ? {
        <const N extends string>(name: TrialName<N>, props: TrialProps<C>): Trial<C, D, true, H>;
        <const P = TrialProps<C>>(props: PropsOrName<C, P>): Trial<C, D, false, H>;
      }
    : {
        <const N extends string>(name: TrialName<N>, props?: TrialProps<C>): Trial<C, D, true, H>;
        <const P = TrialProps<C>>(props?: PropsOrName<C, P>): Trial<C, D, false, H>;
      };

/** A component defined with `defineComponent`, with default simulators `D` and params `H`. */
export type DefinedComponent<C extends AnyComponent = AnyComponent, D = any, H extends string = string> = C & {
  reactive: ComponentInfo;
  trial: TrialFunction<C, D, H>;
};

export function defineComponent<
  C extends AnyComponent,
  S extends string = never,
  D extends Partial<Record<S, Simulator<C>>> = {},
  const P extends Record<string, ParamSpec> = {},
>(definition: {
  /** Identifies the component in the data. Required, since function names do not survive minification. */
  name: string;
  component: C;
  /**
   * The CSV file its rows go to: one row per trial, or per item of a response that is a list.
   * Defaults to the name in lowercase, unless the component sets `session`; `null` keeps them out of
   * the CSVs. A map gives files the function that turns a row into the file's rows, or `true`.
   */
  csv?: ComponentCsv<ResponseOf<C>>;
  /**
   * Puts its trials' columns in the session CSV, the single row per participant: `true` for the
   * response's fields, or a function that returns them.
   */
  session?: SessionColumns<ResponseOf<C>>;
  /** Params it reads with `useParams`, which the settings screen lists whenever it is in the timeline. */
  params?: CheckedParams<P>;
  defaultSimulators?: Record<S, Simulator<C>> & D;
  simulate?: SimulateFunction<C, S>;
  /**
   * Checks each of its trials when the experiment loads, and returns what is wrong with it. Any
   * message keeps the run from starting, and the settings screen shows it.
   */
  check?: (trial: TrialCheck<C, P>) => string | undefined;
}): DefinedComponent<C, D, keyof P & string> {
  const { name, component, session, params = {}, simulate } = definition;
  const csv = definition.csv !== undefined ? definition.csv : session === undefined ? name.toLowerCase() : null;
  const files: CsvTarget[] =
    csv === null
      ? []
      : typeof csv === 'string'
        ? [{ file: csv }]
        : Object.entries(csv).map(([file, flatten]) => (flatten === true ? { file } : { file, flatten }));
  if (files.some((target) => target.file === 'session')) {
    throw new Error(
      `${name} cannot write a CSV file named 'session', which is the session CSV. To put its trials' columns in the session row, give it session: true.`,
    );
  }
  // A hot reload can run a definition again with the same function and name
  const previous = (component as { reactive?: ComponentInfo }).reactive;
  if (previous && previous.name !== name) {
    throw new Error(
      `The components '${previous.name}' and '${name}' are defined with the same function, so their trials could not be told apart. Give one of them a function of its own that renders the shared one.`,
    );
  }
  const defined = component as DefinedComponent<C, D, keyof P & string>;
  defined.reactive = {
    name,
    csv: files,
    session: session as SessionColumns | undefined,
    params: params as Record<string, ParamSpec>,
    defaultSimulators: (definition.defaultSimulators ?? {}) as Record<string, Simulator>,
    simulate: simulate as SimulateFunction | undefined,
    check: definition.check as ComponentInfo['check'],
  };
  defined.trial = ((first?: unknown, second?: unknown) => {
    const named = typeof first === 'string';
    const props = (named ? second : first) as ContextArg<Record<string, any>> | undefined;
    return makeTrial({
      component: defined,
      name: named ? first : undefined,
      props: props ?? {},
    });
  }) as TrialFunction<C, D, keyof P & string>;
  return defined;
}
