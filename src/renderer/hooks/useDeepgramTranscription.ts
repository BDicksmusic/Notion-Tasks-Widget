/**
 * Deepgram Real-Time Transcription Hook
 * 
 * Provides true real-time speech-to-text using Deepgram's WebSocket API.
 * Words appear as you speak with ~100-300ms latency.
 * 
 * Pricing: ~$0.0043/minute ($200 free credit to start)
 * https://deepgram.com/pricing
 */

import { useState, useCallback, useRef, useEffect } from 'react';

export interface DeepgramConfig {
  apiKey: string;
  model?: string; // 'nova-2' (default, best), 'nova', 'enhanced', 'base'
  language?: string; // 'en-US', 'en-GB', etc.
  punctuate?: boolean;
  interimResults?: boolean;
  smartFormat?: boolean;
}

export interface UseDeepgramResult {
  isConnected: boolean;
  isListening: boolean;
  transcript: string;
  interimTranscript: string;
  error: string | null;
  startListening: () => Promise<void>;
  stopListening: () => void;
  resetTranscript: () => void;
}

export function useDeepgramTranscription(config: DeepgramConfig): UseDeepgramResult {
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopListening = useCallback(() => {
    console.log('[Deepgram] Stopping...');
    
    // Stop media recorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;

    // Stop media stream tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    // Close WebSocket
    if (socketRef.current) {
      if (socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.close();
      }
      socketRef.current = null;
    }

    setIsConnected(false);
    setIsListening(false);
  }, []);

  const startListening = useCallback(async () => {
    if (!config.apiKey) {
      setError('Deepgram API key is required. Get one free at deepgram.com');
      return;
    }

    setError(null);
    setInterimTranscript('');

    try {
      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        } 
      });
      streamRef.current = stream;

      // Build WebSocket URL with options
      const params = new URLSearchParams({
        model: config.model || 'nova-2',
        language: config.language || 'en-US',
        punctuate: String(config.punctuate ?? true),
        interim_results: String(config.interimResults ?? true),
        smart_format: String(config.smartFormat ?? true),
        encoding: 'linear16',
        sample_rate: '16000',
        channels: '1',
      });

      const wsUrl = `wss://api.deepgram.com/v1/listen?${params}`;
      
      console.log('[Deepgram] Connecting to WebSocket...');
      const socket = new WebSocket(wsUrl, ['token', config.apiKey]);
      socketRef.current = socket;

      socket.onopen = () => {
        console.log('[Deepgram] WebSocket connected');
        setIsConnected(true);
        setIsListening(true);

        // Start MediaRecorder to capture audio
        const mediaRecorder = new MediaRecorder(stream, {
          mimeType: 'audio/webm;codecs=opus',
        });
        mediaRecorderRef.current = mediaRecorder;

        mediaRecorder.ondataavailable = async (event) => {
          if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) {
            // Convert to raw PCM and send
            const arrayBuffer = await event.data.arrayBuffer();
            socket.send(arrayBuffer);
          }
        };

        // Send audio data every 250ms for real-time feel
        mediaRecorder.start(250);
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'Results' && data.channel?.alternatives?.[0]) {
            const result = data.channel.alternatives[0];
            const text = result.transcript || '';
            
            if (data.is_final) {
              // Final result - append to transcript
              if (text.trim()) {
                setTranscript(prev => {
                  const separator = prev && !prev.endsWith(' ') ? ' ' : '';
                  return prev + separator + text;
                });
                setInterimTranscript('');
              }
            } else {
              // Interim result - show as preview
              setInterimTranscript(text);
            }
          }
        } catch (e) {
          console.warn('[Deepgram] Failed to parse message:', e);
        }
      };

      socket.onerror = (event) => {
        console.error('[Deepgram] WebSocket error:', event);
        setError('Connection error. Check your API key and internet connection.');
        stopListening();
      };

      socket.onclose = (event) => {
        console.log('[Deepgram] WebSocket closed:', event.code, event.reason);
        setIsConnected(false);
        setIsListening(false);
        
        if (event.code === 1008) {
          setError('Invalid API key. Get a free key at deepgram.com');
        } else if (event.code !== 1000) {
          setError(`Connection closed: ${event.reason || 'Unknown reason'}`);
        }
      };

    } catch (err) {
      console.error('[Deepgram] Failed to start:', err);
      if (err instanceof Error) {
        if (err.name === 'NotAllowedError') {
          setError('Microphone access denied. Please allow microphone access.');
        } else {
          setError(err.message);
        }
      } else {
        setError('Failed to start transcription');
      }
      stopListening();
    }
  }, [config, stopListening]);

  const resetTranscript = useCallback(() => {
    setTranscript('');
    setInterimTranscript('');
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopListening();
    };
  }, [stopListening]);

  return {
    isConnected,
    isListening,
    transcript,
    interimTranscript,
    error,
    startListening,
    stopListening,
    resetTranscript,
  };
}


