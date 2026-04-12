import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { HiMicrophone, HiStop, HiTrash, HiPause } from 'react-icons/hi2';
import { useTheme, t } from '../utils/theme';
import { useAudioDeviceId } from '../utils/audiodevice';

interface RecordingData {
  blob: Blob;
  url: string;
  timestamp: string;
}

const AudioVisualizer: React.FC<{ stream: MediaStream; isDark: boolean }> = ({ stream, isDark }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    if (!stream || !canvasRef.current) return;
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    //@ts-ignore
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);

    analyser.fftSize = 2048;
    source.connect(analyser);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const timeData = new Uint8Array(analyser.fftSize);
    const bgColor = isDark ? '#374151' : '#ffffff';
    const activeColor = isDark ? '#ffffff' : '#000000';
    const dimColor = isDark ? '#4B5563' : '#E5E7EB';
    const width = rect.width;
    const height = rect.height;
    const segmentCount = 24;
    const segmentWidth = width / segmentCount;
    const gap = 2;
    let smoothedLevel = 0;

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(timeData);

      // Compute RMS volume from time-domain samples (centered at 128)
      let sumOfSquares = 0;
      for (let i = 0; i < timeData.length; i++) {
        const normalized = (timeData[i] - 128) / 128;
        sumOfSquares += normalized * normalized;
      }
      const volumeLevel = Math.min(1, Math.sqrt(sumOfSquares / timeData.length) * 5);
      smoothedLevel += (volumeLevel - smoothedLevel) * 0.3;

      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, width, height);

      const activeSegments = Math.round(smoothedLevel * segmentCount);
      for (let i = 0; i < segmentCount; i++) {
        ctx.fillStyle = i < activeSegments ? activeColor : dimColor;
        ctx.fillRect(i * segmentWidth + gap / 2, gap, segmentWidth - gap, height - gap * 2);
      }
    };

    draw();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      source.disconnect();
      audioContext.close();
    };
  }, [stream, isDark]);

  return (
    <canvas
      ref={canvasRef}
      width={300}
      height={60}
      className={`mx-auto border-2 border-black ${isDark ? 'bg-gray-700' : 'bg-white'}`}
    />
  );
};

export interface VoiceRecorderHandle {
  stop: () => void;
}

export interface VoiceRecorderProps {
  question?: { value: RecordingData | null };
  handleSaveVoiceData: (data: object) => void;
  handleDiscardVoiceData: () => void;
  deviceId?: string;
  showPause?: boolean;
  showStop?: boolean;
  showVisualizer?: boolean;
  /** Show a discard button while recording to delete and start over. */
  showDiscard?: boolean;
  onRecordingStart?: () => void;
  onPause?: (duration: number) => void;
  onResume?: () => void;
}

