/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useRef } from 'react';
import { ExperimentRunner, BaseComponentProps, ExperimentConfig, registerSimulation, registerFlattener } from '@adriansteffan/reactive';


const config: ExperimentConfig = { showProgressBar: true };

// --- Custom Components ---

const CustomTrial = ({ next, maxCount }: BaseComponentProps & { maxCount: number }) => {
  const [count, setCount] = useState(0);
  const startTime = useRef(performance.now());

  return (
    <>
      <h1 className='text-4xl'>
        <strong>Custom Component</strong>
      </h1>
      <br />
      This is a custom component component. Click the button {maxCount} times to progress
      <br />
      <button
        onClick={() => {
          setCount(count + 1);
          if (count + 1 === maxCount) {
            next({ totalTime: performance.now() - startTime.current, clicks: maxCount });
          }
        }}
        className='mt-4 px-4 py-2 bg-blue-500 text-white rounded-sm hover:bg-blue-600 transition-colors'
      >
        Count: {count}
      </button>
    </>
  );
};

// Register a flattener to control how this trial's data appears in the CSV.
// 'customtrial' is the default CSV file name — override per-item with the csv field.
registerFlattener('CustomTrial', 'customtrial');

// Register a simulation for the custom trial.
// The decision function determines how fast the participant clicks.
// The simulate function uses the trial logic (clicking maxCount times) to produce response data.
registerSimulation('CustomTrial', (trialProps, _experimentState, simulators, participant) => {
  let totalTime = 0;
  for (let i = 0; i < (trialProps.maxCount || 1); i++) {
    const result = simulators.click(trialProps, participant);
    participant = result.participantState;
    totalTime += result.value;
  }
  return { responseData: { totalTime, clicks: trialProps.maxCount }, participantState: participant, duration: totalTime };
}, {
  click: (_trialProps: any, participant: any) => ({
    value: 200 + Math.random() * 500,
    participantState: participant,
  }),
});

const CustomQuestion = () => {
  return (
    <>
      <p>This is a custom question</p>
    </>
  );
};

// --- Timeline ---

export const experiment = [
  {
    name: 'introtext',
    type: 'Text',
    props: {
      buttonText: "Let's Begin",
      animate: true,
      content: (
        <>
          <h1 className='text-4xl'>
            <strong>Hello Reactive! </strong>
          </h1>
          <br />
          This is a basic text component. <br />
        </>
      ),
    },
  },
  {
    name: 'nickname',
    type: 'PlainInput',
    props: {
      content: <p>What is your nickname?</p>,
      buttonText: 'Submit',
      placeholder: 'Enter your nickname',
    },
    simulators: {
      respond: (_trialProps: any, participant: any) => ({
        value: participant.nickname,
        participantState: participant,
      }),
    },
  },
  {
    name: 'customtrial',
    type: 'CustomTrial',
    simulate: true,
    props: {
      maxCount: 5,
    },
  },
  {
    name: 'survey',
    type: 'Quest',
    props: {
      surveyJson: {
        pages: [
          {
            elements: [
              {
                type: 'rating',
                name: 'examplequestion',
                title: 'We can use all of the surveyjs components in the framework',
                isRequired: true,
                rateMin: 1,
                rateMax: 6,
                minRateDescription: 'Not at all',
                maxRateDescription: 'Extremely',
              },
              {
                title: 'Cutom Question',
                type: 'CustomQuestion',
              },
            ],
          },
        ],
      },
    },
  },
  {
    name: 'upload',
    type: 'Upload',
    props: {
      autoUpload: false,
    }
  },
  {
    name: 'finaltext',
    type: 'Text',
    props: {
      content: <>Thank you for participating in our study, you can now close the browser window.</>,
    },
  },
];

export default function Experiment() {
  return (
    <ExperimentRunner
      config={config}
      timeline={experiment}
      components={{CustomTrial}}
      questions={{CustomQuestion}}
      hybridParticipant={{ id: 0, nickname: 'test' }}
    />
  );
}

// --- Simulation config ---
// Define how simulated participants are generated.
// Each participant is an object whose properties are available in simulator decision functions.
export const simulationConfig = {
  participants: {
    generator: (i: number) => ({
      id: i,
      nickname: `participant_${i}`,
    }),
    count: 10,
  },
};