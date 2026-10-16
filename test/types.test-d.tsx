// Type tests, checked by `bun check`: every @ts-expect-error marks a mistake the types must catch
import {
  type BaseComponentProps,
  type TimelineContext,
  defineComponent,
  defineExperiment,
  ifBlock,
  PlainInput,
  Text,
  Upload,
  updateStore,
  useParams,
  whileBlock,
} from '../src/mod';

declare module '../src/mod' {
  interface ExperimentStore {
    bonus: number;
  }
}

type ClickResponse = { totalTime: number; clicks: number };

const CustomTrial = defineComponent({
  name: 'CustomTrial',
  component: ({ next, maxCount }: BaseComponentProps<ClickResponse> & { maxCount: number }) => {
    next({ totalTime: 1, clicks: maxCount });
    return null;
  },
  defaultSimulators: {
    click: ({ props, participant }) => {
      const n: number = props.maxCount;
      return { value: 300 * n, participantState: { ...participant, clicked: true } };
    },
  },
  simulate: ({ props, simulators, participant, store, get }) => {
    const n: number = props.maxCount;
    const r = simulators.click({ props, participant });
    // @ts-expect-error simulator that does not exist
    simulators.tap({ props, participant });
    // @ts-expect-error a simulator needs the props and the participant
    simulators.click({ participant });
    const bonus: number | undefined = store.bonus;
    const name: string = get(PlainInput, 'nickname').value;
    return { responseData: { totalTime: r.value * n + (bonus ?? 0) + name.length, clicks: n } };
  },
});

defineComponent({
  name: 'Bad',
  component: ({ next }: BaseComponentProps<ClickResponse>) => {
    next();
    return null;
  },
  // @ts-expect-error responseData does not match the component's response
  simulate: () => ({ responseData: { totalTime: 'x' } }),
});

// simulate may come before defaultSimulators
defineComponent({
  name: 'SimulateFirst',
  component: (_props: BaseComponentProps<ClickResponse> & { maxCount: number }) => null,
  simulate: ({ props, simulators, participant }) => {
    // @ts-expect-error simulator that does not exist
    simulators.tap({ props, participant });
    return { responseData: { totalTime: simulators.click({ props, participant }).value, clicks: 1 } };
  },
  defaultSimulators: {
    click: ({ props }) => {
      // @ts-expect-error the props keep their types
      const wrong: string = props.maxCount;
      return { value: wrong.length };
    },
  },
});

// Components see the declared store
defineComponent({
  name: 'StoreReader',
  component: ({ store, updateStore }: BaseComponentProps) => {
    const bonus: number | undefined = store.bonus;
    updateStore({ bonus: (bonus ?? 0) + 1 });
    // @ts-expect-error a key the store does not declare
    updateStore({ bonsu: 1 });
    return null;
  },
});

// A component's own params are typed like the experiment's
const readerParams = { showFeedback: { default: true }, mode: { values: ['a', 'b'], default: 'a' } } as const;
defineComponent({
  name: 'ParamReader',
  component: (_props: BaseComponentProps) => {
    const { showFeedback, mode } = useParams(readerParams);
    const shown: boolean = showFeedback;
    // @ts-expect-error mode is one of its values
    const other: 'c' = mode;
    return shown && other ? null : null;
  },
  params: readerParams,
});

// Only name and component are required
const Warmup = defineComponent({
  name: 'Warmup',
  component: ({ next }: BaseComponentProps<{ ready: boolean }>) => (
    <button type='button' onClick={() => next({ ready: true })}>
      Ready
    </button>
  ),
});

// --- trial() signatures ---
CustomTrial.trial({ maxCount: 5 });
CustomTrial.trial('customtrial', { maxCount: 5 });
CustomTrial.trial('customtrial', ({ store }) => ({ maxCount: store.bonus ?? 3 }));
// @ts-expect-error missing required props
CustomTrial.trial();
// @ts-expect-error missing required props after a name
CustomTrial.trial('customtrial');
// @ts-expect-error wrong prop type
CustomTrial.trial({ maxCount: 'five' });
// @ts-expect-error unknown prop
CustomTrial.trial({ maxCount: 5, maxCont: 6 });
Text.trial();
Text.trial('intro');
Text.trial({ content: <p>Hi</p> });
Text.trial('intro', { content: 'Hi', buttonText: 'Go' });
// @ts-expect-error wrong prop type on an optional prop
Text.trial({ buttonText: 3 });
// @ts-expect-error the trial's name is not a prop
Text.trial({ name: 'intro' });
Warmup.trial('warmup');

