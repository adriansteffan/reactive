import { describe, expect, spyOn, test } from 'bun:test';
import Upload from '../src/components/upload';
import type { BaseComponentProps } from '../src/core/component';
import { countDraws, normal, uniform } from '../src/utils/distributions';
import { defineExperiment, type Experiment } from '../src/core/experiment';
import { getBackendUrl } from '../src/core/backend';
import { runSimulation } from '../src/core/simulation';
import { defineComponent } from '../src/core/component';

// Waits a random while, so that participants simulated at the same time interleave
const Rated = defineComponent({
  name: 'Rated',
  component: (_props: BaseComponentProps<{ rating: number }> & { item: number }) => null,
  csv: 'ratings',
  defaultSimulators: { rate: () => ({ value: normal(4, 1) }) },
  simulate: async ({ props, simulators, participant }) => {
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
    return {
      responseData: { rating: simulators.rate({ props, participant }).value + props.item },
      durationMs: uniform(100, 500),
    };
  },
});

const study = (simulation: Experiment['simulation']) =>
  defineExperiment({
    params: { group: { values: ['a', 'b'], default: () => (Math.random() < 0.5 ? 'a' : 'b') } },
    simulation,
    timeline: ({ group }) => [
      [1, 2, 3, 4].sort(() => Math.random() - 0.5).map((item) => Rated.trial({ item })),
      Rated.trial({ item: group === 'a' ? 10 : 20 }),
      Upload.trial('upload'),
    ],
  });

// Simulates the experiment and returns each participant's raw data, by participant id
async function simulate(experiment: Experiment<any>) {
  const uploads: Record<string, string> = {};
  const routes = {
    '/backend/data': {
      POST: async (request: Request) => {
        const { files } = (await request.json()) as { files: { filename: string; content: string }[] };
        const initial = files.find((file) => file.filename.endsWith('_participant_initial.csv'));
        const raw = files.find((file) => file.filename.endsWith('.raw.json'));
        uploads[String(initial?.content.split('\n')[1])] = String(raw?.content);
        return Response.json({ status: 200 });
      },
    },
  };
  await runSimulation(async () => ({ default: experiment }), routes);
  return uploads;
}

const createParticipants = () => Array.from({ length: 8 }, (_, id) => ({ id }));

describe('runSimulation', () => {
  test('participants simulated at the same time draw as if each ran alone', async () => {
    const alone = await simulate(study({ seed: 7, concurrency: 1, createParticipants }));
    const together = await simulate(study({ seed: 7, concurrency: 4, createParticipants }));
    const again = await simulate(study({ seed: 7, concurrency: 4, createParticipants }));
    expect(Object.keys(alone)).toHaveLength(8);
    expect(together).toEqual(alone);
    expect(again).toEqual(alone);
  });

  test('a different seed gives different data', async () => {
    const first = await simulate(study({ seed: 7, concurrency: 4, createParticipants }));
    const second = await simulate(study({ seed: 8, concurrency: 4, createParticipants }));
    expect(second).not.toEqual(first);
  });

  test('the participants are drawn from the seed', async () => {
    const drawn = () => Array.from({ length: 3 }, () => ({ id: Math.random().toFixed(6) }));
    const first = await simulate(study({ seed: 3, createParticipants: drawn }));
    const second = await simulate(study({ seed: 3, createParticipants: drawn }));
    expect(Object.keys(first)).toHaveLength(3);
    expect(second).toEqual(first);
  });

  test('random draws while the experiment loads are reported', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const experiment = study({ seed: 1, createParticipants: () => [{ id: 1 }] });
    await runSimulation(async () => {
      Math.random();
      return { default: experiment };
    }, { '/backend/data': { POST: () => Response.json({ status: 200 }) } });
    expect(warn.mock.calls[0]?.[0]).toContain('drew 1 random number(s) while it loaded');
    warn.mockRestore();
  });
});

test("a component's simulation reaches the experiment's server through getBackendUrl", async () => {
  const Partner = defineComponent({
    name: 'Partner',
    component: (_props: BaseComponentProps<{ partner: string }>) => null,
    simulate: async () => {
      const response = await fetch(`${getBackendUrl()}/partner`);
      return { responseData: { partner: await response.text() } };
    },
  });
  const rows: string[] = [];
  const experiment = defineExperiment({
    simulation: { seed: 1, createParticipants: () => [{ id: 1 }] },
    timeline: [Partner.trial('partner'), Upload.trial('upload')],
  });
  await runSimulation(async () => ({ default: experiment }), {
    '/backend/partner': new Response('matched'),
    '/backend/data': {
      POST: async (request: Request) => {
        const { files } = (await request.json()) as { files: { filename: string; content: string }[] };
        rows.push(String(files.find((file) => file.filename.startsWith('partner.'))?.content));
        return Response.json({ status: 200 });
      },
    },
  });
  expect(rows[0]).toContain('matched');
});

test('countDraws counts Math.random and the samplers', async () => {
  const [, draws] = await countDraws(async () => {
    Math.random();
    uniform(0, 1);
    normal(0, 1);
  });
  expect(draws).toBe(4);
});
