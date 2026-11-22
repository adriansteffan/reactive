import { describe, expect, test } from 'bun:test';
import type { BaseComponentProps } from '../src/core/component';
import type { ExperimentData, TrialData } from '../src/core/rows';
import { defineExperiment } from '../src/core/experiment';
import { seedDistributions } from '../src/utils/distributions';
import { simulateParticipant } from '../src/core/simulation';
import { type TimelineContext, type Trial, compileExperimentTimeline, createTimelineContext, ifBlock, ifGoto, marker, type Timeline, updateStore, whileBlock } from '../src/core/timeline';
import { defineComponent } from '../src/core/component';
import { buildUploadFiles, type FileUpload, markRecordingUploaded } from '../src/core/files';
import CanvasBlock from '../src/components/canvasblock';
import { canvasSize } from '../src/utils/canvas';
import Text from '../src/components/text';
import Screen from '../src/components/screen';
import type { ResponseKey } from '../src/utils/keys';
import type { SlideData } from '../src/core/slides';
import { RandomDotKinematogram } from '../src/components/randomdotkinematogram';

// The store key the CanvasBlock tests count with
declare module '../src/mod' {
  interface ExperimentStore {
    shown: number;
  }
}

// The type tests declare the store for the whole compilation, so these keys are declared too
declare module '../src/mod' {
  interface ExperimentStore {
    count: number;
    list: number[];
  }
}

// Records its `value` prop, so a run shows which trials ran and with which props
const Answer = defineComponent({
  name: 'Answer',
  component: (_props: BaseComponentProps<{ value: number }> & { value?: number; label?: string }) => null,
  csv: 'answers',
  simulate: ({ props }) => ({ responseData: { value: props.value ?? 0 } }),
});

async function run(timeline: Timeline, participant = {}) {
  const data = await simulateParticipant(defineExperiment({ timeline }), participant);
  return data.trials;
}

// Data with the given trials and a session without params
const dataOf = (trials: TrialData[]): ExperimentData => ({ session: { userAgent: '', params: {}, buildSeed: 0 }, trials });

const names = (rows: TrialData[]) => rows.map((row) => row.name);

// The files an Upload at the end of `timeline` builds from `data`
const filesOf = (timeline: Timeline, data: ExperimentData, sessionData?: Record<string, any>) =>
  buildUploadFiles({
    sessionId: 's',
    data,
    store: {},
    components: compileExperimentTimeline(timeline).components,
    sessionData,
    uploadRaw: false,
  });

// The first row of the CSV whose name starts with `prefix`, by column
function csvColumns(files: FileUpload[], prefix: string) {
  const [header, row] = files.find((file) => file.filename.startsWith(`${prefix}.s.`))!.content.split('\n');
  const values = row.split(',');
  return Object.fromEntries(header.split(',').map((column, i) => [column, values[i]]));
}

