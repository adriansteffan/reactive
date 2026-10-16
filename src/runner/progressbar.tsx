import { t, useTheme } from './theme';

/** How far the participant is through the timeline, from 0 to 1. */
export function ProgressBar({ progress }: { progress: number }) {
  const th = t(useTheme());
  return (
    <div className='px-4 mt-4 sm:mt-12 max-w-2xl mx-auto'>
      <div className={`flex-1 h-6 ${th.progressBg} rounded-full overflow-hidden`}>
        <div
          className={`h-full ${th.progressBg} rounded-full duration-300 ${progress > 0 ? 'border-black border-2' : ''}`}
          style={{
            width: `${progress * 100}%`,
            backgroundImage: `repeating-linear-gradient(-45deg, ${th.progressStripe1}, ${th.progressStripe1} 10px, ${th.progressStripe2} 10px, ${th.progressStripe2} 20px)`,
            transition: 'width 300ms ease-in-out',
          }}
        />
      </div>
    </div>
  );
}
