/**
 * Local Whisper Speech Recognition using Transformers.js
 * 
 * This hook provides offline, privacy-focused speech-to-text using
 * OpenAI's Whisper model running locally in the browser via Transformers.js.
 * 
 * Pros:
 * - Completely offline (no API calls)
 * - Free (no usage costs)
 * - Privacy-focused (audio never leaves device)
 * 
 * Cons:
 * - Requires model download (~75-150MB)
 * - Uses CPU/memory during transcription
 * - Initial load time can be slow
 */

import { useCallback, useRef, useState } from 'react';

// Model options - smaller = faster but less accurate
export type WhisperModelSize = 'tiny' | 'base' | 'small';

const MODEL_CONFIGS: Record<WhisperModelSize, { id: string; size: string }> = {
  tiny: { id: 'onnx-community/whisper-tiny', size: '~75MB' },
  base: { id: 'onnx-community/whisper-base', size: '~150MB' },
  small: { id: 'onnx-community/whisper-small', size: '~500MB' }
};

export interface UseLocalWhisperOptions {
  modelSize?: WhisperModelSize;
  language?: string;
}

export interface UseLocalWhisperResult {
  isSupported: boolean;
  isLoading: boolean;
  isRecording: boolean;
  isTranscribing: boolean;
  transcript: string;
  error: string | null;
  modelProgress: number; // 0-100 for model download progress
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<string>;
  resetTranscript: () => void;
}

// Lazy load transformers to avoid blocking initial page load
let transformersPromise: Promise<typeof import('@huggingface/transformers')> | null = null;

async function getTransformers() {
  if (!transformersPromise) {
    transformersPromise = import('@huggingface/transformers');
  }
  return transformersPromise;
}

export function useLocalWhisper(options: UseLocalWhisperOptions = {}): UseLocalWhisperResult {
  const { modelSize = 'tiny', language = 'en' } = options;

  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [modelProgress, setModelProgress] = useState(0);

  const pipelineRef = useRef<unknown>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Check if browser supports required APIs
  const isSupported = typeof window !== 'undefined' && 
    typeof navigator !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    typeof AudioContext !== 'undefined';

  const loadModel = useCallback(async () => {
    if (pipelineRef.current) return pipelineRef.current;

    setIsLoading(true);
    setError(null);
    setModelProgress(0);

    try {
      const { pipeline, env } = await getTransformers();
      
      // Configure for browser use
      env.allowLocalModels = false;
      env.useBrowserCache = true;

      const modelId = MODEL_CONFIGS[modelSize].id;
      console.log(`[LocalWhisper] Loading model: ${modelId}`);

      // Create the pipeline with progress callback
      const pipe = await pipeline('automatic-speech-recognition', modelId, {
        progress_callback: (progress: { status: string; progress?: number; file?: string }) => {
          if (progress.status === 'progress' && progress.progress !== undefined) {
            setModelProgress(Math.round(progress.progress));
          } else if (progress.status === 'done') {
            setModelProgress(100);
          }
          console.log(`[LocalWhisper] ${progress.status}:`, progress.file || '', progress.progress ?? '');
        }
      });

      pipelineRef.current = pipe;
      console.log('[LocalWhisper] Model loaded successfully');
      return pipe;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load Whisper model';
      console.error('[LocalWhisper] Model load error:', err);
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [modelSize]);

  const startRecording = useCallback(async () => {
    if (!isSupported) {
      setError('Audio recording not supported in this browser');
      return;
    }

    setError(null);
    audioChunksRef.current = [];

    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true
        }
      });

      // Create MediaRecorder
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
          ? 'audio/webm;codecs=opus' 
          : 'audio/webm'
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onerror = (event) => {
        console.error('[LocalWhisper] Recording error:', event);
        setError('Recording error occurred');
        setIsRecording(false);
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(1000); // Collect data every second
      setIsRecording(true);
      
      console.log('[LocalWhisper] Recording started');

      // Pre-load the model while recording
      loadModel().catch(() => {
        // Error already handled in loadModel
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to start recording';
      console.error('[LocalWhisper] Start recording error:', err);
      setError(errorMessage);
    }
  }, [isSupported, loadModel]);

  const stopRecording = useCallback(async (): Promise<string> => {
    return new Promise((resolve, reject) => {
      const mediaRecorder = mediaRecorderRef.current;
      
      if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        setIsRecording(false);
        resolve('');
        return;
      }

      mediaRecorder.onstop = async () => {
        setIsRecording(false);
        setIsTranscribing(true);

        try {
          // Stop all tracks
          mediaRecorder.stream.getTracks().forEach(track => track.stop());

          // Combine audio chunks
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          
          if (audioBlob.size === 0) {
            console.log('[LocalWhisper] No audio recorded');
            setIsTranscribing(false);
            resolve('');
            return;
          }

          console.log(`[LocalWhisper] Processing audio: ${(audioBlob.size / 1024).toFixed(1)}KB`);

          // Convert blob to array buffer
          const arrayBuffer = await audioBlob.arrayBuffer();

          // Decode audio using Web Audio API
          const audioContext = new AudioContext({ sampleRate: 16000 });
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
          
          // Get audio data as Float32Array
          const audioData = audioBuffer.getChannelData(0);

          // Ensure model is loaded
          const pipe = await loadModel();

          // Transcribe
          console.log('[LocalWhisper] Transcribing...');
          const result = await (pipe as (audio: Float32Array, options?: { language?: string }) => Promise<{ text: string }>)(audioData, {
            language
          });

          const text = result.text?.trim() || '';
          console.log('[LocalWhisper] Transcription:', text);

          setTranscript(text);
          setIsTranscribing(false);
          resolve(text);
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Transcription failed';
          console.error('[LocalWhisper] Transcription error:', err);
          setError(errorMessage);
          setIsTranscribing(false);
          reject(err);
        }
      };

      mediaRecorder.stop();
    });
  }, [language, loadModel]);

  const resetTranscript = useCallback(() => {
    setTranscript('');
    setError(null);
  }, []);

  return {
    isSupported,
    isLoading,
    isRecording,
    isTranscribing,
    transcript,
    error,
    modelProgress,
    startRecording,
    stopRecording,
    resetTranscript
  };
}


