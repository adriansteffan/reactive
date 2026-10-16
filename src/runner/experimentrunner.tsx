import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { advanceToNextContent, type Bytecode } from '../core/bytecode';
import { freezeInDevelopment } from '../core/development';
import { type Experiment, type Session, startRun } from '../core/experiment';
import { urlParams } from '../core/params';
import { createInitialRow, createTrialRow, type TrialData } from '../core/rows';
import type { Store } from '../core/store';
import { type TimelineContext, createTimelineContext, resolve, type TrialContent } from '../core/timeline';
import { uuidv4 } from '../utils/ids';
import { now } from '../utils/time';
import { AudioDeviceContext, ParamsProvider } from './contexts';
import { DevPanel } from './devpanel';
import { FullscreenGuard } from './fullscreenguard';
import { ProgressBar } from './progressbar';
import { SettingsScreen } from './settingsscreen';
import { ThemeContext } from './theme';

function collectRefreshRate(callback: (refreshRate: number | null) => void) {
  let frameCount = 0;
  const startTime = now();
  const maxDuration = 20000;
  let rafId: number;
  let lastUpdateTime = startTime;
  const updateInterval = 1000;

  const calculateRefreshRate = () => {
    const currentTime = now();
    const elapsedTime = currentTime - startTime;
    if (elapsedTime > 0) {
      const refreshRate = Math.round((frameCount * 1000) / elapsedTime);
      return refreshRate;
    }
    return null;
  };

  const cleanup = () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
    }
  };

  const countFrames = (timestamp: number) => {
    frameCount++;
    const elapsedTime = timestamp - startTime;

    // Check if it's time for an update (once per second)
    if (timestamp - lastUpdateTime >= updateInterval) {
      callback(calculateRefreshRate());
      lastUpdateTime = timestamp;
    }

    if (elapsedTime < maxDuration) {
      rafId = requestAnimationFrame(countFrames);
    } else {
      cleanup();
      callback(calculateRefreshRate());
    }
  };

  rafId = requestAnimationFrame(countFrames);

  return cleanup;
}

type ExperimentBytecode = Bytecode<TrialContent, TimelineContext>;

// After a hot reload, finds the trial that was on screen in the rebuilt bytecode
function realign(
  previous: ExperimentBytecode,
  next: ExperimentBytecode,
  pointer: number,
  advance: (from: number) => number,
): number {
  const shown = previous.instructions[pointer];
  if (shown?.type === 'ExecuteContent' && shown.content.name !== undefined) {
    let best = -1;
    next.instructions.forEach((instruction, index) => {
      const same =
        instruction.type === 'ExecuteContent' &&
        instruction.content.type === shown.content.type &&
        instruction.content.name === shown.content.name;
      if (same && (best === -1 || Math.abs(index - pointer) < Math.abs(best - pointer))) best = index;
    });
    if (best !== -1) return best;
  }
  if (next.instructions[pointer]?.type === 'ExecuteContent') return pointer;
  return advance(Math.min(pointer, next.instructions.length));
}

// Switches given as environment variables arrive as text
function parseBooleanProp(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    return lower !== '' && lower !== 'false' && lower !== '0';
  }
  return !!value;
}

