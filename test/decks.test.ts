import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { type DeckDraw, type DeckSamplingStimulus, DeckChoice, DeckSampling } from '../src/components/decks';
import type { SimulatorArgs } from '../src/core/component';
import { checkTrials, defineExperiment } from '../src/core/experiment';
import { buildUploadFiles } from '../src/core/files';
import { simulateParticipant } from '../src/core/simulation';
import { compileExperimentTimeline, type Timeline } from '../src/core/timeline';

async function run(timeline: Timeline) {
  const data = await simulateParticipant(defineExperiment({ timeline }), {});
  return data.trials;
}

// Draws from the decks in this order, 400 ms apart, then presses the button
const drawing = (order: string[]) => ({
  draw: ({ stimulus }: SimulatorArgs<DeckSamplingStimulus>) => ({
    response: { deck: order[stimulus.draws.length] ?? null, reactionTimeMs: 400 },
  }),
});

const problems = (timeline: Timeline) => checkTrials(compileExperimentTimeline(timeline), {}, false);

describe('DeckSampling', () => {
  test('paired decks move on together, so every draw shows the next position of its deck', async () => {
    const decks = { safe: { outcomes: [1, 2, 3, 4], key: 'f' }, risky: { outcomes: [10, 20, 30, 40] } };
    const [row] = await run([DeckSampling.trial({ decks }).simulators(drawing(['safe', 'risky', 'risky']))]);
    expect(row.recorded).toEqual([
      { deck: 'safe', outcome: 1, position: 0, key: 'f', reactionTimeMs: 400 },
      { deck: 'risky', outcome: 20, position: 1, key: null, reactionTimeMs: 400 },
      { deck: 'risky', outcome: 30, position: 2, key: null, reactionTimeMs: 400 },
    ]);
    // Three draws and the button
    expect(row.durationMs).toBe(1600);
  });

  test('unpaired decks each keep their own position', async () => {
    const decks = { safe: { outcomes: [1, 2, 3, 4] }, risky: { outcomes: [10, 20, 30, 40] } };
    const [row] = await run([DeckSampling.trial({ decks, paired: false }).simulators(drawing(['safe', 'risky', 'risky']))]);
    expect(row.recorded.map((draw: DeckDraw) => [draw.outcome, draw.position])).toEqual([
      [1, 0],
      [10, 0],
      [20, 1],
    ]);
  });

  test('the sampling ends once a deck runs out, and a function deck never does', async () => {
    const always = (deck: string) => drawing(Array(10).fill(deck));
    const decks = { safe: { outcomes: [1, 2] }, risky: { outcomes: () => 7 } };
    const [paired, unpaired, onlyRisky] = await run([
      DeckSampling.trial({ decks }).simulators(always('risky')),
      DeckSampling.trial({ decks, paired: false }).simulators(always('safe')),
      DeckSampling.trial({ decks, paired: false }).simulators(always('risky')),
    ]);
    expect(paired.recorded.map((draw: DeckDraw) => draw.outcome)).toEqual([7, 7]);
    expect(unpaired.recorded.map((draw: DeckDraw) => draw.outcome)).toEqual([1, 2]);
    expect(onlyRisky.recorded).toHaveLength(10);
  });

  test('the button ends the sampling only after minSamples, and with endEarly: false not at all', async () => {
    const decks = { safe: { outcomes: [1, 2, 3] }, risky: { outcomes: [4, 5, 6] } };
    const [row] = await run([DeckSampling.trial({ decks, minSamples: 2 }).simulators(drawing(['safe', 'safe']))]);
    expect(row.recorded).toHaveLength(2);
    await expect(run([DeckSampling.trial({ decks, minSamples: 2 }).simulators(drawing(['safe']))])).rejects.toThrow(
      'pressed the button of a DeckSampling before it could end the sampling',
    );
    await expect(run([DeckSampling.trial({ decks, endEarly: false }).simulators(drawing(['safe']))])).rejects.toThrow(
      'pressed the button of a DeckSampling before it could end the sampling',
    );
  });

  test('with showForgone, each draw also records the other deck at the same position', async () => {
    const decks = { safe: { outcomes: [3, 3, 3] }, risky: { outcomes: [0, 15, 0] } };
    const [row] = await run([DeckSampling.trial({ decks, showForgone: true }).simulators(drawing(['safe', 'safe', 'risky']))]);
    expect(row.recorded.map((draw: DeckDraw) => [draw.deck, draw.outcome, draw.forgone])).toEqual([
      ['safe', 3, 0],
      ['safe', 3, 15],
      ['risky', 0, 3],
    ]);
    expect(problems([DeckSampling.trial({ decks, showForgone: true, paired: false })])[0]).toContain(
      'shows the forgone outcome only for paired decks',
    );
  });

  test('the outcome and the pause after each draw count towards the duration', async () => {
    const decks = { safe: { outcomes: [3, 3] }, risky: { outcomes: [0, 15] } };
    const [row] = await run([
      DeckSampling.trial({ decks, outcomeDurationMs: 500, pauseMs: 250 }).simulators(drawing(['safe', 'risky'])),
    ]);
    // Two draws, each 400 ms after the decks took draws again, and 750 ms of outcome and pause after each
    expect(row.durationMs).toBe(2 * (400 + 750));
  });

  test('a trial without draws still has a row in the CSV', async () => {
    const timeline = [DeckSampling.trial('sampling', { decks: { a: { outcomes: [1] }, b: { outcomes: [2] } } }).simulators(drawing([]))];
    const data = await simulateParticipant(defineExperiment({ timeline }), {});
    const files = buildUploadFiles({
      sessionId: 's',
      data,
      store: {},
      components: compileExperimentTimeline(timeline).components,
      uploadRaw: false,
    });
    const csv = files.find((file) => file.filename.startsWith('decksampling.'));
    expect(csv?.content.split('\n')).toHaveLength(2);
  });

  test('its decks are checked when the experiment loads', () => {
    const deck = { outcomes: [1] };
    expect(problems([DeckSampling.trial({ decks: { a: deck, b: deck, c: deck } })])[0]).toContain('takes two decks, but has 3');
    expect(problems([DeckSampling.trial({ decks: { a: { ...deck, key: 'F' }, b: { ...deck, key: 'f' } } })])[0]).toContain(
      "share the key 'f'",
    );
    expect(problems([DeckSampling.trial({ decks: { a: { ...deck, key: 'f' }, b: deck }, click: false })])[0]).toContain(
      'needs a key for each deck',
    );
    expect(problems([DeckSampling.trial({ decks: { a: deck, b: { outcomes: [] } } })])[0]).toContain("deck 'b' has no outcomes");
    const random = { outcomes: () => 1 };
    expect(problems([DeckSampling.trial({ decks: { a: random, b: random }, endEarly: false })])[0]).toContain(
      'one of its decks needs a list of outcomes',
    );
    expect(problems([DeckSampling.trial({ decks: { a: deck, b: random } })])).toEqual([]);
  });

  test('shows each deck with its label and key', () => {
    const html = renderToStaticMarkup(
      createElement(DeckSampling, {
        decks: { safe: { label: 'A', key: 'f', outcomes: [1] }, risky: { label: 'B', key: 'ArrowRight', outcomes: [2] } },
        next: () => {},
        data: { session: { userAgent: '', params: {}, buildSeed: 0, namedTrials: [] }, trials: [] },
        store: {},
        updateStore: () => {},
      }),
    );
    for (const text of ['>A<', '>B<', '>f<', '>→<', 'Proceed to decision']) expect(html).toContain(text);
  });
});

