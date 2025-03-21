/* eslint-disable @typescript-eslint/no-explicit-any */

import { ExperimentConfig, now, Store, TrialData } from '../utils/common';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ComponentType } from 'react';

// Default components
import Upload from './upload';
import Text from './text';
import PlainInput from './plaininput';
import ProlificEnding from './prolificending';
import Quest from './quest';
import EnterFullscreen from './enterfullscreen';
import ExitFullscreen from './exitfullscreen';
import MicrophoneCheck from './microphonecheck';
import RequestFilePermission from './mobilefilepermission';

// Default Custom Questions
import VoicerecorderQuestionComponent from './voicerecorder';

type ComponentsMap = {
  [key: string]: ComponentType<any>;
};

// Default components map
const defaultComponents: ComponentsMap = {
  Text,
  ProlificEnding,
  EnterFullscreen,
  ExitFullscreen,
  Quest,
  Upload,
  MicrophoneCheck,
  PlainInput,
  RequestFilePermission
};

const defaultCustomQuestions = {
  voicerecorder: VoicerecorderQuestionComponent,
};

interface ComponentTrial {
  name: string;
  type: string;
  props?: Record<string, any> | ((store: Store, data: TrialData[]) => Record<string, any>);
}


// The | string parts need some refactoring in the future, but right now this prevents the consumer from having to write "as const" behind every type

interface MarkerTrial {
  type: 'MARKER' | string;
  id: string;
}

interface IfGotoTrial {
  type: 'IF_GOTO' | string;
  cond: (store: Store, data: TrialData[]) => boolean;
  marker: string;
}

interface UpdateStoreTrial {
  type: 'UPDATE_STORE' | string;
  fun: (store: Store, data: TrialData[]) => Store;
}

interface IfBlockTrial {
  type: 'IF_BLOCK' | string;
  cond: (store: Store, data: TrialData[]) => boolean;
  timeline: ExperimentTrial[];
}

interface WhileBlockTrial {
  type: 'WHILE_BLOCK' | string;
  cond: (store: Store, data: TrialData[]) => boolean;
  timeline: ExperimentTrial[];
}

type ExperimentTrial =
  | MarkerTrial
  | IfGotoTrial
  | UpdateStoreTrial
  | IfBlockTrial
  | WhileBlockTrial
  | ComponentTrial;

interface ComponentInstruction {
  type: 'Component';
  content: ComponentTrial;
}

interface IfGotoInstruction {
  type: 'IfGoto';
  cond: (store: Store, data: TrialData[]) => boolean;
  marker: string;
}

interface UpdateStoreInstruction {
  type: 'UpdateStore';
  fun: (store: Store, data: TrialData[]) => Store;
}

type BytecodeInstruction = ComponentInstruction | IfGotoInstruction | UpdateStoreInstruction;

const renderComponentTrial = (
  componentTrial: ComponentTrial,
  key: number,
  next: (data: any) => void,
  updateStore: (update: Store) => void,
  data: any,
  componentsMap: ComponentsMap,
  customQuestions: ComponentsMap,
  store: Store,
) => {
  const Component = componentsMap[componentTrial.type];

  if (!Component) {
    throw new Error(`No component found for type: ${componentTrial.type}`);
  }

  const componentProps =
    typeof componentTrial.props === 'function'
      ? componentTrial.props(store, data)
      : componentTrial.props || {};

  return (
    <Component
      next={next}
      updateStore={updateStore}
      key={key}
      data={data}
      {...(componentTrial.type === 'Quest' ? { customQuestions: customQuestions } : {})}
      {...componentProps}
    />
  );
};

function prefixUserMarkers(marker: string) {
  return `user_${marker}`;
}

let uniqueMarkerCounter = 0;
function generateUniqueMarker(prefix: string): string {
  return `${prefix}_auto_${uniqueMarkerCounter++}`;
}