// Defined components stay usable as JSX
const asJsx = <Warmup next={() => {}} data={[]} store={{}} updateStore={() => {}} />;

// --- chained methods ---
const base = CustomTrial.trial({ maxCount: 5 });
base.name('a').props({ maxCount: 2 }).metadata({ block: 1 }).collectRefreshRate().csv(null);
base.props((context) => ({ maxCount: context.get(PlainInput, 'nickname').value.length }));
// @ts-expect-error wrong type in props()
base.props({ maxCount: 'x' });
base.simulators({ click: ({ participant }) => ({ value: participant.speed }) });
// @ts-expect-error simulator the component does not have
base.simulators({ tap: () => ({ value: 1 }) });

// --- get ---
const nickname = PlainInput.trial('nickname', { placeholder: 'Name' });
const click = CustomTrial.trial('customtrial', { maxCount: 5 });

const reads = ({ get, getOptional }: TimelineContext) => {
  const a: string = get(nickname).value;
  const b: number = get(click).totalTime;
  const c: number = get(CustomTrial, 'customtrial').clicks;
  const d: number | undefined = getOptional(click)?.totalTime;
  // @ts-expect-error getOptional may be undefined
  const e: number = getOptional(click).totalTime;
  // @ts-expect-error field that does not exist
  get(click).duration;
  const ready: boolean = get(Warmup, 'warmup').ready;
  return [a, b, c, d, e, ready];
};

// --- store ---
updateStore(({ get }) => ({ bonus: get(click).totalTime > 3000 ? 0.25 : 0.5 }));
// @ts-expect-error misspelled store key
updateStore(() => ({ bonsu: 1 }));
// @ts-expect-error wrong store value type
updateStore(() => ({ bonus: 'high' }));
const bonusRead = ({ store }: TimelineContext) => {
  const bonus: number | undefined = store.bonus;
  // @ts-expect-error store key that does not exist
  store.points;
  return bonus;
};

// --- timeline and params ---
const slow = ({ get }: TimelineContext) => get(click).totalTime > 3000;

const experiment = defineExperiment({
  params: {
    group: { values: ['vn', 'scenario'], default: () => (Math.random() < 0.5 ? 'vn' : 'scenario') },
    vnOnly: { default: false },
    trials: { default: 20 },
    weights: { default: [1, 2] },
  },
  timeline: ({ group, vnOnly, trials, weights }) => {
    const n: number = trials;
    const w: number[] = weights;
    // @ts-expect-error value outside the param's values
    if (group === 'vns') return [];
    if (vnOnly) return [nickname];
    return [
      nickname,
      [click, [Text.trial()]],
      group === 'vn' && Text.trial('credits'),
      vnOnly ? null : undefined,
      ifBlock(slow, [Text.trial()]).else([Text.trial()]),
      ifBlock(slow, [Text.trial()]).else(undefined),
      whileBlock(() => n > w.length, [click]),
      updateStore(() => ({ bonus: 1 })),
      Upload.trial('upload', ({ store }) => ({ autoUpload: false, sessionData: { bonus: store.bonus } })),
    ];
  },
});

defineExperiment({
  // @ts-expect-error a 0 from count && trial is not a timeline entry
  timeline: [0 && Text.trial()],
});

defineExperiment({ timeline: [Text.trial()] });

defineExperiment({
  timeline: [Text.trial()],
  // @ts-expect-error participants are produced by a function, so that their draws come from the seed
  simulation: { seed: 1, createParticipants: [{ id: 1 }] },
});
defineExperiment({ timeline: [Text.trial()], simulation: { createParticipants: () => [{ id: 1 }] } });

export { asJsx, bonusRead, experiment, reads };
