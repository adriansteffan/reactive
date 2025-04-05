/* eslint-disable @typescript-eslint/no-explicit-any */

import { ExperimentConfig, Store, Param, now } from '../utils/common';
import { useCallback, useEffect, useMemo, useRef, useState, ComponentType } from 'react';
import {
  compileTimeline,
  TimelineItem,
  RefinedTrialData,
  ComponentResultData,
} from '../utils/bytecode';

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
};

const defaultCustomQuestions: ComponentsMap = {
  voicerecorder: VoicerecorderQuestionComponent,
};

interface RuntimeComponentContent {
  name?: string;
  type: string;
  collectRefreshRate?: boolean;
  hideSettings?: string[] | boolean;
  props?: Record<string, any> | ((store: Store, data: RefinedTrialData[]) => Record<string, any>);
}

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
}: {
  timeline: TimelineItem[];
  config?: ExperimentConfig;
  components?: ComponentsMap;
  questions?: ComponentsMap;
}) {
  const trialByteCode = useMemo(() => {
    return compileTimeline(timeline);
  }, [timeline]);

  const [instructionPointer, setInstructionPointer] = useState(0);
  const [data, setData] = useState<RefinedTrialData[]>(() => {
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
        value:
          param.value !== undefined ? param.value : urlParams[param.name],
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
  });

  const [totalTrialsCompleted, setTotalTrialsCompleted] = useState(0);
  const lastTrialEndTimeRef = useRef(now());
  const experimentStoreRef = useRef<Store>({});

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
        const trialData: ComponentResultData = {
          index: instructionPointer,
          trialNumber: totalTrialsCompleted + 1,
          start: startTime,
          end: endTime,
          duration: endTime - startTime,
          type: content.type,
          name: content.name ?? '',
          responseData: componentResponseData,
        };
        setData((prevData) => [...prevData, trialData]);
        setTotalTrialsCompleted((prevCount) => prevCount + 1);
      } else {
        console.log(
          "ExecuteContent finished, but content wasn't standard component format:",
          content,
        );
      }
    }

    let nextPointer = instructionPointer + 1;
    let foundNextContent = false;

    while (nextPointer < trialByteCode.instructions.length) {
      const nextInstruction = trialByteCode.instructions[nextPointer];

      switch (nextInstruction.type) {
        case 'IfGoto':
          if (nextInstruction.cond(experimentStoreRef.current, data)) {
            const markerIndex = trialByteCode.markers[nextInstruction.marker];
            if (markerIndex !== undefined) {
              nextPointer = markerIndex;
              continue;
            } else {
              console.error(`Marker ${nextInstruction.marker} not found`);
              nextPointer++;
            }
          } else {
            nextPointer++;
          }
          break;

        case 'UpdateStore':
          updateStore(nextInstruction.fun(experimentStoreRef.current, data));
          nextPointer++;
          break;

        case 'ExecuteContent':
          foundNextContent = true;
          lastTrialEndTimeRef.current = now();
          setInstructionPointer(nextPointer);
          return;

        default:
          console.error('Unknown instruction type encountered:', nextInstruction);
          nextPointer++;
          break;
      }
    }

    if (!foundNextContent) {
      setInstructionPointer(nextPointer);
    }
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

  let componentToRender = null;
  if (currentInstruction?.type === 'ExecuteContent') {
    const content = currentInstruction.content;
    if (isRuntimeComponentContent(content)) {
      const Component = componentsMap[content.type];

      if (Component) {
        const componentProps =
          typeof content.props === 'function'
            ? content.props(experimentStoreRef.current, data)
            : content.props || {};

        componentToRender = (
          <TimingWrapper key={instructionPointer} collectRefreshRate={content.collectRefreshRate}>
            <Component
              next={next}
              updateStore={updateStore}
              store={experimentStoreRef.current}
              data={data}
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

  return (
    <div className='w-full'>
      <div
        className={` ${
          config.showProgressBar ? '' : 'hidden '
        } px-4 mt-4 sm:mt-12 max-w-2xl mx-auto flex-1 h-6 bg-gray-200 rounded-full overflow-hidden`}
      >
        <div
          className={`h-full bg-gray-200 rounded-full duration-300 ${
            progress > 0 ? ' border-black border-2' : ''
          }`}
          style={{
            width: `${progress * 100}%`,
            backgroundImage: `repeating-linear-gradient(
                            -45deg, #E5E7EB, #E5E7EB 10px, #D1D5DB 10px, #D1D5DB 20px
                        )`,
            transition: 'width 300ms ease-in-out',
          }}
        />
      </div>
      {componentToRender}
    </div>
  );
}
