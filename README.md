# reactive

A framework for quickly building interactive online experiments using Typescript, React, and TailwindCSS. Comes with a template project that has all batteries included (build tools, docker deployment setup, Bun server for upload etc.)
The project is very early stage, so many of the abstractions are still very leaky and the documentation is largely unfinished.


## Prerequisites

You will need a current version of [Bun](https://bun.sh/) installed on your system. Projects run entirely on Bun: the dev server, the production build, the upload backend and simulations.

## Using the package

### Create a template project

```
bunx @adriansteffan/reactive
```

Then follow the instructions shown there and in the created `README.md`


### Usage

An experiment is defined in `src/Experiment.tsx` of the template project, which exports `defineExperiment(...)`:

```tsx
import { defineExperiment, PlainInput, Text, Upload } from '@adriansteffan/reactive';

export default defineExperiment({
  config: { showProgressBar: true },
  timeline: [
    Text.trial('welcome', { content: <p>Welcome!</p>, buttonText: 'Start' }),
    PlainInput.trial('nickname', { content: <p>What is your nickname?</p> }),
    Text.trial('thanks', ({ get }) => ({
      content: <p>Thank you, {get(PlainInput, 'nickname').value}!</p>,
    })),
    Upload.trial('upload'),
  ],
});
```

The other fields of `defineExperiment` are `params` (below) and `simulation` (see [Simulation](#simulation)).

Premade components available so far:

* Text: A simple display of Text and a Button
* PlainInput: A text input with a prompt
* MicrophoneCheck: used to test the voice recording feature and choose a preferred microphone to use
* CanvasBlock: A sequence of canvas slides with keyboard responses, for timed tasks
* StoreUI: A form that writes its fields to the store
* CheckDevice: Gathers information about the participant's device and can stop participants whose device does not fit
* EnterFullscreen / ExitFullscreen
* ProlificEnding: Shows the Prolific completion code
* Quest (extra): SurveyJS questionnaires
    * ... all questiontypes supported by SurveyJS can be used
    * voicerecorder: a custom question type that allows participants to record voice
    * your own question types, as React components passed by name to `customQuestions`
* Tutorial (extra): A paginated slide deck with navigation, dot indicators, and optional interactive slides via `useTutorialSlide`
* RandomDotKinematogram: A random dot kinematogram (RDK) stimulus for motion perception experiments
* VoiceRecording: A standalone voice recording trial with pause/stop controls, optional minimum duration warning, and confirmation dialog
* Upload: Uploads the collected data on a button press by the participant

Quest and Tutorial are extras: they need packages of their own, so a new project leaves them out. Add them in the project's root directory with

```
bunx @adriansteffan/reactive add quest tutorial
```

and import them from their own entry points:

```tsx
import { Quest } from '@adriansteffan/reactive/quest';
import { Tutorial, useTutorialSlide } from '@adriansteffan/reactive/tutorial';
```

An experiment that does not use them neither installs them nor sends them to its participants.

### Trials

`Component.trial(name?, props)` puts a component into the timeline. The name is optional, but it identifies the trial in the data and is needed to read its result later. Props are checked against the component; a component with required props needs them here.

Further settings are chained. Every method returns a new trial and leaves the one it was called on unchanged, so a partly configured trial can serve as a base for several others. Passing `undefined` leaves a setting as it is, which keeps optional settings inline:

```tsx
const feedback = Text.trial({ buttonText: 'Continue' });

feedback.name('slow').props({ content: <p>Take your time.</p> }),
Text.trial('instructions').metadata(isPractice ? { practice: true } : undefined),
```

| Method | Description |
|---|---|
| `.name(name)` | Renames the trial, for variants of a base trial |
| `.props(props)` | Merges props into the trial's props |
| `.metadata(values, { nested? })` | Extra columns for this trial's rows (see [Metadata](#metadata)) |
| `.csv(file)` | The CSV file(s) for this trial's rows instead of its component's; `null` keeps them out |
| `.simulators(simulators)` | Replaces some of the component's simulators (see [Simulation](#simulation)) |
| `.collectRefreshRate(enabled?)` | Measures the screen's refresh rate while the trial runs, for later canvas trials |
| `.hideSettings(names \| true)` | Hides the component's settings from the settings page |

Times are in milliseconds everywhere, in props as in the recorded data, and their names end in `Ms`: `durationMs`, `reactionTimeMs`, and each row's `startMs` and `endMs`.

### Reading results

Props, metadata, conditions and store updates can be functions of the timeline context (`TimelineContext`), which they receive when the trial runs. Its `get` returns the response of an earlier trial, typed by its component:

```tsx
const nickname = PlainInput.trial('nickname', { content: <p>What is your nickname?</p> });

Text.trial(({ get }) => ({ content: <p>Hello {get(nickname).value}</p> }));
Text.trial(({ get }) => ({ content: <p>Hello {get(PlainInput, 'nickname').value}</p> }));
```

A trial can be read through the trial itself or through its component and name. `get` throws if the trial has not run yet; `getOptional` returns `undefined` instead, for trials that may have been skipped. Asking for a name that is not in the timeline stops the experiment during development and simulation; for real participants it is logged instead. The timeline context also holds `data`, every row recorded so far, and `store`.

These callbacks must not change the context's `data` or `store`: they are frozen during development and simulation, so trying throws. The store changes only through `updateStore` (below) and through components.

### Control flow

The timeline is a list of trials and blocks. Lists can be nested, and `false`, `null` and `undefined` are skipped, so pieces of a timeline can be combined like React children:

```tsx
timeline: [
  welcomeAndConsent,
  group === 'vn' ? [soundCheck, visualNovel] : vignette,
  group === 'vn' && credits,
  upload,
]
```

This covers choices that are fixed before the participant starts. Choices that depend on their answers use blocks, which are decided when the participant reaches them:

```tsx
const clickedSlowly = ({ get }: TimelineContext) => get(CustomTrial, 'customtrial').totalTimeMs > 3000;

ifBlock(clickedSlowly, [Text.trial({ content: <p>Take your time.</p> })]).else([
  Text.trial({ content: <p>That was quick!</p> }),
]),
whileBlock(({ store }) => (store.attempts ?? 0) < 3, [practiceRound]),
updateStore(({ store }) => ({ attempts: (store.attempts ?? 0) + 1 })),
marker('retry'),
ifGoto(({ get }) => !get(Quiz, 'quiz').passed, 'retry'),
```

A condition written as a named function, like `clickedSlowly`, can be reused in several blocks and props without storing a flag. `updateStore` is for values that carry forward, such as a bonus.

Within one timeline, two different trials of the same component cannot share a name, unless they sit in different branches of the same `ifBlock`.

### Params

Params are the experiment's inputs. They are declared once, read from the URL, and passed to `timeline`, which then becomes a function that runs once per participant:

```tsx
export default defineExperiment({
  params: {
    group: {
      values: ['vn', 'scenario'],
      default: () => (Math.random() < 0.5 ? 'vn' : 'scenario'),
      description: 'Which version of the study the participant sees',
    },
    rounds: { default: 3 },
  },
  timeline: ({ group, rounds }) => [
    group === 'vn' ? visualNovel : vignette,
    Array.from({ length: rounds }, (_, i) => Round.trial(`round_${i}`)),
  ],
});
```

* A param is read from the URL by its key (`?group=scenario&rounds=5`), otherwise its default is used. A default that is a function is called once per participant.
* With `values`, the param is typed as one of them (`'vn' | 'scenario'`), and a URL value outside them stops the experiment with an error. Without `values`, the param takes the type of its default.
* The resolved values are recorded in the data. Simulated participants can set them (see [Simulation](#simulation)).
* `timeline` may use any JavaScript, such as `shuffle` or loops. Its random draws are seeded per participant, and the seed (`buildSeed`) is recorded, so the exact timeline a participant saw can be rebuilt later.
* Params exist only inside `timeline`. Parts of the timeline in other files that need one become functions that take it, and components get it as a prop.

### Typed store

The store's shape can be declared once, anywhere in the project:

```tsx
declare module '@adriansteffan/reactive' {
  interface ExperimentStore {
    bonus: number;
  }
}
```

The timeline context's `store`, the `updateStore` block, and the `store` and `updateStore` that components receive are then checked against it. Without a declaration, the store is untyped.

### Custom components

`defineComponent` turns a React component into one that can be used in the timeline:

```tsx
function ReactionView({ next, target }: BaseComponentProps<{ rtMs: number }> & { target: string }) {
  ...
  next({ rtMs });
}

export default defineComponent({
  name: 'Reaction',
  component: ReactionView,
  csv: 'reactions', // optional, see Data Saving
  simulate: ({ props, simulators, participant }) => { ... }, // optional, see Simulation
  defaultSimulators: { ... }, // optional
});
```

`BaseComponentProps<R>` gives the component `next`, which records its response of type `R` and moves on, along with `data`, `store`, `updateStore` and `name`, the trial's name. Only `name` and `component` are required. The name identifies the component in the data, since function names do not survive minification. A defined component is still an ordinary React component.

Write the component as a named function, as above, rather than inline in `defineComponent`: hot reloading then keeps the state of a trial that is on screen when its file changes.

A component can declare params of its own, in the same format as the experiment's. The settings page lists them whenever the component is in the timeline, the URL can set them, and the component reads their values with `useParams(params)`, typed like the experiment's. Upload's `upload` and `download` switches work this way:

```tsx
const params = {
  showFeedback: { default: true, description: 'Show feedback after each response' },
} as const;

function ReactionView(...) {
  const { showFeedback } = useParams(params); // boolean
  ...
}

defineComponent({ name: 'Reaction', component: ReactionView, params });
```

`as const` keeps the `values` of a param as a union of them, as `defineExperiment` does.

A component that talks to the experiment's server, such as a multiplayer game or a streamed API response, reaches the routes in `server.ts` at `getBackendUrl()`. That is `/backend` in the browser and the simulation's own server while simulating, so the component and its `simulate` can use the same call:

```tsx
const response = await fetch(`${getBackendUrl()}/match`, { method: 'POST', body: JSON.stringify({ id }) });
```

Simulated participants run at the same time against that one server, so they can also interact through it.

### Hot reloading

Edits to the experiment or to its components keep the participant where they are: the timeline is rebuilt with the same params and seed, the trial on screen stays mounted with its state, and it receives its new props. An edit that removes the trial on screen falls back to the same position.

### Settings page

`/settings` builds a link for a run. It lists the experiment's params, then the settings: the general ones (`dev`) and those of the components in the selected trials, by component. Below them come the trials, which follow the params entered above. The settings follow which trials are checked, as they would in the run, so excluding a trial drops the settings of components that only it uses. Checking only some trials runs just those, by name or position, through `?includeSubset=` and `?excludeSubset=`.

### Dev panel

`?dev=true` adds a panel that shows the current trial's props, the store and all data recorded so far.

### Turning features off

The settings page and the dev panel are available wherever the experiment runs, including a deployed study, which is often run through the settings page. A study that should not offer one of them can turn it off in the project's `.env`:

```
PUBLIC_DISABLE_SETTINGS=TRUE
PUBLIC_DISABLE_DEV=TRUE
```


## Simulation

Reactive includes a simulation system that lets you run experiments headlessly, generating synthetic data from simulated participants. This is useful for some basic computational modeling, verifying data pipelines, and sample size planning.

### Quick start

Define your participant generator in `defineExperiment`:

```tsx
export default defineExperiment({
  simulation: {
    seed: 42, // optional: makes simulations fully reproducible
    createParticipants: () => sampleParticipants('sobol', 10, {
      needForCognition: { distribution: 'normal', mean: 3.5, sd: 0.8 },
    }),
  },
  timeline: [ ... ],
});
```

### Setting params and URL params

A simulated participant's `params` set the experiment's params, for example to split participants evenly between groups:

```tsx
createParticipants: () => sampleParticipants('sobol', 10, { ... }).map((p, i) => ({
  ...p,
  params: { group: i % 2 ? 'vn' : 'scenario' },
})),
```

To produce simulated runs whose session CSV matches real Prolific runs (so payout/analysis scripts work on both), attach a `urlParams` object to each simulated participant. These are recorded like URL params the experiment does not declare, and land in the CSV with a `url_` prefix.

```tsx
import { sampleParticipants, prolificId } from '@adriansteffan/reactive';

createParticipants: () => sampleParticipants('sobol', 10, {
  needForCognition: { distribution: 'normal', mean: 3.5, sd: 0.8 },
}).map((p) => ({
  ...p,
  urlParams: {
    PROLIFIC_PID: prolificId(),
  },
})),
```

Available generators: `prolificId()` (24-char alphanumeric), `alphanumericId(length)` for custom lengths.

Run the simulation:

```
bun run simulate
```

This starts the backend on a free port, simulates all participants through the experiment, uploads data via the real backend (just like real participants would), and shuts down.

### How it works

Each built-in component (Text, Quest, CanvasBlock, Upload, etc.) has a **simulate function** and **default simulators**. The simulate function contains the trial logic. The simulators are replaceable decision functions that model participant behavior at each interaction point.

For example, Quest's simulate function iterates through questions and calls `simulators.answerQuestion()` for each one. The default `answerQuestion` picks random valid answers. You can override it to model specific participant behavior.

Simulators and simulate functions take a single object, so each one names only what it uses. A simulator receives `props` and `participant`, plus whatever the simulate function passes along (`question`, for `answerQuestion`). It returns its decision, and a new `participantState` if the participant changed; without one, the participant stays as it was.

### Overriding simulators on a trial

`.simulators()` replaces specific decision functions for one trial:

```tsx
PlainInput.trial('name', { content: <p>What is your name?</p> }).simulators({
  respond: ({ participant }) => ({ value: participant.nickname }),
}),
```

The override is merged with the component's defaults — you only need to specify the decision functions you want to change.

### Custom components

Give your custom components a simulation in `defineComponent`:

```tsx
export default defineComponent({
  name: 'MyTrial',
  component: MyTrialView,
  // Simulate function: uses shared trial logic + decision functions
  simulate: ({ props, simulators, participant }) => {
    const choice = simulators.decide({ props, participant });
    return { responseData: { choice: choice.value }, participantState: choice.participantState };
  },
  // Default simulators: one per decision point
  defaultSimulators: {
    decide: () => ({ value: 'default_choice' }),
  },
});
```

A simulate function receives the trial's `props`, the `participant` and the `simulators`, along with the timeline context (`data`, `store`, `get`, `getOptional`), so a simulation can depend on earlier answers. When it calls several simulators in a row, it passes each one the participant the previous one returned (`participant = result.participantState ?? participant`).

The simulate function orchestrates the trial logic. The decision functions are the parts where a human would interact — these are what users override to model different participant behaviors. Its `responseData` is checked against the response type the component records with `next`. A component without `simulate` works normally, but a simulation stops at its trials with an error.

### Reproducible simulations

Add `seed` to your simulation config to make runs fully reproducible:

```tsx
simulation: {
  seed: 42,
  createParticipants: () => sampleParticipants('sobol', 100, {
    needForCognition: { distribution: 'normal', mean: 3.5, sd: 0.8 },
    agreeableness: { distribution: 'normal', mean: 3.0, sd: 1.0 },
    age: { distribution: 'uniform', min: 18, max: 65 },
  }),
},
```

Participants are simulated in one process, several at a time (`concurrency`, by default the number of CPU cores). The `seed` controls two separate phases:

- **Participant generation**: `createParticipants` is called with the base `seed` when the simulation starts, so the list is the same in every run, and stays the same while you edit the experiment.
- **Simulation behavior**: Each participant draws from its own random stream, seeded with the `seed` and the participant's index. The streams of the participant list and of every participant never overlap, also between runs with different seeds, so many seeded runs give independent datasets. The stream covers params' defaults, the timeline's own random draws (trial order) and simulator callbacks. The stream follows the participant across waits, so participants simulated at the same time draw exactly as if each ran alone.

Without `seed`, simulations use random entropy and will vary between runs. `Math.random()` is also routed through these streams, so existing code and third-party libraries are automatically reproducible.

`createParticipants` produces the participants when the simulation starts. That way anything drawn at random in it is drawn from the seed, and a fixed list works the same way:

```tsx
// Fixed
createParticipants: () => [{ id: 1, speed: 2 }, { id: 2, speed: 0.5 }],

// Drawn
createParticipants: () => {
  const base = sampleParticipants('random', 100, {
    openness: { distribution: 'normal', mean: 3.5, sd: 0.8 },
  });
  return base.map((p, i) => ({
    ...p,
    curiosity: p.openness * 0.7 + normal(0, 0.3),
    id: i,
  }));
},
```

**Note:** Random numbers drawn at the top of a file, outside params' defaults and the timeline function, are drawn once and shared by every simulated participant, while real participants each get their own. The simulation warns when the experiment draws random numbers while it loads.

To model distinct populations, combine them inside the factory:

```tsx
createParticipants: () => {
  const smokers = sampleParticipants('sobol', 50, {
    alertness: { distribution: 'normal', mean: 2.8, sd: 0.7 },
  }).map((p) => ({ ...p, smoker: true }));

  const nonSmokers = sampleParticipants('sobol', 50, {
    alertness: { distribution: 'normal', mean: 3.6, sd: 0.5 },
  }).map((p) => ({ ...p, smoker: false }));

  return [...smokers, ...nonSmokers];
},
```

### Built-in simulator decision functions

| Component | Decision functions | Default behavior |
|---|---|---|
| Text | `respond` | Click button, random reaction time |
| PlainInput | `respond` | Returns `'simulated_input'` |
| Quest | `answerQuestion`, also given `question` | Random valid answer per question type |
| CanvasBlock | `respondToSlide`, also given `slide` | Random key from `allowedResponseKeys`, random RT |
| Tutorial | `respondToSlide`, also given `slideIndex` | Advances through slides, no interaction data |
| RandomDotKinematogram | `respond` | Random key from `allowedResponseKeys`, random RT (may timeout) |
| Upload | *(none)* | Builds CSVs and POSTs to backend |
| StoreUI | *(none)* | Uses field default values |
| CheckDevice | *(none)* | Returns simulated device info |
| VoiceRecording | `respondTTS`, `respondBase64` | Platform TTS with default text; falls back to dummy sine tone |
| EnterFullscreen, ExitFullscreen, MicrophoneCheck, ProlificEnding, RequestFilePermission | *(none)* | No-op, advances immediately |


## Data Saving

Reactive automatically builds CSV files from experiment data. Each component names a default CSV file for its rows, and the Upload component builds the files at the end of the experiment.

### How it works

Each component declares where its data should go with the `csv` option of `defineComponent`:

```tsx
defineComponent({ name: 'PlainInput', component: PlainInput, csv: 'session' });             // merge into session CSV
defineComponent({ name: 'CanvasBlock', component: CanvasBlock, csv: 'canvas', flatten });    // own CSV with custom flattener
defineComponent({ name: 'ProlificEnding', component: ProlificEnding, csv: null });           // no CSV output
```

Without `csv`, a component's rows go to a CSV named after the component in lowercase. Built-in components come configured. The Upload component produces CSVs automatically with no props needed:

```tsx
Upload.trial('upload')
```

### Built-in defaults

| Component | Default CSV | Notes |
|---|---|---|
| PlainInput, Quest, CheckDevice, EnterFullscreen, ExitFullscreen, MicrophoneCheck, VoiceRecording | `session` | Merged into single session row, namespaced by trial name |
| Text | `text` | One row per Text component |
| CanvasBlock | `canvas` | One row per slide, with built-in flattener |
| StoreUI | `storeui` | One row per StoreUI occurrence |
| RandomDotKinematogram | `rdk` | One row per RDK trial |
| ProlificEnding, Upload, RequestFilePermission, Tutorial | *(none)* | No CSV output |

### Output files

For a session `abc123`, the Upload component produces:
- `abc123.raw.json` — full raw data
- `session.abc123.{timestamp}.csv` — one row with params, userAgent, `buildSeed`, and all session-level trial data namespaced by trial name (e.g. `nickname_value`, `devicecheck_browser`)
- `canvas.abc123.{timestamp}.csv` — multi-row CSV from CanvasBlock trials
- One CSV per additional group (text, storeui, or any custom group)

### Per-trial CSV override

Override the default target on any trial:

```tsx
CanvasBlock.trial('practice', { timeline: practiceSlides }).csv('practice'), // separate from main canvas
CanvasBlock.trial('main', { timeline: mainSlides }),                         // uses default 'canvas'
```

Route a trial to multiple CSVs with an array:

```tsx
Quest.trial('survey', { surveyJson }).csv(['session', 'survey']), // both session row and own file
```

### Adding session-level data

Use `sessionData` on Upload to inject extra fields into the session CSV:

```tsx
// Static
Upload.trial('upload', { sessionData: { experimentVersion: 2 } }),

// Dynamic (computed from the store or earlier results)
Upload.trial('upload', ({ store, get }) => ({
  sessionData: { bonus: store.bonus, choice: get(Story, 'story').choice },
})),
```

### Custom flatteners

Give a custom component a `flatten` function to control how `responseData` becomes CSV rows:

```tsx
defineComponent({
  name: 'MyGame',
  component: MyGame,
  csv: 'games',
  flatten: (item) =>
    item.responseData.moves.map((move) => ({
      moveType: move.type,
      score: move.score,
    })),
});
```

Each row automatically gets standard trial fields prefixed with `trial_` (`trial_index`, `trial_name`, `trial_startMs`, etc.) plus any metadata from the trial. The flattener output overwrites these if keys collide.

### Array flattener

For components whose `responseData` is an array of objects (like CanvasBlock), use the built-in `arrayFlattener` instead of writing your own. Each array element becomes a CSV row with a `block` column set to the trial name:

```tsx
import { arrayFlattener, defineComponent } from '@adriansteffan/reactive';

defineComponent({ name: 'MyBlockTrial', component: MyBlockTrial, csv: 'blocks', flatten: arrayFlattener });
```

### Multi-CSV components

Map several files to their flatteners to produce multiple CSV files from one component:

```tsx
defineComponent({
  name: 'SportsGame',
  component: SportsGame,
  csv: {
    sports_actions: (item) => flattenActions(item.responseData),
    sports_players: (item) => flattenPlayers(item.responseData),
    sports_matches: (item) => flattenMatches(item.responseData),
  },
});
```

### Upload props

| Prop | Type | Default | Description |
|---|---|---|---|
| `sessionId` | `string` | random UUID | Custom session identifier used in filenames and folder names |
| `sessionData` | `Record<string, any>` | — | Extra key-value pairs added to the session CSV row |
| `generateFiles` | `({ sessionId, data, store }) => FileUpload[]` | — | Produce custom files alongside auto-generated CSVs |
| `uploadRaw` | `boolean` | `true` | Include raw JSON dump of all trial data |
| `autoUpload` | `boolean` | `true` | Upload as soon as the screen appears; `false` shows a submit button first |
| `buttonText` | `string` | `'Submit Data'` | The submit button, with `autoUpload: false` |
| `retryButtonText` | `string` | `'Try Again'` | The button shown after a failed upload |
| `parentFolder` | `string` | — | A folder for the session's folder to go into, on the server (`data/<parentFolder>/<sessionId>`) and in the apps |

### Metadata

Add metadata to a trial to include extra columns in every CSV row it produces:

```tsx
CanvasBlock.trial('block1', { timeline: slides }).metadata({ difficulty: 'hard', block: 2 }),
```

For session-level trials, metadata is namespaced by trial name (e.g. `block1_difficulty`). For non-session trials, metadata columns appear unprefixed. With `.metadata(values, { nested: true })`, the values go into a single `metadata` column instead. Metadata can also be a function of the timeline context.


## Utilities

Reactive exports helper functions for common experiment-building tasks.

```tsx
import { shuffle, sample, chunk, normal, uniform, poisson, sobol, halton, sampleParticipants } from '@adriansteffan/reactive';
```

### Array functions

These are available both as standalone functions and as methods of every array.

| Function | Signature | Description |
|---|---|---|
| `shuffle` | `shuffle(arr)` | Returns a new array with elements randomly reordered (Fisher-Yates) |
| `sample` | `sample(arr, n?)` | Returns `n` random elements from the array (default 1, with replacement) |
| `chunk` | `chunk(arr, n)` | Splits the array into chunks of `n` items; the last chunk holds what is left |
| `.pipe` | `arr.pipe(fn)` | Passes the array to `fn` and returns the result (method only) |

As methods, they chain:

```tsx
const blocks = [1, 2, 3, 4, 5, 6].shuffle().chunk(3); // two blocks of three, in random order
const practice = blocks.pipe(([first]) => first.sample(2));
```

### Distributions

Random number generators, useful for writing realistic simulations.

| Function | Signature | Description |
|---|---|---|
| `uniform` | `uniform(a, b)` | Sample from a continuous uniform distribution over `[a, b)` |
| `normal` | `normal(mu, sigma)` | Sample from a normal (Gaussian) distribution with mean `mu` and standard deviation `sigma` |
| `poisson` | `poisson(lambda)` | Sample from a Poisson distribution with rate `lambda` |

All built-in simulation functions use these distributions internally. During a simulation they draw from the participant's seeded stream (see [Reproducible simulations](#reproducible-simulations)).

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
| Integer | `{ distribution: 'integer', min, max }` | Uniform integer in `[min, max]` inclusive |
| Discrete | `{ distribution: 'discrete', outcomes }` | Weighted categorical — `outcomes: [{ value, weight }, ...]` |

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
});
// → [{ index: 0, needForCognition: 3.5, agreeableness: 3.0 }, ...]
```

The first argument is the sampling method: `'sobol'`, `'halton'`, or `'random'`.

### Drift Diffusion Model (DDM)

`simulateDDMTrial` simulates a single 2AFC trial. Parameters can be fixed numbers or distributions (`{ distribution: 'normal', mean, sd }` / `{ distribution: 'uniform', min, max }`) for inter-trial variability.

```tsx
import { simulateDDMTrial, mapDDMChoice } from '@adriansteffan/reactive';

const result = simulateDDMTrial({
  driftRate: 0.003,
  boundaries: 0.1,        // symmetric: +0.1 / -0.1
  startingPoint: 0,
  noiseLevel: 0.003,
  sensoryDelayMs: { distribution: 'uniform', min: 100, max: 200 },
  motorDelayMs: { distribution: 'uniform', min: 50, max: 100 },
  timeLimitMs: 2000,
  stimOffsetMs: 1000,
  postStimStrategy: { type: 'continue' },
});
// → { choice: 0 | 1 | null, rtMs, finalEvidence, isContaminated }

// Map DDM choice to a key press (null-safe)
mapDDMChoice(result.choice, ['f', 'j'], 'f');
```

`boundaries` can also be a `[lower, upper]` tuple for asymmetric boundaries. `choice` is `null` on timeout.

After the stimulus disappears (`stimOffsetMs`), the `postStimStrategy` takes over:
- `{ type: 'continue' }` — keep accumulating (optional `residualDrift`, `noiseMultiplier`)
- `{ type: 'snapshot' }` — forced choice by boundary proximity
- `{ type: 'collapse', collapseDef: { rate, delayMs? } }` — boundaries shrink, drift drops to 0

Boundaries can also collapse during viewing via `stimulusCollapse: { rate, delayMs? }`.

The RDK component uses this as its default simulator with parameters from Ratcliff & McKoon (2008), converted to ms time steps.


## Voice Recording

### MicrophoneCheck

Place early in your timeline to let participants select and test their microphone:

```tsx
MicrophoneCheck.trial()
```

The selected device ID is stored automatically and used by all subsequent recording components.

### VoiceRecording

A standalone trial where participants record their voice. The "Continue" button only appears after a recording is made.

```tsx
VoiceRecording.trial('description', {
  content: <p>Please describe what you saw.</p>,
})
```

With minimum duration enforcement; shows a warning when paused if the recording is too short:

```tsx
VoiceRecording.trial('decision', {
  content: <p>Please describe your decision in detail.</p>,
  minDurationMs: 15000,
})
```

When `minDurationMs` is set, only pause and discard buttons are shown. When not set, pause, stop, and discard buttons appear with playback after stopping.

| Prop | Default | Description |
|---|---|---|
| `content` | — | Prompt text/JSX |
| `buttonText` | `'Continue'` / `'Save & Continue'` (with minDurationMs) | Button text |
| `shortButtonText` | `'Continue without improving'` | Button text when recording is too short |
| `shortRecordingWarning` | Generic message | Warning text for short recordings |
| `minDurationMs` | — | Minimum recording duration |
| `showVisualizer` | `true` | Show volume level meter |
| `eagerUpload` | `true` | Upload audio immediately after recording |
| `animate` | `false` | Fade-in animation |

Audio recordings are automatically extracted as separate `.webm` files during upload and eagerly uploaded to reduce final upload size. The trial `name` is used in the filename.

To transcribe the recordings with Whisper in Docker, add the transcription setup to the project with `bunx @adriansteffan/reactive add transcription`; the project's README explains how to run it.


## LLM Integration

`invokeLLM` is a general-purpose function for calling LLM APIs. It works with any OpenAI-compatible endpoint (OpenAI, HuggingFace). Responses are cached to disk (`.reactive-cache/llm.json`) so repeated calls with the same arguments skip the API.

```tsx
import { invokeLLM } from '@adriansteffan/reactive';

const text = await invokeLLM(
  { provider: 'openai', model: 'gpt-4o-mini', apiKey: process.env.OPENAI_API_KEY! },
  'Describe a financial decision.'
);
```

### Structured output

Pass a JSON Schema as the third argument to constrain the model's output:

```tsx
const result = await invokeLLM(
  { provider: 'openai', model: 'gpt-4o-mini', apiKey: process.env.OPENAI_API_KEY! },
  'Describe a decision.',
  {
    type: 'object',
    properties: {
      text: { type: 'string' },
      confidence: { type: 'number' },
    },
    required: ['text', 'confidence'],
  }
);
const parsed = JSON.parse(result);
// parsed.text and parsed.confidence are guaranteed to exist
```

### Configuration

| Field | Type | Description |
|---|---|---|
| `provider` | `'openai' \| 'huggingface'` | API provider |
| `model` | `string` | Model name (e.g. `'gpt-4o-mini'`) |
| `apiKey` | `string` | API key |
| `baseUrl` | `string?` | Override the API endpoint |

Keep API keys in `.env.local`, which Bun loads automatically and the project's `.gitignore` excludes. Add `.reactive-cache/` to your `.gitignore`.


## Android and iOS apps

Experiments can be packaged as Android or iOS apps with [Capacitor](https://capacitorjs.com/). The apps store data on the device instead of uploading it. To add this to a project, run in its root directory:

```
bunx @adriansteffan/reactive native
```

This installs the Capacitor packages, creates `capacitor.config.ts` and imports `@adriansteffan/reactive/native` in `src/main.tsx`. It makes sense to develop with the web version and only switch to the device emulators for device-specific features and testing before packaging.

### Android

#### Setup

To build and test an Android app containing your experiment, you will need an installation of 
[Android Studio](https://developer.android.com/studio) and [Java 21 or later](https://www.oracle.com/de/java/technologies/downloads/)

To set up the android project, run this command in the root directory:
```
bunx cap add android
```

Next, find the [path to your local android sdk](https://stackoverflow.com/questions/25176594/android-sdk-location) and create a `local.properties` file in the `android` folder with the following content:

```
sdk.dir=SDK_PATH_HERE
```

If you want to enable file saving for Android versions <= 10, add these lines to the `android/app/main/AndroidManifest.xml`:

```
<manifest xmlns:android="http://schemas.android.com/apk/res/android"> // this line is already there

    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
    
    <!-- For Android 10+ (API 29+) -->
    <uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
    <uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />
    <uses-permission android:name="android.permission.READ_MEDIA_AUDIO" />

    <application
        android:requestLegacyExternalStorage="true" // add this to the application tag
```

For more information, refer to the [Capacitor documentation on Android](https://capacitorjs.com/docs/android)


#### Running

Whenever you have made changes to the code and want to run it on the Android emulator, run:
```
bun run build
bunx cap sync
bunx cap run android
```

#### Packaging

From the root directory, run

```
bunx cap open android
```

. Wait for Android Studio to install the project dependencies and then run Build > Generate APKs and Bundles > Generate APKs. Once your build is finished, there will be a popup guiding you to the location of the bundle's app that you can transfer to your Android device.

#### Where is my data stored?

In the "Internal Storage" section of the file browser, you will find a "Documents" folder that will contain subfolders with your data as soon as the first participant has finished the experiment.

### iOS

#### Setup

To build an iOS app containing your experiment, you will need a machine running MacOS and an installation of [XCode](https://apps.apple.com/us/app/xcode/id497799835). Furthermore, you will need to install [CocoaPods](https://cocoapods.org/), which is most easily installed with [Homebrew](https://brew.sh/).

To set up the iOS project, run 

```
bunx cap add ios
```

Then, go to `ios > App > App > Info.plist`

And add these lines next to the other keys:

```
<key>UIFileSharingEnabled</key>
<string>YES</string>
<key>LSSupportsOpeningDocumentsInPlace</key>
<string>YES</string>
```

For more information, refer to the [Capacitor documentation on iOS](https://capacitorjs.com/docs/ios)

#### Running

Whenever you have made changes to the code and want to run it on the iOS emulator, run:

```
bun run build
bunx cap sync
bunx cap run ios
```

#### Packaging

Packaging iOS apps is quite an undertaking, which is why the process is not overly streamlined/documented yet. The best way to get your experiment on an iOS device right now is to run

```
bunx cap run ios
```

which will open the finished project in XCode. From there, follow a guide on how to sign, bundle and install your app/experiment.

#### Where is my data stored?

After the first participant is run, a folder with the name of your app will appear under "My iPhone/iPad" in the files app, which contains your data.


## Development

`ARCHITECTURE.md` explains how the library is put together. The package is published as TypeScript source, so there is no build step. `sideEffects` in `package.json` lists the files that do something when they are imported: the CSS, the array methods and the native integration. A project's production build leaves out every other file it does not use, so a new file that has to run on import belongs on that list.

Check it with

```
bun test
bun run typecheck
bun run lint
```

To try changes in a project, create a global link once:
```
bun link
```

Then set up a local testing project (run from the parent directory so it's created as a sibling):

```
cd ..
bun reactive/bin/setup.js
cd <project-name>
npm pkg set dependencies.@adriansteffan/reactive="*"
bun install
bun link @adriansteffan/reactive
```

The linked library would otherwise use React from its own `node_modules`, and two copies of React break hooks. So point the library's React at the project's, from the root of this repo:

```
rm -rf node_modules/react node_modules/react-dom
ln -s ../../<project-name>/node_modules/react node_modules/react
ln -s ../../<project-name>/node_modules/react-dom node_modules/react-dom
```

Changes to the library then show up in the project's dev server immediately. Running `bun install` in this repo replaces the links with regular copies, so repeat these three commands afterwards.


Manually publishing to npm (until we figure out a better ci/cd process):
```
npm publish
```

Use npm 11 or later, older versions leave `template/.gitignore` out of the package.


## Authors

* **Adrian Steffan** - [adriansteffan](https://github.com/adriansteffan)