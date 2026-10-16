import { describe, expect, test } from 'bun:test';
import type { BaseComponentProps } from '../src/core/component';
import type { TrialData } from '../src/core/rows';
import { defineExperiment } from '../src/core/experiment';
import { seedDistributions } from '../src/utils/distributions';
import { simulateParticipant } from '../src/core/simulation';
import { type TimelineContext, compileExperimentTimeline, createTimelineContext, ifBlock, ifGoto, marker, type Timeline, updateStore, whileBlock } from '../src/core/timeline';
import { defineComponent } from '../src/core/component';
import { buildUploadFiles, setFlatteners } from '../src/core/files';
import CanvasBlock from '../src/components/canvasblock';
import { RandomDotKinematogram } from '../src/components/randomdotkinematogram';

// The store key the CanvasBlock test counts with
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
  return data.slice(1) as TrialData[];
}

const names = (rows: TrialData[]) => rows.map((row) => row.name);

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

  test('rejects an ifGoto whose marker does not exist', () => {
    expect(() => compileExperimentTimeline([ifGoto(() => true, 'nowhere')])).toThrow("'nowhere'");
  });

  test('rejects anything that is not a trial or a block', () => {
    expect(() => compileExperimentTimeline([{ type: 'Text' } as any])).toThrow('can only hold trials');
  });

  test('turns a trial into the content the runner reads', () => {
    const trial = Answer.trial('a', { value: 1 })
      .metadata({ block: 2 }, { nested: true })
      .csv('other')
      .collectRefreshRate()
      .hideSettings(true);
    const { bytecode } = compileExperimentTimeline([trial]);
    expect(bytecode.instructions[0]).toEqual({
      type: 'ExecuteContent',
      content: {
        component: Answer,
        type: 'Answer',
        name: 'a',
        props: { value: 1 },
        metadata: { block: 2 },
        nestMetadata: true,
        csv: 'other',
        collectRefreshRate: true,
        hideSettings: true,
      },
    });
  });

  test('rejects two different components with the same name', () => {
    const Other = defineComponent({ name: 'Answer', component: () => null });
    expect(() => compileExperimentTimeline([Answer.trial(), Other.trial()])).toThrow(
      'Two different components',
    );
    // Restore the CSV routing the other definition replaced
    setFlatteners('Answer', [{ csv: 'answers' }]);
  });
});

