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
    Text.trial('thanks', ({ data }) => ({
      content: <p>Thank you, {PlainInput.getLatest(data, 'nickname').recorded.value}!</p>,
    })),
    Upload.trial('upload'),
  ],
});
```

`config` sets `showProgressBar` and the `theme`: `'light'` (the default), `'dark'`, or `'dark-plain'`, a dark theme without the background pattern. The other fields of `defineExperiment` are `params` (below) and `simulation` (see [Simulation](#simulation)).

Premade components available so far:

* Text: A simple display of Text and a Button
* Stimulus: Any React or a canvas, answered by keys, buttons, or the content itself (see [Stimuli](#stimuli))
* PlainInput: A text input with a prompt, of one line or several (`rows`), that can ask for a minimum length (`minLength`)
* MicrophoneCheck: used to test the voice recording feature and choose a preferred microphone to use
* CanvasBlock: A sequence of canvas slides with keyboard responses, for timed tasks (see [Timed slides](#timed-slides))
* StoreUI: A form that writes its fields to the store
* CheckDevice: Gathers information about the participant's device and can stop participants whose device does not fit
* fullscreenBlock: Runs its trials in fullscreen, after a screen that asks the participant into it (see [Fullscreen](#fullscreen))
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

Name every trial your analysis needs to find, or give it metadata that identifies it, such as a stimulus id. Rows carry no other lasting identity: their `trialNumber` is the order in which the participant saw the trials, which shifts whenever the timeline changes.

Further settings are chained. Every method returns a new trial and leaves the one it was called on unchanged. Passing `undefined` leaves a setting as it is, which keeps optional settings inline. Variants of a trial are made by a function:

```tsx
const feedback = (name: string, content: ReactNode) => Text.trial(name, { content, buttonText: 'Continue' });

feedback('slow', <p>Take your time.</p>),
Text.trial('instructions').metadata(isPractice ? { practice: true } : undefined),
```

| Method | Description |
|---|---|
| `.metadata(values)` | Extra values for this trial's rows, kept apart from what it recorded and merged into those set before (see [Metadata](#metadata)) |
| `.csv(files)` | Renames the CSV files of this trial's rows, or keeps them out with `null` (see [Per-trial CSV files](#per-trial-csv-files)) |
| `.session(enabled)` | Puts this trial's columns in the session CSV, or keeps them out with `false`, whatever its component does (see [Session columns](#session-columns)) |
| `.simulators(simulators)` | Replaces some of the component's simulators (see [Simulation](#simulation)) |
| `.collectRefreshRate(enabled?)` | Measures the screen's refresh rate while the trial runs, for later canvas trials |
| `.hideParams(names \| true)` | Hides the component's params from the settings page; the names must be the component's params |

Times are in milliseconds everywhere, in props as in the recorded data, and their names end in `Ms`: `durationMs`, `reactionTimeMs`, and each row's `startMs` and `endMs`.

### Reading results

Props, metadata, conditions and store updates can be functions of the timeline context (`TimelineContext`), which they receive when the trial runs. Its `data` holds everything recorded so far, which every component reads with `getAll` and `getLatest`, typed by the component:

```tsx
Text.trial(({ data }) => ({ content: <p>Hello {PlainInput.getLatest(data, 'nickname').recorded.value}</p> }));

// Repeat the practice until 8 of the last 10 answers are correct
whileBlock(({ data }) => Stimulus.getAll(data, 'practice').slice(-10)
  .filter((row) => row.recorded.response === row.metadata?.correct).length < 8, [practice]),
```

`getAll(data)` returns the rows of the component's trials, in the order they ran, and `getAll(data, 'practice')` those of its trial named `practice`, as often as it ran; unnamed trials, such as those made in a loop, are found by their `metadata`. `getLatest(data, 'nickname')` returns the latest row of a named trial, and `getLatest(data)` that of the component's most recent trial, such as feedback after each trial of a loop needs. Both stop if no such trial has run yet; for a trial that may have been skipped, `getAll(data, 'nickname').at(-1)` is `undefined` until it has run. A row holds the trial's `recorded`, its `metadata`, and its `trialNumber`, `startMs`, `endMs` and `durationMs`. A name that is not the component's in the timeline stops the experiment during development and simulation; for real participants it is logged instead. Both work wherever `data` is: in these callbacks, in your components' `data` prop, in simulate functions, and in the raw data a study uploads.

`data.trials` lists all rows, in the order the participant saw them, so `data.trials.at(-1)` is the last one and `data.trials.length` counts them. `data.session` holds what the session recorded when it started: every param with its value and declaration, the build seed, the user agent, and the timeline's named trials. The timeline context also holds the `store`, and inside a CanvasBlock, `slides` (see [Timed slides](#timed-slides)).

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
const clickedSlowly = ({ data }: TimelineContext) => CustomTrial.getLatest(data, 'customtrial').recorded.totalTimeMs > 3000;

ifBlock(clickedSlowly, [Text.trial({ content: <p>Take your time.</p> })]).else([
  Text.trial({ content: <p>That was quick!</p> }),
]),
whileBlock(({ store }) => (store.attempts ?? 0) < 3, [practiceRound]),
updateStore(({ store }) => ({ attempts: (store.attempts ?? 0) + 1 })),
marker('retry'),
ifGoto(({ data }) => !Quiz.getLatest(data, 'quiz').recorded.passed, 'retry'),
```

