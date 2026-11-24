# Experiment Boilerplate

Built with [reactive](https://github.com/adriansteffan/reactive)

## Setup

Install [Bun](https://bun.sh/), then run in the root directory:

```
bun install
```

### Project layout

- `src/Experiment.tsx`: the experiment
- `public/`: static files, served from the site root (`public/images/cat.png` is available at `/images/cat.png`)
- `server.ts`: serves the experiment and the route that saves uploaded data, which comes from the library (`uploadRoutes`); add your own routes to `api`, which components reach at `getBackendUrl()` (also in simulations)
- `.env.production`: the settings for the deployed study, such as the Prolific completion code
- `.env.development`: the settings for running the study on your computer, read by `bun run dev`, `start`, `build` and `simulate`
- `.env.example`: the settings to copy into these two files, which git ignores. Variables starting with `PUBLIC_` are compiled into the experiment, where every participant could read them. All others, such as API keys, only reach your routes in `server.ts`. Both are read as `process.env.NAME`, which is `undefined` if it is not set. Avoid `.env` and `.env.local` for them, since Bun reads those on your computer and in deployments alike.
- `data/`: uploaded data
- `data_download/`: data downloaded from a study-deploy server

## Target: Web (Online Experiment)

This is the version of the experiment you should use if your testing devices have internet access and don't need any device-specific functionalities (e.g. sensors). The web version will work on all platforms!

### Development

```
bun run dev
```

Open [http://localhost:8001](http://localhost:8001). The page updates as you edit.

`bun run start` serves the production version locally, and `bun run typecheck` and `bun run lint` check the code. Linting and formatting use [Biome](https://biomejs.dev/), which has an editor extension.

### Deployment

You will need a server with [Docker](https://docs.docker.com/engine/install/) and Docker Compose 2.24 or newer. In the root directory, start the app with

```
docker compose up -d --build
```

and stop it with `docker compose down`. To update, run `git pull` and start it again with the same command.

The settings page and the `?dev=true` panel are available in the deployed study too. To turn one off, set `PUBLIC_DISABLE_SETTINGS` or `PUBLIC_DISABLE_DEV` to `TRUE` in `.env.production`.

The app listens on port 8001 (see `docker-compose.yaml`). Expose it with a reverse proxy (Apache Virtualhosts or Nginx Server Blocks); [this guide](https://gist.github.com/adriansteffan/48c9bda7237a8a7fcc5bb6987c8e1790) explains how for our setup. Since `.env.production` is not committed, copy it into the clone on the server yourself, and start the app with the same command again whenever it changes.

Uploaded data is stored in `data/` in the root directory of the cloned repo.

### Deploying to a study-deploy server

If you have access to a [study-deploy](https://github.com/adriansteffan/study-deploy) server, deploy the study with

```
bun run deploy
```

This builds the study with the settings in `.env.production` and uploads it. The first time, it asks for

- the server's address and the subdomain the study should get (up to 32 lowercase letters, digits and dashes), and saves both in `package.json` under `studyDeploy`.
- your token for the server, and saves it in `~/.config/study-deploy/tokens.json` on your computer, for all your studies

The study is then served at `https://<subdomain>.<domain>`. Only the user who deployed it first can deploy it again, so collaborators cannot use their own tokens for it. To change the subdomain, edit it in `package.json` and deploy again. The study also stays online under the old one.

Download the data with

```
bun run download
```

It is saved in `data_download/`, apart from the sessions you ran on your computer. Running it again adds new data and overwrites the files downloaded before.

Delete the data on the server, for example after piloting, with

```
bun run delete-data
```

This asks for confirmation, deletes all of it and restarts the study, which interrupts anyone taking part. Download the data first if you still need it. The files in `data_download/` stay, so move them elsewhere before the next download, which would otherwise add the new data to them.

Take the study offline with

```
bun run undeploy
```

This also deletes its data on the server, so download it first. It asks for confirmation, and only deletes the study under the subdomain in `package.json`.

GitHub can also deploy on every push to `main`, using `.github/workflows/deploy.yml`. Deploy from your computer once and commit `package.json`. Then, with the [GitHub CLI](https://cli.github.com) installed and logged in, run

```
bun run ghsetup
```

This saves your token and the contents of `.env.production` as the repository's secrets `DEPLOY_TOKEN` and `DOTENV`. Run it again whenever you change `.env.production`, since the next push would otherwise deploy the old values. Anyone with write access to the repository can read the secrets, so only do this where you trust every collaborator.


## Simulation

You can simulate your experiment headlessly to generate synthetic data, test your data pipeline, or plan sample sizes.

### Setup

Define your participant generator in the `simulation` field of `defineExperiment` in `Experiment.tsx`:

```tsx
export default defineExperiment({
  timeline: ({ clicks }) => [ ... ],
  simulation: {
    createParticipants: () => Array.from({ length: 10 }, (_, i) => ({ id: i, nickname: `participant_${i}` })),
  },
});
```

### Running

```
bun run simulate
```

This starts the backend, simulates all participants through the experiment, and shuts down. The simulated data ends up in `data/`.

### Customizing participant behavior

Each trial component has default decision functions that model participant behavior. Override them per trial with `.simulators()`:

```tsx
PlainInput.trial('name', { content: <p>What is your name?</p> }).simulators({
  respond: ({ participant }) => ({ response: participant.nickname }),
}),
```

### Custom components

Give your custom components a simulation in their `defineComponent` call. See the `CustomTrial` example in `Experiment.tsx` and the [reactive README](https://github.com/adriansteffan/reactive) for details.


## Transcription

Automatically transcribe voice recordings from experiment data using Docker. Requires [Docker](https://docs.docker.com/engine/install/) to be installed. The transcription setup is left out of new projects; add it in the root directory with

```
bunx @adriansteffan/reactive add transcription
```

which creates `transcription/` and the scripts below.

### CPU (faster-whisper)

```
bun run transcribe
```

### GPU (qwen-asr, requires NVIDIA GPU)

```
bun run transcribe:gpu
```

### Options

```
bun run transcribe -- --overwrite       # re-transcribe even if transcriptions.csv exists
bun run transcribe -- --model small     # use a different model
```

Output: `transcriptions.<sessionId>.csv` in each session's data directory, wherever it is under `data/` or `data_download/`, with `filename,text` columns. The model is cached in a Docker volume, so it only downloads once.


## Extra components

Quest (SurveyJS questionnaires) and Tutorial (slide decks) need packages of their own, so they are left out until you add them:

```
bunx @adriansteffan/reactive add quest tutorial
```

Then import them from `@adriansteffan/reactive/quest` and `@adriansteffan/reactive/tutorial`.


## Android and iOS apps

The experiment can also be packaged as an Android or iOS app that stores data on the device, e.g. for studies without a reliable internet connection. To add this, run

```
bunx @adriansteffan/reactive native
```

in the root directory and follow the [setup instructions](https://github.com/adriansteffan/reactive#android-and-ios-apps).


## Authors

* **Adrian Steffan** - [adriansteffan](https://github.com/adriansteffan)



