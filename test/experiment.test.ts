import { describe, expect, test } from 'bun:test';
import Upload from '../src/components/upload';
import { type BaseComponentProps } from '../src/core/component';
import { urlParams } from '../src/core/params';
import { seedDistributions } from '../src/utils/distributions';
import { buildTimeline, componentParams, defineExperiment, previewTimeline, startRun } from '../src/core/experiment';
import { resolveParams } from '../src/core/params';
import { simulateParticipant } from '../src/core/simulation';
import { compileExperimentTimeline, describeEntry } from '../src/core/timeline';
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

  test('a computed default is called once per participant', async () => {
    let calls = 0;
    const experiment = defineExperiment({
      params: { group: { values: ['a', 'b'], default: () => (++calls % 2 ? 'a' : 'b') } },
      timeline: ({ group }) => [Answer.trial('g', { value: group })],
    });
    const first = await simulateParticipant(experiment, {});
    const second = await simulateParticipant(experiment, {});
    expect(calls).toBe(2);
    expect([first[1].responseData.value, second[1].responseData.value]).toEqual(['a', 'b']);
    expect(first[0].responseData.params.group.value).toBe('a');
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
    const { session, specs } = startRun(withParams, { url: urlParams('?speed=3') });
    expect(Object.keys(specs).sort()).toEqual(['dev', 'n', 'speed']);
    expect(session.params).toMatchObject({ speed: 3, dev: false });
  });

  test('a session kept across a hot reload keeps its params and build seed', () => {
    const withParams = defineExperiment({
      params: { n: { default: () => Math.random() } },
      timeline: [Answer.trial()],
    });
    const { session } = startRun(withParams, { url: {} });
    expect(startRun(withParams, { url: {} }, session).session).toEqual(session);
  });

  test('the first row records the params and the build seed', async () => {
    const data = await simulateParticipant(
      defineExperiment({ params: { group }, timeline: [Answer.trial()] }),
      { params: { group: 'scenario' }, urlParams: { source: 'test' } },
    );
    const { params, buildSeed } = data[0].responseData;
    expect(params.group).toMatchObject({ value: 'scenario', registered: true });
    expect(params.source).toMatchObject({ value: 'test', registered: false });
    expect(typeof buildSeed).toBe('number');
  });

  test('component params are shown unless every trial of the component hides them', () => {
    const shown = compileExperimentTimeline([Answer.trial(), Answer.trial().hideSettings(true)]);
    expect([...componentParams(shown).shown]).toEqual(['speed']);
    const hidden = compileExperimentTimeline([Answer.trial().hideSettings(['speed'])]);
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
    expect(groups({ includeSubset: '2' })).toEqual([['General', ['dev']], ['Upload', ['upload', 'download']]]);
  });

  test('top-level entries describe trials and blocks', () => {
    expect(describeEntry(Answer.trial('a'))).toEqual({ type: 'ParamAnswer', name: 'a' });
  });
});
