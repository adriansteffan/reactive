/* eslint-disable @typescript-eslint/no-explicit-any */

import '../index.css';
import { ExperimentConfig, Store, Param, now, getParam } from '../utils/common';
import { useCallback, useEffect, useMemo, useRef, useState, ComponentType } from 'react';
import {
  compileTimeline,
  advanceToNextContent,
  applyMetadata,
  TimelineItem,
  TrialResult,
  ComponentResultData,
} from '../utils/bytecode';
import {
  ParticipantState,
  SimulateFunction,
  resolveSimulation,
} from '../utils/simulation';
import { useHybridSimulationDisabled } from './experimentprovider';
import { ThemeContext, t } from '../utils/theme';
import { AudioDeviceContext } from '../utils/audiodevice';
import { v4 as uuidv4 } from 'uuid';

import Upload from './upload';
import Text from './text';
import PlainInput from './plaininput';
import ProlificEnding from './prolificending';
import Quest from './quest';
import EnterFullscreen from './enterfullscreen';
import ExitFullscreen from './exitfullscreen';
import MicrophoneCheck from './microphonecheck';
import RequestFilePermission from './mobilefilepermission';
import CanvasBlock from './canvasblock';
import CheckDevice from './checkdevice';

import VoicerecorderQuestionComponent from './voicerecorder';
import React from 'react';
import StoreUI from './storeui';
import { Tutorial } from './tutorial';
import { RandomDotKinematogram } from './randomdotkinetogram';
import VoiceRecording from './voicerecording';

type ComponentsMap = {
  [key: string]: ComponentType<any>;
};

const defaultComponents: ComponentsMap = {
  Text,
  ProlificEnding,
  EnterFullscreen,
  ExitFullscreen,
  Quest,
  Upload,
  MicrophoneCheck,
  PlainInput,
  RequestFilePermission,
  CanvasBlock,
  CheckDevice,
  StoreUI,
  Tutorial,
  RandomDotKinematogram,
  VoiceRecording,
};

const defaultCustomQuestions: ComponentsMap = {
  voicerecorder: VoicerecorderQuestionComponent,
};

interface RuntimeComponentContent {
  name?: string;
  type: string;
  csv?: string | string[];
  collectRefreshRate?: boolean;
  hideSettings?: string[] | boolean;
  metadata?:
    | Record<string, any>
    | ((data: TrialResult[], store: Store) => Record<string, any>);
  nestMetadata?: boolean;
  props?: Record<string, any> | ((data: TrialResult[], store: Store) => Record<string, any>);
  simulate?: SimulateFunction | boolean;
  simulators?: Record<string, any>;
}

// Register dev param globally so it appears in the settings screen
getParam('dev', false, 'boolean', 'Enable the developer inspector panel');

function isRuntimeComponentContent(content: any): content is RuntimeComponentContent {
  return typeof content === 'object' && content !== null && typeof content.type === 'string';
}

