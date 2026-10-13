import type { ComponentProps, ReactElement } from 'react';
import { type ExperimentRunner, type ParticipantState, orchestrateSimulation, simulateParticipant, setBackendUrl, seedDistributions } from '@adriansteffan/reactive';
import { api } from './server';

function extractProps(ExperimentComponent: () => ReactElement<ComponentProps<typeof ExperimentRunner>>) {
  // Call the component function directly to get the ExperimentRunner element.
  // This is safe because Experiment() just returns JSX — no hooks execute.
  const element = ExperimentComponent();
  return element.props;
}

// Each simulated participant runs as a separate subprocess to get fresh module-level
// randomization (e.g., group assignment). The orchestrator spawns workers that re-run
// this script with _REACTIVE_WORKER_INDEX set.
//
// Experiment.tsx is imported dynamically so that seeding happens before module-level
// code runs. If participants is a factory function, it is called with the base seed
// for deterministic generation, then re-seeded per-worker for the simulation.
if (process.env._REACTIVE_WORKER_INDEX) {
  const index = parseInt(process.env._REACTIVE_WORKER_INDEX, 10);
  const seed = process.env._REACTIVE_SIMULATION_SEED;
  if (seed) seedDistributions(parseInt(seed, 10) + index);
  setBackendUrl(process.env._REACTIVE_BACKEND_URL!);

  const { default: Experiment } = await import('./src/Experiment');
  const { timeline, simulationConfig } = extractProps(Experiment);
  const participants = simulationConfig.participants;

  let participant: ParticipantState;
  if (typeof participants === 'function') {
    if (seed) seedDistributions(parseInt(seed, 10));
    const allParticipants = participants();
    if (seed) seedDistributions(parseInt(seed, 10) + index);
    participant = allParticipants[index];
  } else if (Array.isArray(participants)) {
    participant = participants[index];
  } else {
    participant = participants.generator(index);
  }

  await simulateParticipant(timeline, participant);
} else {
  const { default: Experiment } = await import('./src/Experiment');
  const { simulationConfig } = extractProps(Experiment);

  // Participants upload through the real backend, on a free port so it never collides with a running dev server
  const server = Bun.serve({ port: 0, routes: api });
  await orchestrateSimulation(simulationConfig, import.meta.path, `${server.url}backend`);
  server.stop();
}
