/* eslint-disable @typescript-eslint/no-explicit-any */

import { now } from '../utils/common';
import { useEffect, useState } from 'react';
import { ComponentType } from 'react';

// Default components
import Upload from './upload';
import Text from './text';
import Quest from './quest';
import MasterMindleWrapper from './mastermindlewrapper';
import MicrophoneCheck from './microphonecheck';


type ComponentsMap = {
  [key: string]: ComponentType<any>;
};

// Default components map
const defaultComponents: ComponentsMap = {
  Text,
  Quest,
  Upload,
  MicrophoneCheck,
  MasterMindleWrapper,
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

interface ExperimentProps {
  timeline: ExperimentTrial[];
  components?: ComponentsMap;
}

// Function to transform experiment definition into components
const transformExperiment = (
  experimentDef: ExperimentTrial[],
  next: (data: any) => void,
  data: any,
  progress: number,
  componentsMap: ComponentsMap
) => {
  return experimentDef.map((def, index) => {
    // Look up component in provided components map
    const Component = componentsMap[def.type];

    if (!Component) {
      throw new Error(`No component found for type: ${def.type}`);
    }

    return (
      <div key={index} className='px-4 w-screen'>
        <div className='mt-4 sm:mt-12 max-w-2xl mx-auto flex-1 h-6 bg-gray-200 rounded-full overflow-hidden'>
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
        <Component
          next={next}
          data={data}
          {...def.props}
        />
      </div>
    );
  });
};

export default function Experiment({ timeline, components = {} }: ExperimentProps) {
  const [trialCounter, setTrialCounter] = useState(0);
  const [data, setData] = useState<TrialData[]>([]);
  const [trialStartTime, setTrialStartTime] = useState(now());

  const componentsMap = { ...defaultComponents, ...components };

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
        start: trialStartTime,
        end: currentTime,
        duration: currentTime - trialStartTime,
      };
      setData([...data, trialData]);
    }

    setTrialStartTime(currentTime);
    setTrialCounter(trialCounter + 1);
  }

  return transformExperiment(
    timeline,
    next,
    data,
    trialCounter / (timeline.length - 1),
    componentsMap
  )[trialCounter];
}