export default function ExperimentRunner({
  timeline,
  config = {
    showProgressBar: false,
  },
  components = {},
  questions = {},
  hybridParticipant,
  disableDev = false,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  simulationConfig: _simulationConfig,
}: {
  timeline: TimelineItem[];
  config?: ExperimentConfig;
  components?: ComponentsMap;
  questions?: ComponentsMap;
  hybridParticipant?: ParticipantState;
  /** Disable the ?dev=true inspector panel. Set to true for production. */
  disableDev?: boolean;
  /** Simulation config — not used at runtime, extracted by simulate.ts via createElement. */
  simulationConfig?: any;
}) {
  const disableHybridSimulation = useHybridSimulationDisabled();
  const trialByteCode = useMemo(() => {
    return compileTimeline(timeline);
  }, [timeline]);

  const dataRef = useRef<TrialResult[]>((() => {
    const urlParams: Record<string, any> = {};
    const searchParams = new URLSearchParams(window.location.search);
    for (const [key, value] of searchParams.entries()) {
      urlParams[key] = value;
    }

    const registry = Param.getRegistry() || [];

    const params: Record<string, any> = {};

    // First add URL params (these will be overwritten by registry entries if there are name collisions)
    for (const [key, value] of Object.entries(urlParams)) {
      params[key] = {
        value,
        registered: false,
        defaultValue: undefined,
        type: undefined,
        description: undefined,
      };
    }

    // Then add/overwrite with registry entries
    for (const param of registry) {
      params[param.name] = {
        value: param.value !== undefined ? param.value : urlParams[param.name],
        registered: true,
        defaultValue: param.defaultValue,
        type: param.type,
        description: param.description,
      };
    }

    const initialData: ComponentResultData = {
      index: -1,
      trialNumber: -1,
      start: now(),
      end: now(),
      duration: 0,
      type: '',
      name: '',
      responseData: {
        userAgent: navigator.userAgent,
        params,
      },
    };

    return [initialData];
  })());

  const [totalTrialsCompleted, setTotalTrialsCompleted] = useState(0);
  const lastTrialEndTimeRef = useRef(now());
  const experimentStoreRef = useRef<Store>({ _uploadId: uuidv4() });

  const [instructionPointer, setInstructionPointer] = useState(() =>
    advanceToNextContent(
      trialByteCode,
      0,
      () => experimentStoreRef.current,
      () => dataRef.current,
      (s) => { experimentStoreRef.current = { ...experimentStoreRef.current, ...s }; },
    )
  );

  const simulationMode =
    (!disableHybridSimulation && getParam('hybridSimulation', false, 'boolean'))
      ? 'hybrid' as const
      : 'none' as const;

  const participantRef = useRef<ParticipantState>(hybridParticipant || {});
  // Guards against duplicate simulation in React strict mode
  const lastSimulatedPointerRef = useRef(-1);

  const componentsMap = { ...defaultComponents, ...components };
  const customQuestionsMap: ComponentsMap = { ...defaultCustomQuestions, ...questions };

  const progress = useMemo(() => {
    const totalInstructions = trialByteCode.instructions.length;
    return totalInstructions > 0 ? instructionPointer / totalInstructions : 0;
  }, [instructionPointer, trialByteCode.instructions]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [instructionPointer]);

  function updateStore(update: Partial<Store>) {
    experimentStoreRef.current = { ...experimentStoreRef.current, ...update };
  }

  function next(
    componentResponseData?: object,
    actualStartTime?: number,
    actualEndTime?: number,
  ): void {
    const currentTime = now();
    const currentInstruction = trialByteCode.instructions[instructionPointer];

    // Use the provided startTime if available, otherwise use the lastTrialEndTimeRef
    const startTime = actualStartTime !== undefined ? actualStartTime : lastTrialEndTimeRef.current;

    const endTime = actualEndTime !== undefined ? actualEndTime : currentTime;

    if (currentInstruction?.type === 'ExecuteContent') {
      const content = currentInstruction.content;
      if (isRuntimeComponentContent(content)) {
        let trialData: ComponentResultData = {
          index: instructionPointer,
          trialNumber: totalTrialsCompleted + 1,
          start: startTime,
          end: endTime,
          duration: endTime - startTime,
          type: content.type,
          name: content.name ?? '',
          ...(content.csv !== undefined ? { csv: content.csv } : {}),
          responseData: componentResponseData,
        };

        trialData = applyMetadata(trialData, content, dataRef.current, experimentStoreRef.current);
        
        dataRef.current = [...dataRef.current, trialData];
        setTotalTrialsCompleted((prevCount) => prevCount + 1);
      } else {
        console.log(
          "ExecuteContent finished, but content wasn't standard component format:",
          content,
        );
      }
    }

    const nextPointer = advanceToNextContent(
      trialByteCode,
      instructionPointer + 1,
      () => experimentStoreRef.current,
      () => dataRef.current,
      (s) => updateStore(s),
    );
    if (nextPointer < trialByteCode.instructions.length) {
      lastTrialEndTimeRef.current = now();
    }
    setInstructionPointer(nextPointer);
  }

  const collectRefreshRate = useCallback((callback: (refreshRate: number | null) => void) => {
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
  }, []);

  const TimingWrapper: React.FC<{
    children: React.ReactNode;
    collectRefreshRate?: boolean;
  }> = ({ children, collectRefreshRate: shouldcollect }) => {
    const wrapperStartTimeRef = useRef<number | null>(null);
    const refreshRateRef = useRef<number | null>(null);

    useEffect(() => {
      wrapperStartTimeRef.current = now();

      if (shouldcollect) {
        const cleanup = collectRefreshRate((rate) => {
          refreshRateRef.current = rate;
          updateStore({ _reactiveScreenRefreshRate: rate });
        });

        return cleanup;
      }
    }, []);

    const childWithTimingProps = React.Children.map(children, (child) => {
      if (React.isValidElement(child)) {
        const interceptedNext = (
          responseData?: object,
          actualStartTime?: number,
          actualEndTime?: number,
        ) => {
          const currentTimeWrapper = now();

          // Use the timings provided by the component if available, otherwise use the one by the wrapper
          const startTime =
            actualStartTime !== undefined ? actualStartTime : wrapperStartTimeRef.current;
          const endTime = actualEndTime !== undefined ? actualEndTime : currentTimeWrapper;

          next(responseData, startTime ?? undefined, endTime ?? undefined);
        };

        return React.cloneElement(child, {
          ...child.props,
          next: interceptedNext,
        });
      }
      return child;
    });

    return <>{childWithTimingProps}</>;
  };

  const currentInstruction = trialByteCode.instructions[instructionPointer];

  const shouldSimulate = useMemo(() => {
    if (simulationMode === 'none') return false;
    if (currentInstruction?.type !== 'ExecuteContent') return false;
    const content = currentInstruction.content;
    if (!isRuntimeComponentContent(content)) return false;
    if (content.simulate === false) return false;
    return !!content.simulate || !!content.simulators;
  }, [instructionPointer, simulationMode, currentInstruction]);

  useEffect(() => {
    if (!shouldSimulate) return;
    if (lastSimulatedPointerRef.current === instructionPointer) return;
    lastSimulatedPointerRef.current = instructionPointer;

    (async () => {
      const content = (currentInstruction as any).content;
      const { trialProps, simulateFn, simulators } = resolveSimulation(content, dataRef.current, experimentStoreRef.current);

      const result = await simulateFn(
        trialProps,
        { data: dataRef.current, store: experimentStoreRef.current },
        simulators,
        participantRef.current,
      );

      participantRef.current = result.participantState;
      if (result.storeUpdates) updateStore(result.storeUpdates);
      next(result.responseData);
    })();
  }, [shouldSimulate, instructionPointer]);

  let componentToRender = null;
  if (currentInstruction?.type === 'ExecuteContent' && !shouldSimulate) {
    const content = currentInstruction.content;
    if (isRuntimeComponentContent(content)) {
      const Component = componentsMap[content.type];

      if (Component) {
        const componentProps =
          typeof content.props === 'function'
            ? content.props(dataRef.current, experimentStoreRef.current)
            : content.props || {};

        componentToRender = (
          <TimingWrapper key={instructionPointer} collectRefreshRate={content.collectRefreshRate}>
            <Component
              next={next}
              updateStore={updateStore}
              store={experimentStoreRef.current}
              data={dataRef.current}
              name={content.name}
              {...(content.type === 'Quest' ? { customQuestions: customQuestionsMap } : {})}
              {...componentProps}
            />
          </TimingWrapper>
        );
      } else {
        console.error(`No component found for type: ${content.type}`);
        componentToRender = <div>Error: Component type "{content.type}" not found.</div>;
      }
    } else {
      console.warn('ExecuteContent instruction does not contain standard component data:', content);
      componentToRender = <div>Non-component content encountered.</div>;
    }
  } else if (instructionPointer >= trialByteCode.instructions.length) {
    componentToRender = <></>;
  }

  const themeValue = config.theme ?? 'light';
  const th = t(themeValue);

  const showDev = !disableDev && getParam('dev', false, 'boolean');
  const devPanelRef = useRef<HTMLDivElement>(null);
  const devContent = currentInstruction?.type === 'ExecuteContent' ? currentInstruction.content : null;

  return (
    <ThemeContext.Provider value={themeValue}>
    <AudioDeviceContext.Provider value={experimentStoreRef.current.audioInputId}>
    <div className='w-full h-full'>
      <div
        className={` ${
          config.showProgressBar ? '' : 'hidden '
        } px-4 mt-4 sm:mt-12 max-w-2xl mx-auto`}
      >
        <div className={`flex-1 h-6 ${th.progressBg} rounded-full overflow-hidden`}>
        <div
          className={`h-full ${th.progressBg} rounded-full duration-300 ${
            progress > 0 ? ` border-black border-2` : ''
          }`}
          style={{
            width: `${progress * 100}%`,
            backgroundImage: `repeating-linear-gradient(
                            -45deg, ${th.progressStripe1}, ${th.progressStripe1} 10px, ${th.progressStripe2} 10px, ${th.progressStripe2} 20px
                        )`,
            transition: 'width 300ms ease-in-out',
          }}
        />
        </div>
      </div>
      {componentToRender}
      {showDev && (
        <>
          <button
            onClick={(e) => {
              const panel = devPanelRef.current;
              if (panel) {
                const open = panel.style.display === 'none';
                panel.style.display = open ? 'block' : 'none';
                (e.currentTarget as HTMLButtonElement).textContent = open ? '\u2715' : 'DEV';
              }
            }}
            className='fixed top-2 right-2 z-50 px-3 py-1 bg-white text-black text-xs font-bold border-2 border-black shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none cursor-pointer'
          >
            DEV
          </button>
          <div ref={devPanelRef} style={{ display: 'none' }} className='fixed top-10 right-2 z-50 w-96 max-h-[80vh] overflow-auto bg-white text-black text-xs font-mono border-2 border-black shadow-[4px_4px_0px_rgba(0,0,0,1)] p-3'>
            {devContent && <>
              <div className='font-bold mb-2 text-sm'>{(devContent as any).type} {(devContent as any).name ? `(${(devContent as any).name})` : ''}</div>
              <div className='mb-2'><span className='font-bold'>Props:</span><pre className='mt-1 whitespace-pre-wrap break-all'>{JSON.stringify(typeof (devContent as any).props === 'function' ? '(dynamic)' : (devContent as any).props, null, 2)}</pre></div>
              {(devContent as any).metadata && <div className='mb-2'><span className='font-bold'>Metadata:</span><pre className='mt-1 whitespace-pre-wrap break-all'>{JSON.stringify((devContent as any).metadata, null, 2)}</pre></div>}
              <div className='mb-2'><span className='font-bold'>Store:</span><pre className='mt-1 whitespace-pre-wrap break-all'>{JSON.stringify(experimentStoreRef.current, null, 2)}</pre></div>
              <div>
                <span className='font-bold cursor-pointer' onClick={(e) => {
                  const el = (e.currentTarget as HTMLElement).nextElementSibling as HTMLElement;
                  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
                }}>Data ({dataRef.current.length}) ▸</span>
                <pre style={{ display: 'none' }} className='mt-1 whitespace-pre-wrap break-all'>{JSON.stringify(dataRef.current, null, 2)}</pre>
              </div>
            </>}
          </div>
        </>
      )}
    </div>
    </AudioDeviceContext.Provider>
    </ThemeContext.Provider>
  );
}
