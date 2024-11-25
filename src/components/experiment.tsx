/* eslint-disable @typescript-eslint/no-explicit-any */

import { now } from '../utils/common';
import { useEffect, useState } from 'react';

import Upload from './upload';
import Text from './text';
import Quest from './quest';
import MasterMindleWrapper from './mastermindlewrapper';
import MicrophoneCheck from './microphonecheck';

const componentMap = {
    Text,
    Quest,
    Upload,
    MicrophoneCheck,
    MasterMindleWrapper,
  };

// Function to transform experiment definition into components
const transformExperiment = (
    experimentDef: Array<{
      name: string;
      type: keyof typeof componentMap;
      props?: Record<string, any>;
    }>,
    next: (data: any) => void,
    data: any,
    progress: number,
  ) => {
    return experimentDef.map((def, index) => {
      const Component = componentMap[def.type];
  
      return (
        <div className='px-4 w-screen'>
          <div className='mt-4 sm:mt-12 max-w-2xl mx-auto flex-1 h-6 bg-gray-200 rounded-full overflow-hidden'>
            <div
              className={`h-full bg-gray-200 rounded-full duration-300 ${progress > 0 ? ' border-black border-2' : ''}`}
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
          {/* no type definitions for trial types at the moment, that will be a feature if we ever make this into a jspsych alternative */}
          {/* eslint-disable-next-line @typescript-eslint/ban-ts-comment */}
          {/* @ts-ignore */}
          <Component
            {...{
              key: index,
              next,
              data,
              ...def.props,
            }}
          />
        </div>
      );
    });
  };
  
  interface TrialData {
    index: number;
    type: string;
    name: string;
    data: object | undefined;
    start: number;
    end: number;
    duration: number;
  }
  
  export default function Experiment({timeline}: {timeline: any[]}) {
    const [trialCounter, setTrialCounter] = useState(0);
    const [data, setData] = useState<TrialData[]>([]);
    const [trialStartTime, setTrialStartTime] = useState(now());
  
    useEffect(() => {
      window.scrollTo(0, 0)
    }, [trialCounter])
  
    function next(newData?: object): void {
      const currentTime = now();
  
      // Get the current trial information from the experiment
      // no type definitions for trial types at the moment, that will be a feature if we ever make this into a jspsych alternative
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      //@ts-ignore
      const currentTrial: ExperimentTrial = timeline[trialCounter];
  
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
        //console.log([...data, trialData]);
        setData([...data, trialData]);
      }
  
      // Set the start time for the next trial
      setTrialStartTime(currentTime);
      setTrialCounter(trialCounter + 1);
    }
  
    // no type definitions for trial types at the moment, that will be a feature if we ever make this into a jspsych alternative
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    //@ts-ignore
    return transformExperiment(timeline, next, data, trialCounter / (timeline.length - 1))[
      trialCounter
    ];
  }