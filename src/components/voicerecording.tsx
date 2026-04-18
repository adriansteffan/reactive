import React, { useState, useRef } from 'react';
import { BaseComponentProps } from '../utils/common';
import { VoiceRecorder, VoiceRecorderHandle } from './voicerecorder';
import { registerSimulation } from '../utils/simulation';
import { registerFlattener, generateAudioFilename } from '../utils/upload';
import { useTheme, t } from '../utils/theme';
import { HiExclamationTriangle } from 'react-icons/hi2';
import { textToWebmBase64, probeAudioDurationMs } from '../utils/tts';
import { post } from '../utils/request';

// 0.5s 440Hz sine tone, Opus codec; fallback when system TTS/ffmpeg unavailable
const DUMMY_AUDIO_BASE64 = 'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwEAAAAAAARQEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggE/TbuMU6uEHFO7a1OsggQ67AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNTguNzYuMTAwV0GNTGF2ZjU4Ljc2LjEwMESJiEB/wAAAAAAAFlSua+KuAQAAAAAAAFnXgQFzxYhRMt5OPJYVP5yBACK1nIN1bmSGhkFfT1BVU1aqg2MuoFa7hATEtACDgQLhkZ+BAbWIQOdwAAAAAABiZIEQY6KTT3B1c0hlYWQBATgBgLsAAAAAABJUw2dAm3NzAQAAAAAAACdjwIBnyAEAAAAAAAAaRaOHRU5DT0RFUkSHjUxhdmY1OC43Ni4xMDBzcwEAAAAAAABgY8CLY8WIUTLeTjyWFT9nyAEAAAAAAAAjRaOHRU5DT0RFUkSHlkxhdmM1OC4xMzQuMTAwIGxpYm9wdXNnyKJFo4hEVVJBVElPTkSHlDAwOjAwOjAwLjUwODAwMDAwMAAAH0O2dUJU54EAo5GBAACACINtgtAc/epJ/gE/wKOZgQAVgAinGl2KmC5fWspQj0PpJrkNsG40QKOVgQApgAihLxDkXfvcBBqwyPJFmpFgo5OBAD2ACKE40Hcyqlc9/1ttqV84o5SBAFGACKE40Hcyql5YIeRahOZfwKOXgQBlgAihTMA96uabsR453W080Xeb9h6jkYEAeYAIoTjQdzKqXDNU2kjGo5aBAI2ACKDZbPIJxX8xM7SEPNZetOMco5OBAKGACKE40Hcyqla9XawRHUWoo5OBALWACKE40Hcyqmb1XKO++uAQo5SBAMmACKEvEORd+8XekK1/rf/rrKOVgQDdgAihONB3MqpWRgIfsDV4YBUIo5OBAPGACKE40Hcyql5SyE1S2QFAo5SBAQWACKE40Hcyqla+8h2o+iaxgKOVgQEZgAihONB3MqpeqdUAtSaZmdKAo5OBAS2ACKFIA0bVUn3Jmsi7ollwo5OBAUGACKE40Hcyql6pt6b1uh3oo5WBAVWACKEvEORd+9/La7aeTKZnv/CjlYEBaYAIoTjO/AZGOE9OIX9kO96+gKOTgQF9gAihONB3MqpekAQ00UpCUKOTgQGRgAihSANG1VJz2oSiMZRZKqOQgQGlgAihONB3MqpeqbeK3KORgQG5gAihLxDkXfvfy2sJCQyjmoEBzYAIosXU/J/RyZHEovOUhd6Ypj7UPC8Bo5uBAeGACKRIuuxKsgM4Wle7xUaBZDTNWofASYGgAQAAAAAAABuhkoEB9QAIBkQ+QjevBKpbiF1qJHWihADN/mAcU7trkbuPs4EAt4r3gQHxggHg8IED';

export { DUMMY_AUDIO_BASE64 };

registerFlattener('VoiceRecording', 'session');
registerSimulation('VoiceRecording', async (_trialProps, _experimentState, simulators, participant) => {
  const respond = simulators.respondTTS ?? simulators.respondBase64;
  const result = await respond(_trialProps, participant);
  const { participantState } = result;

  let data64: string;
  if (simulators.respondTTS) {
    const text = result.value as string;
    const ttsResult = await textToWebmBase64(text);
    if (!ttsResult) throw new Error('TTS failed. Ensure say/espeak and ffmpeg are installed.');
    data64 = ttsResult;
  } else {
    data64 = result.value as string;
  }

  // Exact duration via ffprobe, fall back to estimate from file size
  const recordingDuration = (await probeAudioDurationMs(data64)) ?? Math.round(data64.length / 4);
  return {
    responseData: {
      type: 'audiorecording',
      data64,
      timestamp: new Date().toISOString(),
      recordingDuration,
    },
    participantState,
    duration: recordingDuration,
  };
}, {
  /** Returns text to be spoken via platform TTS. Default: generic test sentence. */
  respondTTS: (_input: any, participant: any) => ({
    value: 'This is a simulated voice recording for testing purposes.',
    participantState: participant,
  }),
  /** Returns raw base64-encoded WebM audio directly. Default: dummy 0.5s sine tone. */
  respondBase64: (_input: any, participant: any) => ({
    value: DUMMY_AUDIO_BASE64,
    participantState: participant,
  }),
});