describe('compiling', () => {
  test('flattens nested lists and skips false, null and undefined', async () => {
    const rows = await run([
      Answer.trial('a'),
      [Answer.trial('b'), [null, Answer.trial('c')]],
      false,
      undefined,
      ifBlock(() => true, [[Answer.trial('d')], false]),
    ]);
    expect(names(rows)).toEqual(['a', 'b', 'c', 'd']);
  });

  test('ifBlock runs its items or its else branch', async () => {
    const choose = (pick: boolean) =>
      run([ifBlock(() => pick, [Answer.trial('then')]).else([Answer.trial('else')]), Answer.trial('after')]);
    expect(names(await choose(true))).toEqual(['then', 'after']);
    expect(names(await choose(false))).toEqual(['else', 'after']);
    expect(names(await run([ifBlock(() => false, [Answer.trial('then')]), Answer.trial('after')]))).toEqual([
      'after',
    ]);
    expect(names(await run([ifBlock(() => false, [Answer.trial('x')]).else(undefined)]))).toEqual([]);
  });

  test('nested blocks', async () => {
    const rows = await run([
      ifBlock(() => true, [
        ifBlock(() => false, [Answer.trial('inner')]).else([Answer.trial('innerElse')]),
        Answer.trial('outer'),
      ]),
    ]);
    expect(names(rows)).toEqual(['innerElse', 'outer']);
  });

  test('whileBlock repeats while its condition holds', async () => {
    const rows = await run([
      updateStore(() => ({ count: 0 })),
      whileBlock(({ store }) => (store.count ?? 0) < 3, [
        Answer.trial(({ store }) => ({ value: store.count })),
        updateStore(({ store }) => ({ count: (store.count ?? 0) + 1 })),
      ]),
    ]);
    expect(rows.map((row) => row.responseData.value)).toEqual([0, 1, 2]);
  });

  test('ifGoto jumps to its marker', async () => {
    const rows = await run([ifGoto(() => true, 'end'), Answer.trial('skipped'), marker('end'), Answer.trial('last')]);
    expect(names(rows)).toEqual(['last']);
  });

  test('compiles blocks to jumps that keep their conditions', () => {
    const slow = () => true;
    const more = () => false;
    const retry = () => false;
    const { instructions } = compileExperimentTimeline([
      ifBlock(slow, [Answer.trial('a')]).else([Answer.trial('b')]),
      whileBlock(more, [Answer.trial('c')]),
      marker('top'),
      ifGoto(retry, 'top'),
    ]).bytecode;
    expect(instructions.map((i) => (i.type === 'ExecuteContent' ? i.content.name : i))).toEqual([
      { type: 'UnlessGoto', cond: slow, marker: 'if_else_0' },
      'a',
      { type: 'Goto', marker: 'if_end_0' },
      'b',
      { type: 'UnlessGoto', cond: more, marker: 'while_end_1' },
      'c',
      { type: 'Goto', marker: 'while_start_1' },
      { type: 'IfGoto', cond: retry, marker: 'user_top' },
    ]);
  });

  test('rejects an ifGoto whose marker does not exist', () => {
    expect(() => compileExperimentTimeline([ifGoto(() => true, 'nowhere')])).toThrow("'nowhere'");
  });

  test('a loop that never reaches a trial stops the experiment instead of freezing it', async () => {
    await expect(run([whileBlock(() => true, [updateStore(() => ({}))]), Answer.trial()])).rejects.toThrow(
      'The timeline repeats a whileBlock without reaching anything to show',
    );
    await expect(run([marker('top'), ifBlock(() => false, [Answer.trial()]), ifGoto(() => true, 'top')])).rejects.toThrow(
      "The timeline repeats the ifGoto back to the marker 'top'",
    );
    const count = updateStore(({ store }) => ({ count: (store.count ?? 0) + 1 }));
    const counted = await run([whileBlock(({ store }) => (store.count ?? 0) < 1000, [count]), Answer.trial('after')]);
    expect(names(counted)).toEqual(['after']);
  });

  test('rejects a marker id used twice, also in different branches', () => {
    expect(() =>
      compileExperimentTimeline([ifBlock(() => true, [marker('top')]).else([marker('top')]), ifGoto(() => true, 'top')]),
    ).toThrow("The marker 'top' is in the timeline twice");
  });

  test('ifGoto can jump into a block, which runs its remaining items and then checks its condition as usual', async () => {
    const rows = await run([
      ifGoto(() => true, 'inside'),
      whileBlock(({ data }) => data.trials.length < 3, [Answer.trial('first'), marker('inside'), Answer.trial('second')]),
    ]);
    expect(names(rows)).toEqual(['second', 'first', 'second']);
  });

  test('rejects anything that is not a trial or a block', () => {
    expect(() => compileExperimentTimeline([{ type: 'Text' } as any])).toThrow('can only hold trials');
  });

  test('turns a trial into the content the runner reads', () => {
    const trial = Answer.trial('a', { value: 1 })
      .metadata({ block: 2 })
      .csv('other')
      .collectRefreshRate()
      .hideParams(true);
    const { bytecode } = compileExperimentTimeline([trial]);
    expect(bytecode.instructions[0]).toEqual({
      type: 'ExecuteContent',
      content: {
        component: Answer,
        type: 'Answer',
        name: 'a',
        props: { value: 1 },
        metadata: { block: 2 },
        csv: 'other',
        collectRefreshRate: true,
        hideParams: true,
      },
    });
  });

  test('rejects two different components with the same name', () => {
    const Other = defineComponent({ name: 'Answer', component: () => null });
    expect(() => compileExperimentTimeline([Answer.trial(), Other.trial()])).toThrow(
      'Two different components',
    );
  });

  test('rejects one function defined as two components, but not defined again under its name', () => {
    const View = () => null;
    const First = defineComponent({ name: 'First', component: View });
    expect(() => defineComponent({ name: 'Second', component: View })).toThrow('same function');
    expect(First.reactive.name).toBe('First');
    expect(() => defineComponent({ name: 'First', component: View })).not.toThrow();
  });
});

describe('trial builder', () => {
  const base = Answer.trial('base', { value: 1 });
  const contentOf = (trial: Trial) =>
    compileExperimentTimeline([trial]).bytecode.instructions[0] as { content: any };
  const context = createTimelineContext(dataOf([]), {}, new Set()) as TimelineContext;
  const props = (trial: Trial) => {
    const value = contentOf(trial).content.props;
    return typeof value === 'function' ? value(context) : value;
  };

  test('methods return new trials and leave the base unchanged', () => {
    const changed = base.metadata({ x: 1 });
    expect(changed).not.toBe(base);
    expect(contentOf(base).content.metadata).toBeUndefined();
    expect(contentOf(changed).content.metadata).toEqual({ x: 1 });
  });

  test('the order of calls does not matter', () => {
    const a = contentOf(base.csv('x').metadata({ m: 1 }).collectRefreshRate(false)).content;
    const b = contentOf(base.collectRefreshRate(false).metadata({ m: 1 }).csv('x')).content;
    expect(a).toEqual(b);
  });

  test('undefined leaves a setting as it is', () => {
    const configured = base.csv('x').metadata({ m: 1 }).collectRefreshRate().hideParams(true);
    const same = configured
      .metadata(undefined)
      .csv(undefined)
      .collectRefreshRate(undefined)
      .hideParams(undefined)
      .simulators(undefined);
    expect(contentOf(same).content).toEqual(contentOf(configured).content);
  });

  test('metadata() merges into the metadata set before, for objects and context functions alike', () => {
    const metadata = (trial: Trial) => {
      const value = contentOf(trial).content.metadata;
      return typeof value === 'function' ? value(context) : value;
    };
    expect(metadata(base.metadata({ block: 1 }).metadata({ stimulus: 'a' }))).toEqual({ block: 1, stimulus: 'a' });
    expect(metadata(base.metadata({ block: 1 }).metadata(() => ({ block: 2 })))).toEqual({ block: 2 });
  });

  test('trials of components without props need no argument', () => {
    expect(props(Answer.trial())).toEqual({});
    expect(contentOf(Answer.trial('named')).content.name).toBe('named');
  });
});