function compileTimeline(timeline: ExperimentTrial[]): {
  instructions: BytecodeInstruction[];
  markers: { [key: string]: number };
} {
  const instructions: BytecodeInstruction[] = [];
  const markers: { [key: string]: number } = {};

  function processTimeline(trials: ExperimentTrial[]) {
    for (let i = 0; i < trials.length; i++) {
      const trial = trials[i];

      switch (trial.type) {
        case 'MARKER':
          markers[prefixUserMarkers((trial as MarkerTrial).id)] = instructions.length;
          break;

        case 'IF_GOTO':
          const ifgotoTrial = trial as IfGotoTrial;
          instructions.push({
            type: 'IfGoto',
            cond: ifgotoTrial.cond,
            marker: prefixUserMarkers(ifgotoTrial.marker),
          });
          break;

        case 'UPDATE_STORE':
          instructions.push({
            type: 'UpdateStore',
            fun: (trial as UpdateStoreTrial).fun,
          });
          break;

        case 'IF_BLOCK': {
          const ifBlockTrial = trial as IfBlockTrial;

          const endMarker = generateUniqueMarker('if_end');

          instructions.push({
            type: 'IfGoto',
            cond: (store, data) => !ifBlockTrial.cond(store, data), // Negate condition to skip if false
            marker: endMarker,
          });

          processTimeline(ifBlockTrial.timeline);

          markers[endMarker] = instructions.length;
          break;
        }

        case 'WHILE_BLOCK': {
          const whileBlockTrial = trial as WhileBlockTrial;

          const startMarker = generateUniqueMarker('while_start');
          const endMarker = generateUniqueMarker('while_end');

          markers[startMarker] = instructions.length;

          instructions.push({
            type: 'IfGoto',
            cond: (store, data) => !whileBlockTrial.cond(store, data),
            marker: endMarker,
          });

          processTimeline(whileBlockTrial.timeline);

          instructions.push({
            type: 'IfGoto',
            cond: () => true, // Always jump back
            marker: startMarker,
          });

          markers[endMarker] = instructions.length;
          break;
        }

        default:
          instructions.push({
            type: 'Component',
            content: trial as ComponentTrial,
          });
          break;
      }
    }
  }

  processTimeline(timeline);

  return { instructions, markers };
}

export default function Experiment({
  timeline,
  config = {
    showProgressBar: true,
  },
  components = {},
  questions = {},
}: {
  timeline: ExperimentTrial[];
  config?: ExperimentConfig;
  components?: ComponentsMap;
  questions?: ComponentsMap;
}) {
  const trialByteCode = useMemo(() => {
    return compileTimeline(timeline);
  }, [timeline]);

  const [trialCounter, setTrialCounter] = useState(0);
  const [totalTrialsCompleted, setTotalTrialsCompleted] = useState(0);
  const [data, setData] = useState<TrialData[]>([]);
  const trialStartTimeRef = useRef(now());
  const experimentStoreRef = useRef({});

  const componentsMap = { ...defaultComponents, ...components };
  const customQuestions: ComponentsMap = { ...defaultCustomQuestions, ...questions };

  const progress = trialCounter / (trialByteCode.instructions.length - 1);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [trialCounter]);

  function updateStore(update: Store) {
    const updatedStore = update;
    experimentStoreRef.current = { ...experimentStoreRef.current, ...updatedStore };
  }

  function next(newData?: object): void {
    const currentTime = now();
    const currentTrial = (trialByteCode.instructions[trialCounter] as ComponentInstruction).content;

    if (currentTrial && data) {
      const trialData: TrialData = {
        index: trialCounter,
        trialNumber: totalTrialsCompleted,
        type: currentTrial.type,
        name: currentTrial.name,
        data: newData,
        start: trialStartTimeRef.current,
        end: currentTime,
        duration: currentTime - trialStartTimeRef.current,
      };
      setData([...data, trialData]);
      setTotalTrialsCompleted(totalTrialsCompleted + 1);
    }

    let nextCounter = trialCounter + 1;
    let foundNextComponent = false;

    // Process control flow instructions until we find a Component or reach the end
    while (!foundNextComponent && nextCounter < trialByteCode.instructions.length) {
      const nextInstruction = trialByteCode.instructions[nextCounter];

      switch (nextInstruction.type) {
        case 'IfGoto':
          if (nextInstruction.cond(experimentStoreRef.current, data)) {
            const markerIndex = trialByteCode.markers[nextInstruction.marker];
            if (markerIndex !== undefined) {
              nextCounter = markerIndex;
            } else {
              console.error(`Marker ${nextInstruction.marker} not found`);
              nextCounter++;
            }
          } else {
            nextCounter++;
          }
          break;

        case 'UpdateStore':
          updateStore(nextInstruction.fun(experimentStoreRef.current, data));
          nextCounter++;
          break;

        case 'Component':
          foundNextComponent = true;
          break;

        default: // Unknown, skip
          nextCounter++;
      }
    }

    trialStartTimeRef.current = now();
    setTrialCounter(nextCounter);
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
          -45deg,
          #E5E7EB,
          #E5E7EB 10px,
          #D1D5DB 10px,
          #D1D5DB 20px
        )`,
            transition: 'width 300ms',
          }}
        />
      </div>
      {trialCounter < trialByteCode.instructions.length &&
        trialByteCode.instructions[trialCounter].type === 'Component' &&
        renderComponentTrial(
          (trialByteCode.instructions[trialCounter] as ComponentInstruction).content,
          totalTrialsCompleted,
          next,
          updateStore,
          data,
          componentsMap,
          customQuestions,
          experimentStoreRef.current, // Pass the current store
        )}
    </div>
  );
}
