import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ParamsProvider, useParams } from '../src/runner/contexts';
import { fullscreenBlock } from '../src/components/fullscreenblock';
import ProlificEnding from '../src/components/prolificending';
import Upload from '../src/components/upload';
import { type BaseComponentProps } from '../src/core/component';
import { urlParams } from '../src/core/params';
import { seedDistributions } from '../src/utils/distributions';
import {
  buildTimeline,
  checkTrials,
  componentParams,
  createRunState,
  defineExperiment,
  previewTimeline,
  realign,
  startRun,
  trialAt,
} from '../src/core/experiment';
import { resolveParams } from '../src/core/params';
import { simulateParticipant } from '../src/core/simulation';
import { compileExperimentTimeline, describeTimeline, ifBlock, ifGoto, marker, type Timeline, updateStore, whileBlock } from '../src/core/timeline';
import { defineComponent } from '../src/core/component';

const Answer = defineComponent({
  name: 'ParamAnswer',
  component: (_props: BaseComponentProps<{ value: unknown }> & { value?: unknown }) => null,
  params: { speed: { default: 1 } },
  simulate: ({ props }) => ({ responseData: { value: props.value } }),
});

const group = { values: ['vn', 'scenario'], default: 'vn' } as const;

describe('params', () => {
  test('a URL value in values is returned, one outside them throws', () => {
    expect(resolveParams({ group }, { url: urlParams('?group=scenario') })).toEqual({ group: 'scenario' });
    expect(() => resolveParams({ group }, { url: urlParams('?group=vns') })).toThrow(
      `The param 'group' must be one of "vn", "scenario"`,
    );
  });

  test('values that are numbers match the text in the URL', () => {
    expect(resolveParams({ level: { values: [1, 2, 3], default: 1 } }, { url: urlParams('?level=2') })).toEqual({
      level: 2,
    });
  });

  test('without a URL value, the default is used', () => {
    expect(resolveParams({ group }, { url: urlParams('') })).toEqual({ group: 'vn' });
  });

  test('URL values take the type of the default', () => {
    const params = {
      on: { default: false },
      count: { default: 3 },
      weights: { default: [1] },
      label: { default: 'x' },
    };
    expect(resolveParams(params, { url: urlParams('?on=true&count=12&weights=[2,3]&label=12') })).toEqual({
      on: true,
      count: 12,
      weights: [2, 3],
      label: '12',
    });
    expect(() => resolveParams(params, { url: urlParams('?count=many') })).toThrow('must be a number');
  });

  test('a value of another type than declared stops the run, wherever it comes from', () => {
    const params = { count: { default: 1 }, on: { default: false }, level: { values: [1, 2], default: 1 } };
    const base64 = (values: object) => urlParams(`?_b=${btoa(JSON.stringify(values))}`);
    expect(() => resolveParams(params, { url: base64({ count: true }) })).toThrow("'count' must be of type number");
    expect(() => resolveParams(params, { overrides: { count: '3' } })).toThrow("'count' must be of type number");
    expect(() => resolveParams(params, { url: urlParams('?on=yes') })).toThrow("'on' must be true or false");
    expect(() => resolveParams(params, { overrides: { level: 3 } })).toThrow("'level' must be one of 1, 2");
    expect(() => resolveParams({ drawn: { values: ['a'], default: () => 'b' } })).toThrow('must be one of');
    expect(resolveParams({ drawn: { default: () => 'any type' } })).toEqual({ drawn: 'any type' });
  });

  test('values from the base64 link keep their type', () => {
    const encoded = btoa(JSON.stringify({ count: 5, group: 'scenario' }));
    expect(resolveParams({ count: { default: 1 }, group }, { url: urlParams(`?_b=${encoded}`) })).toEqual({
      count: 5,
      group: 'scenario',
    });
  });

  test("a simulated participant's params override the URL and the default", () => {
    expect(resolveParams({ group }, { url: urlParams('?group=vn'), overrides: { group: 'scenario' } })).toEqual({
      group: 'scenario',
    });
    expect(() => resolveParams({ group }, { overrides: { group: 'other' } })).toThrow('must be one of');
  });

  test('values kept across hot reloads win over the default, unless no longer allowed', () => {
    let calls = 0;
    const drawn = { default: () => ++calls };
    expect(resolveParams({ drawn }, { previous: { drawn: 7 } })).toEqual({ drawn: 7 });
    expect(calls).toBe(0);
    expect(resolveParams({ group }, { previous: { group: 'removed' } })).toEqual({ group: 'vn' });
  });

  test('a component that reads a param nothing declares stops during development', () => {
    const Reader = () => {
      useParams({ mode: { default: 'a' } });
      return null;
    };
    const render = (values: Record<string, unknown>) =>
      renderToStaticMarkup(createElement(ParamsProvider, { value: values }, createElement(Reader)));
    expect(() => render({})).toThrow("useParams reads the param 'mode'");
    expect(() => render({ mode: 'b' })).not.toThrow();
  });

  test('a computed default is called once per participant', async () => {
    let calls = 0;
    const experiment = defineExperiment({
      params: { group: { values: ['a', 'b'], default: () => (++calls % 2 ? 'a' : 'b') } },
      timeline: ({ group }) => [Answer.trial('g', { value: group })],
    });
    const first = await simulateParticipant(experiment, {});
    const second = await simulateParticipant(experiment, {});
    expect(calls).toBe(2);
    expect([first.trials[0].responseData.value, second.trials[0].responseData.value]).toEqual(['a', 'b']);
    expect(first.session.params.group.value).toBe('a');
  });
});

