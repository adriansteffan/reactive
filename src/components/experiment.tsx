/* eslint-disable @typescript-eslint/no-explicit-any */

import { ExperimentConfig, now } from '../utils/common';
import { useEffect, useRef, useState } from 'react';
import { ComponentType } from 'react';

// Default components
import Upload from './upload';
import Text from './text';
import ProlificEnding from './prolificending';
import Quest from './quest';
import EnterFullscreen from './enterfullscreen';
import ExitFullscreen from './exitfullscreen';
import MicrophoneCheck from './microphonecheck';

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
};

const defaultCustomQuestions = {
  voicerecorder: VoicerecorderQuestionComponent,
};

interface ExperimentTrial {
  name: string;
  type: string;
  props?: Record<string, any>;
}

interface TrialData {
  index: number;
  type: string;
  name: string;
  data: object | undefined;
  start: number;
  end: number;
  duration: number;
}

// Function to transform experiment definition into components
const transformExperiment = (
  experimentDef: ExperimentTrial[],
  index: number,
  next: (data: any) => void,
  data: any,
  componentsMap: ComponentsMap,
  customQuestions: ComponentsMap,
) => {
  if (index >= experimentDef.length) {
    return <></>;
  }

  const def = experimentDef[index];

  const Component = componentsMap[def.type];

  if (!Component) {
    throw new Error(`No component found for type: ${def.type}`);
  }

  return (
    <Component
      next={next}
      key={index}
      data={data}
      {...(def.type === 'Quest' ? { customQuestions: customQuestions } : {})}
      {...def.props}
    />
  );
};

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
  const [trialCounter, setTrialCounter] = useState(0);
  const [data, setData] = useState<TrialData[]>([]);
  const trialStartTimeRef = useRef(now());

  const componentsMap = { ...defaultComponents, ...components };
  const customQuestions: ComponentsMap = { ...defaultCustomQuestions, ...questions };

  const progress = trialCounter / (timeline.length - 1);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [trialCounter]);

  function next(newData?: object): void {
    const currentTime = now();
    const currentTrial = timeline[trialCounter];

    if (currentTrial && data) {
      const trialData: TrialData = {
        index: trialCounter,
        type: currentTrial.type,
        name: currentTrial.name,
        data: newData,
        start: trialStartTimeRef.current,
        end: currentTime,
        duration: currentTime - trialStartTimeRef.current,
      };
      setData([...data, trialData]);
    }

    trialStartTimeRef.current = currentTime;
    setTrialCounter(trialCounter + 1);
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
      {transformExperiment(timeline, trialCounter, next, data, componentsMap, customQuestions)}
    </div>
  );
}
