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

This is the version of the experiment you should use if your testing devices have internet access and don't need any device-specific functionalities (e.g. sensors). The web version will work on all platforms! The specific targets serve as replacements in situations where a stable internet connection might not be given, or privacy directives prevent you from uploading data to a server (and/or you need device-specific functionality).

### Development

```
bun run dev
```

Open [http://localhost:8001](http://localhost:8001). The page updates as you edit.

`bun run start` serves the production version locally, and `bun run typecheck` and `bun run lint` check the code.

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


## Target: Android

For ease of use, it makes sense to run the web version for most of the development and only switch to the specific device emulators for implementing device-specific features and testing compatibility before packaging.

### Setup

To build and test an Android app containing your experiment, you will need an installation of 
[Android Studio](https://developer.android.com/studio) and [Java 21 or later](https://www.oracle.com/de/java/technologies/downloads/)

To set up the android project, run this command in the root directory:
```
bunx cap add android
````

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


### Running

Whenever you have made changes to the code and want to run it on the Android emulator, run:
```
bun run build
bunx cap sync
bunx cap run android
```

### Packaging

From the root directory, run

```
bunx cap open android
```

. Wait for Android Studio to install the project dependencies and then run Build > Generate APKs and Bundles > Generate APKs. Once your build is finished, there will be a popup guiding you to the location of the bundle's app that you can transfer to your Android device.

#### Where is my data stored?

In the "Internal Storage" section of the file browser, you will find a "Documents" folder that will contain subfolders with your data as soon as the first participant has finished the experiment.

## Target: iOS

For ease of use, it makes sense to run the web version for most of the development and only switch to the specific device emulators for implementing device-specific features and testing compatibility before packaging.

### Setup

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

### Running

Whenever you have made changes to the code and want to run it on the iOS emulator, run:

```
bun run build
bunx cap sync
bunx cap run ios
```

### Packaging

Packaging iOS apps is quite an undertaking, which is why the process is not overly streamlined/documented yet. The best way to get your experiment on an iOS device right now is to run

```
bunx cap run ios
```

which will open the finished project in XCode. From there, follow a guide on how to sign, bundle and install your app/experiment.

#### Where is my data stored?

After the first participant is run, a folder with the name of your app will appear under "My iPhone/iPad" in the files app, which contains your data.



## Authors

* **Adrian Steffan** - [adriansteffan](https://github.com/adriansteffan)



