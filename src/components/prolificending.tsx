import { BaseComponentProps, getParam } from '../utils/common';
import Text from '../components/text';

export default function ProlificEnding({
  prolificCode,
}: { prolificCode?: string } & BaseComponentProps) {
  let prolificCodeUsed = prolificCode ?? getParam('cc', undefined, 'string') ?? null;

  const content = (
    <div className='flex flex-col items-center'>
      <svg className='w-12 h-12' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
        <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M5 13l4 4L19 7' />
      </svg>
      <p className='text-center'>
        Thank you! Your data has been successfully submitted. <br /> You can go back to Prolific and
        enter the code {prolificCodeUsed} to finish the study. Alternatively, you can click on this
        link:{' '}
        <a
          target='_blank'
          className='text-blue-400'
          href={`https://app.prolific.com/submissions/complete?cc=${prolificCodeUsed}`}
        >
          Go to Prolific
        </a>
      </p>
    </div>
  );

  return <Text content={content} buttonText='' next={() => {}} />;
}
