import { BaseComponentProps } from '../core/component';
import { useState } from 'react';
import { defineComponent } from '../core/component';
import { uniform } from '../utils/distributions';
import { useTheme, t } from '../runner/theme';

function PlainInput({
  content,
  buttonText = 'Continue',
  className = '',
  containerClass,
  centered = true,
  next,
  animate = false,
  placeholder = 'Enter your response here',
  required = true,
}: BaseComponentProps<{ value: string }> & {
  content?: React.ReactNode;
  /** The button that submits the answer; an empty text shows none, and Enter submits. */
  buttonText?: string;
  className?: string;
  containerClass?: string;
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canSubmit) next({ value: inputValue });
  };

  return (
    <div className={`min-h-screen ${centered ? 'flex items-center justify-center' : ''} ${containerClass ?? th.containerBg}`}>
    <div className={`w-full max-w-prose mx-auto ${className} pt-20 pb-20 px-4 `}>
      <article
        className={`${th.article}
              ${animate ? 'animate-slide-down opacity-0' : ''}`}
      >
        {content}
      </article>

      <form onSubmit={handleSubmit}>
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
            type='submit'
            disabled={!canSubmit}
            className={
              canSubmit
                ? th.button
                : `px-8 py-3 border-2 font-bold text-lg rounded-xl ${th.buttonDisabledBg} ${th.buttonDisabledBorder} ${th.buttonDisabledText} ${th.buttonDisabledShadow} cursor-default`
            }
          >
            {buttonText}
          </button>
        </div>
      )}
      </form>
    </div>
    </div>
  );
}

export default defineComponent({
  name: 'PlainInput',
  component: PlainInput,
  session: true,
  simulate: ({ props, simulators, participant }) => {
    const result = simulators.respond({ props, participant });
    const typingDuration = String(result.value).length * uniform(50, 150);
    return {
      responseData: { value: result.value },
      participant: result.participant,
      durationMs: typingDuration,
    };
  },
  defaultSimulators: {
    respond: () => ({ value: 'simulated_input' }),
  },
});
