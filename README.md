# ReactivePsych

A framework for quickly building interactive online experiments using Typescript, React, and TailwindCSS. Comes with a template project that has all batteries included (build tools, docker deployment setup, node server for upload etc.)
The project is very early stage, so many of the abstractions are still very leaky and the documentation is largely unfinished.


## Prerequisites

You will need a current version of [node.js](https://nodejs.org/en/download/) installed on your system.

## Using the package

### Create a template project

```
npx reactive-psych
```

Then follow the instructions shown there and in the created `README.md`


### Usage

For now, refer to the `App.tsx` in the template project to find out how to define an experiment, and add custom trials and questions!

Premade components available so far:

* Text: A simple display of Text and a Button
* MicCheck: used to test the voice recording feature and choose a preferred microphone to use
* Quest: SurveyJS questionnaires
    * ... all questiontypes supported by SurveyJS can be used
    * voicerecorder: a custom question type that allows participants to record voice
* MasterMindleWrapper: (weird name atm, needs splitting up) Participants play a game similar to Mastermind with varying difficulties
* Upload: Uploads the collected data on a button press by the participant 



## Development


Run this to in the root of the repo to build the project locally (also needs to be run after every change):

```
npm run build
```

Then create a global link (only needs to run once during setup);
```
npm link
```

Then set up a local testing project:

```
npx reactive-psych
npm uninstall reactive-psych && npm link reactive-psych
```


Manually publishing to npm (until we figure out a better ci/cd process):
```
npm publish
```


## Authors

* **Adrian Steffan** - [adriansteffan](https://github.com/adriansteffan)