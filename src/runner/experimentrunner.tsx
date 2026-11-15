import { type ReactNode, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  createRunState,
  type Experiment,
  realign,
  respond,
  type RunState,
  type Session,
  startRun,
  trialAt,
} from '../core/experiment';
import { urlParams } from '../core/params';
import { createExperimentData } from '../core/rows';
import type { CompiledTimeline } from '../core/timeline';
import { uuidv4 } from '../utils/ids';
import { now } from '../utils/time';
import { AudioDeviceContext, CompiledTimelineContext, ParamsProvider } from './contexts';
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

type RunEvent =
  | {
      type: 'respond';
      responseData: unknown;
      storeUpdates: Record<string, any>;
      startMs: number;
      endMs: number;
    }
  | { type: 'rebuild'; previous: CompiledTimeline };

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

  const [state, dispatch] = useReducer(
    (state: RunState, event: RunEvent): RunState => {
      switch (event.type) {
        case 'respond':
          return respond(run.compiled, state, event);
        case 'rebuild':
          return realign(event.previous, run.compiled, state);
      }
    },
    null,
    () =>
      createRunState(
        run.compiled,
        createExperimentData({ userAgent: navigator.userAgent, url: urlParams(), run }),
        { __uploadId: uuidv4() },
      ),
  );
  // The timeline the state belongs to, until a hot reload replaces it
  const [compiled, setCompiled] = useState(run.compiled);

  const trialNumber = state.data.trials.length + 1;
  // When the trial on screen started, and which trial that is
  const trialStartRef = useRef({ trialNumber, ms: now() });
  // The changes the trial on screen made to the store, which take effect when it ends
  const storeUpdatesRef = useRef<Record<string, any>>({});

  useEffect(() => {
    window.scrollTo(0, 0);
    trialStartRef.current = { trialNumber, ms: now() };
  }, [trialNumber]);

  const next = useCallback(
    (responseData?: unknown): void => {
      const start = trialStartRef.current;
      // A trial ends once; a later call, such as from a timer its component left running, is ignored
      if (start.trialNumber !== trialNumber) return;
      const storeUpdates = storeUpdatesRef.current;
      storeUpdatesRef.current = {};
      dispatch({ type: 'respond', responseData, storeUpdates, startMs: start.ms, endMs: now() });
      // The next trial's start, until it appears; a component that finishes while it appears keeps this
      trialStartRef.current = { trialNumber: trialNumber + 1, ms: now() };
    },
    [trialNumber],
  );
  const updateStore = useCallback((updates: Record<string, any>) => {
    storeUpdatesRef.current = { ...storeUpdatesRef.current, ...updates };
  }, []);

  const content = trialAt(compiled, state.pointer);

  const measureRefreshRate = content?.collectRefreshRate;
  useEffect(() => {
    if (!measureRefreshRate) return;
    return collectRefreshRate((rate) => updateStore({ __screenRefreshRate: rate }));
  }, [measureRefreshRate, updateStore]);

  if (compiled !== run.compiled) {
    setCompiled(run.compiled);
    dispatch({ type: 'rebuild', previous: compiled });
    return null;
  }

  let componentToRender: ReactNode = null;
  if (content) {
    const Component = content.component;
    componentToRender = (
      <Component
        key={trialNumber}
        next={next}
        updateStore={updateStore}
        store={state.store}
        data={state.data}
        {...state.props}
        name={content.name}
      />
    );
  }

  const length = compiled.bytecode.instructions.length;
  return (
    <ThemeContext.Provider value={experiment.config?.theme ?? 'light'}>
      <AudioDeviceContext.Provider value={state.store.__audioInputId}>
        <ParamsProvider value={run.session.params}>
          <CompiledTimelineContext.Provider value={compiled}>
            <div className='w-full h-full'>
              <FullscreenGuard>
                {experiment.config?.showProgressBar && (
                  <ProgressBar progress={length > 0 ? state.pointer / length : 0} />
                )}
                {componentToRender}
              </FullscreenGuard>
              {!devDisabled && run.session.params.dev === true && (
                <DevPanel content={content ?? null} store={state.store} data={state.data} />
              )}
            </div>
          </CompiledTimelineContext.Provider>
        </ParamsProvider>
      </AudioDeviceContext.Provider>
    </ThemeContext.Provider>
  );
}