A condition written as a named function, like `clickedSlowly`, can be reused in several blocks and props without storing a flag. `updateStore` is for values that carry forward, such as a bonus.

`ifGoto` jumps to the `marker` with its id, forward or back, and also into the middle of a block: the rest of the block then runs, and a `whileBlock` checks its condition again when its items are done. Within a timeline, each marker id can be used once and every `ifGoto` needs its marker, which is checked when the experiment loads; a CanvasBlock's timeline has markers of its own. On the settings screen, markers cannot be deselected, and a deselected block leaves its markers in its place, so no jump loses its target.

A `whileBlock` or a jump back that repeats without ever reaching a trial would freeze the page, so the experiment stops with an error that names the loop instead.

#### Fullscreen

`fullscreenBlock` runs its trials in fullscreen:

```tsx
fullscreenBlock({ keepFullscreen: true }, [instructions, task]),
```

It starts with a screen that asks the participant into fullscreen, which browsers only allow after a click. The experiment leaves fullscreen once the run is outside the block, at its end or through a jump, so there is nothing to close.

| Option | Description |
|---|---|
| `content`, `buttonText` | The screen's text and button |
| `keepFullscreen` | Asks the participant back into fullscreen on every trial of the block: `true` for a small button, `{ buttonText }` to change its text, or `{ mode: 'overlay', content, buttonText }` for a screen over the trial |
| `stopOnFailure` | Ends the experiment on the screen when the browser cannot enter fullscreen, instead of asking again; nothing is uploaded |
| `errorContent` | Shown when the browser could not enter fullscreen |
| `delayMs` | How long after entering fullscreen the block's first trial starts |
| `className`, `containerClass`, `centered`, `animate` | The screen's look, as for Text |

On the settings screen, the block's screen is listed as an item of its own, so the trials can run without fullscreen while you test them.

Within one timeline, two different trials cannot share a name, even if their components differ, unless they sit in different branches of the same `ifBlock`. A name cannot be `url` or `session`, or start with `url_` or `session_`, since its columns in the session CSV would then take the library's (see [Output files](#output-files)); the types reject these names too. An unnamed trial that goes to the session CSV is named after its component for its columns there: the first `PlainInput` (`PlainInput_value`), the next ones `PlainInput_2`, `PlainInput_3` and so on, in the order they appear in the timeline. These names count positions, so they change when the timeline does; give a trial a name of its own when your analysis reads its columns.

### Stimuli

`Stimulus` shows any React and takes an answer, by a key, a button, or both:

```tsx
Stimulus.trial('face', {
  content: <img src={face} />,
  response: {
    choices: {
      happy: { key: 'f', button: 'Happy' },
      sad: { key: 'j', button: 'Sad' },
    },
    timeLimitMs: 3000,
  },
  displayDurationMs: 500,
}),
```

Its row records the `response`, the `key` that gave it, empty for a button, and the `reactionTimeMs`. Without an answer in time, all three are empty. `options` lists the answers the trial offered, in order: the choices, then the keys, then the buttons, though not the keys of `keys: true`.

| `response` field | Description |
|---|---|
| `choices` | Answers recorded by their names, each given by a `key`, a `button`, or both |
| `keys` | Keys recorded as themselves, or `true` for any key |
| `buttons` | Buttons recorded as their text |
| `buttonDelayMs` | Fades the buttons in this long after the stimulus appears; they take no clicks before, while keys count and reaction times run from the stimulus as always |
| `timeLimitMs` | How long after the stimulus appears an answer counts; the trial ends then |
| `endsTrial` | Whether the first answer ends the trial; `true` by default, and otherwise the trial ends at its time limit |
| `recordAll` | Records every answer until the time limit, not only the first, so the trial lasts until then |

`displayDurationMs` hides the content after that time, while answers count until the time limit. Without a time limit, the trial ends when the content disappears. A trial needs a way to end, an answer, a time limit or a display duration, which the types check.

The buttons are all as wide as the widest, so that none stands out. `centered: false` starts the stimulus at the top of the screen instead of its middle.

With `endsTrial: false`, every trial lasts until its time limit, whenever the answer came, as fixed-duration designs need. With `recordAll`, a trial records each answer in `responses`, in order, such as a press for every target in a stream; `response`, `key` and `reactionTimeMs` still hold the first. In the stimulus CSV, such a trial has a row for each answer, or one empty row without any. Both need a time limit, and the types reject `recordAll` together with `endsTrial: true`.

Named choices record what an answer means, so a counterbalanced key mapping stays in the experiment and out of the analysis:

