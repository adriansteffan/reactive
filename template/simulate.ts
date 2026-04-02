import { orchestrateSimulation, simulateParticipant, setBackendUrl, seedDistributions } from '@adriansteffan/reactive';

// Each simulated participant runs as a separate subprocess to get fresh module-level
// randomization (e.g., group assignment). The orchestrator spawns workers that re-run
// this script with _REACTIVE_WORKER_INDEX set.
//
// Experiment.tsx is imported dynamically so that seeding happens before module-level
// code runs. If participants is a factory function, it is called with the base seed
// for deterministic generation, then re-seeded per-worker for the simulation.
if (process.env._REACTIVE_WORKER_INDEX) {
  const index = parseInt(process.env._REACTIVE_WORKER_INDEX);
  const seed = process.env._REACTIVE_SIMULATION_SEED;
  if (seed) seedDistributions(parseInt(seed) + index);
  setBackendUrl(process.env._REACTIVE_BACKEND_URL!);

  const { experiment, simulationConfig } = await import('./src/Experiment');
  const participants = simulationConfig.participants;

  let participant;
  if (typeof participants === 'function') {
    if (seed) seedDistributions(parseInt(seed));
    const allParticipants = participants();
    if (seed) seedDistributions(parseInt(seed) + index);
    participant = allParticipants[index];
  } else if (Array.isArray(participants)) {
    participant = participants[index];
  } else {
    participant = participants.generator(index);
  }

  await simulateParticipant(experiment, participant);
} else {
  const { simulationConfig } = await import('./src/Experiment');
  await orchestrateSimulation(simulationConfig, import.meta.filename);
}
