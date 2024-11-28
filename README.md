# ReactivePsych

Extremely crude project state atm, so no actual documentation yet


## Prerequisites

You will need a current version of [node.js](https://nodejs.org/en/download/) installed on your system.

## Using the package

### Create a template project

```
npx reactive-psych
```

Then follow the instructions shown there and in the created `README.md`


### Usage

## Development


Run this to in the root of the repo to build the project locally (also needs to be run after every change):

```
npm run build
```

Then create a global link (only needed during setup);
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