/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { Experiment, BaseComponentProps, ExperimentConfig } from 'reactive-psych';

const config: ExperimentConfig = { showProgressBar: true };

const CustomTrial = ({ next, maxCount }: BaseComponentProps & { maxCount: number }) => {
  const [count, setCount] = useState(0);

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
            next({});
          }
        }}
        className='mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors'
      >
        Count: {count}
      </button>
    </>
  );
};

const CustomQuestion = () => {
  return (
    <>
      <p>This is a custom question</p>
    </>
  );
};

const experiment = [
  {
    name: 'introtext',
    type: 'Text',
    props: {
      buttonText: "Let's Begin",
      animate: true,
      content: (
        <>
          <h1 className='text-4xl'>
            <strong>Hello ReactivePsych! </strong>
          </h1>
          <br />
          This is a basic text component. <br />
        </>
      ),
    },
  },
  {
    name: 'customtrial',
    type: 'CustomTrial',
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
  },
  {
    name: 'finaltext',
    type: 'Text',
    props: {
      content: <>Thank you for participating in our study, you can now close the browser window.</>,
    },
  },
];

export default function App() {
  return (
    <Experiment
      config={config}
      timeline={experiment}
      components={{CustomTrial}}
      questions={{CustomQuestion}}
    />
  );
}
