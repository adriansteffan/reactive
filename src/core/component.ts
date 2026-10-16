import type { ReactNode } from 'react';
import { type Flatten, setFlatteners } from './files';
import type { ParamSpec } from './params';
import type { TrialData } from './rows';
import type { Store } from './store';
import { type TimelineContext, type ContextArg, makeTrial, type Trial } from './timeline';

export type ParticipantState = Record<string, any>;

/** Props the runner passes to every component. `R` is the type of the response the component records with `next`. */
export interface BaseComponentProps<R = unknown> {
  next: (data?: R) => void;
  data: TrialData[];
  store: Store;
  updateStore: (mergeIn: Store) => void;
  /** The trial's name, for naming what the component produces before its row is recorded. */
  name?: string;
}

export type AnyComponent = (props: any) => ReactNode;

type PropsOf<C> = C extends (props: infer P) => any ? P : never;

/** The props a trial passes to its component: everything except what the runner provides. */
export type OwnProps<C> = Omit<PropsOf<C>, keyof BaseComponentProps>;

/** The response a component records with `next`. */
export type ResponseOf<C> =
  PropsOf<C> extends { next: (data?: infer R, ...rest: any[]) => void } ? R : unknown;

/** What a simulator receives: the trial's props, the participant, and whatever else the component's simulation passes along. */
export type SimulatorInput<C = any> = {
  props: OwnProps<C>;
  participant: ParticipantState;
  [extra: string]: any;
};

/** A simulator's decision. Without `participantState`, the participant stays as it was. */
export type SimulatorResult = { participantState?: ParticipantState; [key: string]: any };

/** Decides one part of a simulated participant's behavior. */
export type Simulator<C = any> = (input: SimulatorInput<C>) => SimulatorResult;

export type SimulateResult<R = unknown> = {
  responseData: R;
  /** Without it, the participant stays as it was. */
  participantState?: ParticipantState;
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
};

export type SimulateFunction<C = any, S extends string = string> = (
  input: SimulateInput<C, S>,
) => SimulateResult<ResponseOf<C>> | Promise<SimulateResult<ResponseOf<C>>>;

export interface ComponentInfo {
  name: string;
  params: Record<string, ParamSpec>;
  defaultSimulators: Record<string, Simulator>;
  simulate?: SimulateFunction;
}

/** A defined component as the runner sees it, whatever its props. */
export type RuntimeComponent = AnyComponent & { reactive: ComponentInfo };

type HasRequired<T> = {} extends T ? false : true;

type TrialFunction<C, S extends string> =
  HasRequired<OwnProps<C>> extends true
    ? {
        (props: ContextArg<OwnProps<C>>): Trial<C, S>;
        (name: string, props: ContextArg<OwnProps<C>>): Trial<C, S>;
      }
    : {
        (props?: ContextArg<OwnProps<C>>): Trial<C, S>;
        (name: string, props?: ContextArg<OwnProps<C>>): Trial<C, S>;
      };

export type DefinedComponent<C extends AnyComponent = AnyComponent, S extends string = string> = C & {
  reactive: ComponentInfo;
  trial: TrialFunction<C, S>;
};

export function defineComponent<C extends AnyComponent, S extends string = never>(definition: {
  /** Identifies the component in the data. Required, since function names do not survive minification. */
  name: string;
  component: C;
  /**
   * The CSV file its rows go to. Defaults to the name in lowercase; `null` keeps them out of the
   * CSVs. For several files, map each file to the function that flattens rows for it.
   */
  csv?: string | null | Record<string, Flatten | undefined>;
  /** Turns one row into the CSV rows it stands for, e.g. `arrayFlattener` for responses that are lists. */
  flatten?: Flatten;
  /** Params it reads with `useParams`, which the settings screen lists whenever it is in the timeline. */
  params?: Record<string, ParamSpec>;
  defaultSimulators?: Record<S, Simulator<C>>;
  simulate?: SimulateFunction<C, S>;
}): DefinedComponent<C, S> {
  const { name, component, csv = name.toLowerCase(), flatten, params = {}, simulate } = definition;
  setFlatteners(
    name,
    csv === null
      ? []
      : typeof csv === 'string'
        ? [{ csv, flatten }]
        : Object.entries(csv).map(([file, flattenFile]) => ({ csv: file, flatten: flattenFile })),
  );

  const defined = component as DefinedComponent<C, S>;
  defined.reactive = {
    name,
    params,
    defaultSimulators: (definition.defaultSimulators ?? {}) as Record<string, Simulator>,
    simulate: simulate as SimulateFunction | undefined,
  };
  defined.trial = ((first?: unknown, second?: unknown) => {
    const named = typeof first === 'string';
    const props = (named ? second : first) as ContextArg<Record<string, any>> | undefined;
    return makeTrial({
      component: defined,
      name: named ? first : undefined,
      props: props === undefined ? [] : [props],
    });
  }) as TrialFunction<C, S>;
  return defined;
}
