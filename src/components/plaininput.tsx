import { BaseComponentProps } from '../mod';
import { useState } from 'react';
import { registerSimulation } from '../utils/simulation';
import { registerFlattener } from '../utils/upload';
import { uniform } from '../utils/distributions';
import { useTheme, t } from '../utils/theme';

registerFlattener('PlainInput', 'session');

registerSimulation('PlainInput', (trialProps, _experimentState, simulators, participant) => {
  const result = simulators.respond(trialProps, participant);
  const typingDuration = String(result.value).length * uniform(50, 150);
  return {
    responseData: { value: result.value },
    participantState: result.participantState,
    storeUpdates: trialProps.storeupdate ? trialProps.storeupdate(result.value) : undefined,
    duration: typingDuration,
  };
}, {
  respond: (_input: any, participant: any) => ({
    value: 'simulated_input',
    participantState: participant,
  }),
});

function PlainInput({
  content,
  buttonText = 'Click me',
  className = '',
  next,
  updateStore,
  animate = false,
  storeupdate,
  placeholder = 'Enter your response here',
}: BaseComponentProps & {
  content: React.ReactNode;
  buttonText?: string;
  onButtonClick?: () => void;
  className?: string;
  animate?: boolean;
  storeupdate?: (entry: string) => { [key: string]: any };
  placeholder?: string;
}) {
  const th = t(useTheme());
  const [inputValue, setInputValue] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const handleClick = () => {
    if (storeupdate) {
      updateStore(storeupdate(inputValue));
    }
    next({ value: inputValue });
  };

  return (
    <div className={`min-h-screen ${th.containerBg}`}>
    <div className={`max-w-prose mx-auto ${className} mt-20 mb-20 px-4 `}>
      <article
        className={`prose prose-2xl ${th.prose} text-xl ${th.proseLink} prose-a:underline prose-h1:text-4xl prose-h1:mb-10 prose-h1:font-bold prose-p:mb-4 prose-strong:font-bold ${th.text} leading-relaxed
              ${animate ? 'animate-slide-down opacity-0' : ''}`}
      >
        {content}
      </article>

      <div className={`mt-8 ${animate ? 'animate-slide-down opacity-0' : ''}`}>
        <input
          type='text'
          value={inputValue}
          onChange={handleChange}
          placeholder={placeholder}
          className={`w-full px-4 py-3 border-2 ${th.inputBorder} ${th.inputBg} ${th.inputText} rounded-xl text-lg focus:outline-none focus:ring-2 ${th.focusRing}`}
        />
      </div>

      {buttonText && (
        <div
          className={`mt-8 flex justify-center ${animate ? 'animate-fade-in opacity-0' : ''}`}
          style={animate ? { animationDelay: '1s' } : {}}
        >
          <button
            onClick={handleClick}
            className={`${th.buttonBg} cursor-pointer px-8 py-3 border-2 ${th.buttonBorder} font-bold ${th.buttonText} text-lg rounded-xl ${th.buttonShadow} hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none`}
          >
            {buttonText}
          </button>
        </div>
      )}
    </div>
    </div>
  );
}

export default PlainInput;
