/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  compileTimeline,
  advanceToNextContent,
  applyMetadata,
  TrialResult,
  ComponentResultData,
  TimelineItem,
  Store,
} from './bytecode';
import { Param } from './common';


export type ParticipantState = Record<string, any>;

export type SimulatorResult = {
  responseData: any;
  participantState: ParticipantState;
  storeUpdates?: Record<string, any>;
  duration?: number;
};

export type SimulateFunction = (
  trialProps: Record<string, any>,
  experimentState: {
    data: TrialResult[];
    store: Store;
  },
  simulators: Record<string, any>,
  participant: ParticipantState,
) => SimulatorResult | Promise<SimulatorResult>;


interface ComponentSimulation {
  simulate: SimulateFunction;
  defaultSimulators: Record<string, any>;
}

const simulationRegistry: Record<string, ComponentSimulation> = {};

export function registerSimulation(
  type: string,
  simulate: SimulateFunction,
  defaultSimulators: Record<string, any>,
) {
  simulationRegistry[type] = { simulate, defaultSimulators };
}

export function getSimulation(type: string): ComponentSimulation | undefined {
  return simulationRegistry[type];
}

export const noopSimulate: SimulateFunction = (_trialProps, _experimentState, _simulators, participant) => ({
  responseData: {},
  participantState: participant,
});

export function resolveSimulation(content: any, data: TrialResult[], store: Store) {
  const trialProps =
    typeof content.props === 'function' ? content.props(data, store) : content.props || {};
  const registration = simulationRegistry[content.type];
  const simulateFn = typeof content.simulate === 'function' ? content.simulate : registration?.simulate;

  if (!simulateFn) {
    throw new Error(`No simulation registered for trial type '${content.type}' (name: '${content.name ?? 'unnamed'}'). Register one with registerSimulation() or add a simulate function to the timeline item.`);
  }

  const simulators = { ...registration?.defaultSimulators, ...content.simulators };
  return { trialProps, simulateFn, simulators };
}

let _backendUrl = 'http://localhost:8001/backend';
export function setBackendUrl(url: string) { _backendUrl = url; }
export function getBackendUrl() { return _backendUrl; }

let _initialParticipant: ParticipantState | undefined;
export function getInitialParticipant() { return _initialParticipant; }


export async function simulateParticipant(
  timeline: TimelineItem[],
  participant: ParticipantState,
): Promise<TrialResult[]> {
  _initialParticipant = { ...participant };
  let currentParticipantState = { ...participant };
  const bytecode = compileTimeline(timeline);
  let store: Store = {};
  const data: TrialResult[] = [
    {
      index: -1,
      trialNumber: -1,
      start: 0,
      end: 0,
      duration: 0,
      type: '',
      name: '',
      responseData: {
        userAgent: 'simulated',
        params: {
          // Unregistered URL params from participant.urlParams appear in the CSV with a `url_` prefix.
          ...Object.fromEntries(
            Object.entries((participant as any)?.urlParams ?? {}).map(([name, value]) => [name, {
              value,
              registered: false,
              defaultValue: undefined,
              type: undefined,
              description: undefined,
            }]),
          ),
          // Registered params win on name collision.
          ...Object.fromEntries(
            (Param.getRegistry() || []).map((p: any) => [p.name, {
              value: p.value !== undefined ? p.value : p.defaultValue,
              registered: true,
              defaultValue: p.defaultValue,
              type: p.type,
              description: p.description,
            }]),
          ),
        },
      },
    },
  ];
  
  const getStore = () => store;
  const getData = () => data;
  const onUpdateStore = (s: Store) => { store = s; };

  let trialNumber = 0;
  let currentTime = 0;

  let pointer = advanceToNextContent(bytecode, 0, getStore, getData, onUpdateStore);

  while (pointer < bytecode.instructions.length) {
    const content = (bytecode.instructions[pointer] as any).content;
    if (typeof content !== 'object' || content === null || typeof content.type !== 'string') {
      pointer = advanceToNextContent(bytecode, pointer + 1, getStore, getData, onUpdateStore);
      continue;
    }

    const { trialProps, simulateFn, simulators } = resolveSimulation(content, data, store);

    const result = await simulateFn(
      trialProps,
      { data, store },
      simulators,
      currentParticipantState,
    );
    currentParticipantState = result.participantState;
    if (result.storeUpdates) store = { ...store, ...result.storeUpdates };

    trialNumber++;
    const duration = result.duration ?? 0;
    const startTime = currentTime;
    currentTime += duration;

    let trialData: ComponentResultData = {
      index: pointer,
      trialNumber,
      start: startTime,
      end: currentTime,
      duration,
      type: content.type,
      name: content.name ?? '',
      ...(content.csv !== undefined ? { csv: content.csv } : {}),
      responseData: result.responseData,
    };

    data.push(applyMetadata(trialData, content, data, store));
    pointer = advanceToNextContent(bytecode, pointer + 1, getStore, getData, onUpdateStore);
  }

  return data;
}


