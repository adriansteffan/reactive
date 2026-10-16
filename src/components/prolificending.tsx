import type { ReactNode } from 'react';
import { BaseComponentProps } from '../core/component';
import { useParams } from '../runner/contexts';
import Text from './text';
import { noopSimulate } from '../core/simulation';
import { defineComponent } from '../core/component';

const params = {
  cc: { default: '', description: 'Prolific completion code, used when the prolificCode prop is not set' },
};

const defaultContent = (code: string) => (
  <p>
    Thank you! Your data has been successfully submitted. <br /> You can go back to Prolific and
    enter the code {code} to finish the study. Alternatively, you can click on this link:{' '}
    <a
      target='_blank'
      rel='noopener noreferrer'
      className='text-blue-400'
      href={`https://app.prolific.com/submissions/complete?cc=${code}`}
    >
      Go to Prolific
    </a>
  </p>
);

function ProlificEnding({
  prolificCode,
  content = defaultContent,
  className,
  containerClass,
  centered,
  animate,
  data,
  store,
  updateStore,
}: {
  prolificCode?: string;
  /** The message, given the completion code. Prolific's completion link is https://app.prolific.com/submissions/complete?cc=<code>. */
  content?: (code: string) => ReactNode;
  className?: string;
  containerClass?: string;
  centered?: boolean;
  animate?: boolean;
} & BaseComponentProps) {
  const { cc } = useParams(params);

  const message = (
    <div className='flex flex-col items-center'>
      <svg className='w-12 h-12' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
        <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M5 13l4 4L19 7' />
      </svg>
      {content(prolificCode ?? cc)}
    </div>
  );

  return <Text data={data} store={store} updateStore={updateStore} className={className} containerClass={containerClass} centered={centered} animate={animate} content={message} buttonText='' next={() => {}} />;
}

export default defineComponent({
  name: 'ProlificEnding',
  component: ProlificEnding,
  csv: null,
  params,
  simulate: noopSimulate,
});
