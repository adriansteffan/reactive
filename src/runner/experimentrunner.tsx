import { type ReactNode, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  createRunState,
  type Experiment,
  realign,
  respond,
  type RunState,
  type KeptRun,
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

// Counts the frames the screen shows and reports their rate every second, for 20 seconds
function collectRefreshRate(callback: (refreshRate: number) => void) {
  const start = now();
  let frames = 0;
  let reported = start;
  let rafId = 0;
  const count = (timestamp: number) => {
    frames++;
    if (timestamp - reported >= 1000) {
      callback(Math.round((frames * 1000) / (timestamp - start)));
      reported = timestamp;
    }
    if (timestamp - start < 20_000) rafId = requestAnimationFrame(count);
  };
  rafId = requestAnimationFrame(count);
  return () => cancelAnimationFrame(rafId);
}

type RunEvent =
  | {
      type: 'respond';
      recorded: unknown;
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
  const showSettings =
    !parseBooleanProp(disableSettings) && window.location.pathname.endsWith('/settings');

  return showSettings ? (
    <SettingsScreen experiment={experiment} />
  ) : (
    <Runner experiment={experiment} devDisabled={parseBooleanProp(disableDev)} />
  );
}

function Runner({ experiment, devDisabled }: { experiment: Experiment<any>; devDisabled: boolean }) {
  // Space would scroll the participant's page, where it is often a response key
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

  // Hot reloading renders this runner again with the edited experiment, which keeps the participant's
  // params and build seed, so the rebuilt timeline matches the one they are in
  const keptRef = useRef<KeptRun | undefined>(undefined);
  const run = useMemo(() => {
    const started = startRun(experiment, { url: urlParams() }, keptRef.current);
    keptRef.current = started;
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: each trial starts at the top of the page
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [trialNumber]);

  const next = useCallback(
    (recorded?: unknown): void => {
      const start = trialStartRef.current;
      // A trial ends once; a later call, such as from a timer its component left running, is ignored
      if (start.trialNumber !== trialNumber) return;
      const storeUpdates = storeUpdatesRef.current;
      storeUpdatesRef.current = {};
      dispatch({ type: 'respond', recorded, storeUpdates, startMs: start.ms, endMs: now() });
      // The next trial starts as this one ends, also when its component ends it as soon as it appears
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
  const withinFullscreen = compiled.bytecode.fullscreen.some(([start, end]) => state.pointer >= start && state.pointer < end);
  return (
    <ThemeContext.Provider value={experiment.config?.theme ?? 'light'}>
      <AudioDeviceContext.Provider value={state.store.__audioInputId}>
        <ParamsProvider value={run.params}>
          <CompiledTimelineContext.Provider value={compiled}>
            <div className='w-full h-full'>
              <FullscreenGuard within={withinFullscreen}>
                {experiment.config?.showProgressBar && (
                  <ProgressBar progress={length > 0 ? state.pointer / length : 0} />
                )}
                {componentToRender}
              </FullscreenGuard>
              {!devDisabled && run.params.dev === true && (
                <DevPanel content={content} props={state.props} store={state.store} data={state.data} />
              )}
            </div>
          </CompiledTimelineContext.Provider>
        </ParamsProvider>
      </AudioDeviceContext.Provider>
    </ThemeContext.Provider>
  );
}
