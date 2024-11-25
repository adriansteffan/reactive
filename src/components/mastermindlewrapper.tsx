import { useEffect, useRef, useState } from 'react';
import { Bounce, toast } from 'react-toastify';
import Quest from './quest';
import { now } from '../utils/common';

const COLORS = {
  red: '#D81B60',
  blue: '#1E88E5',
  yellow: '#FFC107',
  green: '#01463A',
  grey: '#DADADA',
} as const;

type ColorKey = keyof typeof COLORS;
type Size = 8 | 10 | 12 | 14 | 16 | 20 | 24 | 28 | 32;

interface ColorOrbProps {
  color: ColorKey;
  /** Size in Tailwind units (8-32). Defaults to 12 */
  size?: Size;
  interactive?: boolean;
  pressed?: boolean;
  hoverborder?: boolean;
  onClick?: () => void;
}

type GuessResult = {
  color: ColorKey;
  status: 'correct' | 'wrong-position' | 'incorrect';
};

const ColorOrb: React.FC<ColorOrbProps> = ({
  color,
  size = 12,
  interactive = false,
  hoverborder = false,
  pressed = false,
  onClick,
}) => {
  const letter = color === 'grey' ? '?' : color[0].toUpperCase();

  const sizeClasses = {
    8: 'h-8 w-8 text-sm',
    10: 'h-10 w-10 text-base',
    12: 'h-12 w-12 text-lg',
    14: 'h-14 w-14 text-xl',
    16: 'h-16 w-16 text-xl',
    20: 'h-20 w-20 text-2xl',
    24: 'h-24 w-24 text-3xl',
    28: 'h-28 w-28 text-3xl',
    32: 'h-32 w-32 text-4xl',
  }[size];

  const handleInteraction = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault(); // Prevent double-firing on mobile devices
    onClick?.();
  };

  const handleTouchEnd = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
  };

  return (
    <div
      style={{
        backgroundColor: COLORS[color],
        color: color === 'grey' ? '#000000' : '#FFFFFF',
      }}
      className={`
        ${sizeClasses}
        rounded-full 
        flex items-center justify-center 
        font-bold
        border-2
        border-black
        
        ${interactive ? ' shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none cursor-pointer touch-manipulation' : `border-[${size / 8}px]`}
        ${pressed ? ' translate-x-[2px] translate-y-[2px] shadow-none' : ''}
        ${hoverborder ? ' hover:border-4 cursor-pointer' : ''}
      `}
      onClick={handleInteraction}
      onTouchStart={handleInteraction}
      onTouchEnd={handleTouchEnd}
    >
      {letter}
    </div>
  );
};

// to pass up to the next function
interface GuessData {
  index: number;
  colors: ColorKey[];
  results: GuessResult[];
  isCorrect: boolean;
  start: number;
  end: number;
  duration: number;
}

function useScreenWidth() {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const updateWidth = () => {
      setWidth(window.innerWidth);
    };

    updateWidth();
    window.addEventListener('resize', updateWidth);

    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  return width;
}

