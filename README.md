# reactive

A framework for quickly building interactive online experiments using Typescript, React, and TailwindCSS. Comes with a template project that has all batteries included (build tools, docker deployment setup, node server for upload etc.)
The project is very early stage, so many of the abstractions are still very leaky and the documentation is largely unfinished.


## Prerequisites

You will need a current version of [node.js](https://nodejs.org/en/download/) installed on your system.

## Using the package

### Create a template project

```
npx @adriansteffan/reactive
```

Then follow the instructions shown there and in the created `README.md`


### Usage

For now, refer to the `Experiment.tsx` in the template project to find out how to define an experiment, and add custom trials and questions!

Premade components available so far:

* Text: A simple display of Text and a Button
* MicCheck: used to test the voice recording feature and choose a preferred microphone to use
* CanvasBlock: TODO DOC
* IF_BLOCK: TODO DOC
* IF_GOTO: TODO DOC
* MARKER: TODO DOC
* UPDATE_STORE: TODO DOC
* StoreUI: TODO DOC
* DeviceCheck: TODO DOC
* ProlificEnd: TODO DOC
* Quest: SurveyJS questionnaires
    * ... all questiontypes supported by SurveyJS can be used
    * voicerecorder: a custom question type that allows participants to record voice
* Tutorial: A paginated slide deck with navigation, dot indicators, and optional interactive slides via `useTutorialSlide`
* RandomDotKinematogram: A random dot kinematogram (RDK) stimulus for motion perception experiments
* Upload: Uploads the collected data on a button press by the participant 



## Simulation

Reactive includes a simulation system that lets you run experiments headlessly, generating synthetic data from simulated participants. This is useful for some basic computational modeling, verifying data pipelines, and sample size planning.

### Quick start

Define your participant generator in `Experiment.tsx`:

```tsx
export const simulationConfig = {
  seed: 42, // optional: makes simulations fully reproducible
  participants: () => sampleParticipants('sobol', 10, {
    needForCognition: { distribution: 'normal', mean: 3.5, sd: 0.8 },
  }).map((p, i) => ({ ...p, id: i })),
};
```

Run the simulation:

```
npm run simulate
```

This starts the backend, simulates all participants through the experiment, uploads data via the real backend (just like real participants would), and shuts down.

### How it works

Each built-in component (Text, Quest, CanvasBlock, Upload, etc.) registers a **simulate function** and **default simulators**. The simulate function contains the trial logic. The simulators are replaceable decision functions that model participant behavior at each interaction point.

For example, Quest's simulate function iterates through questions and calls `simulators.answerQuestion()` for each one. The default `answerQuestion` picks random valid answers. You can override it to model specific participant behavior.

### Overriding simulators on a trial

Add a `simulators` property to any timeline item to override specific decision functions:

```tsx
{
  type: 'PlainInput',
  props: { content: <p>What is your name?</p> },
  simulators: {
    respond: (_trialProps, participant) => ({
      value: participant.nickname,
      participantState: participant,
    }),
  },
}
```

The override is merged with the registered defaults — you only need to specify the decision functions you want to change.

### Custom components

Register a simulation for your custom components using `registerSimulation`:

```tsx
registerSimulation('MyTrial',
  // Simulate function: uses shared trial logic + decision functions
  (trialProps, experimentState, simulators, participant) => {
    const choice = simulators.decide(trialProps, participant);
    return { responseData: { choice: choice.value }, participantState: choice.participantState };
  },
  // Default simulators: one per decision point
  {
    decide: (_trialProps, participant) => ({
      value: 'default_choice',
      participantState: participant,
    }),
  },
);
```

The simulate function orchestrates the trial logic. The decision functions are the parts where a human would interact — these are what users override to model different participant behaviors.

### Hybrid mode

During development, you can auto-advance simulated trials while manually interacting with others. Add `?hybridSimulation=true` to the URL during development:

```
http://localhost:5173?hybridSimulation=true
```

Trials with `simulators` or `simulate: true` defined on them will auto-advance. Trials without them render normally for human interaction.

Hybrid mode is enabled by default during development. For production, set `VITE_DISABLE_HYBRID_SIMULATION=true` to disable it regardless of URL parameters.

### Reproducible simulations

Add `seed` to your simulation config to make runs fully reproducible:

```tsx
export const simulationConfig = {
  seed: 42,
  participants: () => sampleParticipants('sobol', 100, {
    needForCognition: { distribution: 'normal', mean: 3.5, sd: 0.8 },
    agreeableness: { distribution: 'normal', mean: 3.0, sd: 1.0 },
    age: { distribution: 'uniform', min: 18, max: 65 },
  }).map((p, i) => ({ ...p, id: i })),
};
```

Each simulated participant runs in its own subprocess. The `seed` controls two separate phases:

- **Participant generation**: The `participants` factory function is called with the base `seed` (same for all workers), so every worker generates the same participant list.
- **Simulation behavior**: Module-level randomness (group assignment, trial order) and simulator callbacks are seeded with `seed + participantIndex`, so each participant gets a unique but reproducible random stream.

Without `seed`, simulations use random entropy and will vary between runs. When seeded, `Math.random()` is also patched to use the seeded PRNG, so existing code and third-party libraries are automatically reproducible.

**Note:** Do not close over module-level random values into the factory function — module-level code runs with a per-worker seed, so captured values would differ between workers. Keep all participant generation logic inside the factory.

```tsx
// Good: all randomness is inside the factory
participants: () => {
  const base = sampleParticipants('random', 100, {
    openness: { distribution: 'normal', mean: 3.5, sd: 0.8 },
  });
  return base.map((p, i) => ({
    ...p,
    curiosity: p.openness * 0.7 + normal(0, 0.3),
    id: i,
  }));
},

// Bad: module-level value captured into factory
const noise = normal(0, 1); // different per worker!
participants: () => [{ trait: noise }],
```

To model distinct populations, combine them inside the factory:

```tsx
participants: () => {
  const smokers = sampleParticipants('sobol', 50, {
    alertness: { distribution: 'normal', mean: 2.8, sd: 0.7 },
  }).map((p) => ({ ...p, smoker: true }));

  const nonSmokers = sampleParticipants('sobol', 50, {
    alertness: { distribution: 'normal', mean: 3.6, sd: 0.5 },
  }).map((p) => ({ ...p, smoker: false }));

  return [...smokers, ...nonSmokers].map((p, i) => ({ ...p, id: i }));
},
```

### Built-in simulator decision functions

| Component | Decision functions | Default behavior |
|---|---|---|
| Text | `respond` | Click button, random reaction time |
| PlainInput | `respond` | Returns `'simulated_input'` |
| Quest | `answerQuestion` | Random valid answer per question type |
| CanvasBlock | `respondToSlide` | Random key from `allowedKeys`, random RT |
| Tutorial | `respondToSlide` | Advances through slides, no interaction data |
| RandomDotKinematogram | `respond` | Random key from `validKeys`, random RT (may timeout) |
| Upload | *(none)* | Builds CSVs and POSTs to backend |
| StoreUI | *(none)* | Uses field default values |
| CheckDevice | *(none)* | Returns simulated device info |
| EnterFullscreen, ExitFullscreen, MicrophoneCheck, ProlificEnding, RequestFilePermission | *(none)* | No-op, advances immediately |


## Data Saving

Reactive automatically builds CSV files from experiment data using a registry-based system. Each component type registers a default CSV target, and the Upload component discovers these at the end of the experiment.

### How it works

Each component type registers where its data should go via `registerFlattener`:

```tsx
registerFlattener('PlainInput', 'session');           // merge into session CSV
registerFlattener('CanvasBlock', 'canvas', flattenFn); // own CSV with custom flattener
registerFlattener('ProlificEnding', null);             // no CSV output
```

Built-in components come pre-registered. The Upload component produces CSVs automatically with no props needed:

```tsx
{ name: 'upload', type: 'Upload' }
```

### Built-in defaults

| Component | Default CSV | Notes |
|---|---|---|
| PlainInput, Quest, CheckDevice, EnterFullscreen, ExitFullscreen, MicrophoneCheck | `session` | Merged into single session row, namespaced by trial name |
| Text | `text` | One row per Text component |
| CanvasBlock | `canvas` | One row per slide, with built-in flattener |
| StoreUI | `storeui` | One row per StoreUI occurrence |
| Tutorial | `session` | Merged into session row |
| RandomDotKinematogram | `rdk` | One row per RDK trial |
| ProlificEnding, Upload, RequestFilePermission | *(none)* | No CSV output |

### Output files

For a session `abc123`, the Upload component produces:
- `abc123.raw.json` — full raw data
- `session.abc123.{timestamp}.csv` — one row with params, userAgent, and all session-level trial data namespaced by trial name (e.g. `nickname_value`, `devicecheck_browser`)
- `canvas.abc123.{timestamp}.csv` — multi-row CSV from CanvasBlock trials
- One CSV per additional group (text, storeui, or any custom group)

### Per-item CSV override

Override the default target on any timeline item:

```tsx
{ name: 'practice', type: 'CanvasBlock', csv: 'practice', ... }  // separate from main canvas
{ name: 'main',     type: 'CanvasBlock', ... }                   // uses default 'canvas'
```

Route a trial to multiple CSVs with an array:

```tsx
{ name: 'survey', type: 'Quest', csv: ['session', 'survey'], ... }  // both session row and own file
```

### Adding session-level data

Use `sessionData` on Upload to inject extra fields into the session CSV:

```tsx
// Static
{
  type: 'Upload',
  props: {
    sessionData: { group: 'control', experimentVersion: 2 },
  },
}

// Dynamic (computed from store/data)
{
  type: 'Upload',
  props: (data, store) => ({
    sessionData: { group: store.assignedGroup, condition: store.condition },
  }),
}
```

### Custom flatteners

Register a flattener for custom components to control how `responseData` becomes CSV rows:

```tsx
registerFlattener('MyGame', 'games', (item) => {
  return item.responseData.moves.map((move) => ({
    moveType: move.type,
    score: move.score,
  }));
});
```

Each row automatically gets standard trial fields prefixed with `trial_` (`trial_index`, `trial_name`, `trial_start`, etc.) plus any metadata from the timeline item. The flattener output overwrites these if keys collide.

### Array flattener

For components whose `responseData` is an array of objects (like CanvasBlock), use the built-in `arrayFlattener` instead of writing your own. Each array element becomes a CSV row with a `block` column set to the trial name:

```tsx
import { registerFlattener, arrayFlattener } from '@adriansteffan/reactive';

registerFlattener('MyBlockTrial', 'blocks', arrayFlattener);
```

### Multi-CSV components

Call `registerFlattener` multiple times for one component to produce multiple CSV files:

```tsx
registerFlattener('SportsGame', 'sports_actions', (item) => flattenActions(item.responseData));
registerFlattener('SportsGame', 'sports_players', (item) => flattenPlayers(item.responseData));
registerFlattener('SportsGame', 'sports_matches', (item) => flattenMatches(item.responseData));
```

### Upload props

| Prop | Type | Default | Description |
|---|---|---|---|
| `sessionID` | `string` | random UUID | Custom session identifier used in filenames and folder names |
| `sessionData` | `Record<string, any>` | — | Extra key-value pairs added to the session CSV row |
| `generateFiles` | `(sessionID, data, store) => FileUpload[]` | — | Produce custom files alongside auto-generated CSVs |
| `uploadRaw` | `boolean` | `true` | Include raw JSON dump of all trial data |
| `autoUpload` | `boolean` | `false` | Upload immediately on mount instead of showing a submit button |

### Metadata

Add `metadata` to timeline items to include extra columns in every CSV row that trial produces:

```tsx
{
  name: 'block1',
  type: 'CanvasBlock',
  metadata: { difficulty: 'hard', block: 2 },
  props: { ... },
}
```

For session-level items, metadata is namespaced by trial name (e.g. `block1_difficulty`). For non-session items, metadata columns appear unprefixed.


## Utilities

Reactive exports helper functions for common experiment-building tasks.

```tsx
import { shuffle, sample, chunk, pipe, normal, uniform, poisson, seedDistributions, sobol, halton, sampleParticipants } from '@adriansteffan/reactive';
```

### Array functions

These are available both as standalone functions and as Array prototype extensions (after calling `registerArrayExtensions()`).

| Function | Signature | Description |
|---|---|---|
| `shuffle` | `shuffle(arr)` | Returns a new array with elements randomly reordered (Fisher-Yates) |
| `sample` | `sample(arr, n?)` | Returns `n` random elements from the array (default 1, with replacement) |
| `chunk` | `chunk(arr, n)` | Splits the array into `n` roughly equal chunks |
| `pipe` | `pipe(arr, fn)` | Passes the array to `fn` and returns the result |

As prototype methods:

```tsx
import { registerArrayExtensions } from '@adriansteffan/reactive';
registerArrayExtensions();

const trials = [1, 2, 3, 4, 5].shuffle();
const picked = trials.sample(2);
const blocks = trials.chunk(3);
```

### Distributions

Random number generators backed by [@stdlib](https://github.com/stdlib-js/stdlib), useful for writing realistic simulations.

| Function | Signature | Description |
|---|---|---|
| `uniform` | `uniform(a, b)` | Sample from a continuous uniform distribution over `[a, b)` |
| `normal` | `normal(mu, sigma)` | Sample from a normal (Gaussian) distribution with mean `mu` and standard deviation `sigma` |
| `poisson` | `poisson(lambda)` | Sample from a Poisson distribution with rate `lambda` |

All built-in simulation functions use these distributions internally.

#### Global seeding

Call `seedDistributions` to seed all three generators from a single seed, making simulation runs fully reproducible:

```tsx
import { seedDistributions } from '@adriansteffan/reactive';

seedDistributions(42);
// All subsequent calls to normal(), uniform(), poisson() produce the same sequence
```

Without seeding, the generators use random entropy (non-reproducible, same as `Math.random()`).

### Quasi-Monte Carlo sequences

Low-discrepancy sequences for more uniform coverage of parameter spaces than pseudorandom sampling. Useful for generating participant parameters in simulations.

Both `sobol` and `halton` take a count and an array of dimension specs. Each dimension describes a distribution to sample from.

| Function | Signature | Description |
|---|---|---|
| `sobol` | `sobol(count, specs)` | Generate `count` points using a Sobol sequence. Supports 1–21 dimensions. |
| `halton` | `halton(count, specs)` | Generate `count` points using a Halton sequence (auto-selects prime bases). |

Each dimension spec is one of:

| Distribution | Spec | Description |
|---|---|---|
| Uniform | `{ distribution: 'uniform', min, max }` | Uniform over `[min, max)` |
| Normal | `{ distribution: 'normal', mean, sd }` | Gaussian with given mean and standard deviation |
| Poisson | `{ distribution: 'poisson', mean }` | Poisson with given mean (discrete) |

For a single dimension, both return a flat `number[]`. For multiple dimensions, they return `number[][]`.

```tsx
import { sobol, halton } from '@adriansteffan/reactive';

// Uniform
sobol(5, [{ distribution: 'uniform', min: 200, max: 800 }]);

// Normal: 10 reaction times ~ N(500, 100)
sobol(10, [{ distribution: 'normal', mean: 500, sd: 100 }]);

// Poisson: 8 counts ~ Poisson(5)
sobol(8, [{ distribution: 'poisson', mean: 5 }]);

// Multi-dimensional: uniform RT + normally distributed threshold
sobol(5, [
  { distribution: 'uniform', min: 200, max: 800 },
  { distribution: 'normal', mean: 0.5, sd: 0.1 },
]);

// Halton — same API, different sequence
halton(5, [{ distribution: 'uniform', min: 200, max: 800 }]);
```

#### Sampling participants

`sampleParticipants` wraps the QMC sequences into a convenient API for generating participant parameter sets. Each key in the spec becomes a named field on the returned objects.

```tsx
import { sampleParticipants } from '@adriansteffan/reactive';

const participants = sampleParticipants('sobol', 100, {
  needForCognition: { distribution: 'normal', mean: 3.5, sd: 0.8 },
  agreeableness: { distribution: 'normal', mean: 3.0, sd: 1.0 },
}).map((p, i) => ({ ...p, id: i }));
// → [{ needForCognition: 3.5, agreeableness: 3.0, id: 0 }, ...]
```

The first argument is the sampling method: `'sobol'`, `'halton'`, or `'random'`.

### Drift Diffusion Model (DDM)

`simulateDDMTrial` simulates a single 2AFC trial. Parameters can be fixed numbers or distributions (`{ type: 'normal', mean, sd }` / `{ type: 'uniform', min, max }`) for inter-trial variability.

```tsx
import { simulateDDMTrial, mapDDMChoice } from '@adriansteffan/reactive';

const result = simulateDDMTrial({
  driftRate: 0.003,
  boundaries: 0.1,        // symmetric: +0.1 / -0.1
  startingPoint: 0,
  noiseLevel: 0.003,
  sensoryDelay: { type: 'uniform', min: 100, max: 200 },
  motorDelay: { type: 'uniform', min: 50, max: 100 },
  timeLimit: 2000,
  stimOffset: 1000,
  postStimStrategy: { type: 'continue' },
});
// → { choice: 0 | 1 | null, rt, finalEvidence, isContaminated }

// Map DDM choice to a key press (null-safe)
mapDDMChoice(result.choice, ['f', 'j'], 'f');
```

`boundaries` can also be a `[lower, upper]` tuple for asymmetric boundaries. `choice` is `null` on timeout.

After the stimulus disappears (`stimOffset`), the `postStimStrategy` takes over:
- `{ type: 'continue' }` — keep accumulating (optional `residualDrift`, `noiseMultiplier`)
- `{ type: 'snapshot' }` — forced choice by boundary proximity
- `{ type: 'collapse', collapseDef: { rate, delay? } }` — boundaries shrink, drift drops to 0

Boundaries can also collapse during viewing via `stimulusCollapse: { rate, delay? }`.

The RDK component uses this as its default simulator with parameters from Ratcliff & McKoon (2008), converted to ms time steps.


## Development


Run this to in the root of the repo to build the project locally (also needs to be run after every change):

```
npm run build
```

Then create a global link (only needs to run once during setup);
```
npm link
```

Then set up a local testing project (run from the parent directory so it's created as a sibling):

```
cd ..
node reactive/bin/setup.js
cd <project-name>
npm pkg set dependencies.@adriansteffan/reactive="*"
npm i && npm i --prefix backend
npm link @adriansteffan/reactive
```


Manually publishing to npm (until we figure out a better ci/cd process):
```
npm publish
```


## Authors

* **Adrian Steffan** - [adriansteffan](https://github.com/adriansteffan)