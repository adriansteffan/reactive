import { countDraws, seedDistributions, withStream } from '../utils/distributions';
import { setBackendUrl } from './backend';
import type { ParticipantState } from './component';
import { createRunState, type Experiment, respond, startRun, trialAt } from './experiment';
import { createExperimentData, type ExperimentData } from './rows';
import { createTimelineContext } from './timeline';

/** A simulation for components without a response, such as entering fullscreen. */
export const noopSimulate = () => ({ responseData: {} as any });

/**
 * Runs one simulated participant through the experiment. Its `params` set the experiment's
 * params, and its `urlParams` are recorded like undeclared URL params.
 */
export async function simulateParticipant(
  experiment: Experiment<any>,
  participant: ParticipantState,
): Promise<ExperimentData> {
  const initialParticipant = { ...participant };
  let participantState = { ...participant };

  const run = startRun(experiment, { url: {}, overrides: participant.params });
  const { compiled } = run;
  let state = createRunState(
    compiled,
    createExperimentData({ userAgent: 'simulated', url: participant.urlParams ?? {}, run }),
    {},
  );
  let currentTime = 0;

  let content = trialAt(compiled, state.pointer);
  while (content) {
    const { name, simulate, defaultSimulators } = content.component.reactive;
    if (!simulate) {
      throw new Error(
        `The ${name} trial '${content.name ?? 'unnamed'}' cannot be simulated, since ${name} has no simulation. Add a simulate function to its defineComponent call.`,
      );
    }
    const result = await simulate({
      ...createTimelineContext(state.data, state.store, compiled.trials),
      props: state.props,
      participant: participantState,
      initialParticipant,
      simulators: { ...defaultSimulators, ...content.simulators },
      components: compiled.components,
    });
    participantState = result.participantState ?? participantState;

    const startMs = currentTime;
    currentTime += result.durationMs ?? 0;
    state = respond(compiled, state, {
      responseData: result.responseData,
      storeUpdates: result.storeUpdates,
      startMs,
      endMs: currentTime,
    });
    content = trialAt(compiled, state.pointer);
  }

  return state.data;
}


export interface RunSimulationConfig {
  /**
   * Produces the simulated participants when the simulation starts. Anything drawn at random
   * here is drawn from the simulation's seed, so the list stays the same between runs and
   * while you edit the experiment.
   */
  createParticipants: () => ParticipantState[];
  /** Seed for reproducible simulations. The participant list and each participant draw from their own streams, derived from it. */
  seed?: number;
  /** How many participants are simulated at the same time. */
  concurrency?: number;
}

// What a random stream is for, as part of its seed
const PARTICIPANT_LIST = 0;
const PARTICIPANT = 1;

/**
 * Simulates the experiment's participants, several at a time, and uploads their data through
 * the backend's `routes`.
 */
export async function runSimulation(
  loadExperiment: () => Promise<{ default: Experiment<any> }>,
  routes: Record<string, any>,
): Promise<void> {
  const [{ default: experiment }, drawsWhileLoading] = await countDraws(loadExperiment);
  if (drawsWhileLoading > 0) {
    console.warn(
      `The experiment drew ${drawsWhileLoading} random number(s) while it loaded. Every simulated participant shares them, while real participants each get their own; draw them in a param default or in the timeline function instead.`,
    );
  }
  const config = experiment.simulation;
  if (!config) throw new Error('Add a simulation config to defineExperiment to simulate participants.');

  const seed = config.seed ?? Math.floor(Math.random() * 2 ** 31);
  // The list and every participant draw from streams of their own, which never overlap, also across seeds
  seedDistributions([seed, PARTICIPANT_LIST]);
  const participants = config.createParticipants();
  const concurrency = config.concurrency ?? process.getBuiltinModule('os').cpus().length;

  // On a free port, so that it never collides with a running dev server
  const server = Bun.serve({ port: 0, routes });
  setBackendUrl(`${server.url}backend`);
  console.log(`Simulating ${participants.length} participants (concurrency: ${concurrency})...`);

  let completed = 0;
  const errors: { index: number; error: unknown }[] = [];
  const writeProgress = () => {
    const pct = participants.length ? Math.round((completed / participants.length) * 100) : 100;
    const bar = '█'.repeat(Math.floor(pct / 2)) + '░'.repeat(50 - Math.floor(pct / 2));
    process.stdout.write(`\r  ${bar} ${completed}/${participants.length} (${pct}%)`);
  };
  writeProgress();

  let nextIndex = 0;
  const simulateNext = async (): Promise<void> => {
    while (nextIndex < participants.length) {
      const index = nextIndex++;
      try {
        await withStream([seed, PARTICIPANT, index], () => simulateParticipant(experiment, participants[index]));
      } catch (error) {
        errors.push({ index, error });
      }
      completed++;
      writeProgress();
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, participants.length) }, simulateNext));
  server.stop();
  process.stdout.write('\n');

  if (errors.length > 0) {
    console.error(`\n${errors.length} participant(s) failed:`);
    for (const { index, error } of errors) {
      console.error(`  Participant ${index}:`, error);
    }
  }
  console.log(
    `Simulation complete. ${completed - errors.length}/${participants.length} participants simulated successfully.`,
  );
}