export default function ExperimentRunner({
  experiment,
  disableSettings,
  disableDev,
}: {
  experiment: Experiment<any>;
  /** Turns off the settings page at /settings. */
  disableSettings?: boolean | string;
  /** Turns off the ?dev=true inspector panel, which shows the store and all recorded data. */
  disableDev?: boolean | string;
}) {
  useEffect(() => {
    const preventSpaceScroll = (e: KeyboardEvent) => {
      if (
        e.key === ' ' &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target as HTMLElement).isContentEditable
      ) {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', preventSpaceScroll);
    return () => window.removeEventListener('keydown', preventSpaceScroll);
  }, []);

  const showSettings =
    !parseBooleanProp(disableSettings) && window.location.pathname.endsWith('/settings');

  return showSettings ? (
    <SettingsScreen experiment={experiment} />
  ) : (
    <Runner experiment={experiment} devDisabled={parseBooleanProp(disableDev)} />
  );
}

function Runner({ experiment, devDisabled }: { experiment: Experiment<any>; devDisabled: boolean }) {
  // Hot reloading renders this runner again with the edited experiment; the session keeps the
  // participant's params and build seed, so the rebuilt timeline matches the one they are in
  const sessionRef = useRef<Session | null>(null);
  const run = useMemo(() => {
    const started = startRun(experiment, { url: urlParams() }, sessionRef.current ?? undefined);
    sessionRef.current = started.session;
    return started;
  }, [experiment]);
  const { bytecode, trials } = run.compiled;

  const [initialData] = useState(() =>
    freezeInDevelopment([
      createInitialRow({ userAgent: navigator.userAgent, url: urlParams(), run, time: now() }),
    ]),
  );
  const dataRef = useRef<TrialData[]>(initialData);
  const storeRef = useRef<Store>(freezeInDevelopment({ __uploadId: uuidv4() }));

  const getContext = useCallback(() => createTimelineContext(dataRef.current, storeRef.current, trials), [trials]);
  const updateStore = useCallback((updates: Record<string, any>) => {
    storeRef.current = freezeInDevelopment({ ...storeRef.current, ...updates });
  }, []);

  const [totalTrialsCompleted, setTotalTrialsCompleted] = useState(0);
  // When the trial on screen started
  const trialStartRef = useRef(now());
  const [instructionPointer, setInstructionPointer] = useState(() =>
    advanceToNextContent(bytecode, 0, getContext, updateStore),
  );
  // The bytecode the pointer belongs to, until a hot reload replaces it
  const [pointerBytecode, setPointerBytecode] = useState(bytecode);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs whenever a new trial appears
  useEffect(() => {
    window.scrollTo(0, 0);
    trialStartRef.current = now();
  }, [totalTrialsCompleted]);

  const next = useCallback(
    (responseData?: unknown): void => {
      const instruction = bytecode.instructions[instructionPointer];
      if (instruction?.type === 'ExecuteContent') {
        const row = createTrialRow(
          instruction.content,
          {
            index: instructionPointer,
            trialNumber: totalTrialsCompleted + 1,
            startMs: trialStartRef.current,
            endMs: now(),
            responseData,
          },
          getContext(),
        );
        dataRef.current = freezeInDevelopment([...dataRef.current, row]);
        setTotalTrialsCompleted((count) => count + 1);
      }

      setInstructionPointer(advanceToNextContent(bytecode, instructionPointer + 1, getContext, updateStore));
      // The next trial's start, until it appears; a component that finishes while it appears keeps this
      trialStartRef.current = now();
    },
    [bytecode, instructionPointer, totalTrialsCompleted, getContext, updateStore],
  );

  const instruction = bytecode.instructions[instructionPointer];
  const content = instruction?.type === 'ExecuteContent' ? instruction.content : null;

  const measureRefreshRate = content?.collectRefreshRate;
  useEffect(() => {
    if (!measureRefreshRate) return;
    return collectRefreshRate((rate) => updateStore({ __screenRefreshRate: rate }));
  }, [measureRefreshRate, updateStore]);

  if (pointerBytecode !== bytecode) {
    setPointerBytecode(bytecode);
    setInstructionPointer(
      realign(pointerBytecode, bytecode, instructionPointer, (from) =>
        advanceToNextContent(bytecode, from, getContext, updateStore),
      ),
    );
    return null;
  }

  let componentToRender: ReactNode = null;
  if (content) {
    const Component = content.component;
    componentToRender = (
      <Component
        key={totalTrialsCompleted}
        next={next}
        updateStore={updateStore}
        store={storeRef.current}
        data={dataRef.current}
        {...resolve(content.props, getContext())}
        name={content.name}
      />
    );
  }

  return (
    <ThemeContext.Provider value={experiment.config?.theme ?? 'light'}>
      <AudioDeviceContext.Provider value={storeRef.current.__audioInputId}>
        <ParamsProvider value={run.session.params}>
          <div className='w-full h-full'>
            {experiment.config?.showProgressBar && (
              <ProgressBar progress={bytecode.instructions.length > 0 ? instructionPointer / bytecode.instructions.length : 0} />
            )}
            {componentToRender}
            <FullscreenGuard store={storeRef.current} />
            {!devDisabled && run.session.params.dev === true && (
              <DevPanel content={content} store={storeRef.current} data={dataRef.current} />
            )}
          </div>
        </ParamsProvider>
      </AudioDeviceContext.Provider>
    </ThemeContext.Provider>
  );
}
