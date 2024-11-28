# ReactivePsych

Extremely crude project state atm, so no actual documentation yet


## Prerequisites

You will need a current version of [node.js](https://nodejs.org/en/download/) installed on your system.

## Using the package

### Create a template project

```
npx adriansteffan/reactive-psych
```

Then follow the instructions shown there and in the created `README.md`


### Usage

## Development

To work on the project locally, we want to set up a local repository, we assume verdaccio is used: 

```
npm install --global verdaccio
```

Run the verdaccio server in a separate console tab:
```
verdaccio
```

Run this to in the root of the repo to build the project locally (also needs to be run after every change):

```
npm run dev-publish
```


Setting up a local testing project:

```
npx adriansteffan/react-psych
npx rp-dev-setup
```

After every change to the package, run this in the testing project
```
npm run rp-dev-pull
```


## Authors

* **Adrian Steffan** - [adriansteffan](https://github.com/adriansteffan)