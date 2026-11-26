// Type tests, checked by `bun check`: every @ts-expect-error marks a mistake the types must catch
import {
  Article,
  type BaseComponentProps,
  Canvas,
  CanvasBlock,
  type ExperimentData,
  type TimelineContext,
  defineComponent,
  defineExperiment,
  fullscreenBlock,
  ifBlock,
  PlainInput,
  sampleParticipants,
  Screen,
  type SimulatorArgs,
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
    click: ({ stimulus, participant }: SimulatorArgs<{ count: number }>) => {
      const n: number = stimulus.count;
      return { response: 300 * n, participant: { ...participant, clicked: true } };
    },
  },
  simulate: async ({ props, simulators, participant, store, data }) => {
    const n: number = props.maxCount;
    const r = await simulators.click({ stimulus: { count: 1 }, participant });
    // @ts-expect-error a simulator may be async, so its result has to be awaited
    simulators.click({ stimulus: { count: 1 }, participant }).response;
    // @ts-expect-error simulator that does not exist
    simulators.tap({ stimulus: { count: 1 }, participant });
    // @ts-expect-error a simulator needs the stimulus and the participant
    simulators.click({ participant });
    // @ts-expect-error the stimulus is the one the simulator declares
    simulators.click({ stimulus: { cuont: 1 }, participant });
    const bonus: number | undefined = store.bonus;
    const name: string = PlainInput.getLatest(data, 'nickname').recorded.value;
    return { recorded: { totalTime: r.response * n + (bonus ?? 0) + name.length, clicks: n } };
  },
});

defineComponent({
  name: 'Bad',
  component: ({ next }: BaseComponentProps<ClickResponse>) => {
    // @ts-expect-error a component that declares what it records ends with it
    next();
    next({ totalTime: 1, clicks: 1 });
    return null;
  },
  // @ts-expect-error a simulation records what the component records
  simulate: () => ({ recorded: { totalTime: 'x' } }),
});

// simulate may come before defaultSimulators, which may leave their stimulus undeclared
const SimulateFirst = defineComponent({
  name: 'SimulateFirst',
  component: (_props: BaseComponentProps<ClickResponse>) => null,
  simulate: async ({ simulators, participant }) => {
    // @ts-expect-error simulator that does not exist
    simulators.tap({ stimulus: {}, participant });
    // @ts-expect-error the stimulus is the one the simulator declares
    simulators.click({ stimulus: { cuont: 1 }, participant });
    simulators.wait({ stimulus: { anything: 1 }, participant });
    const result = await simulators.click({ stimulus: { count: 1 }, participant });
    return { recorded: { totalTime: result.response, clicks: 1 } };
  },
  defaultSimulators: {
    click: ({ stimulus }: SimulatorArgs<{ count: number }>) => ({ response: stimulus.count }),
    wait: ({ participant }) => ({ response: participant.patience }),
    rest: () => ({ response: 'rested' }),
  },
});
SimulateFirst.trial().simulators({
  click: ({ stimulus }) => ({ response: stimulus.count * 2 }),
  wait: ({ stimulus }) => ({ response: stimulus.anything }),
  rest: ({ stimulus }) => ({ response: String(stimulus.anything) }),
});
// @ts-expect-error the stimulus is the one the default simulator declares
SimulateFirst.trial().simulators({ click: ({ stimulus }) => ({ response: stimulus.cuont }) });
// @ts-expect-error a simulator receives a stimulus and a participant
SimulateFirst.trial().simulators({ wait: ({ partcipant }) => ({ response: partcipant }) });

