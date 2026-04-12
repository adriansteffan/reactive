import { useState, useEffect } from 'react';
import { VoiceRecorder } from './voicerecorder';
import { registerSimulation, noopSimulate } from '../utils/simulation';
import { registerFlattener } from '../utils/upload';
import { BaseComponentProps } from '../utils/common';
import { useTheme, t } from '../utils/theme';

registerFlattener('MicrophoneCheck', 'session');
registerSimulation('MicrophoneCheck', noopSimulate, {});

interface MicrophoneDevice {
  deviceId: string;
  label: string;
}

function MicrophoneSelect({
  onMicrophoneSelect,
  disabled = false,
}: {
  onMicrophoneSelect: (deviceId: string) => void;
  disabled?: boolean;
}) {
  const th = t(useTheme());
  const [microphones, setMicrophones] = useState<MicrophoneDevice[]>([]);
  const [selectedMic, setSelectedMic] = useState<string>('');
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        stream.getTracks().forEach((track) => track.stop());
        navigator.mediaDevices.enumerateDevices().then((devices) => {
          const mics = devices
            .filter((device) => device.kind === 'audioinput')
            .map((device) => ({
              deviceId: device.deviceId,
              label: device.label || `Microphone ${device.deviceId.slice(0, 5)}`,
            }));
          setMicrophones(mics);

          if (mics.length > 0 && !selectedMic) {
            setSelectedMic(mics[0].deviceId);
            onMicrophoneSelect(mics[0].deviceId);
          }
        });
      })
      .catch((err) => {
        console.error('Error accessing microphone:', err);
      });
  }, []);

  const handleSelect = (deviceId: string) => {
    setSelectedMic(deviceId);
    onMicrophoneSelect(deviceId);
    setIsOpen(false);
  };

  const selectedLabel =
    microphones.find((mic) => mic.deviceId === selectedMic)?.label || 'Select Microphone';

  return (
    <div className='relative w-64 mx-auto mt-8 mb-8'>
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`w-full px-4 py-2 border-2 transition-all text-left font-bold ${th.buttonBg} ${th.buttonBorder} ${th.buttonShadow} ${disabled ? `${th.buttonDisabledText} cursor-default` : `${th.buttonText} cursor-pointer hover:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-x-1 active:translate-y-1`} ${isOpen ? 'shadow-none translate-x-1 translate-y-1' : ''}`}
      >
        <div className='flex items-center justify-between'>
          <span className='truncate'>{selectedLabel}</span>
          <span className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}>▼</span>
        </div>
      </button>

      {isOpen && (
        <div className='absolute w-full mt-2 z-50'>
          <ul className={`${th.buttonBg} border-2 ${th.buttonBorder} ${th.buttonShadow} max-h-60 overflow-auto`}>
            {microphones.map((mic) => (
              <li
                key={mic.deviceId}
                onClick={() => handleSelect(mic.deviceId)}
                className={`px-4 py-2 cursor-pointer hover:bg-black hover:text-white transition-colors ${selectedMic === mic.deviceId ? 'bg-black text-white' : th.buttonText} border-b-2 ${th.buttonBorder} last:border-b-0`}
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

const MicrophoneCheck = ({ next, updateStore, animate = false }: BaseComponentProps & { animate?: boolean }) => {
  const th = t(useTheme());
  const [recordingExists, setRecordingExists] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | undefined>(undefined);

  const handleMicSelect = (id: string) => {
    setSelectedDeviceId(id);
    updateStore({ audioInputId: id });
  };

  return (
    <div className={`min-h-screen ${th.containerBg}`}>
      <div className={`max-w-prose mx-auto mt-20 mb-20 px-4 ${animate ? 'animate-fade-in opacity-0' : ''}`}>
        <article className={`prose prose-2xl ${th.prose} text-xl ${th.text} leading-relaxed`}>
          <h1 className='text-3xl mb-6 font-semibold'>Let's test your microphone!</h1>
          <p>
            In this experiment, you will need to answer some questions verbally. To make sure that we
            don't lose your input, please select your preferred microphone using the menu below...
          </p>
        </article>
        <MicrophoneSelect onMicrophoneSelect={handleMicSelect} disabled={isRecording} />

        <article className={`prose prose-2xl ${th.prose} text-xl ${th.text} leading-relaxed`}>
          <p>
            ... and use the recording button below to make a test recording of your voice. After
            stopping the recording, you can use the play button to play back the audio.
          </p>
        </article>

        <VoiceRecorder
          onRecordingStart={() => setIsRecording(true)}
          handleSaveVoiceData={() => { setRecordingExists(true); setIsRecording(false); }}
          handleDiscardVoiceData={() => { setRecordingExists(false); setIsRecording(false); }}
          deviceId={selectedDeviceId}
          showPause={false}
          showDiscard={false}
        />

        {recordingExists && (
          <div className='animate-fade-in opacity-0'>
            <article className={`prose prose-2xl ${th.prose} text-xl ${th.text} leading-relaxed`}>
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
                className={`${th.buttonBg} cursor-pointer px-8 py-3 border-2 ${th.buttonBorder} font-bold ${th.buttonText} text-lg rounded-xl ${th.buttonShadow} hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none`}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MicrophoneCheck;