describe('building', () => {
  const experiment = defineExperiment({
    timeline: () => {
      const order = [1, 2, 3, 4, 5, 6].sort(() => Math.random() - 0.5);
      return order.map((value) => Answer.trial({ value }));
    },
  });
  const values = (timeline: ReturnType<typeof buildTimeline>) =>
    compileExperimentTimeline(timeline).bytecode.instructions.map((i: any) => i.content.props.value);

  test('a build with the same seed repeats its random draws', () => {
    expect(values(buildTimeline(experiment, {}, 123))).toEqual(values(buildTimeline(experiment, {}, 123)));
    const draws = new Set(
      [1, 2, 3, 4, 5].map((buildSeed) => values(buildTimeline(experiment, {}, buildSeed)).join()),
    );
    expect(draws.size).toBeGreaterThan(1);
  });

  test('the build leaves the participant stream where it was', () => {
    seedDistributions(5);
    const expected = [Math.random(), Math.random()];
    seedDistributions(5);
    const first = Math.random();
    buildTimeline(experiment, {}, 9);
    expect([first, Math.random()]).toEqual(expected);
  });

  test('a run resolves the params of the experiment, its components and the library', () => {
    const withParams = defineExperiment({
      params: { n: { default: () => Math.random() } },
      timeline: [Answer.trial()],
    });
    const { params, specs } = startRun(withParams, { url: urlParams('?speed=3') });
    expect(Object.keys(specs).sort()).toEqual(['dev', 'n', 'speed']);
    expect(params).toMatchObject({ speed: 3, dev: false });
  });

  test('params cannot take the session columns the library writes', () => {
    const withParam = (name: string) => defineExperiment({ params: { [name]: { default: 1 } }, timeline: [] });
    for (const name of ['sessionId', 'buildSeed', 'url_source', 'session_count']) {
      expect(() => startRun(withParam(name), { url: {} })).toThrow('cannot be named');
    }
    expect(() => startRun(withParam('session'), { url: {} })).not.toThrow();
  });

  test('a run kept across a hot reload keeps its params and build seed', () => {
    const withParams = defineExperiment({
      params: { n: { default: () => Math.random() } },
      timeline: [Answer.trial()],
    });
    const { params, buildSeed } = startRun(withParams, { url: {} });
    expect(startRun(withParams, { url: {} }, { params, buildSeed })).toMatchObject({ params, buildSeed });
  });

  test('the settings screen rejects a param named like a session column, as a run does', () => {
    const name: string = 'url_source';
    const experiment = defineExperiment({ params: { [name]: { default: 'x' } }, timeline: [] });
    expect(() => previewTimeline(experiment, {}, {})).toThrow('cannot be named');
  });

  test('the session records the params and the build seed', async () => {
    const data = await simulateParticipant(
      defineExperiment({ params: { group }, timeline: [Answer.trial()] }),
      { params: { group: 'scenario' }, urlParams: { source: 'test' } },
    );
    const { params, buildSeed } = data.session;
    expect(params.group).toMatchObject({ value: 'scenario', registered: true });
    expect(params.source).toMatchObject({ value: 'test', registered: false });
    expect(typeof buildSeed).toBe('number');
  });

  test('component params are shown unless every trial of the component hides them', () => {
    const shown = compileExperimentTimeline([Answer.trial(), Answer.trial().hideParams(true)]);
    expect([...componentParams(shown).shown]).toEqual(['speed']);
    const hidden = compileExperimentTimeline([Answer.trial().hideParams(['speed'])]);
    expect(componentParams(hidden)).toEqual({
      specs: { speed: { default: 1 } },
      owners: { speed: 'ParamAnswer' },
      shown: new Set(),
    });
  });

  test('the settings screen lists the settings of the selected trials, by component', () => {
    const experiment = defineExperiment({ timeline: [Answer.trial('a'), Upload.trial('upload')] });
    const groups = (url: Record<string, unknown>) =>
      Object.entries(previewTimeline(experiment, url, {}).settings).map(([title, params]) => [title, Object.keys(params)]);
    expect(groups({})).toEqual([['General', ['dev']], ['ParamAnswer', ['speed']], ['Upload', ['upload', 'download']]]);
    expect(groups({ excludeSubset: 'upload' })).toEqual([['General', ['dev']], ['ParamAnswer', ['speed']]]);
    expect(groups({ excludeSubset: '1' })).toEqual([['General', ['dev']], ['Upload', ['upload', 'download']]]);
  });

  test('markers stay when the settings screen leaves entries out, so every ifGoto keeps its target', () => {
    const experiment = defineExperiment({
      timeline: [
        ifGoto(() => true, 'end'),
        Answer.trial('a'),
        ifBlock(() => true, [marker('inside'), Answer.trial('b')]),
        ifGoto(() => false, 'inside'),
        marker('end'),
        Answer.trial('c'),
      ],
    });
    const { compiled } = startRun(experiment, { url: { excludeSubset: '3,end' } });
    const trials = compiled.bytecode.instructions.flatMap((i) => (i.type === 'ExecuteContent' ? [i.content.name] : []));
    expect(trials).toEqual(['a', 'c']);
  });

  test("the components' checks find what is wrong with their trials, which keeps a run from starting", () => {
    const Needy = defineComponent({
      name: 'Needy',
      component: (_props: BaseComponentProps & { code?: string }) => null,
      params: { key: { default: '' } },
      check: ({ props, params, trials, index, production }) =>
        production && !props?.code && !params.key ? `trial ${index + 1} of ${trials.length} needs a code` : undefined,
    });
    const compiled = compileExperimentTimeline([Answer.trial(), Needy.trial(), Needy.trial({ code: 'x' })]);
    expect(checkTrials(compiled, { key: '' }, true)).toEqual(['trial 2 of 3 needs a code']);
    expect(checkTrials(compiled, { key: 'k' }, true)).toEqual([]);
    expect(checkTrials(compiled, { key: '' }, false)).toEqual([]);
  });

  test('a ProlificEnding needs an Upload before it, and in production a completion code', () => {
    const ending = (props = {}) => checkTrials(compileExperimentTimeline([Upload.trial(), ProlificEnding.trial(props)]), { cc: '' }, true);
    expect(ending()[0]).toContain('ProlificEnding has no completion code');
    expect(ending({ prolificCode: 'ABC' })).toEqual([]);
    expect(checkTrials(compileExperimentTimeline([Upload.trial(), ProlificEnding.trial()]), { cc: 'ABC' }, true)).toEqual([]);
    for (const timeline of [[ProlificEnding.trial({ prolificCode: 'ABC' })], [ProlificEnding.trial({ prolificCode: 'ABC' }), Upload.trial()]]) {
      expect(checkTrials(compileExperimentTimeline(timeline), {}, false)[0]).toContain('an Upload has to come before it');
    }
  });

  test("the settings screen resolves a param the experiment declares by the experiment's spec, also over a component's", () => {
    const experiment = defineExperiment({ params: { speed: { default: 'slow' } }, timeline: [Answer.trial()] });
    expect(() => previewTimeline(experiment, { speed: 'fast' }, {})).not.toThrow();
  });

  test('the settings screen lists entries with the items of blocks under them, by name or position', () => {
    const entries = describeTimeline([
      Answer.trial('a'),
      [Answer.trial()],
      ifBlock(() => true, [Answer.trial('b'), marker('m')]).else([Answer.trial()]),
      whileBlock(() => false, [updateStore(() => ({}))]),
    ]);
    expect(entries).toEqual([
      { position: '1', id: 'a', type: 'ParamAnswer', name: 'a' },
      { position: '2', id: '2', type: 'ParamAnswer' },
      {
        position: '3',
        id: '3',
        type: 'ifBlock',
        children: [
          { position: '3.1', id: 'b', type: 'ParamAnswer', name: 'b' },
          { position: '3.2', id: '3.2', type: 'marker', name: 'm' },
          { position: '3.3', id: '3.3', type: 'ParamAnswer', arm: 'else' },
        ],
      },
      { position: '4', id: '4', type: 'whileBlock', children: [{ position: '4.1', id: '4.1', type: 'updateStore' }] },
    ]);
  });

  test("a fullscreenBlock runs its screen and items in fullscreen, and the screen can be left out on its own", () => {
    const experiment = defineExperiment({
      timeline: [Answer.trial('a'), fullscreenBlock({ keepFullscreen: true }, [Answer.trial('b'), Answer.trial('c')]), Answer.trial('d')],
    });
    const run = (excludeSubset?: string) => startRun(experiment, { url: excludeSubset ? { excludeSubset } : {} }).compiled.bytecode;
    expect(run().fullscreen).toEqual([[1, 4]]);
    const { children } = previewTimeline(experiment, {}, {}).entries[1];
    expect(children?.map((child) => [child.position, child.type])).toEqual([['2.1', 'EnterFullscreen'], ['2.2', 'ParamAnswer'], ['2.3', 'ParamAnswer']]);
    const withoutScreen = run('2.1');
    expect(withoutScreen.instructions.map((i) => (i.type === 'ExecuteContent' ? i.content.type : i.type))).toEqual(['ParamAnswer', 'ParamAnswer', 'ParamAnswer', 'ParamAnswer']);
    expect(withoutScreen.fullscreen).toEqual([[1, 3]]);
    expect(run('b,c,2.1').fullscreen).toEqual([]);
  });

  test('a link leaves out trials inside blocks too, and a block that has none of its items left', async () => {
    const experiment = defineExperiment({
      timeline: [
        Answer.trial('a'),
        ifBlock(() => true, [Answer.trial('b'), Answer.trial()]).else([Answer.trial('c')]),
        whileBlock(({ data }) => data.trials.length < 3, [Answer.trial('loop'), marker('kept')]),
        ifGoto(() => false, 'kept'),
        Answer.trial('d'),
      ],
    });
    const names = (excludeSubset: string) =>
      startRun(experiment, { url: { excludeSubset } }).compiled.bytecode.instructions.flatMap((i) =>
        i.type === 'ExecuteContent' ? [i.content.name ?? ''] : [],
      );
    expect(names('b,2.2')).toEqual(['a', 'c', 'loop', 'd']);
    expect(names('loop')).toEqual(['a', 'b', '', 'c', 'd']);
    expect(names('2')).toEqual(['a', 'loop', 'd']);
  });
});