defineComponent({
  name: 'OnlyUndeclared',
  component: (_props: BaseComponentProps<ClickResponse>) => null,
  simulate: async ({ simulators, participant }) => {
    const result = await simulators.click({ stimulus: { count: 1 }, participant });
    return { recorded: { totalTime: result.response, clicks: 1 } };
  },
  defaultSimulators: { click: ({ participant }) => ({ response: participant.speed }) },
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
const readerParams = { showFeedback: { default: true }, mode: { values: ['a', 'b'], random: true } } as const;
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
const noData: ExperimentData = { session: { userAgent: '', params: {}, buildSeed: 0, namedTrials: [] }, trials: [] };
const asJsx = <Warmup next={() => {}} data={noData} store={{}} updateStore={() => {}} />;

// --- chained methods ---
const base = CustomTrial.trial({ maxCount: 5 });
base.metadata({ block: 1 }).collectRefreshRate().csv(null);
CustomTrial.trial(({ data }) => ({ maxCount: PlainInput.getLatest(data, 'nickname').recorded.value.length }));
base.simulators({ click: ({ participant }) => ({ response: participant.speed }) });
// @ts-expect-error simulator the component does not have
base.simulators({ tap: () => ({ response: 1 }) });
// @ts-expect-error a replacement returns what the simulator it replaces returns
base.simulators({ click: () => ({ wrong: 1 }) });
PlainInput.trial('typed').simulators({ respond: () => ({ response: 'typed' }) });
defineComponent({
  name: 'OutsideResponse',
  component: (_props: BaseComponentProps) => null,
  defaultSimulators: {
    // @ts-expect-error what the participant does goes in response
    decide: () => ({ key: 'f' }),
  },
});
CanvasBlock.trial({ timeline: [] }).simulators({ respondToSlide: () => ({ response: { key: 'f', reactionTimeMs: 300 } }) });
// @ts-expect-error a replacement returns a response, like the simulator it replaces
CanvasBlock.trial({ timeline: [] }).simulators({ respondToSlide: () => ({ key: 'f', reactionTimeMs: 300 }) });
// A replacement receives the participant, also where the default simulator takes nothing
PlainInput.trial('typed').simulators({ respond: ({ participant }) => ({ response: String(participant.nickname) }) });
// A replacement can build on the default simulator, whose result the types know
PlainInput.trial('typed').simulators({
  respond: (args, defaultSimulator) => {
    const result = defaultSimulator(args);
    // @ts-expect-error PlainInput's default responds with text
    result.response.toFixed();
    return { ...result, response: result.response.toUpperCase() };
  },
});
// @ts-expect-error the default simulator takes the arguments it should run with
PlainInput.trial('typed').simulators({ respond: (_args, defaultSimulator) => defaultSimulator() });
// @ts-expect-error PlainInput's simulated response is text
PlainInput.trial('typed').simulators({ respond: () => ({ response: 5 }) });
// A replacement may be async, and still returns what the simulator it replaces returns
PlainInput.trial('typed').simulators({ respond: async () => ({ response: 'typed' }) });
// @ts-expect-error PlainInput's simulated response is text
PlainInput.trial('typed').simulators({ respond: async () => ({ response: 5 }) });

// --- reading results ---
const nickname = PlainInput.trial('nickname', { placeholder: 'Name' });
const click = CustomTrial.trial('customtrial', { maxCount: 5 });

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

const reads = ({ data }: TimelineContext) => {
  const a: string = PlainInput.getLatest(data, 'nickname').recorded.value;
  const b: number = CustomTrial.getLatest(data, 'customtrial').recorded.totalTime;
  const c: number[] = CustomTrial.getAll(data).map((row) => row.recorded.clicks);
  const d: number | undefined = CustomTrial.getAll(data, 'customtrial').at(-1)?.recorded.totalTime;
  // @ts-expect-error a trial that may not have run may be undefined
  const e: number = CustomTrial.getAll(data, 'customtrial').at(-1).recorded.totalTime;
  // @ts-expect-error field that does not exist
  CustomTrial.getLatest(data, 'customtrial').recorded.duration;
  const ready: boolean = Warmup.getLatest(data, 'warmup').recorded.ready;
  const metadata: Record<string, any> | undefined = Warmup.getLatest(data, 'warmup').metadata;
  return [a, b, c, d, e, ready, metadata];
};

// --- store ---
updateStore(({ data }) => ({ bonus: CustomTrial.getLatest(data, 'customtrial').recorded.totalTime > 3000 ? 0.25 : 0.5 }));
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
const slow = ({ data }: TimelineContext) => CustomTrial.getLatest(data, 'customtrial').recorded.totalTime > 3000;

const experiment = defineExperiment({
  params: {
    group: { values: ['vn', 'scenario'], random: true },
    hand: { values: ['left', 'right'], default: (values) => values[0], defaultDescription: 'the left one' },
    start: { default: () => Math.random() },
    vnOnly: { default: false },
    trials: { default: 20, hidden: true },
    weights: { default: [1, 2] },
  },
  timeline: ({ group, hand, start, vnOnly, trials, weights }) => {
    const n: number = trials + start;
    const h: 'left' | 'right' = hand;
    const w: number[] = weights;
    // @ts-expect-error value outside the param's values
    if (group === 'vns') return [];
    // @ts-expect-error value outside the values that the default takes
    if (h === 'both') return [];
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
    ({ slides, data }) => ({ draw: () => {}, displayDurationMs: slides.length * CustomTrial.getLatest(data, 'customtrial').recorded.clicks }),
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
    { draw: () => {}, response: { choices: { happy: { key: 'f' }, sad: { key: 'j' } }, timeLimitMs: 2000 } },
    { draw: () => {}, response: { click: true } },
    // @ts-expect-error a slide's choices are given by keys, since a canvas has no buttons
    { draw: () => {}, response: { choices: { happy: { button: 'Happy' } } } },
    ({ slides }) => ({ draw: () => {}, displayDurationMs: (slides.at(-1)?.x ?? 0) + (slides.at(-1)?.response === 'happy' ? 1 : 0) }),
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
// @ts-expect-error a default that takes the values and returns something else
defineExperiment({ params: { group: { values: ['a', 'b'], default: (values) => `${values[0]}!` } }, timeline: [] });
// @ts-expect-error random draws one of the values, which this param does not have
defineExperiment({ params: { group: { random: true } }, timeline: [] });
// @ts-expect-error random takes the place of a default
defineExperiment({ params: { group: { values: ['a', 'b'], random: true, default: 'a' } }, timeline: [] });
// @ts-expect-error a param needs a default or random
defineExperiment({ params: { group: { values: ['a', 'b'] } }, timeline: [] });
// @ts-expect-error the session CSV keeps url_ columns for URL params that nothing declares
defineExperiment({ params: { url_source: { default: 'x' } }, timeline: [] });
defineComponent({
  name: 'BadDefault',
  component: (_props: BaseComponentProps) => null,
  // @ts-expect-error a component's params are checked too
  params: { speed: { values: [1, 2], default: 3 } },
});

defineExperiment({ params: { nback: { values: [1, 2], random: true, condition: true } }, timeline: [] });
defineComponent({
  name: 'ConditionSetting',
  component: (_props: BaseComponentProps) => null,
  // @ts-expect-error only the experiment's params can be conditions
  params: { speed: { default: 1, condition: true } },
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
  csv: { moves: (row) => row.recorded.moves.map((move) => ({ move })), summary: (row) => ({ n: row.recorded.moves.length }) },
  session: true,
});
defineComponent({
  name: 'SessionColumns',
  component: movesComponent,
  session: (row) => ({ total: row.recorded.moves.length }),
});
defineComponent({
  name: 'NotRows',
  component: movesComponent,
  // @ts-expect-error a file's function returns rows, not the values in them
  csv: { moves: (row) => row.recorded.moves },
});
defineComponent({
  name: 'Typo',
  component: movesComponent,
  // @ts-expect-error the rows have the component's response
  csv: { moves: (row) => row.recorded.moevs.map((move: number) => ({ move })) },
});
defineComponent({
  name: 'SessionRows',
  component: movesComponent,
  // @ts-expect-error the session CSV holds a single row per participant
  session: (row) => row.recorded.moves.map((move) => ({ move })),
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
  session: (row) => ({ n: row.recorded.length }),
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

// --- sampled participants ---
const sampled = sampleParticipants('sobol', 10, {
  needForCognition: { distribution: 'normal', mean: 3.5, sd: 0.8 },
  openness: { distribution: 'normal', mean: 3, sd: 1, correlations: { needForCognition: 0.4 } },
});
const sampledTraits: { needForCognition: number; openness: number; index: number } = sampled[0];
sampleParticipants('sobol', 10, {
  needForCognition: { distribution: 'normal', mean: 3.5, sd: 0.8 },
  // @ts-expect-error a correlation names another trait
  openness: { distribution: 'normal', mean: 3, sd: 1, correlations: { needForCogniton: 0.4 } },
});
sampleParticipants('sobol', 10, {
  // @ts-expect-error a trait does not correlate with itself
  openness: { distribution: 'normal', mean: 3, sd: 1, correlations: { openness: 0.4 } },
});

// --- stimuli ---
Screen.trial('face', {
  content: <img src='face.png' alt='' />,
  response: { choices: { happy: { key: 'f', button: 'Happy' }, sad: { key: 'j' } }, timeLimitMs: 3000 },
  displayDurationMs: 500,
});
Screen.trial('fixation', { content: '+', displayDurationMs: 500 });
Screen.trial({ content: <Article><p>Text</p></Article>, response: { buttons: ['Yes', 'No'], buttonDelayMs: 1000 }, centered: false, animate: true });
Screen.trial({
  content: ({ respond }) => <Canvas draw={(ctx, width, height) => ctx.fillRect(0, 0, width, height)} onClick={(x, y) => respond({ x, y })} />,
});
// @ts-expect-error a trial needs a way to end
Screen.trial({ content: 'Nothing ends this trial' });
// @ts-expect-error a choice is given by a key, a button, or both
Screen.trial({ response: { choices: { happy: {} } }, displayDurationMs: 500 });
// An answer through respond is the simulator's to give, typed like the default's
Screen.trial({ content: ({ respond }) => <input onBlur={(event) => respond(event.target.value)} /> }).simulators({
  respond: () => ({ response: { answer: 'typed', reactionTimeMs: 2000 } }),
});
// A simulator knows how the Screen can be answered
Screen.trial({ response: { buttons: ['Yes', 'No'] } }).simulators({
  respond: ({ stimulus }) => ({ response: { answer: stimulus.buttons?.[0], reactionTimeMs: 2000 } }),
});
// Answers that do not end a trial need its time limit, and recording every answer cannot end it
Screen.trial({ response: { choices: { yes: { key: 'f' } }, timeLimitMs: 2000, endsTrial: false } });
Screen.trial({ response: { keys: [' '], timeLimitMs: 30000, recordAll: true } });
// @ts-expect-error a trial that its answers do not end needs a time limit
Screen.trial({ response: { keys: ['f'], endsTrial: false } });
// @ts-expect-error so does one that records every answer
Screen.trial({ response: { keys: ['f'], recordAll: true } });
// @ts-expect-error recording every answer keeps the trial going
Screen.trial({ response: { keys: ['f'], timeLimitMs: 2000, recordAll: true, endsTrial: true } });
const tapCount = ({ data }: TimelineContext) => Screen.getLatest(data, 'taps').recorded.responses?.length ?? 0;
const stimulusAnswer = ({ data }: TimelineContext) => Screen.getLatest(data, 'face').recorded.response === 'happy';
const stimulusOptions = ({ data }: TimelineContext): string[] => Screen.getLatest(data, 'face').recorded.options;

export { asJsx, bonusRead, experiment, reads, sampledTraits, stimulusAnswer, stimulusOptions, slideKey, tapCount };
