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
* Upload: Uploads the collected data on a button press by the participant 



## Simulation

Reactive includes a simulation system that lets you run experiments headlessly, generating synthetic data from simulated participants. This is useful for some basic computational modeling, verifying data pipelines, and sample size planning.

### Quick start

Define your participant generator in `Experiment.tsx`:

```tsx
export const simulationConfig = {
  participants: {
    generator: (i) => ({ id: i, nickname: `participant_${i}` }),
    count: 10,
  },
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

### Built-in simulator decision functions

| Component | Decision functions | Default behavior |
|---|---|---|
| Text | `respond` | Click button, random reaction time |
| PlainInput | `respond` | Returns `'simulated_input'` |
| Quest | `answerQuestion` | Random valid answer per question type |
| CanvasBlock | `respondToSlide` | Random key from `allowedKeys`, random RT |
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
| ProlificEnding, Upload | *(none)* | No CSV output |

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