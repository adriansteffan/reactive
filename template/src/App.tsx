/* eslint-disable @typescript-eslint/no-explicit-any */
import { Experiment, shuffleArray } from 'reactive-psych';

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
            <strong>Welcome to our experiment!</strong>
          </h1>
          <br />
          In this study we will be investigating under which conditions people exert mental effort
          and which types of feedback can alter or encourage this. You will be taking part in five
          different variations of a game, each containing the same task but with different feedback
          methods. You will get a detailed explanation of the type of feedback you will be getting
          before each block, however the basic task remains the same. <br />
        </>
      ),
    },
  },
  {
    name: `TEST`,
    type: 'Quest',
    props: {
      surveyJson: {
        pages: [
          {
            elements: [
              {
                type: 'imagepicker',
                name: 'choosefeedback',
                title:
                  'If you could continue playing the game, which feedback option would you choose? (Placeholder images until we finalize on the design)',
                isRequired: true,
                imageWidth: 200,
                imageHeight: 150,
                showLabel: true,
                choices: [
                  {
                    value: '2',
                    imageLink: 'https://placehold.co/600x400/EEE/31343C',
                    text: 'A',
                  },
                  {
                    value: '3',
                    imageLink: 'https://placehold.co/600x400/EEE/31343C',
                    text: 'B',
                  },
                  {
                    value: '4',
                    imageLink: 'https://placehold.co/600x400/EEE/31343C',
                    text: 'C',
                  },
                  {
                    value: '5',
                    imageLink: 'https://placehold.co/600x400/EEE/31343C',
                    text: 'D',
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  },
  {
    name: 'miccheck',
    type: 'MicrophoneCheck',
  },
  ...shuffleArray([
    {
      feedbacktype: 5,
      text: (
        <>
          <h1 className='text-4xl mb-8'>
            <strong>Get ready!</strong>
          </h1>
          <p>
            Remember, to verify your guess, press "Check". You will then receive feedback on whether
            your guess was correct or, if not, which positions are correct (✓), which are incorrect
            (X), and which have a correct colour which is found in another spot (C). If you would
            like to skip the current color code to be guessed and instead be given a new one, please
            press "Skip".
          </p>
        </>
      ),
    },
  ]).flatMap((block: any, blockindex: number) => [
    {
      name: `blocktype${block.feedbacktype}_blockindex${blockindex}_mastermindle`,
      type: 'MasterMindleWrapper',
      props: {
        blockIndex: `${blockindex}`,
        feedback: block.feedbacktype,
        timeLimit: 120,
        maxGuesses: 8,
      },
    },
    {
      name: `blocktype${block.feedbacktype}_blockindex${blockindex}_survey`,
      type: 'Quest',
      props: {
        surveyJson: {
          pages: [
            {
              elements: [
                {
                  type: 'rating',
                  name: 'enjoyment',
                  title:
                    'Game completed! How much did you enjoy solving the tasks with this feedback variant?',
                  isRequired: true,
                  rateMin: 1,
                  rateMax: 6,
                  minRateDescription: 'Not at all',
                  maxRateDescription: 'Extremely',
                },
                {
                  type: 'voicerecorder',
                  name: 'senseofeffort',
                  title:
                    'Please describe how would design a question targetted at extracting: Sense of effort, qualitative question (Question Missing)',
                  isRequired: true,
                },
                {
                  type: 'voicerecorder',
                  name: 'strategyusage',
                  title: 'What strategy did you use the most in this block? (Yellow in doc)',
                  isRequired: true,
                },
                {
                  type: 'rating',
                  name: 'effortsu',
                  title: 'How effortful was the usage of this strategy?',
                  isRequired: true,
                  rateMin: 1,
                  rateMax: 6,
                  minRateDescription: 'Not at all',
                  maxRateDescription: 'Extremely',
                },
              ],
            },
          ],
        },
      },
    },
  ]),
  {
    name: 'upload',
    type: 'Upload',
  },
];

export default function App() {
  return <><Experiment timeline={experiment} /></>;
}