function MasterMindle({
  feedback,
  next,
  maxTime,
  timeLeft,
  maxGuesses,
  setTimeLeft,
  setQuitLastGame,
}: {
  feedback: 1 | 2 | 3 | 4 | 5;
  next: (data: object) => void;
  maxTime: number;
  timeLeft: number;
  maxGuesses: number;
  setTimeLeft: (time: number) => void;
  setQuitLastGame: (quit: boolean) => void;
}) {
  const [selectedColor, setSelectedColor] = useState<ColorKey | null>(null);
  const [currentGuess, setCurrentGuess] = useState<(ColorKey | null)[]>([null, null, null, null]);
  const [localTimeLeft, setLocalTimeLeft] = useState<number>(timeLeft);
  const [guessesLeft, setGuessesLeft] = useState<number>(maxGuesses - 1);
  const [roundOver, setRoundOver] = useState<boolean>(false);

  const [guessStartTime, setGuessStartTime] = useState<number>(now());
  const [accumulatedGuesses, setAccumulatedGuesses] = useState<GuessData[]>([]);
  const screenWidth = useScreenWidth();

  const warningShownRef = useRef(false);

  useEffect(() => {
    warningShownRef.current = false;
  }, [maxTime]);

  useEffect(() => {
    // Only start the timer if the round is not over
    if (roundOver) return;

    const timer = setInterval(() => {
      setLocalTimeLeft((prev) => {
        const newTime = Math.max(0, prev - 1);

        if (newTime === 30 && !warningShownRef.current) {
          warningShownRef.current = true;
          toast('30 seconds remaining!', {
            position: 'top-center',
            hideProgressBar: true,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: false,
            progress: undefined,
            theme: 'light',
            transition: Bounce,
            autoClose: 4000,
          });
        }

        return newTime;
      });
    }, 1000);

    // Cleanup timer when component unmounts or roundOver changes
    return () => clearInterval(timer);
  }, [roundOver, setLocalTimeLeft]);

  const [previousGuesses, setPreviousGuesses] = useState<
    { colors: ColorKey[]; results: GuessResult[] }[]
  >([]);

  const [solution] = useState<ColorKey[]>(() => {
    const colors = Object.keys(COLORS).filter((color) => color !== 'grey') as ColorKey[];
    return Array(4)
      .fill(null)
      .map(() => colors[Math.floor(Math.random() * colors.length)]);
  });

  // Add effect to scroll to bottom when previousGuesses changes
  const guessesContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (guessesContainerRef.current) {
      guessesContainerRef.current.scrollTop = guessesContainerRef.current.scrollHeight;
    }
  }, [previousGuesses]);

  const checkGuess = (guess: ColorKey[]): GuessResult[] => {
    // Count color frequencies in solution
    const solutionColorCounts = solution.reduce(
      (counts, color) => {
        counts[color] = (counts[color] || 0) + 1;
        return counts;
      },
      {} as Record<ColorKey, number>,
    );

    // First pass: Mark correct positions
    const results: GuessResult[] = guess.map((color, i) => {
      if (color === solution[i]) {
        solutionColorCounts[color]--;
        return { color, status: 'correct' as const };
      }
      return { color, status: 'incorrect' as const };
    });

    // Second pass: Check wrong positions
    guess.forEach((color, i) => {
      if (results[i].status === 'correct') return;
      if (solutionColorCounts[color] > 0) {
        results[i] = { color, status: 'wrong-position' as const };
      }
    });

    return results;
  };

  const handleCheck = () => {
    if (currentGuess.some((color) => color === null)) {
      toast('Please complete your guess!', {
        position: 'top-center',
        hideProgressBar: true,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: false,
        progress: undefined,
        theme: 'light',
        transition: Bounce,
      });

      return;
    }

    const currentTime = now();
    const guessResults = checkGuess(currentGuess as ColorKey[]);
    const isCorrect = guessResults.every((result) => result.status === 'correct');

    const guessData: GuessData = {
      index: previousGuesses.length,
      colors: currentGuess as ColorKey[],
      results: guessResults,
      isCorrect: isCorrect,
      start: guessStartTime,
      end: currentTime,
      duration: currentTime - guessStartTime,
    };

    setAccumulatedGuesses((prev) => [...prev, guessData]);

    setPreviousGuesses((prev) => [
      ...prev,
      {
        colors: currentGuess as ColorKey[],
        results: guessResults,
      },
    ]);

    setSelectedColor(null);

    if (isCorrect) {
      toast.success('You found the solution! Continue to the next trial.', {
        closeOnClick: true,
        transition: Bounce,
      });
      setSelectedColor(null);
      setRoundOver(true);
      return;
    }

    setGuessesLeft((prev) => prev - 1);
    if (guessesLeft == 0) {
      toast.error('Out of guesses! Continue to the next trial.', {
        closeOnClick: true,
        transition: Bounce,
      });
      setSelectedColor(null);
      setRoundOver(true);
    }

    if (localTimeLeft == 0) {
      toast.error('Out of time! Continue to the next trial.', {
        closeOnClick: true,
        transition: Bounce,
      });
      setSelectedColor(null);
      setRoundOver(true);
    }

    setCurrentGuess([null, null, null, null]);
    setGuessStartTime(currentTime);
  };

  const handleNext = (skipped: boolean) => {
    setTimeLeft(localTimeLeft);
    next({
      solution: solution,
      solved: accumulatedGuesses.some((guess: GuessData) => guess.isCorrect),
      skipped: skipped,
      timeLeft_s: timeLeft,
      guesses: accumulatedGuesses,
    });
  };

  return (
    <div className='mt-16 md:p-8 lg:mt-16 max-w-7xl h-[calc(100vh-230px)] lg:h-full w-fit mx-auto flex flex-col lg:flex-row xl:gap-x-12 lg:gap-x-8 justify-between lg:justify-center'>
      <div className='absolute inset-0 -z-10 h-full w-full bg-white bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px]'></div>

      {/* Action Buttons */}
      <div className='flex gap-6 xl:w-56 xl:px-12 lg:p-4 flex-row justify-center lg:justify-start lg:flex-col'>
        {!roundOver && (
          <button
            className='bg-white px-6 md:px-8 py-3 text-sm md:text-lg border-2 border-black font-bold rounded-full shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none'
            onClick={handleCheck}
          >
            CHECK
          </button>
        )}
        {!roundOver && (
          <button
            className='bg-white px-6 md:px-8 py-1 md:py-3 text-sm md:text-lg border-2 border-black font-bold rounded-full shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none'
            onClick={() => setCurrentGuess([null, null, null, null])}
          >
            CLEAR
          </button>
        )}
        {!roundOver && (
          <button
            className='bg-white px-6 md:px-8 py-1 md:py-3 text-sm md:text-lg border-2 border-black font-bold border-red-500 text-red-500 rounded-full shadow-[2px_2px_0px_rgba(239,68,68,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none'
            onClick={() => {
              setQuitLastGame(true);
              handleNext(true);
            }}
          >
            SKIP
          </button>
        )}
        {roundOver && (
          <button
            className='bg-white px-6 md:px-8 py-3 md:py-3 text-sm md:text-lg border-2 border-black font-bold text-black rounded-full shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none'
            onClick={() => {
              handleNext(false);
            }}
          >
            NEXT
          </button>
        )}
        
      </div>

      {/* Gameboard */}
      <div className='flex flex-col justify-between order-first items-center lg:order-none min-h-0'>
        <div className='space-y-4 -mt-8 sm:mt-0 md:space-y-8 flex-1'>
          {/* Timer */}
          <div className='flex justify-center items-center gap-6'>
            <div className='text-lg text-center sm:text-2xl font-bold w-20 sm:text-left'>
              {Math.floor(localTimeLeft / 60)}:{(localTimeLeft % 60).toString().padStart(2, '0')}
            </div>
          </div>
          {/* Current Guess Slots */}
          <div className='py-5 sm:py-10 md:p-10 rounded-lg'>
            <div className='flex gap-4 sm:gap-8 justify-center relative w-fit mx-auto'>
              <div className='absolute top-1/2 h-1 left-0 right-0 bg-gray-300 -z-10' />
              {currentGuess.map((color: ColorKey | null, index: number) => (
                <ColorOrb
                  key={index}
                  color={color ?? 'grey'}
                  size={screenWidth >= 600 ? 24 : 16}
                  hoverborder={selectedColor != null || (!!color && color !== 'grey')}
                  onClick={() => {
                    if (roundOver) {
                      return;
                    }
                    if (!selectedColor || selectedColor === 'grey') {
                      if (!!color && color != 'grey') {
                        setCurrentGuess((prevGuess) =>
                          prevGuess.map((color, i) => (i === index ? null : color)),
                        );
                        return;
                      }
                      toast('Please select a color first!', {
                        position: 'top-center',
                        hideProgressBar: true,
                        closeOnClick: true,
                        pauseOnHover: true,
                        draggable: false,
                        progress: undefined,
                        theme: 'light',
                        transition: Bounce,
                      });
                      return;
                    }

                    if (selectedColor === color) {
                      setCurrentGuess((prevGuess) =>
                        prevGuess.map((color, i) => (i === index ? null : color)),
                      );
                      return;
                    }

                    setCurrentGuess((prevGuess) =>
                      prevGuess.map((color, i) => (i === index ? selectedColor : color)),
                    );
                  }}
                />
              ))}
            </div>
          </div>

          {/* Previous Guesses */}
          <div
            ref={guessesContainerRef}
            className='space-y-6 md:p-4 lg:p-16 border-gray-400 h-[25vh] lg:h-[40vh] overflow-y-auto'
          >
            {previousGuesses.map((guess, rowNum) => (
              <div
                key={rowNum}
                className={`flex items-center gap-4 sm:gap-8 justify-center ${feedback == 3 ? 'flex-col sm:flex-row' : ''}`}
              >
                <div className='hidden sm:block w-4 sm:w-8 text-xl'>{rowNum + 1}</div>
                <div className='flex gap-2 sm:gap-4 flex-row items-center'>
                  <div className='w-4 sm:hidden sm:w-8 text-xl'>{rowNum + 1}</div>
                  {guess.colors.map((color, index) => (
                    <div key={index} className='flex flex-col items-center'>
                      <ColorOrb key={index} color={color} size={12} />
                      {feedback == 4 && (
                        <span>
                          {guess.results[index].status === 'correct' && '✓'}
                          {guess.results[index].status !== 'correct' && <>&nbsp;</>}
                        </span>
                      )}
                      {feedback == 5 && (
                        <span>
                          {guess.results[index].status == 'correct' && '✓'}
                          {guess.results[index].status == 'incorrect' && '✗'}
                          {guess.results[index].status == 'wrong-position' && 'C'}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                <div className='flex items-center gap-4 text-lg'>
                  {feedback == 1 && (
                    <span>
                      {guess.results.filter((result) => result.status !== 'correct').length == 0 ? (
                        <span className='font-bold text-blue-600'>✓</span>
                      ) : (
                        <span className='font-bold text-red-600'>✗</span>
                      )}
                    </span>
                  )}
                  {feedback == 2 && (
                    <>
                      <span className='font-bold text-blue-600'>✓</span>
                      <span>
                        {guess.results.filter((result) => result.status === 'correct').length}
                      </span>
                      <span className='font-bold text-red-600'>✗</span>
                      <span>
                        {guess.results.filter((result) => result.status !== 'correct').length}
                      </span>
                    </>
                  )}
                  {feedback == 3 && (
                    <>
                      <span className='font-bold text-blue-600'>✓</span>
                      <span>
                        {guess.results.filter((result) => result.status === 'correct').length}
                      </span>
                      <span className='font-bold text-red-600'>✗</span>
                      <span>
                        {guess.results.filter((result) => result.status === 'incorrect').length}
                      </span>
                      <span className='font-bold'>C</span>
                      <span>
                        {
                          guess.results.filter((result) => result.status === 'wrong-position')
                            .length
                        }
                      </span>
                    </>
                  )}
                  {feedback == 4 && (
                    <>
                      <span className='font-bold text-red-600'>✗</span>
                      <span>
                        {guess.results.filter((result) => result.status === 'incorrect').length}
                      </span>
                      <span className='font-bold'>C</span>
                      <span>
                        {
                          guess.results.filter((result) => result.status === 'wrong-position')
                            .length
                        }
                      </span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right Side - Color Selection */}
      <div className='lg:space-y-6 xl:px-8 flex flex-row justify-center gap-x-4 sm:gap-x-12 lg:gap-x-0 lg:justify-start lg:flex-col'>
        {(Object.keys(COLORS) as ColorKey[])
          .filter((color) => color !== 'grey')
          .map((color) => (
            <div key={color} className='flex items-center gap-4'>
              <ColorOrb
                color={color}
                size={16}
                interactive={selectedColor != color}
                pressed={selectedColor == color}
                onClick={() => {
                  if (roundOver) {
                    return;
                  }
                  if (selectedColor == color) {
                    setSelectedColor(null);
                    return;
                  }
                  setSelectedColor(color);
                }}
              />
              <span
                className={`hidden lg:inline uppercase text-lg ${selectedColor == color ? 'underline underline-offset-2' : ''}`}
              >
                {color}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}

interface MMTrialData {
  type: 'game' | 'survey';
  index: number;
  start: number;
  end: number;
  duration: number;
  data: object;
  quitLastGame?: boolean;
}

function MasterMindleWrapper({
  next,
  blockIndex,
  feedback,
  timeLimit = 120,
  maxGuesses = 10,
}: {
  next: (data: object) => void;
  blockIndex: number;
  feedback: 1 | 2 | 3 | 4 | 5;
  timeLimit: number;
  maxGuesses: number;
}) {
  const [gameState, setGameState] = useState<'game' | 'survey'>('game');
  const [timeLeft, setTimeLeft] = useState(timeLimit);
  const [trialStartTime, setTrialStartTime] = useState(now());
  const [accumulatedData, setAccumulatedData] = useState<MMTrialData[]>([]);
  const [quitLastGame, setQuitLastGame] = useState<boolean>(false);
  const [trialIndex, setTrialIndex] = useState(0);

  function switchGameState(newData: object) {
    const currentTime = now();

    const trialData: MMTrialData = {
      type: gameState,
      index: trialIndex,
      start: trialStartTime,
      end: currentTime,
      duration: currentTime - trialStartTime,
      data: newData,
    };

    if (gameState === 'survey' && timeLeft <= 0) {
      next({
        blockIndex: blockIndex,
        feedbacktype: feedback,
        timelimit_s: timeLimit,
        data: [...accumulatedData, trialData],
      });
      return;
    }

    setAccumulatedData((prev) => [...prev, trialData]);

    if (gameState === 'survey') {
      setQuitLastGame(false);
    }

    setTrialStartTime(currentTime);
    setTrialIndex((prev) => prev + 1);
    setGameState(gameState === 'survey' ? 'game' : 'survey');
  }

  if (gameState === 'survey') {
    return (
      <Quest
        next={switchGameState}
        surveyJson={{
          pages: [
            {
              elements: [
                {
                  type: 'rating',
                  name: 'intensityofeffort',
                  title: 'How effortful was guessing this combination for you?',
                  isRequired: true,
                  rateMin: 1,
                  rateMax: 6,
                  minRateDescription: 'Minimal Effort',
                  maxRateDescription: 'Maximum Effort',
                },
                ...(quitLastGame
                  ? [
                      {
                        type: 'voicerecorder',
                        name: 'whyskip',
                        title: 'Why did you chose to quit before you found the solution?',
                        isRequired: true,
                      },
                    ]
                  : [{}]),
              ],
            },
          ],
        }}
      />
    );
  }
  return (
    <MasterMindle
      feedback={feedback}
      next={switchGameState}
      maxTime={timeLimit}
      maxGuesses={maxGuesses}
      timeLeft={timeLeft}
      setTimeLeft={setTimeLeft}
      setQuitLastGame={setQuitLastGame}
    />
  );
}

export default MasterMindleWrapper;
