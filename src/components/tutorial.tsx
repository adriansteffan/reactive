import { useState, useRef, useEffect, useCallback, useContext, createContext, ReactNode } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'motion/react';
import { BaseComponentProps } from '../mod';
import { registerSimulation } from '../utils/simulation';
import { registerFlattener } from '../utils/upload';
import { useTheme, t } from '../utils/theme';

registerFlattener('Tutorial', null);

registerSimulation('Tutorial', (trialProps, _experimentState, simulators, participant) => {
  const slideCount = trialProps.slides?.length ?? 0;
  const slideData: Record<number, Record<string, unknown>> = {};
  let totalDuration = 0;
  for (let i = 0; i < slideCount; i++) {
    const result = simulators.respondToSlide(i, trialProps, participant);
    participant = result.participantState;
    slideData[i] = result.value ?? {};
    totalDuration += result.duration ?? 500;
  }
  return { responseData: { slides: slideData }, participantState: participant, duration: totalDuration };
}, {
  respondToSlide: (_slideIndex: number, _trialProps: any, participant: any) => ({
    value: {},
    participantState: participant,
    duration: 500,
  }),
});

interface TutorialSlideContextValue {
  setCanProgress: (canProgress: boolean) => void;
  autoAdvance: (delayMs?: number) => void;
  setSlideData: (data: Record<string, unknown>) => void;
}

const TutorialSlideContext = createContext<TutorialSlideContextValue>({
  setCanProgress: () => {},
  autoAdvance: () => {},
  setSlideData: () => {},
});

/**
 * Hook for interactive slide components.
 * Call with `{ locked: true }` to start with the next button disabled.
 * Then call `unlock()` when the interaction is complete.
 * Call `unlock({ autoAdvanceMs: 1000 })` to auto-advance after a delay.
 */
export const useTutorialSlide = ({ locked = false } = {}) => {
  const ctx = useContext(TutorialSlideContext);
  const initialized = useRef(false);
  if (!initialized.current && locked) {
    initialized.current = true;
    ctx.setCanProgress(false);
  }
  return {
    setData: ctx.setSlideData,
    unlock: ({ autoAdvanceMs }: { autoAdvanceMs?: number } = {}) => {
      ctx.setCanProgress(true);
      if (autoAdvanceMs !== undefined) ctx.autoAdvance(autoAdvanceMs);
    },
  };
};

export interface TutorialProps extends BaseComponentProps {
  slides: ReactNode[];
  /** Fade duration in seconds (default: 0.3) */
  fadeDuration?: number;
  finishText?: string;
  containerClass?: string;
  /** Key to go forward (default: 'ArrowRight', set to false to disable) */
  nextKey?: string | false;
  /** Key to go back (default: 'ArrowLeft', set to false to disable) */
  backKey?: string | false;
  /** Slide-down + fade-in entrance animation (default: false) */
  animate?: boolean;
  /** Color mode for dot indicators (default: 'light') */
  theme?: 'light' | 'dark';
}

const NAV_BTN_BASE =
  'px-4 py-3 border-2 font-bold text-lg rounded-xl transition-all duration-100 outline-none focus:outline-none focus:ring-0';

