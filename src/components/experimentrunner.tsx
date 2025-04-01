/* eslint-disable @typescript-eslint/no-explicit-any */

import { ExperimentConfig, Store } from '../utils/common';
import { useEffect, useMemo, useRef, useState, ComponentType } from 'react';
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
};

const defaultCustomQuestions: ComponentsMap = {
  voicerecorder: VoicerecorderQuestionComponent,
};

interface RuntimeComponentContent {
  name?: string;
  type: string;
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
  const [data, setData] = useState<RefinedTrialData[]>([]);
  const [totalTrialsCompleted, setTotalTrialsCompleted] = useState(0);
  const lastTrialEndTimeRef = useRef(performance.now());
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
    const currentTime = performance.now();
    const currentInstruction = trialByteCode.instructions[instructionPointer];

    // Use the provided startTime if available, otherwise use the lastTrialEndTimeRef
    const startTime = actualStartTime !== undefined ? actualStartTime : lastTrialEndTimeRef.current;

    const endTime = actualEndTime !== undefined ? actualEndTime : currentTime;

    if (currentInstruction?.type === 'ExecuteContent') {
      const content = currentInstruction.content;
      if (isRuntimeComponentContent(content)) {
        const trialData: ComponentResultData = {
          index: instructionPointer,
          trialNumber: totalTrialsCompleted,
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
          lastTrialEndTimeRef.current = performance.now();
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

  const TimingWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const wrapperStartTimeRef = useRef<number | null>(null);

    useEffect(() => {
      wrapperStartTimeRef.current = performance.now();
    }, []);

    const childWithTimingProps = React.Children.map(children, (child) => {
      if (React.isValidElement(child)) {
        const interceptedNext = (
          responseData?: object,
          actualStartTime?: number,
          actualEndTime?: number,
        ) => {
          const currentTimeWrapper = performance.now();

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
          <TimingWrapper key={instructionPointer}>
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
