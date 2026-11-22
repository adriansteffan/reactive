// Type tests, checked by `bun check`: every @ts-expect-error marks a mistake the types must catch
import {
  type BaseComponentProps,
  CanvasBlock,
  type ExperimentData,
  type TimelineContext,
  defineComponent,
  defineExperiment,
  fullscreenBlock,
  ifBlock,
  PlainInput,
  StoreUI,
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
      return { value: 300 * n, participant: { ...participant, clicked: true } };
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
    // @ts-expect-error a component that declares a response ends with it
    next();
    next({ totalTime: 1, clicks: 1 });
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
const ParamReader = defineComponent({
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

// A response that allows undefined can be left out
defineComponent({
  name: 'MaybeResponse',
  component: ({ next }: BaseComponentProps<{ key: string } | undefined>) => {
    next();
    return null;
  },
});
defineComponent({
  name: 'Undeclared',
  component: ({ next }: BaseComponentProps) => {
    next();
    next({ anything: 1 });
    return null;
  },
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
Text.trial({ allowedResponseKeys: ['Enter', ' '] });
Text.trial({ durationMs: 500, buttonText: 'Skip', allowedResponseKeys: [' '] });

// A component whose props come in variants keeps each variant's own props
const Variant = defineComponent({
  name: 'Variant',
  component: (_props: BaseComponentProps & ({ mode: 'a'; a: number } | { mode: 'b'; b: string })) => null,
});
Variant.trial({ mode: 'a', a: 1 });
// @ts-expect-error b belongs to the other variant
Variant.trial({ mode: 'a', b: 'x' });
// Keys outside the suggested names, such as letters of other layouts
Text.trial({ allowedResponseKeys: ['ö', 'ñ'] });
Text.trial('intro', { content: 'Hi', buttonText: 'Go' });
// @ts-expect-error wrong prop type on an optional prop
Text.trial({ buttonText: 3 });
// @ts-expect-error the trial's name is not a prop
Text.trial({ name: 'intro' });
Warmup.trial('warmup');

// Defined components stay usable as JSX
const noData: ExperimentData = { session: { userAgent: '', params: {}, buildSeed: 0 }, trials: [] };
const asJsx = <Warmup next={() => {}} data={noData} store={{}} updateStore={() => {}} />;

// --- chained methods ---
const base = CustomTrial.trial({ maxCount: 5 });
base.metadata({ block: 1 }).collectRefreshRate().csv(null);
CustomTrial.trial((context) => ({ maxCount: context.get(PlainInput, 'nickname').value.length }));
base.simulators({ click: ({ participant }) => ({ value: participant.speed }) });
// @ts-expect-error simulator the component does not have
base.simulators({ tap: () => ({ value: 1 }) });
// @ts-expect-error a replacement returns what the simulator it replaces returns
base.simulators({ click: () => ({ wrong: 1 }) });
PlainInput.trial('typed').simulators({ respond: () => ({ value: 'typed' }) });
defineComponent({
  name: 'OutsideValue',
  component: (_props: BaseComponentProps) => null,
  defaultSimulators: {
    // @ts-expect-error a simulator's decision goes in value
    decide: () => ({ key: 'f' }),
  },
});
CanvasBlock.trial({ timeline: [] }).simulators({ respondToSlide: () => ({ value: { key: 'f', reactionTimeMs: 300 } }) });
// @ts-expect-error a replacement returns the decision in value, like the simulator it replaces
CanvasBlock.trial({ timeline: [] }).simulators({ respondToSlide: () => ({ key: 'f', reactionTimeMs: 300 }) });
// A replacement receives the participant, also where the default simulator takes nothing
PlainInput.trial('typed').simulators({ respond: ({ participant }) => ({ value: String(participant.nickname) }) });
// @ts-expect-error PlainInput's simulated answer is text
PlainInput.trial('typed').simulators({ respond: () => ({ value: 5 }) });

// --- get ---
const nickname = PlainInput.trial('nickname', { placeholder: 'Name' });
const click = CustomTrial.trial('customtrial', { maxCount: 5 });
const unnamed = PlainInput.trial();
const renamed = PlainInput.trial('renamed');

const readsNames = ({ get, getOptional }: TimelineContext) => {
  // @ts-expect-error only named trials can be read
  get(unnamed);
  // @ts-expect-error only named trials can be read
  getOptional(unnamed);
  return get(renamed).value;
};

// --- names and settings ---
// @ts-expect-error the session CSV keeps columns starting with session_
Text.trial('session_end');
// @ts-expect-error the session CSV keeps url_ columns
Text.trial('url');
Text.trial('sessions');
// @ts-expect-error also for a component without props of its own
Warmup.trial('session_end');
ParamReader.trial().hideParams(['mode']).hideParams(true);
// @ts-expect-error a setting the component does not have
ParamReader.trial().hideParams(['moed']);

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

// --- CanvasBlock ---
CanvasBlock.trial({
  timeline: [
    { draw: (ctx) => ctx.fillText('+', 0, 0), displayDurationMs: 500 },
    ({ slides, get }) => ({ draw: () => {}, displayDurationMs: slides.length * get(click).clicks }),
    ifBlock(({ slides }) => slides.at(-1)?.key === 'f', [{ draw: () => {}, displayDurationMs: 100 }]).else([]),
    updateStore(({ slides }) => ({ bonus: slides.length })),
    // @ts-expect-error a slide draws itself
    { displayDurationMs: 100 },
    // @ts-expect-error a slide needs a way to end
    { draw: () => {} },
    { draw: () => {}, response: { keys: ['f', 'J', ' ', 'ArrowLeft', 'Enter'] } },
    // @ts-expect-error a response that does not end the slide leaves it without an end
    { draw: () => {}, response: { keys: ['f'], endsSlide: false } },
    { draw: () => {}, response: { keys: ['f'], endsSlide: false, timeLimitMs: 2000 } },
    { draw: () => {}, displayDurationMs: 500, response: { keys: true, endsSlide: false, hidesDrawing: true } },
    // @ts-expect-error what a response does needs the keys it takes
    { draw: () => {}, displayDurationMs: 500, response: { timeLimitMs: 2000 } },
  ],
  width: '80%',
  height: '16:9',
});
// Blocks hold either trials or slides, and only fit timelines of their kind
CanvasBlock.trial({
  timeline: [
    ifBlock(() => true, [{ draw: (ctx) => ctx.fillText('x', 0, 0), displayDurationMs: 1 }]).else([
      ({ slides }) => ({ draw: () => {}, displayDurationMs: slides.length }),
    ]),
  ],
});
defineExperiment({
  timeline: [
    // @ts-expect-error a block of slides belongs in a CanvasBlock
    ifBlock(() => true, [{ draw: () => {}, displayDurationMs: 1 }]),
  ],
});
CanvasBlock.trial({
  timeline: [
    // @ts-expect-error a block of trials belongs in the experiment's timeline
    whileBlock(() => false, [Text.trial()]),
  ],
});
defineExperiment({ timeline: [fullscreenBlock({ keepFullscreen: true }, [Text.trial(), ifBlock(() => true, [Text.trial()])])] });
fullscreenBlock({ keepFullscreen: { buttonText: 'Back to fullscreen' } }, []);
fullscreenBlock({ keepFullscreen: { mode: 'overlay', content: 'Please return to fullscreen' } }, []);
// @ts-expect-error only the overlay shows content
fullscreenBlock({ keepFullscreen: { content: 'Please return to fullscreen' } }, []);
// @ts-expect-error only the overlay shows content
fullscreenBlock({ keepFullscreen: { mode: 'button', content: 'Please return to fullscreen' } }, []);
CanvasBlock.trial({
  timeline: [
    // @ts-expect-error a fullscreenBlock holds trials
    fullscreenBlock({}, [Text.trial()]),
  ],
});
// @ts-expect-error the else holds the same kind as the block
ifBlock(() => true, [Text.trial()]).else([{ draw: () => {}, displayDurationMs: 1 }]);
const either = ifBlock(() => true, [updateStore(() => ({ bonus: 1 }))]).else(undefined);
defineExperiment({ timeline: [either, whileBlock(() => false, [])] });
CanvasBlock.trial({ timeline: [either, whileBlock(() => false, [])] });
// @ts-expect-error a size that cannot be read
CanvasBlock.trial({ timeline: [], width: '16x9' });
const slideKey = ({ slides }: TimelineContext) => {
  const ms: number | null | undefined = slides.at(-1)?.reactionTimeMs;
  // @ts-expect-error field that does not exist
  slides.at(-1)?.reactionTime;
  return ms;
};

defineExperiment({
  // @ts-expect-error a 0 from count && trial is not a timeline entry
  timeline: [0 && Text.trial()],
});

defineExperiment({ timeline: [Text.trial()] });

defineExperiment({
  // @ts-expect-error a default outside the values
  params: { group: { values: ['a', 'b'], default: 'c' } },
  timeline: [],
});
// @ts-expect-error a computed default outside the values
defineExperiment({ params: { group: { values: ['a', 'b'], default: () => 'c' } }, timeline: [] });
// @ts-expect-error the session CSV keeps url_ columns for URL params that nothing declares
defineExperiment({ params: { url_source: { default: 'x' } }, timeline: [] });
defineComponent({
  name: 'BadDefault',
  component: (_props: BaseComponentProps) => null,
  // @ts-expect-error a component's params are checked too
  params: { speed: { values: [1, 2], default: 3 } },
});

// --- StoreUI writes the declared store ---
StoreUI.trial({ fields: [{ type: 'integer', storeKey: 'bonus', label: 'Bonus', min: 0 }] });
// @ts-expect-error a key the store does not declare
StoreUI.trial({ fields: [{ type: 'integer', storeKey: 'bonsu', label: 'Bonus' }] });
// @ts-expect-error a boolean field cannot write a number
StoreUI.trial({ fields: [{ type: 'boolean', storeKey: 'bonus', label: 'Bonus' }] });

// --- CSV files and the session row ---
const movesComponent = (_props: BaseComponentProps<{ moves: number[] }>) => null;
defineComponent({
  name: 'Files',
  component: movesComponent,
  csv: { moves: (row) => row.responseData.moves.map((move) => ({ move })), summary: (row) => ({ n: row.responseData.moves.length }) },
  session: true,
});
defineComponent({
  name: 'SessionColumns',
  component: movesComponent,
  session: (row) => ({ total: row.responseData.moves.length }),
});
defineComponent({
  name: 'NotRows',
  component: movesComponent,
  // @ts-expect-error a file's function returns rows, not the values in them
  csv: { moves: (row) => row.responseData.moves },
});
defineComponent({
  name: 'Typo',
  component: movesComponent,
  // @ts-expect-error the rows have the component's response
  csv: { moves: (row) => row.responseData.moevs.map((move: number) => ({ move })) },
});
defineComponent({
  name: 'SessionRows',
  component: movesComponent,
  // @ts-expect-error the session CSV holds a single row per participant
  session: (row) => row.responseData.moves.map((move) => ({ move })),
});
const listComponent = (_props: BaseComponentProps<{ x: number }[]>) => null;
defineComponent({
  name: 'ListToSession',
  component: listComponent,
  // @ts-expect-error a list has no fields to spread into the session row's columns
  session: true,
});
const ListCount = defineComponent({
  name: 'ListCount',
  component: listComponent,
  session: (row) => ({ n: row.responseData.length }),
});
ListCount.trial().session(false);
PlainInput.trial().session(false).csv('inputs');
Text.trial().session(true);
// @ts-expect-error a list has no fields to spread into the session row's columns
CanvasBlock.trial({ timeline: [] }).session(true);

defineExperiment({
  timeline: [Text.trial()],
  // @ts-expect-error participants are produced by a function, so that their draws come from the seed
  simulation: { seed: 1, createParticipants: [{ id: 1 }] },
});
defineExperiment({ timeline: [Text.trial()], simulation: { createParticipants: () => [{ id: 1 }] } });

export { asJsx, bonusRead, experiment, reads, readsNames, slideKey };