describe('hot reload', () => {
  // A run of `timeline` with the trial at `pointer` on screen
  const runAt = (timeline: Timeline, pointer: number) => {
    const compiled = compileExperimentTimeline(timeline);
    return { compiled, state: { ...createRunState(compiled, { session: { userAgent: '', params: {}, buildSeed: 0, namedTrials: [] }, trials: [] }, {}), pointer } };
  };

  test('finds the trial on screen by its name in the rebuilt timeline', () => {
    const before = runAt([Answer.trial('a'), Answer.trial('b'), Answer.trial('c')], 1);
    const after = compileExperimentTimeline([
      Answer.trial('new'),
      Answer.trial('a'),
      Answer.trial('b', { value: 'edited' }),
      Answer.trial('c'),
    ]);
    const state = realign(before.compiled, after, before.state);
    expect(trialAt(after, state.pointer)?.name).toBe('b');
    expect(state.props).toEqual({ value: 'edited' });
  });

  test('without a name, stays at the same position', () => {
    const before = runAt([Answer.trial(), Answer.trial({ value: 1 })], 1);
    const after = compileExperimentTimeline([Answer.trial(), Answer.trial({ value: 2 }), Answer.trial()]);
    const state = realign(before.compiled, after, before.state);
    expect(state.pointer).toBe(1);
    expect(state.props).toEqual({ value: 2 });
  });

  test('runs control flow when the position is no longer a trial', () => {
    const before = runAt([Answer.trial(), Answer.trial()], 1);
    const after = compileExperimentTimeline([
      Answer.trial(),
      ifBlock(() => false, [Answer.trial('skipped')]),
      Answer.trial('end'),
    ]);
    const state = realign(before.compiled, after, before.state);
    expect(trialAt(after, state.pointer)?.name).toBe('end');
  });
});