describe('trial builder', () => {
  const base = Answer.trial('base', { value: 1 });
  const contentOf = (trial: ReturnType<typeof Answer.trial>) =>
    compileExperimentTimeline([trial]).bytecode.instructions[0] as { content: any };
  const context = createTimelineContext([], {}, new Set()) as TimelineContext;
  const props = (trial: ReturnType<typeof Answer.trial>) => {
    const value = contentOf(trial).content.props;
    return typeof value === 'function' ? value(context) : value;
  };

  test('methods return new trials and leave the base unchanged', () => {
    const renamed = base.name('other').metadata({ x: 1 });
    expect(renamed).not.toBe(base);
    expect(contentOf(base).content.name).toBe('base');
    expect(contentOf(base).content.metadata).toBeUndefined();
    expect(contentOf(renamed).content.name).toBe('other');
  });

  test('the order of calls does not matter', () => {
    const a = contentOf(base.csv('x').metadata({ m: 1 }).collectRefreshRate(false)).content;
    const b = contentOf(base.collectRefreshRate(false).metadata({ m: 1 }).csv('x')).content;
    expect(a).toEqual(b);
  });

  test('undefined leaves a setting as it is', () => {
    const configured = base.csv('x').metadata({ m: 1 }).collectRefreshRate().hideSettings(['a']);
    const same = configured
      .name(undefined)
      .props(undefined)
      .metadata(undefined)
      .csv(undefined)
      .collectRefreshRate(undefined)
      .hideSettings(undefined)
      .simulators(undefined);
    expect(contentOf(same).content).toEqual(contentOf(configured).content);
  });

  test('props() merges into the props, for objects and context functions alike', () => {
    const fromCtx = (value: number) => () => ({ value });
    expect(props(Answer.trial({ value: 1, label: 'a' }).props({ value: 2 }))).toEqual({ value: 2, label: 'a' });
    expect(props(Answer.trial({ label: 'a' }).props(fromCtx(2)))).toEqual({ value: 2, label: 'a' });
    expect(props(Answer.trial(() => ({ value: 1, label: 'a' })).props({ value: 2 }))).toEqual({
      value: 2,
      label: 'a',
    });
    expect(props(Answer.trial(() => ({ value: 1, label: 'a' })).props(fromCtx(2)))).toEqual({
      value: 2,
      label: 'a',
    });
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
          (data as any[]).pop();
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
    const data = await simulateParticipant(defineExperiment({ timeline: [Plain.trial('one')] }), {});
    const files = buildUploadFiles({ sessionId: 's', data, store: {}, uploadRaw: false });
    expect(files.some((file) => file.filename.startsWith('plainthing.s.'))).toBe(true);
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
    const data = await simulateParticipant(defineExperiment({ timeline: [Game.trial('g')] }), {});
    const files = buildUploadFiles({ sessionId: 's', data, store: {}, uploadRaw: false });
    const rows = (prefix: string) =>
      files.find((file) => file.filename.startsWith(`${prefix}.s.`))?.content.split('\n').length;
    expect([rows('moves'), rows('players')]).toEqual([3, 2]);
  });

  test('a simulation gets the context, and the participant carries over unless a result changes it', async () => {
    const Counter = defineComponent({
      name: 'Counter',
      component: (_props: BaseComponentProps<{ seen: number; earlierRows: number }>) => null,
      defaultSimulators: {
        see: ({ participant }) => ({ participantState: { ...participant, seen: participant.seen + 1 } }),
      },
      simulate: ({ props, simulators, participant, data }) => {
        const result = simulators.see({ props, participant });
        return {
          responseData: { seen: result.participantState?.seen, earlierRows: data.length },
          participantState: result.participantState,
        };
      },
    });
    const rows = await run([Counter.trial('first'), Answer.trial('between'), Counter.trial('second')], {
      seen: 0,
    });
    expect(rows[2].responseData).toEqual({ seen: 2, earlierRows: 3 });
  });

  test('generateFiles receives the session, the data and the store', () => {
    let received: unknown;
    buildUploadFiles({
      sessionId: 's',
      data: [],
      store: { bonus: 1 },
      uploadRaw: false,
      generateFiles: (input) => {
        received = input;
        return [];
      },
    });
    expect(received).toEqual({ sessionId: 's', data: [], store: { bonus: 1 } });
  });

  test('CanvasBlock still runs its own timeline format', async () => {
    const slide = (key: string) => ({ draw: () => {}, allowedResponseKeys: [key], displayDurationMs: 100 });
    const data = await simulateParticipant(
      defineExperiment({
        timeline: [
          CanvasBlock.trial('canvas', {
            timeline: [
              { type: 'UPDATE_STORE', fun: () => ({ shown: 0 }) },
              {
                type: 'WHILE_BLOCK',
                cond: (_data, store) => (store.shown ?? 0) < 2,
                timeline: [slide('f'), { type: 'UPDATE_STORE', fun: (_data, store) => ({ shown: (store.shown ?? 0) + 1 }) }],
              },
              { type: 'IF_BLOCK', cond: (slides) => slides.length === 2, timeline: [slide('j')] },
            ],
          }),
        ],
      }),
      {},
    );
    expect(data[1].responseData.map((row: { key: string }) => row.key)).toEqual(['f', 'f', 'j']);
  });

  test('a random dot kinematogram accepts any key by default, also when simulated', async () => {
    // Without coherent motion, simulated participants choose the wrong answer too
    const trials = Array.from({ length: 40 }, (_, i) =>
      RandomDotKinematogram.trial(`rdk${i}`, { correctResponse: 'f', coherence: 0 }),
    );
    seedDistributions(1);
    const data = await simulateParticipant(defineExperiment({ timeline: trials }), {});
    const responses = new Set(data.slice(1).map((row) => row.responseData.response));
    // A participant who runs out of time responds with null
    expect([...responses].filter((response) => response !== null).sort()).toEqual([' ', 'f']);
  });

  test('without simulate, a simulation stops with an error naming the component', async () => {
    const Unsimulated = defineComponent({ name: 'Unsimulated', component: () => null });
    await expect(run([Unsimulated.trial()])).rejects.toThrow('Unsimulated has no simulation');
  });
});