export const Tutorial = ({
  next,
  slides,
  fadeDuration = 0.3,
  finishText = 'Start',
  containerClass,
  animate = false,
  nextKey = 'ArrowRight',
  backKey = 'ArrowLeft',
  theme,
}: TutorialProps) => {
  const contextTheme = useTheme();
  const resolvedTheme = theme ?? contextTheme;
  const th = t(resolvedTheme);

  const NAV_BTN_ACTIVE = `${NAV_BTN_BASE} ${th.buttonBg} ${th.buttonText} ${th.buttonBorder} ${th.buttonShadow} cursor-pointer hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none`;
  const NAV_BTN_DISABLED = `${NAV_BTN_BASE} ${th.buttonDisabledBg} ${th.buttonDisabledText} ${th.buttonDisabledBorder} ${th.buttonDisabledShadow} cursor-default`;

  const [page, setPage] = useState(0);
  const [progressMap, setProgressMap] = useState<Record<number, boolean>>({});
  const autoAdvanceTimer = useRef<ReturnType<typeof setTimeout>>();
  const dataMap = useRef<Record<number, Record<string, unknown>>>({});

  const canProgress = progressMap[page] !== false;

  const prevCanProgress = useRef(canProgress);
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (canProgress && !prevCanProgress.current) {
      setPulse(true);
      const timer = setTimeout(() => setPulse(false), 300);
      return () => clearTimeout(timer);
    }
    prevCanProgress.current = canProgress;
  }, [canProgress]);

  const handleSetCanProgress = useCallback(
    (value: boolean) => {
      setProgressMap((prev) => ({ ...prev, [page]: value }));
    },
    [page],
  );

  const handleSetSlideData = useCallback(
    (data: Record<string, unknown>) => {
      dataMap.current[page] = { ...dataMap.current[page], ...data };
    },
    [page],
  );

  const goNext = useCallback(() => {
    if (page === slides.length - 1) next({ slides: dataMap.current });
    else setPage((p) => p + 1);
  }, [page, slides.length, next]);

  const goNextIfCan = useCallback(() => {
    if (!canProgress) return;
    goNext();
  }, [canProgress, goNext]);

  const handleAutoAdvance = useCallback(
    (delayMs = 0) => {
      if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current);
      autoAdvanceTimer.current = setTimeout(() => goNext(), delayMs);
    },
    [goNext],
  );

  useEffect(() => () => { if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current); }, []);

  const goBack = useCallback(() => {
    if (page > 0) setPage((p) => p - 1);
  }, [page]);

  useEffect(() => {
    if (nextKey === false && backKey === false) return;
    const onKey = (e: KeyboardEvent) => {
      if (nextKey && e.key === nextKey) { e.preventDefault(); goNextIfCan(); }
      if (backKey && e.key === backKey) { e.preventDefault(); goBack(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nextKey, backKey, goNextIfCan, goBack]);

  return (
    <LayoutGroup>
      <div
        className={`${containerClass ?? th.containerBg} ${animate ? 'animate-slide-down opacity-0' : ''}`}
        style={{
          width: '100vw',
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{ flex: 1, position: 'relative' }}>
          <AnimatePresence mode='popLayout'>
            <motion.div
              key={page}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: fadeDuration }}
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <TutorialSlideContext.Provider value={{ setCanProgress: handleSetCanProgress, autoAdvance: handleAutoAdvance, setSlideData: handleSetSlideData }}>
                {slides[page]}
              </TutorialSlideContext.Provider>
            </motion.div>
          </AnimatePresence>
        </div>

        <div
          style={{
            padding: '1.5rem 1.5rem 3rem',
            display: 'grid',
            gridTemplateColumns: '1fr auto 1fr',
            alignItems: 'center',
          }}
        >
          <div style={{ justifySelf: 'end', marginRight: '1rem' }}>
            <button
              onClick={goBack}
              className={NAV_BTN_ACTIVE}
              tabIndex={-1}
              onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') e.preventDefault(); }}
              style={{ visibility: page > 0 ? 'visible' : 'hidden' }}
            >
              ←
            </button>
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            {slides.map((_, i) => (
              <div
                key={i}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: i === page ? th.dotActive : th.dotInactive,
                  transition: 'background-color 0.2s',
                }}
              />
            ))}
          </div>

          <div style={{ justifySelf: 'start', marginLeft: '1rem' }}>
            <motion.button
              onClick={goNextIfCan}
              tabIndex={-1}
              onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') e.preventDefault(); }}
              animate={{ scale: pulse ? 1.2 : 1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 15 }}
              className={(canProgress ? NAV_BTN_ACTIVE : NAV_BTN_DISABLED) + (page === slides.length - 1 ? ' px-8' : '')}
            >
              {page === slides.length - 1 ? finishText : '→'}
            </motion.button>
          </div>
        </div>
      </div>
    </LayoutGroup>
  );
};
