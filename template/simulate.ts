import { orchestrateSimulation, simulateParticipant, setBackendUrl } from '@adriansteffan/reactive';
import { experiment, simulationConfig } from './src/Experiment';

// Each simulated participant runs as a separate subprocess to get fresh module-level
// randomization (e.g., group assignment). The orchestrator spawns workers that re-run
// this script with _REACTIVE_WORKER_INDEX set.
if (process.env._REACTIVE_WORKER_INDEX) {
  const index = parseInt(process.env._REACTIVE_WORKER_INDEX);
  const participants = simulationConfig.participants;
  const participant = Array.isArray(participants) ? participants[index] : participants.generator(index);
  setBackendUrl(process.env._REACTIVE_BACKEND_URL!);
  await simulateParticipant(experiment, participant);
} else {
  await orchestrateSimulation(simulationConfig, import.meta.filename);
}
