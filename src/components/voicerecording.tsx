import React, { useState, useRef } from 'react';
import { BaseComponentProps } from '../core/component';
import { Recorder, RecorderHandle } from './recorder';
import { defineComponent } from '../core/component';
import { audioFilename, markRecordingUploaded } from '../core/files';
import { useTheme, t } from '../runner/theme';
import { ExclamationTriangleIcon } from './icons';
import { textToWebmBase64, probeAudioDurationMs } from '../utils/tts';
import { post } from '../core/backend';

// 0.5s 440Hz sine tone, Opus codec; fallback when system TTS/ffmpeg unavailable
const DUMMY_AUDIO_BASE64 = 'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwEAAAAAAARQEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggE/TbuMU6uEHFO7a1OsggQ67AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNTguNzYuMTAwV0GNTGF2ZjU4Ljc2LjEwMESJiEB/wAAAAAAAFlSua+KuAQAAAAAAAFnXgQFzxYhRMt5OPJYVP5yBACK1nIN1bmSGhkFfT1BVU1aqg2MuoFa7hATEtACDgQLhkZ+BAbWIQOdwAAAAAABiZIEQY6KTT3B1c0hlYWQBATgBgLsAAAAAABJUw2dAm3NzAQAAAAAAACdjwIBnyAEAAAAAAAAaRaOHRU5DT0RFUkSHjUxhdmY1OC43Ni4xMDBzcwEAAAAAAABgY8CLY8WIUTLeTjyWFT9nyAEAAAAAAAAjRaOHRU5DT0RFUkSHlkxhdmM1OC4xMzQuMTAwIGxpYm9wdXNnyKJFo4hEVVJBVElPTkSHlDAwOjAwOjAwLjUwODAwMDAwMAAAH0O2dUJU54EAo5GBAACACINtgtAc/epJ/gE/wKOZgQAVgAinGl2KmC5fWspQj0PpJrkNsG40QKOVgQApgAihLxDkXfvcBBqwyPJFmpFgo5OBAD2ACKE40Hcyqlc9/1ttqV84o5SBAFGACKE40Hcyql5YIeRahOZfwKOXgQBlgAihTMA96uabsR453W080Xeb9h6jkYEAeYAIoTjQdzKqXDNU2kjGo5aBAI2ACKDZbPIJxX8xM7SEPNZetOMco5OBAKGACKE40Hcyqla9XawRHUWoo5OBALWACKE40Hcyqmb1XKO++uAQo5SBAMmACKEvEORd+8XekK1/rf/rrKOVgQDdgAihONB3MqpWRgIfsDV4YBUIo5OBAPGACKE40Hcyql5SyE1S2QFAo5SBAQWACKE40Hcyqla+8h2o+iaxgKOVgQEZgAihONB3MqpeqdUAtSaZmdKAo5OBAS2ACKFIA0bVUn3Jmsi7ollwo5OBAUGACKE40Hcyql6pt6b1uh3oo5WBAVWACKEvEORd+9/La7aeTKZnv/CjlYEBaYAIoTjO/AZGOE9OIX9kO96+gKOTgQF9gAihONB3MqpekAQ00UpCUKOTgQGRgAihSANG1VJz2oSiMZRZKqOQgQGlgAihONB3MqpeqbeK3KORgQG5gAihLxDkXfvfy2sJCQyjmoEBzYAIosXU/J/RyZHEovOUhd6Ypj7UPC8Bo5uBAeGACKRIuuxKsgM4Wle7xUaBZDTNWofASYGgAQAAAAAAABuhkoEB9QAIBkQ+QjevBKpbiF1qJHWihADN/mAcU7trkbuPs4EAt4r3gQHxggHg8IED';


