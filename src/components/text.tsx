import React, { useEffect, useRef } from 'react';
import { BaseComponentProps, now } from '../mod';

function Text({
  content,
  buttonText = 'Click me',
  className = '',
  next,
  animate = false,
  allowedKeys = false,
}: {
  content: React.ReactNode;
  buttonText?: string;
  onButtonClick?: () => void;
  className?: string;
  animate?: boolean;
  allowedKeys?: string[] | boolean;
} & BaseComponentProps) {
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    startTimeRef.current = now();

    const handleKeyPress = (event: KeyboardEvent) => {
      const keypressTime = now();

      const isKeyAllowed =
        allowedKeys === true || (Array.isArray(allowedKeys) && allowedKeys.includes(event.key));

      if (isKeyAllowed) {
        const reactionTime = keypressTime - startTimeRef.current;

        next({
          key: event.key,
          time: keypressTime,
          reactionTime: reactionTime,
        });
      }
    };

    if (allowedKeys) {
      window.addEventListener('keydown', handleKeyPress);
    }

    return () => {
      if (allowedKeys) {
        window.removeEventListener('keydown', handleKeyPress);
      }
    };
  }, [next, allowedKeys]);

  const handleClick = () => {
    const clickTime = now();

    const reactionTime = clickTime - startTimeRef.current;

    next({
      key: 'button',
      time: clickTime,
      reactionTime: reactionTime,
    });
  };

  return (
    <div className={`max-w-prose mx-auto ${className} mt-20 mb-20 px-4 `}>
      <article
        className={`prose prose-2xl prose-slate text-xl prose-a:text-blue-600 prose-a:underline prose-h1:text-4xl prose-h1:mb-10 prose-h1:font-bold prose-p:mb-4 prose-strong:font-bold text-black leading-relaxed
            ${animate ? 'animate-slide-down opacity-0' : ''}`}
      >
        {content}
      </article>

      {buttonText && (
        <div
          className={`mt-16 flex justify-center ${animate ? 'animate-fade-in opacity-0' : ''}`}
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

export default Text;