describe('reading results', () => {
  const nickname = Answer.trial('nickname', { value: 7 });

  test('get and getOptional read a trial that has run', async () => {
    const rows = await run([
      nickname,
      Answer.trial('copy', ({ get, getOptional }) => ({
        value: get(nickname).value + get(Answer, 'nickname').value + (getOptional(nickname)?.value ?? 0),
      })),
    ]);
    expect(rows[1].responseData.value).toBe(21);
  });

  test('a skipped trial: get throws, getOptional gives undefined', async () => {
    const skipped = Answer.trial('skipped', { value: 1 });
    const optional = await run([
      ifBlock(() => false, [skipped]),
      Answer.trial('after', ({ getOptional }) => ({ value: getOptional(skipped)?.value ?? -1 })),
    ]);
    expect(optional[0].responseData.value).toBe(-1);

    await expect(
      run([ifBlock(() => false, [skipped]), Answer.trial('after', ({ get }) => ({ value: get(skipped).value }))]),
    ).rejects.toThrow("'skipped' has not run yet");
  });

  test('a trial that runs repeatedly gives its most recent run', async () => {
    const rows = await run([
      updateStore(() => ({ count: 0 })),
      whileBlock(({ store }) => (store.count ?? 0) < 3, [
        Answer.trial('looped', ({ store }) => ({ value: (store.count ?? 0) * 10 })),
        updateStore(({ store }) => ({ count: (store.count ?? 0) + 1 })),
      ]),
      Answer.trial('last', ({ get }) => ({ value: get(Answer, 'looped').value })),
    ]);
    expect(rows.at(-1)?.responseData.value).toBe(20);
  });

  test('unnamed trials and unknown names throw', async () => {
    const unnamed = Answer.trial({ value: 1 });
    // @ts-expect-error the types reject reading an unnamed trial, and so does the run
    await expect(run([unnamed, Answer.trial('x', ({ get }) => ({ value: get(unnamed).value }))])).rejects.toThrow(
      'Only named trials',
    );
    await expect(
      run([Answer.trial('x', ({ get }) => ({ value: get(Answer, 'typo').value }))]),
    ).rejects.toThrow("no Answer trial named 'typo'");
  });

  test('two different trials with the same name are rejected, unless they are in exclusive branches', () => {
    expect(() => compileExperimentTimeline([Answer.trial('a'), Answer.trial('a')])).toThrow('named');
    expect(() =>
      compileExperimentTimeline([ifBlock(() => true, [Answer.trial('a')]), Answer.trial('a')]),
    ).toThrow('named');
    expect(() =>
      compileExperimentTimeline([
        ifBlock(() => true, [Answer.trial('a')]).else([ifBlock(() => true, [Answer.trial('a')])]),
      ]),
    ).not.toThrow();
  });

  test('a name identifies one trial, whatever its component', () => {
    const Note = defineComponent({ name: 'Note', component: (_props: BaseComponentProps) => null });
    expect(() => compileExperimentTimeline([Answer.trial('a'), Note.trial('a')])).toThrow('(Answer and Note)');
    expect(() =>
      compileExperimentTimeline([ifBlock(() => true, [Answer.trial('a')]).else([Note.trial('a')])]),
    ).not.toThrow();
  });

  test('trial names cannot take the session columns the library writes', () => {
    for (const name of ['url', 'url_x', 'session', 'session_end']) {
      expect(() => compileExperimentTimeline([Answer.trial(name)])).toThrow('cannot be named');
    }
    for (const name of ['urls', 'sessions', 'trial_1', 'meta']) {
      expect(() => compileExperimentTimeline([Answer.trial(name)])).not.toThrow();
    }
  });

  test('the same trial twice and repeated unnamed trials are fine', () => {
    const named = Answer.trial('a');
    expect(() => compileExperimentTimeline([named, named, Answer.trial(), Answer.trial()])).not.toThrow();
  });

  test('callbacks cannot change the data or the store', async () => {
    await expect(
      run([
        updateStore(() => ({ list: [1] })),
        updateStore(({ store }) => {
          store.list?.push(2);
          return {};
        }),
      ]),
    ).rejects.toThrow();
    await expect(
      run([
        Answer.trial('a'),
        ifBlock(({ data }) => {
          data.trials.pop();
          return true;
        }, []),
      ]),
    ).rejects.toThrow();
  });
});

