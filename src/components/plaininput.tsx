import { BaseComponentProps, type SimulatorArgs } from '../core/component';
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
  rows = 1,
  minLength = 1,
}: BaseComponentProps<{ value: string }> & {
  content?: React.ReactNode;
  /** The button that submits the answer. A one-line input can go without it (an empty text), since Enter submits. */
  buttonText?: string;
  className?: string;
  containerClass?: string;
  centered?: boolean;
  animate?: boolean;
  placeholder?: string;
  /** Keeps the button disabled until something is entered. */
  required?: boolean;
  /** The lines the input shows. With more than one, Enter starts a new line. */
  rows?: number;
  /** Keeps the button disabled until the answer has this many characters, without the spaces around it, and shows the count. */
  minLength?: number;
}) {
  const th = t(useTheme());
  const [inputValue, setInputValue] = useState('');
  const length = inputValue.trim().length;
  // An answer that is not required can be left empty, but not too short
  const canSubmit = length === 0 ? !required : length >= minLength;

  const inputProps = {
    value: inputValue,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setInputValue(e.target.value),
    placeholder,
  };
  const inputClass = `w-full px-4 py-3 border-2 ${th.inputBorder} ${th.inputBg} ${th.inputText} rounded-xl text-lg focus-visible:outline-1 ${th.focusOutline}`;

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

      <form onSubmit={handleSubmit} className={animate ? 'animate-slide-down opacity-0' : ''}>
      <div className='mt-8'>
        {rows > 1 ? (
          <textarea {...inputProps} rows={rows} className={`block leading-relaxed ${inputClass}`} />
        ) : (
          <input {...inputProps} type='text' className={inputClass} />
        )}
        {minLength > 1 && (
          <div className={`mt-2 text-sm text-right tabular-nums opacity-60 ${th.text}`}>
            {length} / {minLength} minimum characters
          </div>
        )}
      </div>

      {buttonText && (
        <div className='mt-8 flex justify-center'>
          <button
            type='submit'
            disabled={!canSubmit}
            className={th.button}
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
  simulate: async ({ props, simulators, participant }) => {
    const result = await simulators.respond({
      stimulus: { content: props.content, minLength: props.minLength ?? 1 },
      participant,
    });
    const typingDuration = String(result.response).length * uniform(50, 150);
    return {
      recorded: { value: result.response },
      participant: result.participant,
      durationMs: typingDuration,
    };
  },
  defaultSimulators: {
    respond: ({ stimulus }: SimulatorArgs<{ content: React.ReactNode; minLength: number }>) => ({
      response: 'simulated_input'.padEnd(stimulus.minLength, '_'),
    }),
  },
});
