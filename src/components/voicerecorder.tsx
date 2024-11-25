import React, { useState, useRef, useEffect } from 'react';
import { HiMicrophone, HiStop, HiTrash } from 'react-icons/hi2';

import { SurveyQuestionElementBase } from 'survey-react-ui';

import { Question, Serializer } from 'survey-core';
interface AudioVisualizerProps {
  stream: MediaStream;
}

interface RecordingData {
  blob: Blob;
  url: string;
  timestamp: string;
}

// I quickly AI-genned this viz so that the participants have some feedback if their audio is being picked up - probably highly inaccurate, but that should not matter at all
const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ stream }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const previousDataRef = useRef<number[]>([]);

  useEffect(() => {
    if (!stream || !canvasRef.current) return;
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    //@ts-ignore
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);

    // Increased FFT size for smoother data
    analyser.fftSize = 2048;
    source.connect(analyser);
    analyserRef.current = analyser;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    previousDataRef.current = Array(analyser.frequencyBinCount).fill(128);

    // Enhanced smoothing function with weighted average
    const smoothValue = (current: number, previous: number) => {
      const weight = 0.08; // Lower = smoother, higher = more responsive
      return previous + (current - previous) * weight;
    };

    // Function to compute running average for additional smoothing
    const averageValues = (data: number[], windowSize: number = 3) => {
      const result = new Array(data.length).fill(0);

      for (let i = 0; i < data.length; i++) {
        let sum = 0;
        let count = 0;

        for (
          let j = Math.max(0, i - windowSize);
          j < Math.min(data.length, i + windowSize + 1);
          j++
        ) {
          sum += data[j];
          count++;
        }

        result[i] = sum / count;
      }

      return result;
    };

    const draw = () => {
      const width = rect.width;
      const height = rect.height;
      const centerY = height / 2;

      animationRef.current = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(dataArray);

      // Apply initial smoothing
      const smoothedData = Array.from(dataArray).map((value, i) =>
        smoothValue(value, previousDataRef.current[i]),
      );

      // Apply running average smoothing
      const averagedData = averageValues(smoothedData);

      // Update previous data
      previousDataRef.current = averagedData;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width * dpr, height * dpr);

      // Draw the center line
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
      ctx.lineWidth = 1;
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);
      ctx.stroke();

      // Draw waveform
      ctx.beginPath();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';

      const skipPoints = 4;
      const points: [number, number][] = [];

      for (let i = 0; i < averagedData.length; i += skipPoints) {
        const x = (i / averagedData.length) * width;
        const normalizedValue = (averagedData[i] - 128) / 128;
        const y = centerY + normalizedValue * height * 4.0;
        points.push([x, y]);
      }

      // Draw smooth curve through points
      if (points.length > 0) {
        ctx.moveTo(points[0][0], points[0][1]);

        for (let i = 1; i < points.length - 2; i++) {
          const xc = (points[i][0] + points[i + 1][0]) / 2;
          const yc = (points[i][1] + points[i + 1][1]) / 2;
          ctx.quadraticCurveTo(points[i][0], points[i][1], xc, yc);
        }

        // For the last two points
        if (points.length > 2) {
          const last = points.length - 1;
          ctx.quadraticCurveTo(
            points[last - 1][0],
            points[last - 1][1],
            points[last][0],
            points[last][1],
          );
        }
      }

      ctx.stroke();
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      source.disconnect();
      audioContext.close();
    };
  }, [stream]);

  return (
    <canvas
      ref={canvasRef}
      width={300}
      height={60}
      className='mx-auto rounded-lg bg-white shadow-sm'
    />
  );
};