```tsx
timeline: ({ group }) => [
  Stimulus.trial('face', {
    content: <img src={face} />,
    response: {
      choices: {
        happy: { key: group === 'a' ? 'f' : 'j' },
        sad: { key: group === 'a' ? 'j' : 'f' },
      },
    },
  }),
],
```

Both groups record `happy` and `sad`, and the key next to it. Two answers that share a key or a button stop the experiment when it loads, since only one of them could be given.

The content can also answer by itself. As a function, it receives `respond`, which ends the trial with whatever it is given as the `response`; an object is written to the CSV as JSON. The function is rendered as a component, so it can use hooks. `Canvas` draws within the content, sized like a CanvasBlock, and its `onClick` gives a click's position in the drawing's coordinates:

```tsx
Stimulus.trial('location', {
  content: ({ respond }) => (
    <Canvas width={600} height={400} draw={drawScene} onClick={(x, y) => respond({ x, y })} />
  ),
}),
```

The simulation cannot guess such answers, so a Stimulus whose content answers needs a simulator of its own (see [Overriding simulators on a trial](#overriding-simulators-on-a-trial)):

```tsx
.simulators({ respond: () => ({ value: { response: { x: 300, y: 200 }, reactionTimeMs: 900 } }) })
```

A simulated answer is recorded as the browser would record it. Its `key` says how it was given, `null` for a button or the content's `respond`; left out, it is the answer's own key, so `{ response: 'happy', reactionTimeMs: 700 }` records the F of the example above. An answer the Stimulus does not take, or a key that gives another answer, stops the simulation with an error. For a trial that records every answer, `respond` is asked again after each, with the `answers` so far, until it gives none or one after the time limit; each answer has to come after the one before:

```tsx
// a tap every 700 ms
.simulators({ respond: ({ answers }) => ({ value: { response: ' ', reactionTimeMs: (answers.length + 1) * 700 } }) })
```

Times work as for slides (below): a reaction time runs from the frame with which the stimulus appeared to the moment the browser timestamped the key press or click, and a key pressed before the stimulus appeared does not count. The stimulus appears once the images in its content have loaded, so their loading time is not part of a reaction time or a display duration; an image that fails to load shows as broken. Background images in CSS and videos are not waited for. Rendering a page can take varying time, though, so fast sequences, such as a fixation cross, a 50 ms stimulus and a mask, belong in a CanvasBlock.

### Timed slides

CanvasBlock shows a sequence of slides on a canvas within one trial, for tasks that need precise timing, such as a fixation cross, a briefly shown word and a key press. It draws each slide in an animation frame, with no React rendering between slides. Its timeline holds slides, and the same blocks as the experiment's timeline. A block holds either slides or trials, and the types keep each to the timelines of its kind:

```tsx
import { CanvasBlock, ifBlock, type Slide } from '@adriansteffan/reactive';

const fixation: Slide = {
  draw: (ctx, w, h) => ctx.fillText('+', w / 2, h / 2),
  displayDurationMs: 500,
  ignoreData: true,
};

const stimulus = (word: string): Slide => ({
  draw: (ctx, w, h) => ctx.fillText(word, w / 2, h / 2),
  displayDurationMs: 200,
  response: { keys: ['f', 'j'], timeLimitMs: 2000 },
  metadata: { word },
});

const wrongKey: Slide = { draw: (ctx, w, h) => ctx.fillText('Wrong key', w / 2, h / 2), displayDurationMs: 500 };

CanvasBlock.trial('main', {
  timeline: words.map((word) => [
    fixation,
    stimulus(word),
    ifBlock(({ slides }) => slides.at(-1)?.key !== 'f', [wrongKey]),
  ]),
}).metadata({ condition: 'hard' }),
```

| Slide field | Description |
|---|---|
| `draw(ctx, width, height)` | Draws the slide on a canvas cleared to white, with black as the fill color |
| `displayDurationMs` | How long the drawing stays visible |
| `response.keys` | The keys that count as a response, or `true` for any key (see below) |
| `response.choices` | Responses recorded by their names, each given by its `key`, as on a Stimulus |
| `response.click` | Takes a click on the canvas as a response |
| `response.timeLimitMs` | How long after the slide appears a response counts |
| `response.endsSlide` | Whether the first response ends the slide; `true` by default |
| `response.hidesDrawing` | Clears the drawing at the first response |
| `ignoreData` | Records no row for the slide |
| `metadata` | Extra values for the slide's row |

A slide with a `response` ends at the first response, unless `endsSlide` is `false`. Otherwise it ends when the response's time limit runs out, or, without one, when its display duration does; the drawing can disappear earlier while keys still count. A slide needs one of these ways to end, which the types check; an empty list of keys or choices, which they cannot see, stops the experiment during development and simulation. TypeScript explains a slide's mistakes best where it is declared as a `Slide`, like `fixation` above, rather than written inside the timeline.

Keys are named as the browser names them in `KeyboardEvent.key`: a letter, a digit or symbol, `' '` for the space bar, or a named key such as `'Enter'` or `'ArrowLeft'`, which editors suggest. Any other name the browser gives works as well, such as `'ö'` on a German keyboard. Keys count in any case, so caps lock does not matter and `'enter'` is `'Enter'`, and the slide's row records the key as the list names it. Text's and the RandomDotKinematogram's `allowedResponseKeys` work the same way.

A slide can also be a function of the timeline context, which runs once, when the slide starts. Inside a CanvasBlock, the context's `slides` holds the rows of the block's slides so far, while `data` holds the experiment's trials, as everywhere else. `updateStore` changes the store for the rest of the block, and the block's changes reach the experiment's store when it ends.

Each slide records a row with its `slideNumber`, which counts the slides the participant saw from 1, including those that record nothing; `startMs`, `endMs` and `durationMs`; and the `key` pressed and its `reactionTimeMs`, or `null` without a response. A slide with `choices` also records the `response`, the name of the choice the key gave, so that keys counterbalanced across participants are recorded by what they mean. A slide that takes clicks records where the click landed as `x` and `y`, in the coordinates `draw` uses, and its `key` is `null`. Clicks count by the same rules as keys: from the frame with which the slide appeared, judged at the next frame. In the canvas CSV, every slide is a row: its metadata is in `meta_` columns (`meta_word`), and the block's own metadata in `slideblock_meta_` columns (`slideblock_meta_condition`).

Times are taken from the frames the browser shows. A slide appears with the first frame after the one that draws it, and `startMs` is that frame's time; `endMs` is when the next frame takes it down. A reaction time runs from `startMs` to the moment the browser timestamped the key press, so the time the page needs to handle the key is not part of it, and a held key's repeats do not count. Durations are counted in frames: a slide is taken down on the frame nearest its duration when the screen's refresh rate is known, from `.collectRefreshRate()` on an earlier trial, and otherwise on the first frame at or after it.

| CanvasBlock prop | Description |
|---|---|
| `timeline` | The slides and blocks |
| `width`, `height` | The canvas's size: pixels as a number, a share of the screen as a percentage (`'80%'`), or a ratio of width to height (`'16:9'`), which sets this side from the other, or alone makes the largest canvas of that shape that fits the screen; the largest square that fits by default |
| `styleCanvas(ctx, width, height)` | Sets colors and fonts before each slide is drawn |
| `initCanvas(ctx, width, height)` | Runs once, after the canvas is set up |

`canvasCountdown(seconds)` returns slides that count down one second each and record nothing.

### Params

Params are the experiment's inputs. They are declared once, read from the URL, and passed to `timeline`, which then becomes a function that runs once per participant:

```tsx
export default defineExperiment({
  params: {
    group: {
      values: ['vn', 'scenario'],
      random: true,
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

* A param is read from the URL by its key (`?group=scenario&rounds=5`), otherwise its default is used. A default that is a function is called once per participant, with the param's `values` if it has any, as in `default: (values) => (Math.random() < 0.8 ? values[0] : values[1])` for groups of unequal size. With `random: true` in place of a default, each participant gets one of the `values` at random.
* With `values`, the param is typed as one of them (`'vn' | 'scenario'`), and its default, or what a default function returns, must be one of them too. Without `values`, the param takes the type of its default.
* Whatever sets a param, the URL, a simulated participant or a default function, a value of another type stops the experiment with an error: one outside `values`, text for a number, or anything but `true` or `false` for a switch. Only a default function without `values` declares no type, so its values are not checked.
* The settings page shows the `description`, and what the default is: its value, or that it is drawn at random or computed for each participant. A `defaultDescription` takes the place of that, so it can say how a function chooses it, or what a value like `0` stands for.
* `hidden: true` leaves a param off the settings page, such as one that only tests need. A link can still set it.
* The resolved values are recorded in the data. Simulated participants can set them (see [Simulation](#simulation)).
* `timeline` may use any JavaScript, such as `shuffle` or loops. Its random draws are seeded per participant, and the seed (`buildSeed`) is recorded, so the exact timeline a participant saw can be rebuilt later.
* Params exist only inside `timeline`. Parts of the timeline in other files that need one become functions that take it, and components get it as a prop.
* Each param is a column of the session CSV, so a param cannot be named `sessionId`, `userAgent` or `buildSeed`, or start with `url_` or `session_`. The types reject these names, and so does the run.

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
function ReactionView({ next, target }: BaseComponentProps<{ reactionTimeMs: number }> & { target: string }) {
  ...
  next({ reactionTimeMs });
}

export default defineComponent({
  name: 'Reaction',
  component: ReactionView,
  csv: 'reactions', // optional, see Data Saving
  simulate: ({ props, simulators, participant }) => { ... }, // optional, see Simulation
  defaultSimulators: { ... }, // optional
});
```

`BaseComponentProps<R>` gives the component `next`, which records what the trial measured, of type `R`, and moves on (only a type that allows `undefined` can be left out), along with `data`, `store`, `updateStore` and `name`, the trial's name. Only `name` and `component` are required. The name identifies the component in the data, since function names do not survive minification. A defined component is still an ordinary React component.

Write the component as a named function, as above, rather than inline in `defineComponent`: hot reloading then keeps the state of a trial that is on screen when its file changes.

A component that measures times takes them with `now()`, the clock of the rows' `startMs` and `endMs`. To match the built-in screens, `useTheme()` returns the experiment's theme, and `t(theme)` its Tailwind classes, such as `t(useTheme()).button` for a button that ends a screen and `.article` for a screen's text. Headings in an `.article` are set in Besley, which other headings get with the class `font-besley`.

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

`as const` keeps the `values` of a param as a union of them, as `defineExperiment` does. A param that `useParams` reads but `defineComponent` does not declare would have no value, so it stops the experiment during development and simulation.

A component can check each of its trials when the experiment loads, with `check`. It gets the trial's `props` (`undefined` when they are computed during the run), the run's `params`, every trial of the timeline as `trials` with this one's `index`, and `production`, which is true in a production build. It returns what is wrong, if anything. Any message keeps the run from starting, and the settings screen shows it while you build a link. A check for something only the real link provides, such as a URL param, can leave development and simulation alone by returning nothing unless `production` is set:

```tsx
defineComponent({
  name: 'ProlificEnding',
  …,
  check: ({ props, params, trials, index, production }) => {
    if (!trials.slice(0, index).some((trial) => trial.type === 'Upload')) {
      return 'ProlificEnding ends the experiment, so an Upload has to come before it, or the data is never saved.';
    }
    if (production && props !== undefined && !props.prolificCode && !params.cc) {
      return 'ProlificEnding has no completion code to show: set its prolificCode, or the cc param in the link.';
    }
  },
});
```

This is ProlificEnding's own check. A ProlificEnding without an Upload before it stops the run everywhere, and in production, so does one without a completion code. The checks see the trials the run will show, so deselecting the Upload on the settings screen while keeping the ProlificEnding stops the run as well.

A component that talks to the experiment's server, such as a multiplayer game or a streamed API response, reaches the routes in `server.ts` at `getBackendUrl()`. That is `/backend` in the browser and the simulation's own server while simulating, so the component and its `simulate` can use the same call:

```tsx
const response = await fetch(`${getBackendUrl()}/match`, { method: 'POST', body: JSON.stringify({ id }) });
```

Simulated participants run at the same time against that one server, so they can also interact through it.

### Hot reloading

Edits to the experiment or to its components keep the participant where they are: the timeline is rebuilt with the same params and seed, the trial on screen stays mounted with its state, and it receives its new props. An edit that removes the trial on screen falls back to the same position.

### Settings page

`/settings` builds a link for a run. It lists the experiment's params, the general settings (`dev`), and custom params, which are recorded as text, in `url_` columns. Below them come the trials, which follow the params entered above, and the settings of the components in the selected trials, by component. When `timeline` is a function, both can differ with every param whose default is computed, so they only appear once these params are set. What was unchecked or entered there stays in the link when such a param is cleared again. The trials inside an `ifBlock` or `whileBlock` are listed under it, and unchecking a block unchecks all of them. The checked trials run, as does any trial that other param values add; the link lists the unchecked ones in `?excludeSubset=`, each by its name, or without one by its position (`4.2` for the second item of the fourth entry). A block whose items are all unchecked is left out with them. The settings follow which trials are checked, as they would in the run, so unchecking a trial drops the settings of components that only it uses.

### Dev panel

`?dev=true` adds a panel that shows the current trial's props, the store and all data recorded so far.

### Turning features off

The settings page and the dev panel are available wherever the experiment runs, including a deployed study, which is often run through the settings page. A study that should not offer one of them can turn it off in the project's `.env.production`:

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
  timeline: [ ... ],
  simulation: {
    seed: 42, // optional: makes simulations fully reproducible
    createParticipants: () => sampleParticipants('sobol', 10, {
      needForCognition: { distribution: 'normal', mean: 3.5, sd: 0.8 },
    }),
  },
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

Simulators and simulate functions take a single object, so each one names only what it uses. A simulator receives `props` and `participant`, plus whatever the simulate function passes along (`question`, for `answerQuestion`). It returns `{ value, participant }`: its decision as `value`, and the new `participant` if the participant changed; without one, the participant stays as it was.

### Overriding simulators on a trial

`.simulators()` replaces specific decision functions for one trial:

```tsx
PlainInput.trial('name', { content: <p>What is your name?</p> }).simulators({
  respond: ({ participant }) => ({ value: participant.nickname }),
}),
```

The override is merged with the component's defaults — you only need to specify the decision functions you want to change. A replacement returns what the function it replaces returns, which the types check, and may leave out `participant` to keep the participant as it was. A CanvasBlock's `respondToSlide` also receives the `slide`, so one replacement can decide each slide's response.

A replacement also receives the component's default simulator, to build on what it decides. It runs the default with the input passed to it:

```tsx
Text.trial('intro').simulators({
  // The default response, only twice as slow
  respond: (input, defaultSimulator) => {
    const result = defaultSimulator(input);
    return { ...result, value: { ...result.value, reactionTimeMs: result.value.reactionTimeMs * 2 } };
  },
}),
```

Spreading `result` keeps the participant the default returned. To run the default for a different participant, pass it one: `defaultSimulator({ ...input, participant: changed })`.

### Custom components

Give your custom components a simulation in `defineComponent`:

```tsx
export default defineComponent({
  name: 'MyTrial',
  component: MyTrialView,
  // Simulate function: uses shared trial logic + decision functions
  simulate: ({ props, simulators, participant }) => {
    const result = simulators.decide({ props, participant });
    return { recorded: { choice: result.value }, participant: result.participant };
  },
  // Default simulators: one per decision point
  defaultSimulators: {
    decide: () => ({ value: 'default_choice' }),
  },
});
```

A simulate function receives the trial's `props`, the `participant` and the `simulators`, along with the timeline context (`data` and `store`), so a simulation can depend on earlier answers, read with `getAll` and `getLatest`. When it calls several simulators in a row, it passes each one the participant the previous one returned (`participant = result.participant ?? participant`), and returns the last one as its `participant`.

A component that records nothing, such as a screen of instructions, can use `simulate: noopSimulate`, which moves on at once.

The simulate function orchestrates the trial logic. The decision functions are the parts where a human would interact — these are what users override to model different participant behaviors. What it returns as `recorded` is checked against the type the component records with `next`. A component without `simulate` works normally, but a simulation stops at its trials with an error.

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

| Component | Decision functions | Its `value` | Default behavior |
|---|---|---|---|
| Text | `respond` | `{ key, reactionTimeMs }` | Click button, random reaction time |
| Stimulus | `respond`, also given the `answers` so far | `{ response, reactionTimeMs }`, and optionally the `key` that gave it | One random answer from `choices`, `keys` and `buttons`, random RT, after `buttonDelayMs` for a button; a Stimulus whose content answers needs its own |
| PlainInput | `respond` | the text entered | Returns `'simulated_input'`, filled up to `minLength` |
| Quest | `answerQuestion`, also given `question` | `{ answer, durationMs }` | Random valid answer per question type |
| CanvasBlock | `respondToSlide`, also given `slide` | `{ key, reactionTimeMs }`, or `{ x, y, reactionTimeMs }` for a click | Random key from the slide's `keys` and `choices`, or a random point on a slide that takes clicks, random RT; it counts under the same rules as a real response |
| Tutorial | `respondToSlide`, also given `slideIndex` | `{ data, durationMs }` | Advances through slides, no interaction data |
| RandomDotKinematogram | `respond` | `{ key, reactionTimeMs }` | Random key from `allowedResponseKeys`, random RT (may timeout) |
| Upload | *(none)* | | Builds CSVs and POSTs to backend |
| StoreUI | *(none)* | | Uses field default values |
| CheckDevice | *(none)* | | Returns simulated device info |
| VoiceRecording | `respondTTS`, `respondBase64` | the text to speak, or the audio as base64 | Platform TTS with default text; falls back to dummy sine tone |
| fullscreenBlock's screen, MicrophoneCheck, ProlificEnding, RequestFilePermission | *(none)* | | No-op, advances immediately |


## Data Saving

Reactive automatically builds CSV files from experiment data: the session CSV, with one row per participant, and files with rows per trial. The Upload component builds the files at the end of the experiment.

### How it works

Each component declares where its data should go, with the `csv` and `session` options of `defineComponent`:

```tsx
defineComponent({ name: 'PlainInput', component: PlainInput, session: true });               // columns in the session CSV
defineComponent({ name: 'CanvasBlock', component: CanvasBlock, csv: { canvas: flatten } });  // own CSV with custom flattener
defineComponent({ name: 'ProlificEnding', component: ProlificEnding, csv: null });           // no CSV output
```

Without `csv`, a component's rows go to a CSV named after the component in lowercase, unless it sets `session`. Built-in components come configured. The Upload component produces CSVs automatically with no props needed:

```tsx
Upload.trial('upload')
```

### Built-in defaults

| Component | Default CSV | Notes |
|---|---|---|
| PlainInput, Quest, CheckDevice, VoiceRecording | session | Columns in the single session row, namespaced by trial name |
| Text | `text` | One row per Text component |
| Stimulus | `stimulus` | One row per Stimulus |
| CanvasBlock | `canvas` | One row per slide, with built-in flattener |
| StoreUI | `storeui` | One row per StoreUI occurrence |
| RandomDotKinematogram | `rdk` | One row per RDK trial |
| fullscreenBlock's screen, MicrophoneCheck, ProlificEnding, Upload, RequestFilePermission, Tutorial | *(none)* | No CSV output |

### Output files

For a session `abc123`, the Upload component produces:
- `abc123.raw.json` — all the data, as `{ "session": …, "trials": [ … ] }`, with recordings replaced by the names of their files
- `session.abc123.{timestamp}.csv` — one row with `sessionId`, `userAgent`, `buildSeed`, the params, URL params that nothing declares (`url_…`), the Upload's `sessionData` (`session_…`), and all session-level trial data namespaced by trial name (e.g. `nickname_value`, `devicecheck_browser`)
- `canvas.abc123.{timestamp}.csv` — multi-row CSV from CanvasBlock trials
- One CSV per additional group (text, storeui, or any custom group)

### Per-trial CSV files

A trial can rename its component's CSV file:

```tsx
CanvasBlock.trial('practice', { timeline: practiceSlides }).csv('practice'), // separate from main canvas
CanvasBlock.trial('main', { timeline: mainSlides }),                         // uses default 'canvas'
```

The file keeps its flattener under the new name, so the practice CSV also has one row per slide. Flatteners belong to the component, and a trial never needs one of its own.

A component that only fills the session row has no file to rename, so a name gives its trial one, next to its session columns:

```tsx
Quest.trial('survey', { surveyJson }).csv('survey'), // both session row and own file
```

For a component with several files (see [Multi-CSV components](#multi-csv-components)), the trial names the files it renames, and the others stay as they are; `null` leaves one out:

```tsx
SportsGame.trial('practice').csv({ sports_actions: 'practice_actions', sports_matches: null }),
```

A name of a file the component does not write, or a plain name for a component with several files, stops the experiment when it loads. So does the name `session`, which belongs to the session CSV; `.session(true)` puts a trial's columns there.

### Session columns

The session CSV holds a single row per participant. A component with `session: true` gives each of its trials columns there, one per field of the response, prefixed with the trial's name (`nickname_value`). A function picks the columns instead, and returns them as one object:

```tsx
defineComponent({
  name: 'SportsGame',
  component: SportsGame,
  session: (item) => ({ finalScore: item.recorded.score }), // game_finalScore for a trial named 'game'
  csv: { sports_actions: (item) => flattenActions(item.recorded) },
});
```

A trial's `.session(true)` puts its columns in the session CSV although its component does not, and `.session(false)` keeps them out. Something recorded as a list has no fields to spread into columns, so it needs a function: the types reject `true` for it, and a list that reaches the session CSV from a component that does not declare its response stops the experiment during development and simulation.

### Adding session-level data

Use `sessionData` on Upload to inject extra fields into the session CSV. Their columns are prefixed with `session_` (`session_experimentVersion`), so they never take the place of a param:

```tsx
// Static
Upload.trial('upload', { sessionData: { experimentVersion: 2 } }),

// Dynamic (computed from the store or earlier results)
Upload.trial('upload', ({ store, data }) => ({
  sessionData: { bonus: store.bonus, choice: Story.getLatest(data, 'story').recorded.choice },
})),
```

### Custom flatteners

Without a flattener, each trial is one row, with the fields it recorded as columns, and a trial that recorded a list is one row per item, like CanvasBlock's slides. To give a trial rows of another shape, map the file to a function that returns its row, or a list of rows. The function reads the trial's row with the component's response, so TypeScript checks what it reads:

```tsx
defineComponent({
  name: 'MyGame',
  component: MyGame,
  csv: {
    games: (item) =>
      item.recorded.moves.map((move) => ({
        moveType: move.type,
        score: move.score,
      })),
  },
});
```

Each row automatically gets standard trial fields prefixed with `trial_` (`trial_name`, `trial_trialNumber`, `trial_startMs`, etc.) plus the trial's metadata prefixed with `meta_`.

Column names starting with `trial_`, `meta_`, `response_`, `url_`, `session_` or `slideblock_meta_` belong to the library. A field of a response or of a flattener's output whose name starts with one of them gets `response_` in front (`meta_score` becomes `response_meta_score`), so it can never take the place of a column the library writes.

### Multi-CSV components

Map several files to their flatteners to produce multiple CSV files from one component, and a file to `true` for one row per trial:

```tsx
defineComponent({
  name: 'SportsGame',
  component: SportsGame,
  csv: {
    sports_actions: (item) => flattenActions(item.recorded),
    sports_players: (item) => flattenPlayers(item.recorded),
    sports_matches: (item) => flattenMatches(item.recorded),
  },
});
```

### Upload props

| Prop | Type | Default | Description |
|---|---|---|---|
| `sessionId` | `string` | random UUID | Custom session identifier used in filenames and folder names |
| `sessionData` | `Record<string, any>` | — | Extra key-value pairs added to the session CSV row, as `session_` columns |
| `generateFiles` | `({ sessionId, data, store }) => FileUpload[]` | — | Produce custom files alongside auto-generated CSVs |
| `uploadRaw` | `boolean` | `true` | Include the raw JSON of all the data |
| `autoUpload` | `boolean` | `true` | Upload as soon as the screen appears; `false` shows a submit button first |
| `buttonText` | `string` | `'Submit Data'` | The submit button, with `autoUpload: false` |
| `retryButtonText` | `string` | `'Try Again'` | The button shown after a failed upload |
| `parentFolder` | `string` | — | A folder for the session's folder to go into, on the server (`data/<parentFolder>/<sessionId>`) and in the apps |

### Metadata

Add metadata to a trial to include extra columns in every CSV row it produces:

```tsx
RandomDotKinematogram.trial('rdk1', { coherence: 0.5 }).metadata({ difficulty: 'hard', block: 2 }),
```

In the data, metadata sits under the row's `metadata`, apart from the trial's own fields and what it `recorded`, so their names can never collide. In the CSVs, its columns are prefixed with `meta_` (`meta_difficulty`), and for session-level trials also with the trial name (`rdk1_meta_difficulty`). A CanvasBlock's metadata is in `slideblock_meta_` columns instead, next to its slides' `meta_` columns (see [Timed slides](#timed-slides)). An object value becomes a single column holding its JSON. Metadata can also be a function of the timeline context.


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
| `mean` | `mean(arr)` | The mean of an array of numbers, or 0 for an empty one |
| `sum` | `sum(arr)` | The sum of an array of numbers |
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

Both return one array of values per point, `number[][]`, also for a single dimension (`sobol(5, [spec]).map(([rt]) => rt)`).

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

A trait can correlate with the others, which it names in its `correlations`:

```tsx
sampleParticipants('sobol', 100, {
  needForCognition: { distribution: 'normal', mean: 3.5, sd: 0.8 },
  openness: { distribution: 'normal', mean: 3.0, sd: 1.0, correlations: { needForCognition: 0.4 } },
  age: { distribution: 'integer', min: 18, max: 65, correlations: { openness: -0.2 } },
});
```

Each pair is given at one of its two traits, and pairs left out are uncorrelated. Normal traits get the correlation as given. Other distributions get a somewhat weaker one, since it applies to the normal scores they are made from: 0.5 between two uniform traits comes out at about 0.48, and coarse discrete traits lose more. Correlations that contradict each other, such as a and b at 0.9 and b and c at 0.9 but a and c at -0.9, stop with an error. Correlated samples stay as evenly spread as the Sobol and Halton sequences make them.

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
// → { choice: 0 | 1 | null, reactionTimeMs, finalEvidence, isContaminated }

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

The selected device ID is stored automatically and used by all subsequent recording components. A recording component of your own reads it with `useAudioDeviceId()`.

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
| `shortRecordingContent` | Generic message | Shown when the recording is shorter than `minDurationMs` |
| `minDurationMs` | — | Minimum recording duration |
| `silenceWarningMs`, `silenceWarningContent` | — | After this many milliseconds of silence, a banner with this content asks the participant to speak up |
| `showVisualizer` | `true` | Show volume level meter |
| `eagerUpload` | `true` | Upload audio immediately after recording |
| `animate` | `false` | Fade-in animation |

Audio recordings are automatically extracted as separate `.webm` files during upload and eagerly uploaded to reduce final upload size. Each file is named after its trial's name and number (`audio_story_4.webm`), and the trial's row records the name as `audioFile`.

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

Keep API keys in `.env.development`, which Bun loads automatically on your computer and the project's `.gitignore` excludes. Add `.reactive-cache/` to your `.gitignore`.


## Android and iOS apps

Experiments can be packaged as Android or iOS apps with [Capacitor](https://capacitorjs.com/). The apps store data on the device instead of uploading it. To add this to a project, run in its root directory:

```
bunx @adriansteffan/reactive native
```

This installs the Capacitor packages, creates `capacitor.config.json` and imports `@adriansteffan/reactive/native` in `src/main.tsx`. It makes sense to develop with the web version and only switch to the device emulators for device-specific features and testing before packaging. `getPlatform()` returns `'native'` in the apps and `'web'` in the browser.

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

From the root directory, build the app with the settings in `.env.production` and open it:

```
bun run build:production
bunx cap sync
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

Packaging iOS apps is quite an undertaking, which is why the process is not overly streamlined/documented yet. The best way to get your experiment on an iOS device right now is to build it with the settings in `.env.production` and run

```
bun run build:production
bunx cap sync
bunx cap run ios
```

which will open the finished project in XCode. From there, follow a guide on how to sign, bundle and install your app/experiment.

#### Where is my data stored?

After the first participant is run, a folder with the name of your app will appear under "My iPhone/iPad" in the files app, which contains your data.


## Development

The package is published as TypeScript source, so there is no build step. `sideEffects` in `package.json` lists the files that do something when they are imported: the CSS, the array methods and the native integration. A project's production build leaves out every other file it does not use, so a new file that has to run on import belongs on that list.

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