describe('DeckChoice', () => {
  test('records the chosen deck and what it gave, or null for a deck without an outcome', async () => {
    const decks = { safe: { outcome: 3, key: 'f' }, risky: { outcome: () => 32 } };
    const choosing = (deck: string) => ({ choose: () => ({ response: { deck, reactionTimeMs: 900 } }) });
    const rows = await run([
      DeckChoice.trial({ decks }).simulators(choosing('safe')),
      DeckChoice.trial({ decks }).simulators(choosing('risky')),
      DeckChoice.trial({ decks: { safe: {}, risky: {} } }).simulators(choosing('risky')),
    ]);
    expect(rows.map((row) => row.recorded)).toEqual([
      { choice: 'safe', key: 'f', reactionTimeMs: 900, outcome: 3 },
      { choice: 'risky', key: null, reactionTimeMs: 900, outcome: 32 },
      { choice: 'risky', key: null, reactionTimeMs: 900, outcome: null },
    ]);
    await expect(run([DeckChoice.trial({ decks }).simulators(choosing('other'))])).rejects.toThrow(
      "chose the deck 'other', which the DeckChoice does not have",
    );
  });

  test('with outcomeDurationMs, the outcome is shown for that long and counts towards the duration', async () => {
    const choosing = (deck: string) => ({ choose: () => ({ response: { deck, reactionTimeMs: 900 } }) });
    const [shown, none] = await run([
      DeckChoice.trial({ decks: { safe: { outcome: 3 }, risky: { outcome: 0 } }, outcomeDurationMs: 1000 }).simulators(
        choosing('safe'),
      ),
      DeckChoice.trial({ decks: { safe: {}, risky: {} }, outcomeDurationMs: 1000 }).simulators(choosing('safe')),
    ]);
    expect(shown.durationMs).toBe(1900);
    // A deck without an outcome ends the trial at the choice
    expect(none.durationMs).toBe(900);
  });
});