function VoiceRecording({
  content,
  buttonText,
  shortButtonText = 'Continue without improving',
  className = '',
  containerClass,
  next,
  data,
  store,
  minDurationMs,
  shortRecordingContent,
  showVisualizer = true,
  eagerUpload = true,
  animate = false,
  name,
  silenceWarningMs,
  silenceWarningContent,
}: BaseComponentProps & {
  content?: React.ReactNode;
  buttonText?: string;
  /** Button text when the recording is shorter than minDurationMs. */
  shortButtonText?: string;
  className?: string;
  containerClass?: string;
  /** Minimum recording duration. If shorter, a warning is shown when paused. */
  minDurationMs?: number;
  /** Shown when the recording is shorter than minDurationMs. */
  shortRecordingContent?: React.ReactNode;
  /** Show the volume level meter during recording. Default true. */
  showVisualizer?: boolean;
  /** Upload audio immediately after recording to reduce final upload size. Default true. */
  eagerUpload?: boolean;
  animate?: boolean;
  /** Milliseconds of continuous silence before a "speak up" banner appears. Disabled when undefined. */
  silenceWarningMs?: number;
  /** Shown in the silence banner. */
  silenceWarningContent?: React.ReactNode;
}) {
  const th = t(useTheme());
  const resolvedButtonText = buttonText ?? (minDurationMs != null ? 'Save & Continue' : 'Continue');
  const recorderRef = useRef<RecorderHandle>(null);
  const pendingContinueRef = useRef(false);

  const [recordingData, setRecordingData] = useState<object | null>(null);
  const [paused, setPaused] = useState(false);
  const [pausedDuration, setPausedDuration] = useState(0);

  const isTooShort = minDurationMs != null && pausedDuration < minDurationMs;

  const handleSave = (recording: any) => {
    // Named after the trial number this trial's row will get, which makes the name unique in the session
    const saved = { ...recording, audioFile: audioFilename(name ?? 'VoiceRecording', data.trials.length + 1) };
    // Uploads the recording now, so the final upload is smaller; if this fails, the final upload sends it
    if (eagerUpload && saved.data64 && store.__uploadId) {
      post('/data', {
        sessionId: store.__uploadId,
        files: [{ filename: saved.audioFile, content: saved.data64, encoding: 'base64' }],
      })
        .then((response) => {
          if (response.ok) markRecordingUploaded(saved.audioFile, saved.data64);
        })
        .catch(() => {});
    }

    setRecordingData(saved);
    setPaused(false);
    if (pendingContinueRef.current) {
      pendingContinueRef.current = false;
      next(saved);
    }
  };

  const handlePause = (duration: number) => {
    setPaused(true);
    setPausedDuration(duration);
  };

  const handleResume = () => {
    setPaused(false);
  };

  const finalize = () => {
    pendingContinueRef.current = true;
    recorderRef.current?.stop();
  };

  return (
    <div className={`min-h-screen ${containerClass ?? th.containerBg}`}>
      <div className={`max-w-prose mx-auto ${className} pt-20 pb-20 px-4 ${animate ? 'animate-fade-in opacity-0' : ''}`}>
        {content && (
          <article
            className={th.article}
          >
            {content}
          </article>
        )}

        <div className='pt-6'>
        <Recorder
          ref={recorderRef}
          handleSaveVoiceData={handleSave}
          handleDiscardVoiceData={() => { setRecordingData(null); setPaused(false); }}
          showStop={minDurationMs == null}
          showDiscard={minDurationMs != null}
          showVisualizer={showVisualizer}
          silenceWarningMs={silenceWarningMs}
          silenceWarningContent={silenceWarningContent}
          onPause={handlePause}
          onResume={handleResume}
        />
        </div>

        {paused && isTooShort && (
          <div className={`mt-8 flex items-start space-x-3 p-4 border-2 ${th.buttonBorder} ${th.text} ${animate ? 'animate-fade-in opacity-0' : ''}`}>
            <ExclamationTriangleIcon className='w-6 h-6 text-yellow-500 flex-shrink-0 mt-0.5' />
            <p className='text-sm'>
              {shortRecordingContent ?? 'Your recording seems quite short. Please consider adding more detail to your description.'}
            </p>
          </div>
        )}

        {/* Continue button (visible when paused, minDurationMs mode only) */}
        {paused && minDurationMs != null && (
          <div className={`mt-8 flex justify-center ${animate ? 'animate-fade-in opacity-0' : ''}`}>
            <button
              onClick={finalize}
              className={th.button}
            >
              {isTooShort ? shortButtonText : resolvedButtonText}
            </button>
          </div>
        )}

        {/* Continue button after recording is stopped (non-minDurationMs mode) */}
        {recordingData && !paused && (
          <div className={`mt-16 flex justify-center ${animate ? 'animate-fade-in opacity-0' : ''}`}>
            <button
              onClick={() => next(recordingData)}
              className={th.button}
            >
              {resolvedButtonText}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default defineComponent({
  name: 'VoiceRecording',
  component: VoiceRecording,
  session: true,
  simulate: async ({ props, simulators, participant }) => {
    // A trial can set respondTTS to undefined to use the base64 simulator instead
    const { respondTTS } = simulators as Partial<typeof simulators>;
    const result = await (respondTTS ?? simulators.respondBase64)({ props, participant });

    let data64: string;
    if (respondTTS) {
      const text = result.value as string;
      const ttsResult = await textToWebmBase64(text);
      if (!ttsResult) throw new Error('TTS failed. Ensure say/espeak and ffmpeg are installed.');
      data64 = ttsResult;
    } else {
      data64 = result.value as string;
    }

    // Exact duration via ffprobe, fall back to estimate from file size
    const recordingDurationMs = (await probeAudioDurationMs(data64)) ?? Math.round(data64.length / 4);
    return {
      responseData: {
        type: 'audiorecording',
        data64,
        timestamp: new Date().toISOString(),
        recordingDurationMs,
      },
      participant: result.participant,
      durationMs: recordingDurationMs,
    };
  },
  defaultSimulators: {
    /** Returns text to be spoken via platform TTS. Default: generic test sentence. */
    respondTTS: () => ({ value: 'This is a simulated voice recording for testing purposes.' }),
    /** Returns raw base64-encoded WebM audio directly. Default: dummy 0.5s sine tone. */
    respondBase64: () => ({ value: DUMMY_AUDIO_BASE64 }),
  },
});
