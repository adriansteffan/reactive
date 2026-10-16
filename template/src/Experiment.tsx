import { useRef, useState } from 'react';
import {
  type BaseComponentProps,
  defineComponent,
  defineExperiment,
  PlainInput,
  sampleParticipants,
  Text,
  Upload,
} from '@adriansteffan/reactive';

// --- Custom Components ---

// A named function, so that hot reloading keeps the trial's state when this file changes
function CustomTrialView({
  next,
  maxCount,
}: BaseComponentProps<{ totalTimeMs: number; clicks: number }> & { maxCount: number }) {
  const [count, setCount] = useState(0);
  const startTime = useRef(performance.now());

  return (
    <>
      <h1 className='text-4xl'>
        <strong>Custom Component</strong>
      </h1>
      <br />
      This is a custom component. Click the button {maxCount} times to progress
      <br />
      <button
        type='button'
        onClick={() => {
          setCount(count + 1);
          if (count + 1 === maxCount) {
            next({ totalTimeMs: performance.now() - startTime.current, clicks: maxCount });
          }
        }}
        className='mt-4 px-4 py-2 bg-blue-500 text-white rounded-sm hover:bg-blue-600 transition-colors'
      >
        Count: {count}
      </button>
    </>
  );
}

const CustomTrial = defineComponent({
  name: 'CustomTrial',
  component: CustomTrialView,
  // The CSV file this component's data goes into, which a trial can change with .csv()
  csv: 'customtrial',
  // simulate replays the trial, asking the click simulator how fast the participant clicks
  simulate: ({ props, simulators, participant }) => {
    let totalTimeMs = 0;
    for (let i = 0; i < props.maxCount; i++) {
      const result = simulators.click({ props, participant });
      participant = result.participantState ?? participant;
      totalTimeMs += result.value;
    }
    return {
      responseData: { totalTimeMs, clicks: props.maxCount },
      participantState: participant,
      durationMs: totalTimeMs,
    };
  },
  defaultSimulators: {
    click: () => ({ value: 200 + Math.random() * 500 }),
  },
});

// --- Experiment ---

export default defineExperiment({
  config: { showProgressBar: true },
  simulation: {
    seed: 42,
    createParticipants: () =>
      sampleParticipants('sobol', 10, {
        needForCognition: { distribution: 'normal', mean: 3.5, sd: 0.8 },
      }).map((p) => ({ ...p, nickname: `participant_${p.index}` })),
  },
  timeline: [
    Text.trial('introtext', {
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
    }),

    PlainInput.trial('nickname', {
      content: <p>What is your nickname?</p>,
      buttonText: 'Submit',
      placeholder: 'Enter your nickname',
    }).simulators({
      respond: ({ participant }) => ({ value: participant.nickname }),
    }),

    CustomTrial.trial('customtrial', { maxCount: 5 }),

    Upload.trial('upload'),

    Text.trial('finaltext', ({ get }) => ({
      content: (
        <>
          Thank you for participating in our study, {get(PlainInput, 'nickname').value}. You can now
          close the browser window.
        </>
      ),
    })),
  ],
});
