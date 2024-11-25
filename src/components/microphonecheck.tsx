import { useState, useEffect } from 'react';
import { VoiceRecorder } from './voicerecorder';

interface MicrophoneDevice {
  deviceId: string;
  label: string;
}

export function MicrophoneSelect({
  onMicrophoneSelect,
}: {
  onMicrophoneSelect: (deviceId: string) => void;
}) {
  const [microphones, setMicrophones] = useState<MicrophoneDevice[]>([]);
  const [selectedMic, setSelectedMic] = useState<string>('');
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    // Request microphone permissions and get list of devices
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then(() => {
        navigator.mediaDevices.enumerateDevices().then((devices) => {
          const mics = devices
            .filter((device) => device.kind === 'audioinput')
            .map((device) => ({
              deviceId: device.deviceId,
              label: device.label || `Microphone ${device.deviceId.slice(0, 5)}`,
            }));
          setMicrophones(mics);

          // Set default microphone
          if (mics.length > 0 && !selectedMic) {
            setSelectedMic(mics[0].deviceId);
            onMicrophoneSelect(mics[0].deviceId);
          }
        });
      })
      .catch((err) => {
        console.error('Error accessing microphone:', err);
      });
  }, [onMicrophoneSelect, selectedMic]);

  const handleSelect = (deviceId: string) => {
    setSelectedMic(deviceId);
    onMicrophoneSelect(deviceId);
    setIsOpen(false);
  };

  const selectedLabel =
    microphones.find((mic) => mic.deviceId === selectedMic)?.label || 'Select Microphone';

  return (
    <div className='relative w-64 mx-auto mt-8 mb-8'>
      {/* Selected Option Display */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          w-full px-4 py-2
          bg-white text-black
          border-2 border-black
          shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]
          hover:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]
          active:shadow-none
          active:translate-x-1
          active:translate-y-1
          transition-all
          text-left
          font-bold
          ${isOpen ? 'shadow-none translate-x-1 translate-y-1' : ''}
        `}
      >
        <div className='flex items-center justify-between'>
          <span className='truncate'>{selectedLabel}</span>
          <span className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}>▼</span>
        </div>
      </button>

      {/* Dropdown Options */}
      {isOpen && (
        <div className='absolute w-full mt-2 z-50'>
          <ul
            className={`
            bg-white
            border-2 border-black
            shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]
            max-h-60 overflow-auto
          `}
          >
            {microphones.map((mic) => (
              <li
                key={mic.deviceId}
                onClick={() => handleSelect(mic.deviceId)}
                className={`
                  px-4 py-2
                  cursor-pointer
                  hover:bg-black hover:text-white
                  transition-colors
                  ${selectedMic === mic.deviceId ? 'bg-black text-white' : ''}
                  border-b-2 border-black last:border-b-0
                `}
              >
                {mic.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const MicrophoneCheck = ({ next }: { next: (data: object) => void }) => {
  const [recordingExists, setRecordingExists] = useState(false);

  return (
    <div className={`max-w-prose mx-auto mt-20 mb-20`}>
      <article className='prose prose-2xl prose-slate text-xl text-black leading-relaxed'>
        <h1 className='text-3xl mb-6 font-semibold'>Let's test your microphone!</h1>
        <p>
          In this experiment, you will need to answer some questions verbally. To make sure that we
          don't lose your input, please select your preferred microphone using the menu below...
        </p>
      </article>
      {/*This is really hacky but it works and there is a deadline, we should find a way to pass around such values in the future */}
      {/*eslint-disable-next-line @typescript-eslint/no-explicit-any*/}
      <MicrophoneSelect onMicrophoneSelect={(id: string) => ((window as any).audioInputId = id)} />

      <article className='prose prose-2xl prose-slate text-xl text-black leading-relaxed'>
        <p>
          ... and use the recording button below to make a test recording of your voice. After
          stopping the recording, you can use the play button to play back the audio.
        </p>
      </article>

      <VoiceRecorder
        question={{ value: null }}
        handleSaveVoiceData={() => setRecordingExists(true)}
        handleDiscardVoiceData={() => setRecordingExists(false)}
      />

      {recordingExists && (
        <>
          <article className='prose prose-2xl prose-slate text-xl text-black leading-relaxed'>
            <p>
              Can you hear yourself? Great! You can continue on to the next step. <br /> If you
              can't hear your voice, try one of the other options from the list or check any
              physical mute switches on your microphone. Be sure to also check that your computer
              audio is turned on so you can actually listen back to your test recording!
            </p>
          </article>

          <div className='mt-16 flex justify-center'>
            <button
              onClick={() => next({})}
              className='bg-white px-8 py-3 border-2 border-black font-bold text-black text-lg rounded-xl shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none'
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default MicrophoneCheck;
