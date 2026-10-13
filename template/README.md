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
- `server.ts`: serves the experiment and the upload backend; add your own routes to `api`
- `.env`: committed settings. Only `PUBLIC_` variables reach the experiment, and every one it reads must be defined here. Secrets such as API keys go in `.env.local`, which is not committed.
- `data/`: uploaded data

## Target: Web (Online Experiment)

This is the version of the experiment you should use if your testing devices have internet access and don't need any device-specific functionalities (e.g. sensors). The web version will work on all platforms!

### Development

```
bun run dev
```

Open [http://localhost:8001](http://localhost:8001). The page updates as you edit.

`bun run start` serves the production version locally, and `bun run typecheck` and `bun run lint` check the code. Linting and formatting use [Biome](https://biomejs.dev/), which has an editor extension.

### Deployment

You will need a server with [Docker](https://docs.docker.com/engine/install/). In the root directory, start the app with

```
docker compose up -d --build
```

and stop it with `docker compose down`. To update, run `git pull` and start it again with the same command.

The app listens on port 8001 (see `docker-compose.yaml`). Expose it with a reverse proxy (Apache Virtualhosts or Nginx Server Blocks); [this guide](https://gist.github.com/adriansteffan/48c9bda7237a8a7fcc5bb6987c8e1790) explains how for our setup. The `PUBLIC_` variables are baked in when the image is built, so rebuild after changing `.env`.

Uploaded data is stored in `data/` in the root directory of the cloned repo.


## Simulation

You can simulate your experiment headlessly to generate synthetic data, test your data pipeline, or plan sample sizes.

### Setup

Define your participant generator and simulation config in `Experiment.tsx`:

```tsx
export const simulationConfig = {
  participants: {
    generator: (i) => ({ id: i, nickname: `participant_${i}` }),
    count: 10,
  },
};
```

### Running

```
bun run simulate
```

This starts the backend, simulates all participants through the experiment, and shuts down. The simulated data ends up in `data/`.

### Customizing participant behavior

Each trial component has default decision functions that model participant behavior. Override them per-trial using the `simulators` property on a timeline item:

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

### Custom components

Register simulations for your custom trial components using `registerSimulation`. See the `CustomTrial` example in `Experiment.tsx` and the [reactive README](https://github.com/adriansteffan/reactive) for details.

### Hybrid mode

During development, auto-advance simulated trials while manually interacting with others:

Add `?hybridSimulation=true` to the URL:

```
http://localhost:8001?hybridSimulation=true
```

Trials with `simulators` or `simulate: true` defined will auto-advance. Others render normally for human interaction. Hybrid mode is enabled by default during development. For production, set `PUBLIC_DISABLE_HYBRID_SIMULATION=true` in `.env` to disable it.


## Transcription

Automatically transcribe voice recordings from experiment data using Docker. Requires [Docker](https://docs.docker.com/engine/install/) to be installed.

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

Output: `transcriptions.csv` in each participant's data directory with `filename,text` columns. The model is cached in a Docker volume, so it only downloads once.


## Android and iOS apps

The experiment can also be packaged as an Android or iOS app that stores data on the device, e.g. for studies without a reliable internet connection. To add this, run

```
bunx @adriansteffan/reactive native
```

in the root directory and follow the [setup instructions](https://github.com/adriansteffan/reactive#android-and-ios-apps).


## Authors

* **Adrian Steffan** - [adriansteffan](https://github.com/adriansteffan)