function VoiceRecording({
  content,
  buttonText,
  shortButtonText = 'Continue without improving',
  className = '',
  containerClass,
  next,
  store,
  minDuration,
  shortRecordingWarning,
  showVisualizer = true,
  eagerUpload = true,
  animate = false,
  name,
  silenceWarningSec,
  silenceWarningText,
}: BaseComponentProps & {
  content?: React.ReactNode;
  buttonText?: string;
  /** Button text when recording is shorter than minDuration. Defaults to buttonText. */
  shortButtonText?: string;
  className?: string;
  containerClass?: string;
  /** Minimum recording duration in ms. If shorter, a warning is shown when paused. */
  minDuration?: number;
  /** Custom warning text for short recordings. */
  shortRecordingWarning?: React.ReactNode;
  /** Show the volume level meter during recording. Default true. */
  showVisualizer?: boolean;
  /** Upload audio immediately after recording to reduce final upload size. Default true. */
  eagerUpload?: boolean;
  animate?: boolean;
  name?: string;
  /** Seconds of continuous silence before a "speak up" banner appears. Disabled when undefined. */
  silenceWarningSec?: number;
  /** Text shown in the silence banner. */
  silenceWarningText?: string;
}) {
  const th = t(useTheme());
  const resolvedButtonText = buttonText ?? (minDuration != null ? 'Save & Continue' : 'Continue');
  const recorderRef = useRef<VoiceRecorderHandle>(null);
  const pendingContinueRef = useRef(false);

  const [recordingData, setRecordingData] = useState<object | null>(null);
  const [paused, setPaused] = useState(false);
  const [pausedDuration, setPausedDuration] = useState(0);

  const isTooShort = minDuration != null && pausedDuration < minDuration;

  const handleSave = (data: any) => {
    // Eager upload: POST audio to backend immediately.
    // Flag is only set after confirmed success.
    // If the POST fails, the flag stays false and the final Upload handles it.
    if (eagerUpload && data.data64 && store?._uploadId) {
      const filename = generateAudioFilename(name ?? 'recording');
      post('/data', {
        sessionId: store._uploadId,
        files: [{ filename, content: data.data64, encoding: 'base64' }],
      }).then(() => {
        data._audioPreUploaded = true;
        data._audioPreUploadedFilename = filename;
      }).catch(() => { /* ignore — final Upload handles it */ });
    }

    setRecordingData(data);
    setPaused(false);
    if (pendingContinueRef.current) {
      pendingContinueRef.current = false;
      next(data);
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
            className={`prose prose-2xl ${th.prose} text-xl ${th.proseLink} prose-a:underline prose-h1:text-4xl prose-h1:mb-10 prose-h1:font-bold prose-p:mb-4 prose-strong:font-bold ${th.text} leading-relaxed`}
          >
            {content}
          </article>
        )}

        <div className='pt-6'>
        <VoiceRecorder
          ref={recorderRef}
          handleSaveVoiceData={handleSave}
          handleDiscardVoiceData={() => { setRecordingData(null); setPaused(false); }}
          showStop={minDuration == null}
          showDiscard={minDuration != null}
          showVisualizer={showVisualizer}
          silenceWarningSec={silenceWarningSec}
          silenceWarningText={silenceWarningText}
          onPause={handlePause}
          onResume={handleResume}
        />
        </div>

        {paused && isTooShort && (
          <div className={`mt-8 flex items-start space-x-3 p-4 border-2 ${th.buttonBorder} ${th.text} ${animate ? 'animate-fade-in opacity-0' : ''}`}>
            <HiExclamationTriangle className='w-6 h-6 text-yellow-500 flex-shrink-0 mt-0.5' />
            <p className='text-sm'>
              {shortRecordingWarning ?? 'Your recording seems quite short. Please consider adding more detail to your description.'}
            </p>
          </div>
        )}

        {/* Continue button (visible when paused, minDuration mode only) */}
        {paused && minDuration != null && (
          <div className={`mt-8 flex justify-center ${animate ? 'animate-fade-in opacity-0' : ''}`}>
            <button
              onClick={finalize}
              className={`${th.buttonBg} cursor-pointer px-8 py-3 border-2 ${th.buttonBorder} font-bold ${th.buttonText} text-lg rounded-xl ${th.buttonShadow} hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none`}
            >
              {isTooShort ? shortButtonText : resolvedButtonText}
            </button>
          </div>
        )}

        {/* Continue button after recording is stopped (non-minDuration mode) */}
        {recordingData && !paused && (
          <div className={`mt-16 flex justify-center ${animate ? 'animate-fade-in opacity-0' : ''}`}>
            <button
              onClick={() => next(recordingData)}
              className={`${th.buttonBg} cursor-pointer px-8 py-3 border-2 ${th.buttonBorder} font-bold ${th.buttonText} text-lg rounded-xl ${th.buttonShadow} hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none`}
            >
              {resolvedButtonText}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default VoiceRecording;