export interface RunSimulationConfig {
  participants: ParticipantState[] | { generator: (index: number) => ParticipantState; count: number } | (() => ParticipantState[]);
  /** Seed for reproducible simulations. Each participant gets seed + workerIndex. */
  seed?: number;
  backendPort?: number;
  concurrency?: number;
}

export async function orchestrateSimulation(config: RunSimulationConfig, scriptPath: string): Promise<void> {
  const { spawn } = await import('child_process');

  const port = config.backendPort ?? 8001;
  const backendUrl = `http://localhost:${port}/backend`;

  const participantCount = typeof config.participants === 'function'
    ? config.participants().length
    : Array.isArray(config.participants)
      ? config.participants.length
      : config.participants.count;

  const backend = spawn('node', ['src/backend.ts'], {
    cwd: './backend',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Wait for backend to signal readiness before spawning workers
  await new Promise<void>((resolve, reject) => {
    backend.on('error', reject);

    backend.stdout?.on('data', (data: any) => {
      const msg = data.toString();
      if (msg.includes('REACTIVE_BACKEND_READY')) {
        resolve();
      }
    });

    backend.stderr?.on('data', (data: any) => {
      console.error(`[backend] ${data.toString().trim()}`);
    });

    setTimeout(() => reject(new Error('Backend did not start within 10 seconds')), 10000);
  });

  console.log(`Backend running on port ${port}`);

  try {
    const concurrency = config.concurrency ?? (await import('os')).cpus().length;
    console.log(`Simulating ${participantCount} participants (concurrency: ${concurrency})...`);

    let completed = 0;
    const errors: { index: number; error: string }[] = [];

    const writeProgress = () => {
      const pct = Math.min(100, Math.round((completed / participantCount) * 100));
      const filled = Math.floor(pct / 2);
      const bar = '█'.repeat(filled) + '░'.repeat(50 - filled);
      process.stdout.write(`\r  ${bar} ${completed}/${participantCount} (${pct}%)`);
    };

    const spawnWorker = (i: number) => new Promise<void>((resolve) => {
      let stderr = '';
      const worker = spawn('node', [scriptPath], {
        env: {
          ...process.env,
          _REACTIVE_WORKER_INDEX: String(i),
          _REACTIVE_BACKEND_URL: backendUrl,
          ...(config.seed !== undefined ? { _REACTIVE_SIMULATION_SEED: String(config.seed) } : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      worker.stderr?.on('data', (data: any) => { stderr += data.toString(); });

      worker.on('close', (code: number) => {
        if (code !== 0) {
          errors.push({ index: i, error: stderr.trim() || `exited with code ${code}` });
        }
        completed++;
        writeProgress();
        resolve();
      });
      worker.on('error', (err: Error) => {
        errors.push({ index: i, error: err.message });
        completed++;
        writeProgress();
        resolve();
      });
    });

    writeProgress();

    // Worker pool: always keep `concurrency` workers running
    let nextIndex = 0;
    await new Promise<void>((resolveAll) => {
      const startNext = () => {
        if (nextIndex >= participantCount) {
          if (completed >= participantCount) resolveAll();
          return;
        }
        const i = nextIndex++;
        spawnWorker(i).then(startNext);
      };
      for (let j = 0; j < Math.min(concurrency, participantCount); j++) {
        startNext();
      }
    });

    process.stdout.write('\n');

    if (errors.length > 0) {
      console.error(`\n${errors.length} participant(s) failed:`);
      for (const { index, error } of errors) {
        console.error(`  Participant ${index}: ${error}`);
      }
    }

    console.log(`Simulation complete. ${completed - errors.length}/${participantCount} participants simulated successfully.`);
  } finally {
    backend.kill();
    console.log('Backend stopped.');
  }
}
