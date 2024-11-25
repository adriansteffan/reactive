interface ProseContainerProps {
    content: React.ReactNode;
    buttonText?: string;
    onButtonClick?: () => void;
    className?: string;
    next: (newData: object) => void;
    animate?: boolean; // new parameter
  }
  
  const Text: React.FC<ProseContainerProps> = ({
    content,
    buttonText = 'Click me',
    className = '',
    next,
    animate = false,
  }) => {
    const handleClick = () => {
      next({});
    };
  
    return (
      <div className={`max-w-prose mx-auto ${className} mt-20 mb-20`}>
        <article 
          className={`prose prose-2xl prose-slate text-xl prose-h1:text-5xl text-black leading-relaxed
            ${animate ? 'animate-slideDown opacity-0' : ''}`}
        >
          {content}
        </article>
  
        {buttonText && (
          <div 
            className={`mt-16 flex justify-center ${animate ? 'animate-fadeIn opacity-0' : ''}`} 
            style={animate ? { animationDelay: '1s' } : {}}
          >
            <button
              onClick={handleClick}
              className='bg-white px-8 py-3 border-2 border-black font-bold text-black text-lg rounded-xl shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none'
            >
              {buttonText}
            </button>
          </div>
        )}
      </div>
    );
  };
  
  export default Text;