import { BaseComponentProps } from '../core/component';
import { useState } from 'react';
import { defineComponent } from '../core/component';
import { uniform } from '../utils/distributions';
import { useTheme, t } from '../runner/theme';

function PlainInput({
  content,
  buttonText = 'Continue',
  className = '',
  centered = true,
  next,
  animate = false,
  placeholder = 'Enter your response here',
  required = true,
}: BaseComponentProps<{ value: string }> & {
  content?: React.ReactNode;
  buttonText?: string;
  className?: string;
  centered?: boolean;
  animate?: boolean;
  placeholder?: string;
  /** Keeps the button disabled until something is entered. */
  required?: boolean;
}) {
  const th = t(useTheme());
  const [inputValue, setInputValue] = useState('');
  const canSubmit = !required || inputValue.trim() !== '';

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const handleClick = () => {
    next({ value: inputValue });
  };

  return (
    <div className={`min-h-screen ${centered ? 'flex items-center justify-center' : ''} ${th.containerBg}`}>
    <div className={`w-full max-w-prose mx-auto ${className} pt-20 pb-20 px-4 `}>
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
          className={`w-full px-4 py-3 border-2 ${th.inputBorder} ${th.inputBg} ${th.inputText} rounded-xl text-lg focus:outline-none`}
        />
      </div>

      {buttonText && (
        <div
          className={`mt-8 flex justify-center ${animate ? 'animate-fade-in opacity-0' : ''}`}
          style={animate ? { animationDelay: '1s' } : {}}
        >
          <button
            onClick={handleClick}
            disabled={!canSubmit}
            className={`px-8 py-3 border-2 font-bold text-lg rounded-xl ${
              canSubmit
                ? `${th.buttonBg} ${th.buttonBorder} ${th.buttonText} ${th.buttonShadow} cursor-pointer hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none`
                : `${th.buttonDisabledBg} ${th.buttonDisabledBorder} ${th.buttonDisabledText} ${th.buttonDisabledShadow} cursor-default`
            }`}
          >
            {buttonText}
          </button>
        </div>
      )}
    </div>
    </div>
  );
}

export default defineComponent({
  name: 'PlainInput',
  component: PlainInput,
  csv: 'session',
  simulate: ({ props, simulators, participant }) => {
    const result = simulators.respond({ props, participant });
    const typingDuration = String(result.value).length * uniform(50, 150);
    return {
      responseData: { value: result.value },
      participantState: result.participantState,
      durationMs: typingDuration,
    };
  },
  defaultSimulators: {
    respond: () => ({ value: 'simulated_input' }),
  },
});
