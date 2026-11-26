import { type ReactNode, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { type BaseComponentProps, defineComponent, type SimulatorArgs } from '../core/component';
import { t, useTheme } from '../runner/theme';
import { uniform } from '../utils/distributions';
import { type ResponseKey, responseKey } from '../utils/keys';

/** What a card shows: a number or a text, which the data records as it is. */
export type Outcome = number | string;

interface DeckLook {
  /** What the deck's face shows; the deck's name by default. */
  label?: ReactNode;
  /** The background of the deck and its cards, any CSS color; white by default. */
  color?: string;
  /** The color of the deck's label and of the outcomes on its cards; black by default. */
  textColor?: string;
  /** A key that draws from the deck, a letter in either case. */
  key?: ResponseKey;
}

export type SamplingDeck = DeckLook & {
  /** The outcomes, drawn in this order, or a function that gives each draw's outcome. */
  outcomes: readonly Outcome[] | (() => Outcome);
};

export type ChoiceDeck = DeckLook & {
  /** What choosing the deck gives, shown on a card after the choice; a function draws it then. */
  outcome?: Outcome | (() => Outcome);
};

interface TableProps {
  /** Clicking a deck draws from it or chooses it. With `false`, only the decks' keys do. Defaults to `true`. */
  click?: boolean;
  /** What a card shows for its outcome; the outcome itself by default. */
  formatOutcome?: (outcome: Outcome) => ReactNode;
  /** `'wide'` lays each card down on the side of the deck it came from. Defaults to `'compact'`. */
  layout?: 'compact' | 'wide';
  /** Deals the decks onto the screen. Defaults to `true`. */
  animate?: boolean;
}

/** One card drawn from a deck. */
export type DeckDraw = {
  deck: string;
  outcome: Outcome;
  /** Where in the deck's outcomes the card came from, counted from 0. */
  position: number;
  /** With `showForgone`, the other deck's outcome at the same position, which the participant saw but did not get. */
  forgone?: Outcome;
  /** The key that drew it, or `null` for a click. */
  key: string | null;
  /** Since the decks took draws again: since they appeared, or since the outcome and pause after the draw before. */
  reactionTimeMs: number;
};

export type DeckChoiceData = {
  choice: string;
  /** The key that chose, or `null` for a click. */
  key: string | null;
  reactionTimeMs: number;
  /** What the chosen deck gave, or `null` for a deck without an outcome. */
  outcome: Outcome | null;
};

// --- Drawing, shared by the browser and the simulation ---

// Paired decks share one position, which every draw moves on; otherwise each deck keeps its own
function nextPosition(draws: readonly DeckDraw[], deck: string, paired: boolean) {
  return paired ? draws.length : draws.filter((draw) => draw.deck === deck).length;
}

function outcomeAt({ outcomes }: SamplingDeck, position: number) {
  return typeof outcomes === 'function' ? outcomes() : outcomes[position];
}

function drawCard(
  decks: Record<string, SamplingDeck>,
  draws: readonly DeckDraw[],
  deck: string,
  paired: boolean,
  showForgone: boolean,
) {
  const position = nextPosition(draws, deck, paired);
  const card = { deck, outcome: outcomeAt(decks[deck], position), position };
  if (!showForgone) return card;
  const [other] = Object.keys(decks).filter((name) => name !== deck);
  return { ...card, forgone: outcomeAt(decks[other], position) };
}

/** Whether a deck's list has run out, which ends the sampling. */
function ranOut(decks: Record<string, SamplingDeck>, draws: readonly DeckDraw[], paired: boolean) {
  return Object.entries(decks).some(
    ([name, { outcomes }]) => typeof outcomes !== 'function' && nextPosition(draws, name, paired) >= outcomes.length,
  );
}

function chosenOutcome({ outcome }: ChoiceDeck): Outcome | null {
  if (outcome === undefined) return null;
  return typeof outcome === 'function' ? outcome() : outcome;
}

function checkDecks(component: string, decks: Record<string, DeckLook>, click: boolean | undefined) {
  const names = Object.keys(decks);
  if (names.length !== 2) return `A ${component} takes two decks, but has ${names.length}.`;
  if (click === false && names.some((name) => decks[name].key === undefined)) {
    return `A ${component} with click: false needs a key for each deck, since its decks could not be drawn from otherwise.`;
  }
  const [first, second] = names.map((name) => decks[name].key?.toLowerCase());
  if (first !== undefined && first === second) {
    return `The ${component}'s decks '${names[0]}' and '${names[1]}' share the key '${first}', so only one of them can be drawn from.`;
  }
  return undefined;
}

// --- The table: the decks, the card between them, and the button below ---

const KEY_LABELS: Record<string, string> = {
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  arrowdown: '↓',
  ' ': 'Space',
  enter: '↵',
};
const keyLabel = (key: string) => KEY_LABELS[key.toLowerCase()] ?? key.toLowerCase();

// The cards under the top one, offset so the deck looks stacked, dealt one after another
const CARD_LAYERS = [
  { offset: 'translate-x-[8px] translate-y-[8px]', delay: 0 },
  { offset: 'translate-x-[4px] translate-y-[4px]', delay: 0.1 },
  { offset: '', delay: 0.2 },
];

type Colors = { color: string; textColor: string };

function colorsOf(look: DeckLook): Colors {
  return { color: look.color ?? 'white', textColor: look.textColor ?? 'black' };
}

function Deck({
  label,
  colors,
  side,
  onClick,
  animate,
}: {
  label: ReactNode;
  colors: Colors;
  side: 'left' | 'right';
  onClick: ((timeStamp: number) => void) | undefined;
  animate: boolean;
}) {
  return (
    <div className='relative w-44 h-60'>
      {CARD_LAYERS.map((layer, i) => {
        const deal = animate
          ? {
              initial: { y: -400, x: side === 'left' ? -300 : 300, rotate: side === 'left' ? -20 : 20, opacity: 0 },
              animate: { y: 0, x: 0, rotate: 0, opacity: 1 },
              transition: { delay: layer.delay, duration: 0.5, ease: [0.23, 1, 0.32, 1] as const },
            }
          : {};
        if (i < CARD_LAYERS.length - 1) {
          return (
            <motion.div
              key={i}
              className={`absolute inset-0 border-2 border-black rounded-xl ${layer.offset}`}
              style={{ backgroundColor: colors.color }}
              {...deal}
            />
          );
        }
        return (
          <motion.div key={i} className='absolute inset-0' {...deal}>
            <button
              type='button'
              tabIndex={-1}
              disabled={!onClick}
              onClick={(event) => onClick?.(event.timeStamp)}
              className={`relative z-10 w-44 h-60 border-2 border-black rounded-xl flex items-center justify-center select-none transition-transform duration-150 ${onClick ? 'cursor-pointer hover:-translate-y-1.5' : ''}`}
              style={{ backgroundColor: colors.color }}
            >
              <div className='absolute inset-2 border-2 border-black rounded-lg pointer-events-none' />
              <span className='relative text-3xl font-besley font-bold' style={{ color: colors.textColor }}>
                {label}
              </span>
            </button>
          </motion.div>
        );
      })}
    </div>
  );
}

type Card = { deck: string; outcome: Outcome; id: number; forgone?: boolean };

function Table({
  heading,
  decks,
  onDeck,
  cards,
  hiddenDecks = [],
  emptyMiddle,
  button,
  click = true,
  formatOutcome = String,
  layout = 'compact',
  animate = true,
}: TableProps & {
  heading: ReactNode;
  decks: Record<string, DeckLook>;
  /** Draws from or chooses a deck, or `undefined` while the decks take none. */
  onDeck: ((deck: string, key: string | null, timeStamp: number) => void) | undefined;
  cards: Card[];
  hiddenDecks?: string[];
  /** Shown between the decks while there is no card. */
  emptyMiddle: ReactNode;
  button: ReactNode;
}) {
  const th = t(useTheme());
  const names = Object.keys(decks);
  const wide = layout === 'wide';

  // The handler of the latest render, so a key press always sees the current state
  const onDeckRef = useRef(onDeck);
  onDeckRef.current = onDeck;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || !onDeckRef.current) return;
      const deck = Object.keys(decks).find((name) => {
        const { key } = decks[name];
        return key !== undefined && responseKey([key], event.key) !== undefined;
      });
      if (deck === undefined) return;
      event.preventDefault();
      onDeckRef.current(deck, decks[deck].key ?? null, event.timeStamp);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [decks]);

  return (
    <div className={`min-h-screen flex flex-col items-center justify-center p-8 overflow-hidden ${th.containerBg}`}>
      <h2 className={`text-2xl font-bold ${th.text} mb-16 text-center`}>{heading}</h2>

      <div className={`flex items-center justify-center ${wide ? 'gap-4' : 'gap-12'}`}>
        {names.map((name, index) => {
          const deck = decks[name];
          const side = index === 0 ? 'left' : 'right';
          return (
            <motion.div
              key={name}
              animate={{ opacity: hiddenDecks.includes(name) ? 0 : 1 }}
              transition={{ duration: 0.4 }}
              className={`flex items-center ${wide ? 'gap-4' : 'gap-12'}`}
              style={{ order: index * 2, flexDirection: side === 'left' ? 'row' : 'row-reverse' }}
            >
              {deck.key !== undefined && (
                <span
                  className={`px-3.5 py-1.5 bg-white border-2 border-black rounded-lg font-bold text-lg select-none shadow-[0_3px_0_-2px_white,0_3px_0_0px_black] transition-opacity duration-400 ${onDeck ? '' : 'opacity-0'}`}
                >
                  {keyLabel(deck.key)}
                </span>
              )}
              <Deck
                label={deck.label ?? name}
                colors={colorsOf(deck)}
                side={side}
                onClick={click && onDeck ? (timeStamp) => onDeck(name, null, timeStamp) : undefined}
                animate={animate}
              />
            </motion.div>
          );
        })}

        {/* mt-[8px] lines the card up with the top card of a deck, which its stack lifts by 8px */}
        <div className={`${wide ? 'w-[24rem]' : 'w-44'} h-60 flex items-center justify-center relative mt-[8px]`} style={{ order: 1 }}>
          {cards.length === 0 && emptyMiddle}
          <AnimatePresence>
            {cards.map((card) => {
              const index = names.indexOf(card.deck);
              const colors = colorsOf(decks[card.deck]);
              // Next to a forgone outcome, which is faded, the card the participant got has a thicker border
              const opacity = card.forgone ? 0.3 : 1;
              const raised = !card.forgone && cards.some((other) => other.forgone);
              return (
                <motion.div
                  key={`${card.id}-${card.deck}`}
                  className={`${wide ? 'w-44 h-60 absolute top-0' : 'absolute inset-0'} ${raised ? 'border-4' : 'border-2'} border-black rounded-xl flex items-center justify-center select-none`}
                  style={{ backgroundColor: colors.color }}
                  initial={{ opacity, x: index === 0 ? -200 : 200, scale: 0.8 }}
                  // In the wide layout, a card lands on the side of its deck
                  animate={{ opacity, x: wide ? (index === 0 ? -96 : 96) : 0, scale: 1 }}
                  exit={{ opacity: 0, transition: { duration: 0 } }}
                  transition={{ duration: 0.3, ease: 'easeOut' }}
                >
                  <span className='text-4xl font-besley font-black' style={{ color: colors.textColor }}>
                    {formatOutcome(card.outcome)}
                  </span>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>

      <div className='h-12 mt-24'>{button}</div>
    </div>
  );
}

// --- DeckSampling ---

export type DeckSamplingProps = TableProps &
  BaseComponentProps<DeckDraw[]> & {
    /** The two decks, by the names the data records, from left to right. */
    decks: Record<string, SamplingDeck>;
    /** Every draw moves both decks on to their next outcome, not only the one drawn from. Defaults to `true`. */
    paired?: boolean;
    /** How many cards the participant draws before the button can end the sampling. */
    minSamples?: number;
    /** Whether the button can end the sampling before a deck runs out. Defaults to `true`. */
    endEarly?: boolean;
    /**
     * Also shows the other deck's outcome at the same position, faded, as the one the participant did
     * not get, while the card they got has a thicker border. Needs paired decks, and lays the cards out as `layout: 'wide'` does.
     */
    showForgone?: boolean;
    /** How long a drawn card stays on the table, until the next draw by default. The decks take no draws meanwhile. */
    outcomeDurationMs?: number;
    /** How long the decks wait after `outcomeDurationMs` before they take the next draw. */
    pauseMs?: number;
    buttonText?: string;
    /** The button's text while the participant has drawn fewer than `minSamples` cards. */
    inactiveButtonText?: string;
    /** The heading while the participant draws, and once a deck has run out. */
    headings?: { sampling?: ReactNode; ended?: ReactNode };
  };

function DeckSamplingView({
  decks,
  paired = true,
  minSamples = 0,
  endEarly = true,
  showForgone = false,
  outcomeDurationMs,
  pauseMs = 0,
  buttonText = 'Proceed to decision',
  inactiveButtonText,
  headings,
  next,
  layout,
  ...table
}: DeckSamplingProps) {
  const th = t(useTheme());
  // The draws and the wait after each are kept in refs as well, so two quick presses never both draw
  const drawsRef = useRef<DeckDraw[]>([]);
  const [draws, setDraws] = useState<DeckDraw[]>([]);
  const waitingRef = useRef(false);
  const [waiting, setWaiting] = useState(false);
  const [cardShown, setCardShown] = useState(false);
  const takesDrawsSince = useRef(performance.now());

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (delayMs: number, run: () => void) => timers.current.push(setTimeout(run, delayMs));

  const ended = ranOut(decks, draws, paired);
  const tooFew = !ended && draws.length < minSamples;
  const latest = draws.at(-1);
  const shownLayout = showForgone ? 'wide' : layout;

  const draw = (deck: string, key: string | null, timeStamp: number) => {
    if (waitingRef.current || ranOut(decks, drawsRef.current, paired)) return;
    const card = drawCard(decks, drawsRef.current, deck, paired, showForgone);
    drawsRef.current = [...drawsRef.current, { ...card, key, reactionTimeMs: Math.round(timeStamp - takesDrawsSince.current) }];
    setDraws(drawsRef.current);
    setCardShown(true);
    if (outcomeDurationMs !== undefined) later(outcomeDurationMs, () => setCardShown(false));
    takesDrawsSince.current = timeStamp;
    const waitMs = (outcomeDurationMs ?? 0) + pauseMs;
    if (waitMs > 0) {
      waitingRef.current = true;
      setWaiting(true);
      later(waitMs, () => {
        waitingRef.current = false;
        setWaiting(false);
        takesDrawsSince.current = performance.now();
      });
    }
  };

  const cards: Card[] = [];
  if (cardShown && latest) {
    cards.push({ deck: latest.deck, outcome: latest.outcome, id: draws.length });
    const [other] = Object.keys(decks).filter((name) => name !== latest.deck);
    if (latest.forgone !== undefined) cards.push({ deck: other, outcome: latest.forgone, id: draws.length, forgone: true });
  }

  return (
    <Table
      {...table}
      heading={
        ended
          ? (headings?.ended ?? 'There are no more cards to draw.')
          : (headings?.sampling ?? 'Draw cards from the decks to see their outcomes!')
      }
      layout={shownLayout}
      decks={decks}
      onDeck={ended || waiting ? undefined : draw}
      cards={cards}
      emptyMiddle={
        draws.length === 0 &&
        shownLayout !== 'wide' && <div className='absolute inset-0 border-2 border-dashed border-gray-300 rounded-xl' />
      }
      button={
        (endEarly || ended) && (
          <button type='button' tabIndex={-1} className={th.button} disabled={tooFew} onClick={() => next(drawsRef.current)}>
            {tooFew && inactiveButtonText ? inactiveButtonText : buttonText}
          </button>
        )
      }
    />
  );
}

/** What DeckSampling's `draw` simulator receives: the decks' names, the draws so far, and whether it may stop. */
export type DeckSamplingStimulus = { decks: string[]; draws: DeckDraw[]; canStop: boolean };

/** A deck to draw from, or `null` to press the button, and how long after the decks took draws again. */
export type DeckSamplingSimulatorResult = { response: { deck: string | null; reactionTimeMs: number } };

export const DeckSampling = defineComponent({
  name: 'DeckSampling',
  component: DeckSamplingView,
  check: ({ props }) => {
    if (props === undefined) return undefined;
    const problem = checkDecks('DeckSampling', props.decks, props.click);
    if (problem) return problem;
    const lists = Object.entries(props.decks).filter(([, deck]) => typeof deck.outcomes !== 'function');
    const empty = lists.find(([, deck]) => deck.outcomes.length === 0);
    if (empty) return `The DeckSampling's deck '${empty[0]}' has no outcomes.`;
    if (props.showForgone && props.paired === false) {
      return 'A DeckSampling shows the forgone outcome only for paired decks, which have an outcome at the same position.';
    }
    if (props.endEarly === false && lists.length === 0) {
      return 'A DeckSampling with endEarly: false ends only when a deck runs out, so one of its decks needs a list of outcomes.';
    }
    return undefined;
  },
  // A trial without draws still has a row
  csv: { decksampling: (row) => (row.recorded.length > 0 ? row.recorded : {}) },
  simulate: async ({ props, simulators, participant }) => {
    const paired = props.paired ?? true;
    const waitMs = (props.outcomeDurationMs ?? 0) + (props.pauseMs ?? 0);
    const draws: DeckDraw[] = [];
    let durationMs = 0;
    while (!ranOut(props.decks, draws, paired)) {
      const canStop = props.endEarly !== false && draws.length >= (props.minSamples ?? 0);
      const result = await simulators.draw({ stimulus: { decks: Object.keys(props.decks), draws: [...draws], canStop }, participant });
      participant = result.participant ?? participant;
      const { deck, reactionTimeMs } = result.response;
      durationMs += reactionTimeMs;
      if (deck === null) {
        if (canStop) break;
        throw new Error('A simulated participant pressed the button of a DeckSampling before it could end the sampling.');
      }
      if (!(deck in props.decks)) {
        throw new Error(`A simulated participant drew from the deck '${deck}', which the DeckSampling does not have.`);
      }
      const card = drawCard(props.decks, draws, deck, paired, props.showForgone ?? false);
      draws.push({ ...card, key: props.decks[deck].key ?? null, reactionTimeMs });
      durationMs += waitMs;
    }
    return { recorded: draws, participant, durationMs };
  },
  defaultSimulators: {
    // Random decks, until it may stop after 15 cards
    draw: ({ stimulus }: SimulatorArgs<DeckSamplingStimulus>): DeckSamplingSimulatorResult => {
      const reactionTimeMs = Math.round(uniform(300, 1500));
      if (stimulus.canStop && stimulus.draws.length >= 15) return { response: { deck: null, reactionTimeMs } };
      return { response: { deck: stimulus.decks[Math.floor(uniform(0, stimulus.decks.length))], reactionTimeMs } };
    },
  },
});

// --- DeckChoice ---

export type DeckChoiceProps = TableProps &
  BaseComponentProps<DeckChoiceData> & {
    /** The two decks, by the names the data records, from left to right. */
    decks: Record<string, ChoiceDeck>;
    /** The button under the outcome of the chosen deck. */
    buttonText?: string;
    /** The heading before the choice, and with the chosen deck's outcome. */
    headings?: { choice?: ReactNode; result?: ReactNode };
  };

function DeckChoiceView({ decks, buttonText = 'Continue', headings, next, ...table }: DeckChoiceProps) {
  const th = t(useTheme());
  const [chosen, setChosen] = useState<DeckChoiceData>();
  const chosenRef = useRef<DeckChoiceData>();
  const shownAt = useRef(performance.now());

  const choose = (deck: string, key: string | null, timeStamp: number) => {
    if (chosenRef.current) return;
    const choice = {
      choice: deck,
      key,
      reactionTimeMs: Math.round(timeStamp - shownAt.current),
      outcome: chosenOutcome(decks[deck]),
    };
    chosenRef.current = choice;
    // A deck without an outcome has nothing to show
    if (choice.outcome === null) next(choice);
    else setChosen(choice);
  };

  return (
    <Table
      {...table}
      heading={
        chosen ? (headings?.result ?? "Here's your outcome!") : (headings?.choice ?? 'Which deck do you choose?')
      }
      decks={decks}
      onDeck={chosen ? undefined : choose}
      cards={chosen && chosen.outcome !== null ? [{ deck: chosen.choice, outcome: chosen.outcome, id: 0 }] : []}
      hiddenDecks={chosen ? Object.keys(decks).filter((name) => name !== chosen.choice) : []}
      emptyMiddle={<span className={`text-3xl font-black ${th.text} select-none`}>vs.</span>}
      button={
        chosen && (
          <button type='button' tabIndex={-1} className={th.button} onClick={() => next(chosen)}>
            {buttonText}
          </button>
        )
      }
    />
  );
}

/** What DeckChoice's `choose` simulator receives: the decks' names. */
export type DeckChoiceStimulus = { decks: string[] };

/** The chosen deck, and how long after the decks appeared. */
export type DeckChoiceSimulatorResult = { response: { deck: string; reactionTimeMs: number } };

export const DeckChoice = defineComponent({
  name: 'DeckChoice',
  component: DeckChoiceView,
  check: ({ props }) => (props === undefined ? undefined : checkDecks('DeckChoice', props.decks, props.click)),
  simulate: async ({ props, simulators, participant }) => {
    const result = await simulators.choose({ stimulus: { decks: Object.keys(props.decks) }, participant });
    const { deck, reactionTimeMs } = result.response;
    if (!(deck in props.decks)) {
      throw new Error(`A simulated participant chose the deck '${deck}', which the DeckChoice does not have.`);
    }
    const recorded = { choice: deck, key: props.decks[deck].key ?? null, reactionTimeMs, outcome: chosenOutcome(props.decks[deck]) };
    return { recorded, participant: result.participant ?? participant, durationMs: reactionTimeMs };
  },
  defaultSimulators: {
    choose: ({ stimulus }: SimulatorArgs<DeckChoiceStimulus>): DeckChoiceSimulatorResult => ({
      response: {
        deck: stimulus.decks[Math.floor(uniform(0, stimulus.decks.length))],
        reactionTimeMs: Math.round(uniform(500, 3000)),
      },
    }),
  },
});
