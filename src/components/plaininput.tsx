import { BaseComponentProps } from '../mod';
import { useState } from 'react';

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
    <div className={`max-w-prose mx-auto ${className} mt-20 mb-20 px-4 `}>
      <article
        className={`prose prose-2xl prose-slate text-xl prose-a:text-blue-600 prose-a:underline prose-h1:text-4xl prose-h1:mb-10 prose-h1:font-bold prose-p:mb-4 prose-strong:font-bold text-black leading-relaxed
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
          className='w-full px-4 py-3 border-2 border-black rounded-xl text-lg focus:outline-none focus:ring-2 focus:ring-blue-500'
        />
      </div>

      {buttonText && (
        <div
          className={`mt-8 flex justify-center ${animate ? 'animate-fade-in opacity-0' : ''}`}
          style={animate ? { animationDelay: '1s' } : {}}
        >
          <button
            onClick={handleClick}
            className='bg-white cursor-pointer px-8 py-3 border-2 border-black font-bold text-black text-lg rounded-xl shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none'
          >
            {buttonText}
          </button>
        </div>
      )}
    </div>
  );
}

export default PlainInput;