export const VoiceRecorder = ({
  question,
  handleSaveVoiceData,
  handleDiscardVoiceData,
}: {
  question: {
    value: RecordingData | null;
  };
  handleSaveVoiceData: (data: object) => void;
  handleDiscardVoiceData: () => void;
}) => {
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  
  const startRecording = async () => {
    try {
      /*This is really hacky but it works and there is a deadline, we should find a way to pass around such values in the future */
      /*eslint-disable-next-line @typescript-eslint/no-explicit-any*/
      const deviceId = (window as any).audioInputId;
      const constraints: MediaStreamConstraints = {
        audio: deviceId
          ? {
              deviceId: { exact: deviceId },
            }
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
    } catch (err) {
      console.error('Error accessing microphone:', err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
      setIsRecording(false);
    }
  };

  const saveRecording = (blob: Blob, url: string) => {
    if (blob && url) {
      handleSaveVoiceData({
        blob: blob,
        // dont change this type, since the upload function depends on it while looking for audio. we might want to refactor this at some point
        type: 'audiorecording',
        url: url,
        timestamp: new Date().toISOString(),
      });
    }
  };

  const discardRecording = () => {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioUrl(null);
    question.value = null;
    handleDiscardVoiceData();
  };

  return (
    <div className='flex flex-col items-center space-y-4 p-4 bg-white'>
      {/* Recording button */}
      {!audioUrl && (
        <button
          onClick={isRecording ? stopRecording : startRecording}
          className={`flex items-center justify-center space-x-2 p-4 rounded-full border-2 border-black shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none cursor-pointer
              ${isRecording ? 'bg-red-500 hover:bg-red-600' : ''} 
              text-white transition-colors duration-200`}
          aria-label={isRecording ? 'Stop Recording' : 'Start Recording'}
        >
          {isRecording ? (
            <HiStop className='w-6 h-6' />
          ) : (
            <HiMicrophone className='w-6 h-6 text-black' />
          )}
        </button>
      )}

      {/* Audio visualizer */}
      {isRecording && audioStream && (
        <div className='w-full max-w-md mx-auto'>
          <AudioVisualizer stream={audioStream} />
        </div>
      )}

      {/* Recording status */}
      {isRecording && (
        <div className='flex items-center space-x-2'>
          <div className='w-3 h-3 bg-red-500 rounded-full animate-pulse'></div>
          <span className='text-sm text-black'>Recording...</span>
        </div>
      )}

      {/* Audio player and action buttons */}
      {audioUrl && !isRecording && (
        <div className='flex flex-col items-center space-y-4 w-full max-w-md'>
          <audio
            controls
            preload='none'
            className='w-full'
            playsInline 
          >
            <source src={audioUrl} type='audio/mp4' />
            <source src={audioUrl} type='audio/webm' />
            Your browser does not support the audio element.
          </audio>

          <div className='flex space-x-4'>
            <button
              onClick={discardRecording}
              className='border-2 border-black shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none cursor-pointer flex items-center space-x-2 px-4 py-2 text-black
                        rounded-xl transition-colors duration-200'
            >
              <HiTrash className='w-4 h-4' />
              <span>Discard</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const CUSTOM_TYPE = 'voicerecorder';

export class VoiceRecorderModel extends Question {
  getType() {
    return CUSTOM_TYPE;
  }
}

Serializer.addClass(
  CUSTOM_TYPE,
  [],
  function () {
    return new VoiceRecorderModel('');
  },
  'question',
);

export default class VoiceRecorderQuestion extends SurveyQuestionElementBase {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(props: any) {
    super(props);
    this.state = { value: this.question.value };
  }
  get question() {
    return this.questionBase;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleSaveVoiceData = (data: any) => {
    this.question.value = data;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleDiscardVoiceData = () => {
    this.question.value = null;
  };

  get style() {
    return this.question.getPropertyValue('readOnly') || this.question.isDesignMode
      ? { pointerEvents: 'none' }
      : undefined;
  }

  renderElement() {
    return (
      <VoiceRecorder
        question={{ value: null }}
        handleSaveVoiceData={this.handleSaveVoiceData}
        handleDiscardVoiceData={this.handleDiscardVoiceData}
      />
    );
  }
}