describe('components', () => {
  test('without csv, rows go to a CSV named after the component', async () => {
    const Plain = defineComponent({
      name: 'PlainThing',
      component: (_props: BaseComponentProps<{ ok: boolean }>) => null,
      simulate: () => ({ responseData: { ok: true } }),
    });
    const timeline = [Plain.trial('one')];
    const files = filesOf(timeline, await simulateParticipant(defineExperiment({ timeline }), {}));
    expect(files.some((file) => file.filename.startsWith('plainthing.s.'))).toBe(true);
  });

  test('metadata stays apart from the row and the response, in the data and in the CSVs', async () => {
    const timeline = [
      Answer.trial('a', { value: 7 }).metadata({ name: 'block A', value: 'from metadata' }),
      Answer.trial('b', { value: 8 }).metadata({ value: 'from metadata' }).session(true),
    ];
    const data = await simulateParticipant(defineExperiment({ timeline }), {});
    expect(data.trials[0]).toMatchObject({
      name: 'a',
      responseData: { value: 7 },
      metadata: { name: 'block A', value: 'from metadata' },
    });

    const files = filesOf(timeline, data);
    expect(csvColumns(files, 'answers')).toEqual({
      trial_trialNumber: '1',
      trial_startMs: '0',
      trial_endMs: '0',
      trial_durationMs: '0',
      trial_type: 'Answer',
      trial_name: 'a',
      meta_name: 'block A',
      meta_value: 'from metadata',
      value: '7',
    });
    expect(csvColumns(files, 'session')).toMatchObject({ b_value: '8', b_meta_value: 'from metadata' });
  });

  test('sessionData goes into the session CSV as session_ columns, apart from the params', async () => {
    const timeline = [Answer.trial('a', { value: 7 }).session(true)];
    const data = await simulateParticipant(defineExperiment({ params: { bonus: { default: 1 } }, timeline }), {});
    const files = filesOf(timeline, data, { bonus: 2 });
    expect(csvColumns(files, 'session')).toMatchObject({ bonus: '1', session_bonus: '2', a_value: '7' });
  });

  test('response fields named like the library columns get response_ in front', async () => {
    const Odd = defineComponent({
      name: 'Odd',
      component: (_props: BaseComponentProps<Record<string, number>>) => null,
      simulate: () => ({
        responseData: { meta_value: 1, trial_name: 2, response_x: 3, url_y: 4, plain: 5 },
      }),
    });
    const timeline = [
      Odd.trial('a').metadata({ value: 'meta' }),
      Odd.trial('b').metadata({ value: 'meta' }).session(true),
    ];
    const files = filesOf(timeline, await simulateParticipant(defineExperiment({ timeline }), {}));
    expect(csvColumns(files, 'odd')).toMatchObject({
      trial_name: 'a',
      meta_value: 'meta',
      response_meta_value: '1',
      response_trial_name: '2',
      response_response_x: '3',
      response_url_y: '4',
      plain: '5',
    });
    expect(csvColumns(files, 'session')).toMatchObject({
      b_meta_value: 'meta',
      b_response_meta_value: '1',
      b_plain: '5',
    });
  });

  test('a component can write to several CSV files, each with its own flattener', async () => {
    const Game = defineComponent({
      name: 'Game',
      component: (_props: BaseComponentProps<{ moves: number[]; players: string[] }>) => null,
      csv: {
        moves: (row) => row.responseData.moves.map((move: number) => ({ move })),
        players: (row) => row.responseData.players.map((player: string) => ({ player })),
      },
      simulate: () => ({ responseData: { moves: [1, 2], players: ['a'] } }),
    });
    const timeline = [Game.trial('g')];
    const files = filesOf(timeline, await simulateParticipant(defineExperiment({ timeline }), {}));
    const rows = (prefix: string) =>
      files.find((file) => file.filename.startsWith(`${prefix}.s.`))?.content.split('\n').length;
    expect([rows('moves'), rows('players')]).toEqual([3, 2]);
  });

  test('a response that is a list is a row per item, also in a trial\'s own file', async () => {
    const List = defineComponent({
      name: 'List',
      component: (_props: BaseComponentProps<{ x: number }[]>) => null,
      simulate: () => ({ responseData: [{ x: 1 }, { x: 2 }] }),
    });
    const Numbers = defineComponent({
      name: 'Numbers',
      component: (_props: BaseComponentProps<number[]>) => null,
      simulate: () => ({ responseData: [4, 5] }),
    });
    const numbers = [Numbers.trial('n')];
    const numberLines = filesOf(numbers, await simulateParticipant(defineExperiment({ timeline: numbers }), {}))
      .find((file) => file.filename.startsWith('numbers.s.'))
      ?.content.split('\n');
    expect(numberLines?.map((line) => line.split(',').at(-1))).toEqual(['value', '4', '5']);
    const timeline = [List.trial('practice').csv('practice'), List.trial('main')];
    const files = filesOf(timeline, await simulateParticipant(defineExperiment({ timeline }), {}));
    const lines = (prefix: string) =>
      files.find((file) => file.filename.startsWith(`${prefix}.s.`))?.content.split('\n');
    expect(lines('practice')?.length).toBe(3);
    expect(lines('practice')?.[0].split(',')).toContain('x');
    expect(lines('list')?.length).toBe(3);
  });

  test("a trial renames the files of a component with several by name, and each keeps its flattener", async () => {
    const Game = defineComponent({
      name: 'Game',
      component: (_props: BaseComponentProps<{ moves: number[] }>) => null,
      csv: { moves: (row) => row.responseData.moves.map((move: number) => ({ move })), log: true },
      session: true,
      simulate: () => ({ responseData: { moves: [1, 2] } }),
    });
    const timeline = [Game.trial('practice').csv({ moves: 'practice_moves', log: null })];
    const files = filesOf(timeline, await simulateParticipant(defineExperiment({ timeline }), {}));
    const lines = (prefix: string) =>
      files.find((file) => file.filename.startsWith(`${prefix}.s.`))?.content.split('\n');
    expect(files.map((file) => file.filename.split('.')[0]).sort()).toEqual(['practice_moves', 'session']);
    expect(lines('practice_moves')?.length).toBe(3);
    expect(lines('practice_moves')?.[0].split(',')).toContain('move');
  });

  test("a component's session function picks the trial's columns in the session row, and a file's function can return one row", async () => {
    const Game = defineComponent({
      name: 'Game',
      component: (_props: BaseComponentProps<{ moves: number[] }>) => null,
      csv: { summary: (item) => ({ last: item.responseData.moves.at(-1) }) },
      session: (item) => ({ total: item.responseData.moves.length }),
      simulate: () => ({ responseData: { moves: [1, 2] } }),
    });
    const timeline = [Game.trial('g')];
    const files = filesOf(timeline, await simulateParticipant(defineExperiment({ timeline }), {}));
    const session = csvColumns(files, 'session');
    expect(session.g_total).toBe('2');
    expect(session).not.toHaveProperty('g_moves');
    expect(csvColumns(files, 'summary')).toMatchObject({ trial_name: 'g', last: '2' });
  });

  test('a list in the session CSV, which cannot be spread into columns, stops the experiment', async () => {
    // The types reject a list for the session CSV, but a component that does not declare its response gets past them
    const Untyped = defineComponent({
      name: 'Untyped',
      component: (_props: BaseComponentProps) => null,
      session: true,
      simulate: () => ({ responseData: [{ x: 1 }] }),
    });
    const timeline = [Untyped.trial('l')];
    const data = await simulateParticipant(defineExperiment({ timeline }), {});
    expect(() => filesOf(timeline, data)).toThrow("The Untyped trial 'l' gives the session CSV a list");
  });

  test('a component that fills the session row writes no file unless it names one, and a trial can leave the row', async () => {
    const Input = defineComponent({
      name: 'Input',
      component: (_props: BaseComponentProps<{ value: number }>) => null,
      session: true,
      simulate: () => ({ responseData: { value: 1 } }),
    });
    const timeline = [Input.trial('a'), Input.trial('b').session(false).csv('inputs')];
    const files = filesOf(timeline, await simulateParticipant(defineExperiment({ timeline }), {}));
    expect(files.map((file) => file.filename.split('.')[0]).sort()).toEqual(['inputs', 'session']);
    expect(csvColumns(files, 'session')).toHaveProperty('a_value');
    expect(csvColumns(files, 'session')).not.toHaveProperty('b_value');
  });

  test("no CSV file can be named 'session', which is the session CSV", () => {
    const component = (_props: BaseComponentProps) => null;
    expect(() => defineComponent({ name: 'SessionFile', component, csv: 'session' })).toThrow(
      "SessionFile cannot write a CSV file named 'session'",
    );
    expect(() => compileExperimentTimeline([Answer.trial().csv({ answers: 'session' })])).toThrow('use .session(true)');
  });

  test('a trial that renames CSV files the component does not write, or one of several without saying which, stops at load', () => {
    const Game = defineComponent({
      name: 'Game',
      component: (_props: BaseComponentProps) => null,
      csv: { moves: true, players: true },
    });
    expect(() => compileExperimentTimeline([Game.trial().csv('practice')])).toThrow(
      "Game writes the CSV files 'moves', 'players', so a trial's .csv() needs to say which",
    );
    expect(() => compileExperimentTimeline([Game.trial().csv({ moevs: 'practice' })])).toThrow(
      "renames the CSV file 'moevs', but Game writes 'moves', 'players'",
    );
    expect(() => compileExperimentTimeline([Game.trial().csv(null), Answer.trial().csv('own')])).not.toThrow();
  });

  test('unnamed trials in the session CSV are named after their component', async () => {
    const Input = defineComponent({
      name: 'Input',
      component: (_props: BaseComponentProps<{ value: number }>) => null,
      session: true,
      simulate: () => ({ responseData: { value: 1 } }),
    });
    const timeline = [Input.trial(), Input.trial('age'), Input.trial(), Input.trial().session(false), Input.trial()];
    const rows = await run(timeline);
    expect(names(rows)).toEqual(['Input', 'age', 'Input_2', '', 'Input_3']);
    expect(Object.keys(csvColumns(filesOf(timeline, dataOf(rows)), 'session'))).toEqual(
      expect.arrayContaining(['Input_value', 'age_value', 'Input_2_value', 'Input_3_value']),
    );
    expect(() => compileExperimentTimeline([Input.trial(), Input.trial(), Answer.trial('Input_2')])).toThrow(
      "'Input_2' is the name an unnamed Input trial gets",
    );
  });

  test('recordings are named after their trial, and sent again unless the server has the same content', () => {
    const recording = (trialNumber: number, name: string, recorded: Record<string, string>) =>
      ({ trialNumber, type: 'VoiceRecording', name, responseData: { type: 'audiorecording', ...recorded } }) as TrialData;
    markRecordingUploaded('audio_kept_2.webm', 'AAAA');
    markRecordingUploaded('audio_redone_3.webm', 'old');
    const files = buildUploadFiles({
      sessionId: 's',
      store: {},
      components: new Map(),
      uploadRaw: false,
      data: dataOf([
        recording(1, 'later', { data64: 'BBBB' }),
        recording(2, 'kept', { data64: 'AAAA', audioFile: 'audio_kept_2.webm' }),
        recording(3, 'redone', { data64: 'new', audioFile: 'audio_redone_3.webm' }),
      ]),
    });
    const recordings = files.filter((file) => file.encoding === 'base64');
    expect(recordings.map((file) => [file.filename, file._alreadyUploaded])).toEqual([
      ['audio_later_1.webm', false],
      ['audio_kept_2.webm', true],
      ['audio_redone_3.webm', false],
    ]);
  });

  test('a simulation gets the context, and the participant carries over unless a result changes it', async () => {
    const Counter = defineComponent({
      name: 'Counter',
      component: (_props: BaseComponentProps<{ seen: number; earlierRows: number }>) => null,
      defaultSimulators: {
        see: ({ participant }) => ({ participant: { ...participant, seen: participant.seen + 1 } }),
      },
      simulate: ({ props, simulators, participant, data }) => {
        const result = simulators.see({ props, participant });
        return {
          responseData: { seen: result.participant?.seen, earlierRows: data.trials.length },
          participant: result.participant,
        };
      },
    });
    const rows = await run([Counter.trial('first'), Answer.trial('between'), Counter.trial('second')], {
      seen: 0,
    });
    expect(rows[2].responseData).toEqual({ seen: 2, earlierRows: 2 });
  });

  test('generateFiles receives the session, the data and the store', () => {
    let received: unknown;
    buildUploadFiles({
      sessionId: 's',
      data: dataOf([]),
      store: { bonus: 1 },
      components: new Map(),
      uploadRaw: false,
      generateFiles: (input) => {
        received = input;
        return [];
      },
    });
    expect(received).toEqual({ sessionId: 's', data: dataOf([]), store: { bonus: 1 } });
  });

  test('CanvasBlock runs slides with the blocks of the main timeline, in the context of the experiment', async () => {
    const slide = (key: ResponseKey) => ({ draw: () => {}, response: { keys: [key], timeLimitMs: 1000 } });
    const rows = await run([
      Answer.trial('before', { value: 3 }),
      CanvasBlock.trial('canvas', {
        timeline: [
          updateStore(() => ({ shown: 0 })),
          whileBlock(({ store }) => (store.shown ?? 0) < 2, [
            slide('f'),
            updateStore(({ store }) => ({ shown: (store.shown ?? 0) + 1 })),
          ]),
          ifBlock(({ slides }) => slides.length === 2, [slide('j')]).else([slide('x')]),
          ({ get, slides }) => ({ ...slide('k'), metadata: { before: get(Answer, 'before').value, seen: slides.length } }),
        ],
      }),
      Answer.trial('after', ({ store }) => ({ value: store.shown })),
    ]);
    expect(rows[1].responseData.map((row: SlideData) => row.key)).toEqual(['f', 'f', 'j', 'k']);
    expect(rows[1].responseData[3].metadata).toEqual({ before: 3, seen: 3 });
    expect(rows[2].responseData.value).toBe(2);
  });

  test("a timed Text screen ends after its duration, unless its button ends it first", async () => {
    const clickAfter = (reactionTimeMs: number) => () => ({ value: { key: 'button', reactionTimeMs } });
    const rows = await run([
      Text.trial({ durationMs: 1000 }),
      Text.trial({ durationMs: 1000, buttonText: 'Skip' }).simulators({ respond: clickAfter(300) }),
      Text.trial({ durationMs: 1000, buttonText: 'Skip' }).simulators({ respond: clickAfter(1500) }),
    ]);
    expect(rows.map((row) => [row.responseData, row.durationMs])).toEqual([
      [{}, 1000],
      [{ key: 'button', reactionTimeMs: 300 }, 300],
      [{}, 1000],
    ]);
  });

  test('a Screen records the named answer and the key that gave it', async () => {
    const choices = { happy: { key: 'f', button: 'Happy' }, sad: { key: 'j' } } as const;
    const rows = await run(Array.from({ length: 20 }, () => Screen.trial({ content: 'face', response: { choices } })));
    for (const { responseData, durationMs } of rows) {
      expect(['happy', 'sad']).toContain(responseData.response);
      expect(responseData.key).toBe(choices[responseData.response as 'happy' | 'sad'].key);
      expect(durationMs).toBe(responseData.reactionTimeMs);
    }
  });

  test('a Screen ends at its time limit, or after its display duration, without an answer in time', async () => {
    const late = () => ({ value: { response: 'f', key: 'f', reactionTimeMs: 2500 } });
    const rows = await run([
      Screen.trial({ response: { keys: ['f'], timeLimitMs: 2000 } }).simulators({ respond: late }),
      Screen.trial({ content: '+', displayDurationMs: 500 }),
    ]);
    expect(rows.map((row) => [row.responseData, row.durationMs])).toEqual([
      [{ response: null, key: null, reactionTimeMs: null }, 2000],
      [{ response: null, key: null, reactionTimeMs: null }, 500],
    ]);
  });

  test('a simulated answer to a Screen is recorded as the browser would record it', async () => {
    const response = { keys: true, choices: { happy: { key: 'f', button: 'Happy' }, sad: { key: 'j' }, skip: { button: 'Skip' } } } as const;
    const answering = (value: { response: string; key?: string | null }) =>
      Screen.trial({ response }).simulators({ respond: () => ({ value: { ...value, reactionTimeMs: 500 } }) });
    const rows = await run([
      answering({ response: 'happy' }),
      answering({ response: 'happy', key: null }),
      answering({ response: 'skip' }),
      answering({ response: 'X' }),
    ]);
    expect(rows.map((row) => row.responseData)).toEqual([
      { response: 'happy', key: 'f', reactionTimeMs: 500 },
      { response: 'happy', key: null, reactionTimeMs: 500 },
      { response: 'skip', key: null, reactionTimeMs: 500 },
      { response: 'x', key: 'x', reactionTimeMs: 500 },
    ]);

    await expect(run([answering({ response: 'happy', key: 'j' })])).rejects.toThrow("with the key 'j', which gives 'sad'");
    await expect(run([answering({ response: 'sad', key: null })])).rejects.toThrow('without its key, but it has no button');
    const choicesOnly = Screen.trial({ response: { choices: response.choices } });
    await expect(
      run([choicesOnly.simulators({ respond: () => ({ value: { response: 'maybe', reactionTimeMs: 500 } }) })]),
    ).rejects.toThrow(`answered "maybe", which the Screen does not take. Its answers are 'happy', 'sad', 'skip'`);
  });

  test("a Screen whose content answers needs a simulator, which gives the content's answer", async () => {
    // Content that would answer through respond, which the simulation does not render
    const content = () => null;
    await expect(run([Screen.trial({ content: '+', displayDurationMs: 500 }), Screen.trial('location', { content })])).rejects.toThrow(
      "In the Screen trial 'location' (trial 2): A Screen whose content answers through respond needs a simulator of its own",
    );
    const rows = await run([
      Screen.trial({ content }).simulators({ respond: () => ({ value: { response: 0.62, reactionTimeMs: 3100 } }) }),
    ]);
    expect(rows[0].responseData).toEqual({ response: 0.62, key: null, reactionTimeMs: 3100 });
  });

  test('a Screen whose answers share a key or button stops the run when the experiment loads', async () => {
    await expect(
      run([Screen.trial({ response: { choices: { happy: { key: 'f' }, sad: { key: 'F' } } } })]),
    ).rejects.toThrow("share the key 'f'");
    await expect(run([Screen.trial({ response: { keys: [] } })])).rejects.toThrow('would never end');
  });

  test("a replacement builds on the default simulator, keeping the participant it returns", async () => {
    const Tap = defineComponent({
      name: 'Tap',
      component: (_props: BaseComponentProps<{ taps: number; tappedBefore: boolean }>) => null,
      simulate: ({ props, simulators, participant }) => {
        const result = simulators.tap({ props, participant });
        return { responseData: { taps: result.value, tappedBefore: participant.tapped === true }, participant: result.participant };
      },
      defaultSimulators: {
        tap: ({ participant }) => ({ value: 2, participant: { ...participant, tapped: true } }),
      },
    });
    const rows = await run([
      Tap.trial().simulators({
        tap: (input, defaultSimulator) => {
          const result = defaultSimulator(input);
          return { ...result, value: result.value * 10 };
        },
      }),
      Tap.trial(),
    ]);
    expect(rows.map((row) => row.responseData)).toEqual([
      { taps: 20, tappedBefore: false },
      { taps: 2, tappedBefore: true },
    ]);
  });

  test('the canvas takes its size from pixels, shares of the screen and ratios, and fits the screen', () => {
    const on = (width: Parameters<typeof canvasSize>[0], height: Parameters<typeof canvasSize>[1]) =>
      canvasSize(width, height, 1600, 900);
    expect(on(undefined, undefined)).toEqual({ width: 900, height: 900 });
    expect(on(400, undefined)).toEqual({ width: 400, height: 400 });
    expect(on('50%', '50%')).toEqual({ width: 800, height: 450 });
    expect(on(800, '16:9')).toEqual({ width: 800, height: 450 });
    expect(on('4:3', 600)).toEqual({ width: 800, height: 600 });
    expect(on('16:9', undefined)).toEqual({ width: 1600, height: 900 });
    expect(on(undefined, '4:3')).toEqual({ width: 1200, height: 900 });
    expect(canvasSize('16:9', undefined, 900, 1600)).toEqual({ width: 900, height: 506 });
  });

  test('a slide function runs once per slide', async () => {
    let calls = 0;
    await run([CanvasBlock.trial({ timeline: [() => ({ draw: () => {}, displayDurationMs: ++calls })] })]);
    expect(calls).toBe(1);
  });

  test('a simulated slide lasts until the response that ends it, or until its time runs out', async () => {
    // The simulated participant's answers to the slides, in order
    const answers: [string | null, number | null][] = [[null, null], ['F', 300], ['f', 600], ['f', 700], ['f', 100]];
    const rows = await run([
      CanvasBlock.trial({
        timeline: [
          { draw: () => {}, displayDurationMs: 500, ignoreData: true },
          { draw: () => {}, response: { keys: ['f'] } },
          { draw: () => {}, displayDurationMs: 200, response: { keys: ['f'], timeLimitMs: 1000 } },
          { draw: () => {}, response: { keys: ['f'], timeLimitMs: 400 } },
          { draw: () => {}, response: { keys: ['f'], endsSlide: false, timeLimitMs: 400 } },
        ],
      }).simulators({
        respondToSlide: () => {
          const [key, reactionTimeMs] = answers.shift() ?? [null, null];
          return { value: { key, reactionTimeMs } };
        },
      }),
    ]);
    expect(rows[0].responseData).toEqual([
      { slideNumber: 2, startMs: 500, endMs: 800, durationMs: 300, key: 'f', reactionTimeMs: 300 },
      { slideNumber: 3, startMs: 800, endMs: 1400, durationMs: 600, key: 'f', reactionTimeMs: 600 },
      { slideNumber: 4, startMs: 1400, endMs: 1800, durationMs: 400, key: null, reactionTimeMs: null },
      { slideNumber: 5, startMs: 1800, endMs: 2200, durationMs: 400, key: 'f', reactionTimeMs: 100 },
    ]);
    expect(rows[0].durationMs).toBe(2200);
  });

  test('a slide that can never end stops the experiment', async () => {
    // The types reject these slides; the run checks them too, and also catches an empty list of keys
    // @ts-expect-error
    await expect(run([CanvasBlock.trial({ timeline: [{ draw: () => {} }] })])).rejects.toThrow('never end');
    await expect(
      // @ts-expect-error
      run([CanvasBlock.trial({ timeline: [{ draw: () => {}, response: { keys: true, endsSlide: false } }] })]),
    ).rejects.toThrow('never end');
    await expect(run([CanvasBlock.trial({ timeline: [{ draw: () => {}, response: { keys: [] } }] })])).rejects.toThrow(
      'never end',
    );
  });

  test("the canvas CSV has a row per slide, with the slide's metadata apart from the block's", async () => {
    const timeline = [
      CanvasBlock.trial('main', {
        timeline: [
          { draw: () => {}, displayDurationMs: 100, metadata: { stimulus: 'A' } },
          { draw: () => {}, displayDurationMs: 100 },
        ],
      }).metadata({ condition: 'hard' }),
    ];
    const data = await simulateParticipant(defineExperiment({ timeline }), {});
    const [header, first, second] = filesOf(timeline, data)
      .find((file) => file.filename.startsWith('canvas.'))!
      .content.split('\n');
    const columns = header.split(',');
    const row = (line: string) => Object.fromEntries(line.split(',').map((value, i) => [columns[i], value]));
    expect(row(first)).toMatchObject({ slideblock_meta_condition: 'hard', meta_stimulus: 'A', slideNumber: '1' });
    expect(row(second)).toMatchObject({ slideblock_meta_condition: 'hard', meta_stimulus: '', slideNumber: '2' });
    expect(columns).not.toContain('meta_condition');
  });

  test('a random dot kinematogram accepts any key by default, also when simulated', async () => {
    // Without coherent motion, simulated participants choose the wrong answer too
    const trials = Array.from({ length: 40 }, (_, i) =>
      RandomDotKinematogram.trial(`rdk${i}`, { correctResponse: 'f', coherence: 0 }),
    );
    seedDistributions(1);
    const data = await simulateParticipant(defineExperiment({ timeline: trials }), {});
    const responses = new Set(data.trials.map((row) => row.responseData.key));
    // A participant who runs out of time responds with null
    expect([...responses].filter((response) => response !== null).sort()).toEqual([' ', 'f']);
  });

  test('without simulate, a simulation stops with an error naming the component', async () => {
    const Unsimulated = defineComponent({ name: 'Unsimulated', component: () => null });
    await expect(run([Unsimulated.trial()])).rejects.toThrow('Unsimulated has no simulation');
  });
});