export const VoiceRecorder = forwardRef<VoiceRecorderHandle, VoiceRecorderProps>(({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  question: _question,
  handleSaveVoiceData,
  handleDiscardVoiceData,
  deviceId,
  showPause = true,
  showStop = true,
  showVisualizer = true,
  showDiscard = true,
  onRecordingStart,
  onPause,
  onResume,
}, ref) => {
  const theme = useTheme();
  const th = t(theme);
  const isDark = theme.startsWith('dark');
  const contextDeviceId = useAudioDeviceId();

  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  // Duration tracking (ms, excludes paused time)
  const durationRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  const startTimer = () => { durationRef.current = 0; timerRef.current = setInterval(() => { durationRef.current += 100; }, 100); };
  const resumeTimer = () => { timerRef.current = setInterval(() => { durationRef.current += 100; }, 100); };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && (recorder.state === 'recording' || recorder.state === 'paused')) {
      recorder.stop();
      recorder.stream.getTracks().forEach((track) => track.stop());
      setIsRecording(false);
      setIsPaused(false);
      clearTimer();
    }
  };

  useImperativeHandle(ref, () => ({ stop: stopRecording }));

  const startRecording = async () => {
    try {
      const resolvedDeviceId = deviceId ?? contextDeviceId;
      const constraints: MediaStreamConstraints = {
        audio: resolvedDeviceId
          ? { deviceId: { exact: resolvedDeviceId } }
          : true,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      setAudioStream(stream);
      mediaRecorderRef.current = new MediaRecorder(stream);

      chunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (e: BlobEvent) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        setAudioStream(null);
        saveRecording(blob, url);
      };

      mediaRecorderRef.current.start();

      setIsRecording(true);
      setIsPaused(false);
      startTimer();
      onRecordingStart?.();
    } catch (err) {
      console.error('Error accessing microphone:', err);
    }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
      clearTimer();
      onPause?.(durationRef.current);
    }
  };

  const resumeRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
      resumeTimer();
      onResume?.();
    }
  };

  const saveRecording = async (blob: Blob, url: string) => {
    if (blob && url) {
      const base64Data = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = reader.result?.toString().split(',')[1] || '';
          resolve(base64);
        };
        reader.readAsDataURL(blob);
      });

      handleSaveVoiceData({
        blob: blob,
        // dont change this type, since the upload function depends on it while looking for audio
        type: 'audiorecording',
        url: url,
        data64: base64Data,
        timestamp: new Date().toISOString(),
        recordingDuration: durationRef.current,
      });
    }
  };

  const discardWhileRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && (recorder.state === 'recording' || recorder.state === 'paused')) {
      // Prevent onstop from saving, clear chunks first
      chunksRef.current = [];
      recorder.onstop = null;
      recorder.stop();
      recorder.stream.getTracks().forEach((track) => track.stop());
    }
    setIsRecording(false);
    setIsPaused(false);
    setAudioStream(null);
    clearTimer();
    handleDiscardVoiceData();
  };

  const discardRecording = () => {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioUrl(null);
    setIsPaused(false);
    handleDiscardVoiceData();
  };

  const btnBase = `flex items-center justify-center p-4 rounded-full border-2 ${th.buttonBorder} ${th.buttonShadow} hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none cursor-pointer transition-colors duration-200`;

  return (
    <div className='flex flex-col items-center space-y-4 p-4 px-8'>
      {/* Start button */}
      {!audioUrl && !isRecording && (
        <button
          onClick={startRecording}
          className={`${btnBase} ${th.buttonBg}`}
          aria-label='Start Recording'
        >
          <HiMicrophone className={`w-6 h-6 ${th.buttonText}`} />
        </button>
      )}

      {/* Recording controls */}
      {!audioUrl && isRecording && (
        <div className='flex items-center space-x-4'>
          {showPause && (
            <button
              onClick={isPaused ? resumeRecording : pauseRecording}
              className={`${btnBase} ${th.buttonBg}`}
              aria-label={isPaused ? 'Resume Recording' : 'Pause Recording'}
            >
              {isPaused ? (
                <HiMicrophone className={`w-6 h-6 ${th.buttonText}`} />
              ) : (
                <HiPause className={`w-6 h-6 ${th.buttonText}`} />
              )}
            </button>
          )}
          {showStop && (
            <button
              onClick={stopRecording}
              className={`${btnBase} bg-red-500 text-white`}
              aria-label='Stop Recording'
            >
              <HiStop className='w-6 h-6' />
            </button>
          )}
          {showDiscard && isPaused && (
            <button
              onClick={discardWhileRecording}
              className={`${btnBase} ${th.buttonBg}`}
              aria-label='Discard Recording'
            >
              <HiTrash className={`w-6 h-6 ${th.buttonText}`} />
            </button>
          )}
        </div>
      )}

      {/* Audio visualizer */}
      {showVisualizer && isRecording && !isPaused && audioStream && (
        <div className='w-full max-w-md mx-auto'>
          <AudioVisualizer stream={audioStream} isDark={isDark} />
        </div>
      )}

      {/* Recording status */}
      {isRecording && (
        <div className='flex items-center space-x-2'>
          <div className={`w-3 h-3 rounded-full ${isPaused ? 'bg-yellow-500' : 'bg-red-500 animate-pulse'}`}></div>
          <span className={`text-sm ${th.text}`}>{isPaused ? 'Paused' : 'Recording...'}</span>
        </div>
      )}

      {/* Audio player and discard */}
      {audioUrl && !isRecording && (
        <div className='flex flex-col items-center space-y-4 w-full max-w-md'>
          <audio controls preload='none' className='w-full' playsInline>
            <source src={audioUrl} type='audio/mp4' />
            <source src={audioUrl} type='audio/webm' />
            Your browser does not support the audio element.
          </audio>

          <div className='flex space-x-4'>
            <button
              onClick={discardRecording}
              className={`border-2 ${th.buttonBorder} ${th.buttonShadow} hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none cursor-pointer flex items-center space-x-2 px-4 py-2 ${th.text} rounded-xl transition-colors duration-200`}
            >
              <HiTrash className='w-4 h-4' />
              <span>Discard</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
});


export default function VoicerecorderQuestionComponent({
  setValue,
}: {
  setValue: (data: object | null) => void;
}) {
  return (
    <VoiceRecorder
      handleSaveVoiceData={(data) => setValue(data)}
      handleDiscardVoiceData={() => setValue(null)}
    />
  );
}
