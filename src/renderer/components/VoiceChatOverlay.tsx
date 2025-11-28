import { useCallback, useEffect, useRef, useState } from 'react';
import { useSpeechCapture } from '../hooks/useSpeechCapture';
import { useLocalWhisper } from '../hooks/useLocalWhisper';
import { platformBridge } from '@shared/platform';

const widgetAPI = platformBridge.widgetAPI;

// Speech recognition mode (free options only)
type SpeechMode = 'browser' | 'whisper';

// Available voice options
interface VoiceOption {
  id: string;
  name: string;
  lang: string;
}

// Get available voices
function getAvailableVoices(): VoiceOption[] {
  if (!('speechSynthesis' in window)) return [];
  
  const voices = speechSynthesis.getVoices();
  const englishVoices = voices.filter(v => v.lang.startsWith('en'));
  
  return englishVoices.map(v => ({
    id: v.voiceURI,
    name: v.name.replace(/Microsoft |Google /, ''),
    lang: v.lang
  }));
}

interface VoiceTask {
  id: string;
  title?: string | null;
  status?: string | null;
  dueDate?: string | null;
  dueDateEnd?: string | null;
  urgent?: boolean;
  important?: boolean;
}

interface VoiceProject {
  id: string;
  title?: string | null;
  status?: string | null;
}

interface VoiceChatOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onTranscript: (text: string) => void;
  onSend: (text: string) => Promise<string>;
  tasks?: VoiceTask[];
  projects?: VoiceProject[];
}

type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking' | 'confirming';

interface PendingAction {
  description: string;
  execute: () => Promise<void>;
}

// Simple beep sound using Web Audio API
function playSound(type: 'start' | 'stop' | 'success' | 'error') {
  try {
    const audioContext = new AudioContext();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    switch (type) {
      case 'start':
        oscillator.frequency.value = 800;
        gainNode.gain.value = 0.1;
        oscillator.type = 'sine';
        break;
      case 'stop':
        oscillator.frequency.value = 400;
        gainNode.gain.value = 0.1;
        oscillator.type = 'sine';
        break;
      case 'success':
        oscillator.frequency.value = 1000;
        gainNode.gain.value = 0.1;
        oscillator.type = 'sine';
        break;
      case 'error':
        oscillator.frequency.value = 200;
        gainNode.gain.value = 0.1;
        oscillator.type = 'square';
        break;
    }
    
    oscillator.start();
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.2);
    oscillator.stop(audioContext.currentTime + 0.2);
  } catch (err) {
    console.warn('Could not play sound:', err);
  }
}

// Text-to-speech helper with word-by-word display callback
function speak(
  text: string, 
  onWordUpdate?: (visibleText: string, wordIndex: number) => void,
  onEnd?: () => void,
  selectedVoiceId?: string
): void {
  if (!('speechSynthesis' in window)) {
    console.warn('Speech synthesis not supported');
    onWordUpdate?.(text, -1);
    onEnd?.();
    return;
  }

  // Cancel any ongoing speech
  speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  
  // Find the selected voice or use a good default
  const voices = speechSynthesis.getVoices();
  let selectedVoice = selectedVoiceId 
    ? voices.find(v => v.voiceURI === selectedVoiceId)
    : null;
  
  if (!selectedVoice) {
    // Try to find a good default voice
    selectedVoice = voices.find(v => 
      v.name.includes('Google US English') ||
      v.name.includes('Google UK English Female') ||
      v.name.includes('Samantha') ||
      v.name.includes('Microsoft Zira') ||
      v.name.includes('Microsoft David')
    ) || voices.find(v => v.lang.startsWith('en')) || voices[0];
  }
  
  if (selectedVoice) {
    utterance.voice = selectedVoice;
  }
  
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;

  // Track word boundaries for live text display
  const words = text.split(' ');
  let currentWordIndex = 0;
  
  // Use boundary event for word-by-word display
  utterance.onboundary = (event) => {
    if (event.name === 'word') {
      // Calculate which word we're at based on character index
      let charCount = 0;
      for (let i = 0; i < words.length; i++) {
        if (charCount >= event.charIndex) {
          currentWordIndex = i;
          break;
        }
        charCount += words[i].length + 1; // +1 for space
      }
      const visibleText = words.slice(0, currentWordIndex + 1).join(' ');
      onWordUpdate?.(visibleText, currentWordIndex);
    }
  };
  
  utterance.onstart = () => {
    // Show first word immediately
    onWordUpdate?.(words[0], 0);
  };
  
  utterance.onend = () => {
    // Show full text at end
    onWordUpdate?.(text, words.length - 1);
    onEnd?.();
  };
  
  utterance.onerror = (e) => {
    console.error('Speech error:', e);
    onWordUpdate?.(text, -1);
    onEnd?.();
  };
  
  // Small delay to ensure voices are loaded
  setTimeout(() => {
    speechSynthesis.speak(utterance);
  }, 100);
}

// Generate a simple greeting
function generateSimpleGreeting(): string {
  const now = new Date();
  const hour = now.getHours();
  
  let timeGreeting = 'Hello';
  if (hour < 12) timeGreeting = 'Good morning';
  else if (hour < 17) timeGreeting = 'Good afternoon';
  else timeGreeting = 'Good evening';

  return `${timeGreeting}! How can I help you today?`;
}

// Generate a contextual greeting based on tasks and time of day (encouraging, not nagging)
function generateContextualGreeting(tasks: VoiceTask[], projects: VoiceProject[]): string {
  const now = new Date();
  const hour = now.getHours();
  const today = now.toISOString().split('T')[0];
  
  // Time-based greeting
  let timeGreeting = 'Hello';
  if (hour < 12) timeGreeting = 'Good morning';
  else if (hour < 17) timeGreeting = 'Good afternoon';
  else timeGreeting = 'Good evening';

  // Analyze tasks
  const activeTasks = tasks.filter(t => 
    t.status?.toLowerCase() !== 'done' && 
    t.status?.toLowerCase() !== 'completed' &&
    t.status?.toLowerCase() !== '✅'
  );
  
  const overdueTasks = activeTasks.filter(t => {
    if (!t.dueDate) return false;
    return t.dueDate < today;
  });
  
  const todayTasks = activeTasks.filter(t => {
    if (!t.dueDate) return false;
    return t.dueDate === today;
  });
  
  const urgentTasks = activeTasks.filter(t => t.urgent);
  const importantTasks = activeTasks.filter(t => t.important);

  // Build greeting - encouraging tone!
  let greeting = `${timeGreeting}! `;
  
  // Summary - positive framing
  if (activeTasks.length === 0) {
    greeting += "You're all caught up - nice work! Would you like to plan something new?";
    return greeting;
  }

  // Positive framing for task count
  if (activeTasks.length <= 3) {
    greeting += `You have a light day with just ${activeTasks.length} task${activeTasks.length !== 1 ? 's' : ''}. `;
  } else if (activeTasks.length <= 7) {
    greeting += `You have ${activeTasks.length} tasks on your plate. `;
  } else {
    greeting += `Busy day ahead with ${activeTasks.length} tasks! `;
  }

  // Gentle mentions - not accusations
  if (overdueTasks.length > 0) {
    const taskName = overdueTasks[0].title || 'a task';
    if (overdueTasks.length === 1) {
      greeting += `Just a heads up, "${taskName}" slipped past its due date. No worries, want to knock it out now? `;
    } else {
      greeting += `A few items slipped past their dates. Would you like to update them? `;
    }
  } else if (todayTasks.length > 0) {
    const taskName = todayTasks[0].title || 'something';
    if (todayTasks.length === 1) {
      greeting += `"${taskName}" is on deck for today. Ready to dive in?`;
    } else {
      greeting += `You've got "${taskName}" and ${todayTasks.length - 1} more for today. What feels right to start with?`;
    }
  } else if (urgentTasks.length > 0) {
    const taskName = urgentTasks[0].title || 'something';
    greeting += `"${taskName}" is marked as urgent whenever you're ready. `;
  } else if (importantTasks.length > 0) {
    const taskName = importantTasks[0].title || 'something';
    greeting += `"${taskName}" looks important - want to work on that?`;
  } else {
    greeting += "What would you like to focus on?";
  }

  return greeting;
}

export default function VoiceChatOverlay({
  isOpen,
  onClose,
  onTranscript,
  onSend,
  tasks = [],
  projects = []
}: VoiceChatOverlayProps) {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [displayText, setDisplayText] = useState('');
  const [responseText, setResponseText] = useState('');
  const [visibleResponseText, setVisibleResponseText] = useState(''); // Text shown word-by-word
  const [audioLevel, setAudioLevel] = useState(0);
  const [conversationHistory, setConversationHistory] = useState<Array<{role: 'user' | 'assistant', text: string}>>([]);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentWordIndex, setCurrentWordIndex] = useState(-1);
  const [availableVoices, setAvailableVoices] = useState<VoiceOption[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('');
  const [showVoiceSelector, setShowVoiceSelector] = useState(false);
  const [showMicSetup, setShowMicSetup] = useState(false);
  const [micStatus, setMicStatus] = useState<'unknown' | 'granted' | 'denied' | 'testing'>('unknown');
  const [micTestLevel, setMicTestLevel] = useState(0);
  const [savedTranscript, setSavedTranscript] = useState('');
  const [greetingStyle, setGreetingStyle] = useState<'simple' | 'summary'>('simple');
  const [autoListen, setAutoListen] = useState(true);
  const [availableMics, setAvailableMics] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string>('');
  const [speechApiStatus, setSpeechApiStatus] = useState<'checking' | 'available' | 'unavailable'>('checking');
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [speechMode, setSpeechMode] = useState<SpeechMode>('browser'); // Default to browser for real-time (free)
  const [whisperModelReady, setWhisperModelReady] = useState(false);
  const [browserFailed, setBrowserFailed] = useState(false); // Track if browser speech failed
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number>();
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const silenceTimeoutRef = useRef<NodeJS.Timeout>();
  const hasSpokenRef = useRef(false);

  // Browser speech recognition (requires internet)
  const {
    isListening: browserIsListening,
    isSupported: browserIsSupported,
    transcript: browserTranscript,
    interimTranscript,
    error: browserSpeechError,
    startListening: browserStartListening,
    stopListening: browserStopListening,
    resetTranscript: browserResetTranscript
  } = useSpeechCapture();

  // Local Whisper (offline, free)
  const {
    isSupported: whisperIsSupported,
    isLoading: whisperIsLoading,
    isRecording: whisperIsRecording,
    isTranscribing: whisperIsTranscribing,
    transcript: whisperTranscript,
    error: whisperError,
    modelProgress: whisperModelProgress,
    startRecording: whisperStartRecording,
    stopRecording: whisperStopRecording,
    resetTranscript: whisperResetTranscript
  } = useLocalWhisper({ modelSize: 'tiny' });

  // Unified interface based on mode
  const isListening = speechMode === 'whisper' ? whisperIsRecording : browserIsListening;
  const isSupported = speechMode === 'whisper' ? whisperIsSupported : browserIsSupported;
  const transcript = speechMode === 'whisper' ? whisperTranscript : browserTranscript;
  const speechError = speechMode === 'whisper' ? whisperError : browserSpeechError;
  
  const startListening = useCallback(() => {
    if (speechMode === 'whisper') {
      whisperStartRecording();
    } else {
      browserStartListening();
    }
  }, [speechMode, whisperStartRecording, browserStartListening]);

  const stopListening = useCallback(() => {
    if (speechMode === 'whisper') {
      whisperStopRecording();
    } else {
      browserStopListening();
    }
  }, [speechMode, whisperStopRecording, browserStopListening]);

  const resetTranscript = useCallback(() => {
    if (speechMode === 'whisper') {
      whisperResetTranscript();
    } else {
      browserResetTranscript();
    }
  }, [speechMode, whisperResetTranscript, browserResetTranscript]);

  // Add to debug log - define early so it can be used in effects
  const addDebug = useCallback((msg: string) => {
    console.log('[VoiceChat]', msg);
    setDebugLog(prev => [...prev.slice(-9), `${new Date().toLocaleTimeString()}: ${msg}`]);
  }, []);

  // Debug transcript changes
  useEffect(() => {
    if (transcript) {
      addDebug(`Final transcript: "${transcript}"`);
    }
  }, [transcript, addDebug]);

  useEffect(() => {
    if (interimTranscript) {
      addDebug(`Interim: "${interimTranscript}"`);
    }
  }, [interimTranscript, addDebug]);

  useEffect(() => {
    if (speechError) {
      addDebug(`Speech error: ${speechError}`);
      
      // Auto-fallback to Whisper if browser speech fails with network error
      if (speechMode === 'browser' && 
          (speechError.includes('internet') || speechError.includes('Network') || speechError.includes('network'))) {
        addDebug('Browser speech failed, switching to Local AI (Whisper)');
        setBrowserFailed(true);
        setSpeechMode('whisper');
        // Start Whisper recording
        whisperStartRecording();
      }
    }
  }, [speechError, addDebug, speechMode, whisperStartRecording]);

  useEffect(() => {
    addDebug(`Listening state: ${isListening}`);
  }, [isListening, addDebug]);

  // Audio level monitoring for visualization - uses selected microphone
  const startAudioMonitoring = useCallback(async () => {
    try {
      // Use the selected microphone if available
      const audioConstraints: MediaTrackConstraints = selectedMicId 
        ? { deviceId: { exact: selectedMicId } }
        : true;
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      mediaStreamRef.current = stream;
      
      audioContextRef.current = new AudioContext();
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      
      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);
      
      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
      
      const updateLevel = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setAudioLevel(average / 255);
        animationFrameRef.current = requestAnimationFrame(updateLevel);
      };
      
      updateLevel();
      addDebug(`Audio monitoring started with mic: ${selectedMicId || 'default'}`);
    } catch (err) {
      console.error('Failed to start audio monitoring:', err);
      addDebug(`Audio monitoring failed: ${err}`);
    }
  }, [selectedMicId, addDebug]);

  const stopAudioMonitoring = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setAudioLevel(0);
  }, []);

  const resumeListening = useCallback(() => {
    setVoiceState('listening');
    setDisplayText('');
    resetTranscript();
    hasSpokenRef.current = false;
    startListening();
    startAudioMonitoring();
  }, [resetTranscript, startListening, startAudioMonitoring]);

  // Restart audio monitoring when microphone changes
  useEffect(() => {
    if (isOpen && voiceState === 'listening' && selectedMicId) {
      stopAudioMonitoring();
      startAudioMonitoring();
      addDebug(`Switched to microphone: ${selectedMicId}`);
    }
  }, [selectedMicId]); // Only trigger on mic change

  // Expand dock and keep it expanded when voice chat opens
  useEffect(() => {
    if (isOpen) {
      // Force expand the dock to prevent collapse
      widgetAPI.requestExpand?.();
      
      // Keep expanding periodically while voice chat is open
      const keepExpanded = setInterval(() => {
        widgetAPI.requestExpand?.();
      }, 500);
      
      return () => {
        clearInterval(keepExpanded);
      };
    }
  }, [isOpen]);

  // Load voices and settings on mount
  useEffect(() => {
    // Load saved settings from localStorage
    if (typeof window !== 'undefined') {
      const saved = window.localStorage?.getItem('voiceAssistantSettings');
      if (saved) {
        try {
          const settings = JSON.parse(saved);
          if (settings.greetingStyle) setGreetingStyle(settings.greetingStyle);
          if (settings.selectedVoiceId) setSelectedVoiceId(settings.selectedVoiceId);
          if (typeof settings.autoListen === 'boolean') setAutoListen(settings.autoListen);
        } catch (e) {
          console.error('Failed to parse voice settings:', e);
        }
      }
    }
    
    if ('speechSynthesis' in window) {
      const loadVoices = () => {
        const voices = getAvailableVoices();
        setAvailableVoices(voices);
        
        // Set default voice if not set and no saved preference
        if (!selectedVoiceId && voices.length > 0) {
          const saved = window.localStorage?.getItem('voiceAssistantSettings');
          const savedVoiceId = saved ? JSON.parse(saved).selectedVoiceId : null;
          
          if (!savedVoiceId) {
            // Prefer Google or Microsoft voices
            const preferred = voices.find(v => 
              v.name.includes('Google') || 
              v.name.includes('Zira') ||
              v.name.includes('David') ||
              v.name.includes('Samantha')
            );
            setSelectedVoiceId(preferred?.id || voices[0].id);
          }
        }
      };
      
      loadVoices();
      speechSynthesis.onvoiceschanged = loadVoices;
      
      return () => {
        speechSynthesis.onvoiceschanged = null;
      };
    }
  }, [selectedVoiceId]);

  // Check microphone permission and enumerate devices on mount
  useEffect(() => {
    if (isOpen) {
      // Check Speech API availability
      const hasSpeechAPI = typeof window !== 'undefined' && 
        (Boolean(window.SpeechRecognition) || Boolean((window as any).webkitSpeechRecognition));
      setSpeechApiStatus(hasSpeechAPI ? 'available' : 'unavailable');
      addDebug(`Speech API: ${hasSpeechAPI ? 'available' : 'NOT AVAILABLE'}`);
      
      // Check microphone permission
      navigator.permissions?.query({ name: 'microphone' as PermissionName })
        .then(result => {
          setMicStatus(result.state === 'granted' ? 'granted' : result.state === 'denied' ? 'denied' : 'unknown');
          addDebug(`Mic permission: ${result.state}`);
        })
        .catch(() => {
          setMicStatus('unknown');
          addDebug('Mic permission: unknown (query failed)');
        });
      
      // Enumerate microphones
      navigator.mediaDevices?.enumerateDevices()
        .then(devices => {
          const mics = devices.filter(d => d.kind === 'audioinput');
          setAvailableMics(mics);
          addDebug(`Found ${mics.length} microphone(s)`);
          if (mics.length > 0 && !selectedMicId) {
            setSelectedMicId(mics[0].deviceId);
          }
        })
        .catch(err => {
          addDebug(`Failed to enumerate devices: ${err.message}`);
        });
    }
  }, [isOpen, addDebug, selectedMicId]);

  // Test microphone function - uses selected microphone
  const testMicrophone = async () => {
    setMicStatus('testing');
    setMicTestLevel(0);
    addDebug(`Testing microphone: ${selectedMicId || 'default'}`);
    
    try {
      // Use the selected microphone
      const audioConstraints: MediaTrackConstraints = selectedMicId 
        ? { deviceId: { exact: selectedMicId } }
        : true;
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      let maxLevel = 0;
      
      const checkLevel = () => {
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        const normalized = Math.min(1, average / 128);
        setMicTestLevel(normalized);
        maxLevel = Math.max(maxLevel, normalized);
      };
      
      const interval = setInterval(checkLevel, 50);
      
      // Test for 3 seconds
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      clearInterval(interval);
      stream.getTracks().forEach(track => track.stop());
      audioContext.close();
      
      setMicStatus(maxLevel > 0.1 ? 'granted' : 'unknown');
      setMicTestLevel(0);
      addDebug(`Mic test complete, max level: ${(maxLevel * 100).toFixed(0)}%`);
      
      if (maxLevel > 0.1) {
        playSound('success');
      }
    } catch (err) {
      console.error('Mic test failed:', err);
      addDebug(`Mic test failed: ${err}`);
      setMicStatus('denied');
      setMicTestLevel(0);
      playSound('error');
    }
  };

  // Track transcript for display after speaking
  useEffect(() => {
    if (transcript) {
      setSavedTranscript(transcript);
    }
  }, [transcript]);

  // Start listening when overlay opens
  useEffect(() => {
    if (isOpen && isSupported) {
      // Play startup sound and speak greeting
      playSound('start');
      
      // Generate greeting based on style preference
      const greeting = greetingStyle === 'simple' 
        ? generateSimpleGreeting()
        : generateContextualGreeting(tasks, projects);
      
      setVoiceState('speaking');
      setResponseText(greeting);
      setVisibleResponseText('');
      
      speak(
        greeting,
        (visibleText, wordIdx) => {
          setVisibleResponseText(visibleText);
          setCurrentWordIndex(wordIdx);
        },
        () => {
          resumeListening();
        },
        selectedVoiceId
      );
    }
    
    return () => {
      stopListening();
      stopAudioMonitoring();
      speechSynthesis?.cancel();
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
      }
    };
  }, [isOpen, isSupported]);

  // Update display text as user speaks
  useEffect(() => {
    if (isListening) {
      const currentText = transcript + (interimTranscript ? ' ' + interimTranscript : '');
      setDisplayText(currentText);
      onTranscript(currentText);
      
      // Track if user has spoken
      if (currentText.trim()) {
        hasSpokenRef.current = true;
      }
      
      // Reset silence timeout when speaking
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
      }
      
      // Auto-process after 2 seconds of silence (if something was said)
      if (hasSpokenRef.current && currentText.trim()) {
        silenceTimeoutRef.current = setTimeout(() => {
          if (isListening && transcript) {
            stopListening();
            handleProcessTranscript(transcript);
          }
        }, 2000);
      }
    }
  }, [transcript, interimTranscript, isListening, onTranscript]);

  const handleProcessTranscript = async (text: string) => {
    if (!text.trim()) {
      resumeListening();
      return;
    }

    playSound('stop');
    setVoiceState('processing');
    stopAudioMonitoring();
    setError(null);
    
    // Add user message to history
    setConversationHistory(prev => [...prev, { role: 'user', text }]);

    try {
      const response = await onSend(text);
      setResponseText(response);
      setVisibleResponseText('');
      setVoiceState('speaking');
      
      // Add assistant response to history
      setConversationHistory(prev => [...prev, { role: 'assistant', text: response }]);

      playSound('success');
      
      // Speak the response with word-by-word display
      speak(
        response,
        (visibleText, wordIdx) => {
          setVisibleResponseText(visibleText);
          setCurrentWordIndex(wordIdx);
        },
        () => {
          // After speaking, resume listening
          setVisibleResponseText(response); // Ensure full text is shown
          resumeListening();
        },
        selectedVoiceId
      );
    } catch (err) {
      console.error('Failed to process:', err);
      const errorMsg = err instanceof Error ? err.message : 'Sorry, I had trouble with that. Please try again.';
      setError(errorMsg);
      setResponseText(errorMsg);
      setVisibleResponseText('');
      
      playSound('error');
      
      speak(
        errorMsg,
        (visibleText) => setVisibleResponseText(visibleText),
        () => {
          resumeListening();
        },
        selectedVoiceId
      );
    }
  };

  const handleClose = () => {
    stopListening();
    stopAudioMonitoring();
    speechSynthesis?.cancel();
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
    }
    setVoiceState('idle');
    setConversationHistory([]);
    setPendingAction(null);
    onClose();
  };

  const handleOrbClick = async () => {
    console.log('[VoiceChat] Orb clicked, current state:', voiceState, 'mode:', speechMode);
    playSound('start'); // Audio feedback on click
    
    if (voiceState === 'listening') {
      // Stop and process immediately
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
      }
      stopAudioMonitoring();
      
      if (speechMode === 'whisper') {
        // Whisper mode: stopRecording returns the transcript
        setVoiceState('processing');
        try {
          const whisperText = await whisperStopRecording();
          if (whisperText) {
            handleProcessTranscript(whisperText);
          } else {
            playSound('stop');
            resumeListening();
          }
        } catch (err) {
          console.error('Whisper error:', err);
          playSound('error');
          resumeListening();
        }
      } else {
        // Browser mode: transcript is already available
        stopListening();
        if (transcript) {
          handleProcessTranscript(transcript);
        } else {
          playSound('stop');
          resumeListening();
        }
      }
    } else if (voiceState === 'speaking') {
      // Stop speaking and resume listening
      speechSynthesis?.cancel();
      resumeListening();
    } else if (voiceState === 'idle') {
      // Start listening
      playSound('start');
      resumeListening();
    }
  };

  if (!isOpen) return null;

  const orbScale = 1 + (audioLevel * 0.4);
  const orbGlow = audioLevel * 80;

  return (
    <div className="voice-chat-overlay" onClick={(e) => e.stopPropagation()}>
      <div className="voice-header-buttons">
        <button 
          className="voice-mic-btn" 
          onClick={() => setShowMicSetup(!showMicSetup)}
          title="Microphone setup"
        >
          🎤
        </button>
        <button 
          className="voice-settings-btn" 
          onClick={() => setShowVoiceSelector(!showVoiceSelector)}
          title="Change voice"
        >
          🔊
        </button>
        <button className="voice-close-btn" onClick={handleClose} title="Close voice chat">
          ✕
        </button>
      </div>

      {/* Simplified Microphone Status Panel */}
      {showMicSetup && (
        <div className="mic-setup-panel compact">
          <h4>🎤 Voice Status</h4>
          
          {/* Current Mode Display */}
          <div className="current-mode-display">
            <span className="mode-label">Engine:</span>
            <span className="mode-value">
              {speechMode === 'browser' && '🌐 Browser (Real-time)'}
              {speechMode === 'whisper' && '🤖 Local AI (Offline)'}
            </span>
            {browserFailed && <span className="mode-failed">⚠️ Needs internet</span>}
          </div>

          {/* Current Microphone */}
          <div className="current-mic-display">
            <span className="mode-label">Mic:</span>
            <span className="mode-value">
              {availableMics.find(m => m.deviceId === selectedMicId)?.label?.slice(0, 30) || 'Default'}
            </span>
            <span className={`mic-permission-badge ${micStatus}`}>
              {micStatus === 'granted' ? '✓' : micStatus === 'denied' ? '✕' : '?'}
            </span>
          </div>

          {/* Live Level - Compact */}
          <div className="compact-level">
            <div className="mic-level-bar compact">
              <div 
                className="mic-level-fill" 
                style={{ width: `${audioLevel * 100}%` }}
              />
            </div>
            <span className="level-indicator">
              {audioLevel > 0.1 ? '🎤' : '🔇'}
            </span>
          </div>

          {/* Whisper Download Progress (only when downloading) */}
          {speechMode === 'whisper' && whisperIsLoading && (
            <div className="whisper-download-compact">
              <span>Downloading AI Model: {whisperModelProgress}%</span>
              <div className="whisper-progress-bar">
                <div className="whisper-progress-fill" style={{ width: `${whisperModelProgress}%` }} />
              </div>
            </div>
          )}

          {/* Link to full settings */}
          <p className="settings-link-hint">
            Configure voice settings in <strong>Control Center → Voice Assistant</strong>
          </p>

          {/* Collapsible Debug Log at bottom */}
          <details className="debug-log-collapsible">
            <summary>Debug Log ({debugLog.length})</summary>
            <div className="debug-log-content">
              {debugLog.length === 0 ? (
                <span className="debug-empty">No events yet...</span>
              ) : (
                debugLog.map((log, i) => (
                  <div key={i} className="debug-line">{log}</div>
                ))
              )}
            </div>
          </details>

          <button 
            className="mic-setup-close"
            onClick={() => setShowMicSetup(false)}
          >
            Done
          </button>
        </div>
      )}
      
      {/* Voice Selector */}
      {showVoiceSelector && (
        <div className="voice-selector">
          <h4>Select Voice</h4>
          <div className="voice-list">
            {availableVoices.map(voice => (
              <button
                key={voice.id}
                className={`voice-option ${selectedVoiceId === voice.id ? 'selected' : ''}`}
                onClick={() => {
                  setSelectedVoiceId(voice.id);
                  // Sync to localStorage for Control Center
                  const saved = window.localStorage?.getItem('voiceAssistantSettings');
                  const settings = saved ? JSON.parse(saved) : {};
                  window.localStorage?.setItem('voiceAssistantSettings', JSON.stringify({ ...settings, selectedVoiceId: voice.id }));
                  // Test the voice
                  speak("Hello, this is how I sound.", undefined, undefined, voice.id);
                }}
              >
                <span className="voice-name">{voice.name}</span>
                <span className="voice-lang">{voice.lang}</span>
                {selectedVoiceId === voice.id && <span className="voice-check">✓</span>}
              </button>
            ))}
          </div>
          <button 
            className="voice-selector-close"
            onClick={() => setShowVoiceSelector(false)}
          >
            Done
          </button>
        </div>
      )}
      
      <div className="voice-chat-content">
        {/* Conversation History */}
        <div className="voice-history">
          {conversationHistory.slice(-4).map((msg, i) => (
            <div key={i} className={`voice-history-item ${msg.role}`}>
              <span className="voice-history-role">{msg.role === 'user' ? 'You' : 'Assistant'}</span>
              <span className="voice-history-text">{msg.text}</span>
            </div>
          ))}
        </div>

        {/* Animated Orb */}
        <div className="voice-orb-container">
          <div 
            className={`voice-orb ${voiceState}`}
            onClick={handleOrbClick}
            style={{
              transform: `scale(${voiceState === 'listening' ? orbScale : 1})`,
              boxShadow: voiceState === 'listening' 
                ? `0 0 ${20 + orbGlow}px rgba(59, 130, 246, ${0.4 + audioLevel * 0.5}),
                   0 0 ${50 + orbGlow}px rgba(59, 130, 246, ${0.2 + audioLevel * 0.3}),
                   inset 0 0 20px rgba(255, 255, 255, ${0.1 + audioLevel * 0.2})`
                : undefined
            }}
          >
            <div className="orb-inner">
              {voiceState === 'listening' && (
                <div className="orb-waves">
                  <span style={{ animationDelay: '0s', height: `${20 + audioLevel * 30}px` }}></span>
                  <span style={{ animationDelay: '0.15s', height: `${25 + audioLevel * 35}px` }}></span>
                  <span style={{ animationDelay: '0.3s', height: `${20 + audioLevel * 30}px` }}></span>
                </div>
              )}
              {voiceState === 'processing' && (
                <div className="orb-spinner"></div>
              )}
              {voiceState === 'speaking' && (
                <div className="orb-speaking">
                  <span></span>
                  <span></span>
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              )}
              {voiceState === 'idle' && (
                <div className="orb-mic">🎤</div>
              )}
            </div>
          </div>
          
          <div className="voice-state-label">
            {voiceState === 'listening' && speechMode === 'browser' && (displayText ? 'Listening (live)...' : 'Speak now...')}
            {voiceState === 'listening' && speechMode === 'whisper' && (whisperIsRecording ? 'Recording... (tap when done)' : 'Speak now...')}
            {voiceState === 'processing' && (whisperIsTranscribing ? 'Transcribing audio...' : 'Thinking...')}
            {voiceState === 'speaking' && 'Speaking...'}
            {voiceState === 'idle' && (whisperIsLoading ? `Loading AI (${whisperModelProgress}%)...` : 'Tap to start')}
          </div>
          {speechMode === 'whisper' && whisperIsLoading && (
            <div className="whisper-loading-bar">
              <div className="whisper-loading-fill" style={{ width: `${whisperModelProgress}%` }} />
            </div>
          )}
        </div>

        {/* Live Audio Level Indicator */}
        {voiceState === 'listening' && (
          <div className="live-audio-indicator">
            <div className="audio-bars">
              {[...Array(12)].map((_, i) => (
                <div 
                  key={i} 
                  className="audio-bar"
                  style={{ 
                    height: `${Math.max(4, audioLevel * 40 * (1 + Math.sin(i * 0.5) * 0.5))}px`,
                    opacity: audioLevel > 0.05 ? 1 : 0.3
                  }}
                />
              ))}
            </div>
            <span className="audio-status">
              {audioLevel > 0.3 ? '🎤 Hearing you!' : audioLevel > 0.1 ? '🎤 Listening...' : '🎤 Speak now'}
            </span>
          </div>
        )}

        {/* Current Transcript / Response */}
        <div className="voice-transcript">
          {voiceState === 'listening' && (
            <div className={`transcript-bubble user ${displayText ? 'active' : 'waiting'}`}>
              <span className="bubble-label">👤 You</span>
              {displayText ? (
                <p className="transcript-text live">
                  {displayText}
                  <span className="typing-cursor pulse">|</span>
                </p>
              ) : (
                <p className="transcript-placeholder">
                  <span className="placeholder-dots">
                    <span>●</span><span>●</span><span>●</span>
                  </span>
                  Waiting for you to speak...
                </p>
              )}
            </div>
          )}
          {voiceState === 'processing' && (
            <div className="transcript-bubble user complete">
              <span className="bubble-label">👤 You said</span>
              <p className="transcript-text">"{transcript}"</p>
            </div>
          )}
          {voiceState === 'speaking' && (
            <>
              <div className="transcript-bubble user complete faded">
                <span className="bubble-label">👤 You said</span>
                <p className="transcript-text small">"{savedTranscript}"</p>
              </div>
              <div className="transcript-bubble assistant">
                <span className="bubble-label">🤖 Assistant</span>
                <p className="response-text">
                  {visibleResponseText}
                  {visibleResponseText !== responseText && <span className="typing-cursor speaking">|</span>}
                </p>
              </div>
            </>
          )}
          {error && (
            <p className="error-text">⚠️ {error}</p>
          )}
          {speechError && (
            <div className="speech-error-container">
              <p className="error-text">🎤 {speechError}</p>
              {speechError.includes('internet') || speechError.includes('Network') ? (
                <p className="error-hint">
                  💡 Voice recognition needs internet. You can type below instead:
                </p>
              ) : null}
            </div>
          )}
          {speechApiStatus === 'unavailable' && (
            <p className="error-text">⚠️ Speech recognition not available in this browser</p>
          )}
          
          {/* Text input fallback when voice fails */}
          {(speechError || speechApiStatus === 'unavailable') && (
            <div className="voice-text-fallback">
              <input
                type="text"
                className="voice-text-input"
                placeholder="Type your message here..."
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                    const text = e.currentTarget.value.trim();
                    e.currentTarget.value = '';
                    setVoiceState('processing');
                    handleProcessTranscript(text);
                  }
                }}
              />
              <p className="fallback-hint">Press Enter to send</p>
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="voice-hints">
          <div className="hint-title">Try saying:</div>
          <div className="hint-examples">
            <span>"Add a task to call John tomorrow"</span>
            <span>"Mark the design review as done"</span>
            <span>"What tasks do I have today?"</span>
          </div>
        </div>

        {/* Tap instruction */}
        <div className="voice-tap-hint">
          {voiceState === 'listening' && 'Tap the orb when done speaking'}
          {voiceState === 'speaking' && 'Tap to interrupt'}
        </div>
      </div>

      <style>{`
        .voice-chat-overlay {
          position: fixed;
          inset: 0;
          background: linear-gradient(180deg, #0a0a0f 0%, #1a1a2e 50%, #0a0a0f 100%);
          z-index: 100000;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          animation: fadeIn 0.3s ease;
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .voice-header-buttons {
          position: absolute;
          top: 20px;
          right: 20px;
          display: flex;
          gap: 12px;
        }

        .voice-settings-btn,
        .voice-close-btn {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.2);
          color: rgba(255, 255, 255, 0.7);
          font-size: 20px;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .voice-settings-btn:hover,
        .voice-close-btn:hover {
          background: rgba(255, 255, 255, 0.2);
          color: white;
          transform: scale(1.05);
        }

        .voice-selector {
          position: absolute;
          top: 80px;
          right: 20px;
          background: rgba(20, 20, 30, 0.95);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 12px;
          padding: 16px;
          min-width: 280px;
          max-height: 400px;
          overflow-y: auto;
          z-index: 10;
          animation: slideDown 0.2s ease;
        }

        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .voice-selector h4 {
          margin: 0 0 12px;
          color: white;
          font-size: 14px;
          font-weight: 600;
        }

        .voice-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-bottom: 12px;
        }

        .voice-option {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 12px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.15s;
          text-align: left;
        }

        .voice-option:hover {
          background: rgba(255, 255, 255, 0.1);
          border-color: rgba(255, 255, 255, 0.2);
        }

        .voice-option.selected {
          background: rgba(59, 130, 246, 0.2);
          border-color: rgba(59, 130, 246, 0.5);
        }

        .voice-name {
          flex: 1;
          color: white;
          font-size: 13px;
        }

        .voice-lang {
          color: rgba(255, 255, 255, 0.5);
          font-size: 11px;
        }

        .voice-check {
          color: #3b82f6;
          font-weight: bold;
        }

        .voice-selector-close {
          width: 100%;
          padding: 10px;
          background: rgba(59, 130, 246, 0.2);
          border: 1px solid rgba(59, 130, 246, 0.4);
          border-radius: 8px;
          color: white;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.15s;
        }

        .voice-selector-close:hover {
          background: rgba(59, 130, 246, 0.3);
        }

        .voice-mic-btn {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.2);
          color: rgba(255, 255, 255, 0.7);
          font-size: 20px;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .voice-mic-btn:hover {
          background: rgba(255, 255, 255, 0.2);
          color: white;
          transform: scale(1.05);
        }

        .mic-setup-panel {
          position: absolute;
          top: 80px;
          left: 20px;
          background: rgba(20, 20, 30, 0.95);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 16px;
          padding: 20px;
          min-width: 300px;
          max-width: 320px;
          z-index: 10;
          animation: slideDown 0.2s ease;
        }

        .mic-setup-panel.compact {
          padding: 16px;
          min-width: 260px;
        }

        .mic-setup-panel h4 {
          margin: 0 0 12px;
          color: white;
          font-size: 15px;
          font-weight: 600;
        }

        /* Compact mode displays */
        .current-mode-display,
        .current-mic-display {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 8px;
          margin-bottom: 8px;
        }

        .mode-label {
          color: rgba(255, 255, 255, 0.6);
          font-size: 12px;
          min-width: 50px;
        }

        .mode-value {
          color: white;
          font-size: 13px;
          font-weight: 500;
          flex: 1;
        }

        .mode-failed {
          color: #fbbf24;
          font-size: 11px;
        }

        .mic-permission-badge {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: bold;
        }

        .mic-permission-badge.granted {
          background: rgba(74, 222, 128, 0.2);
          color: #4ade80;
        }

        .mic-permission-badge.denied {
          background: rgba(248, 113, 113, 0.2);
          color: #f87171;
        }

        .mic-permission-badge.unknown,
        .mic-permission-badge.testing {
          background: rgba(255, 255, 255, 0.1);
          color: rgba(255, 255, 255, 0.5);
        }

        .compact-level {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 10px;
        }

        .mic-level-bar.compact {
          flex: 1;
          height: 8px;
          margin-bottom: 0;
        }

        .level-indicator {
          font-size: 16px;
          width: 24px;
          text-align: center;
        }

        .whisper-download-compact {
          padding: 10px;
          background: rgba(59, 130, 246, 0.1);
          border-radius: 8px;
          margin-bottom: 10px;
        }

        .whisper-download-compact span {
          display: block;
          color: rgba(255, 255, 255, 0.8);
          font-size: 12px;
          margin-bottom: 6px;
        }

        .settings-link-hint {
          color: rgba(255, 255, 255, 0.5);
          font-size: 11px;
          text-align: center;
          margin: 10px 0;
        }

        .settings-link-hint strong {
          color: rgba(255, 255, 255, 0.7);
        }

        /* Collapsible Debug Log */
        .debug-log-collapsible {
          margin-top: 10px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          padding-top: 10px;
        }

        .debug-log-collapsible summary {
          cursor: pointer;
          color: rgba(255, 255, 255, 0.5);
          font-size: 11px;
          padding: 4px 0;
          user-select: none;
        }

        .debug-log-collapsible summary:hover {
          color: rgba(255, 255, 255, 0.7);
        }

        .debug-log-content {
          max-height: 120px;
          overflow-y: auto;
          margin-top: 8px;
          padding: 8px;
          background: rgba(0, 0, 0, 0.3);
          border-radius: 6px;
          font-family: monospace;
          font-size: 10px;
        }

        .debug-line {
          color: rgba(255, 255, 255, 0.6);
          padding: 2px 0;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }

        .debug-empty {
          color: rgba(255, 255, 255, 0.3);
          font-style: italic;
        }

        .mic-status-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
          padding: 12px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 8px;
        }

        .mic-status-label {
          color: rgba(255, 255, 255, 0.7);
          font-size: 14px;
        }

        .mic-status-value {
          font-size: 14px;
          font-weight: 600;
        }

        .mic-status-value.granted { color: #4ade80; }
        .mic-status-value.denied { color: #f87171; }
        .mic-status-value.testing { color: #60a5fa; }
        .mic-status-value.unknown { color: rgba(255, 255, 255, 0.5); }

        .mic-level-container {
          margin-bottom: 16px;
        }

        .mic-level-bar {
          height: 24px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          overflow: hidden;
          margin-bottom: 8px;
        }

        .mic-level-fill {
          height: 100%;
          background: linear-gradient(90deg, #3b82f6, #8b5cf6, #ec4899);
          border-radius: 12px;
          transition: width 0.05s ease;
        }

        .mic-level-text {
          display: block;
          text-align: center;
          color: rgba(255, 255, 255, 0.8);
          font-size: 13px;
        }

        .mic-test-btn {
          width: 100%;
          padding: 14px;
          background: linear-gradient(135deg, #3b82f6, #8b5cf6);
          border: none;
          border-radius: 10px;
          color: white;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          margin-bottom: 16px;
        }

        .mic-test-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 4px 20px rgba(59, 130, 246, 0.4);
        }

        .mic-test-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        .mic-tips {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 8px;
          padding: 12px;
          margin-bottom: 16px;
        }

        .mic-tips p {
          margin: 0 0 8px;
          color: rgba(255, 255, 255, 0.8);
          font-size: 13px;
        }

        .mic-tips ul {
          margin: 0;
          padding-left: 20px;
        }

        .mic-tips li {
          color: rgba(255, 255, 255, 0.6);
          font-size: 12px;
          margin-bottom: 4px;
        }

        .mic-setup-close {
          width: 100%;
          padding: 10px;
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 8px;
          color: white;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.15s;
        }

        .mic-setup-close:hover {
          background: rgba(255, 255, 255, 0.2);
        }

        .mic-select-section {
          margin-bottom: 16px;
        }

        .mic-select-label,
        .mic-level-label,
        .debug-log-label {
          display: block;
          color: rgba(255, 255, 255, 0.7);
          font-size: 12px;
          margin-bottom: 6px;
        }

        .mic-select {
          width: 100%;
          padding: 10px 12px;
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 8px;
          color: white;
          font-size: 13px;
        }

        .mic-select:focus {
          outline: none;
          border-color: #3b82f6;
        }

        .mic-level-fill.testing {
          background: linear-gradient(90deg, #22c55e, #4ade80);
        }

        .debug-log-section {
          margin-top: 16px;
          margin-bottom: 16px;
        }

        .debug-log {
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          padding: 10px;
          max-height: 120px;
          overflow-y: auto;
          font-family: monospace;
          font-size: 11px;
        }

        .debug-empty {
          color: rgba(255, 255, 255, 0.4);
          font-style: italic;
        }

        .debug-line {
          color: rgba(255, 255, 255, 0.8);
          margin-bottom: 4px;
          word-break: break-all;
        }

        .debug-line:last-child {
          margin-bottom: 0;
        }

        .speech-error-container {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .error-hint {
          color: rgba(255, 255, 255, 0.7);
          font-size: 13px;
          margin: 0;
        }

        .voice-text-fallback {
          margin-top: 16px;
          width: 100%;
          max-width: 400px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .voice-text-input {
          width: 100%;
          padding: 14px 18px;
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 12px;
          color: white;
          font-size: 15px;
          outline: none;
          transition: all 0.2s;
        }

        .voice-text-input:focus {
          border-color: #3b82f6;
          background: rgba(255, 255, 255, 0.15);
          box-shadow: 0 0 20px rgba(59, 130, 246, 0.2);
        }

        .voice-text-input::placeholder {
          color: rgba(255, 255, 255, 0.4);
        }

        .fallback-hint {
          text-align: center;
          color: rgba(255, 255, 255, 0.5);
          font-size: 12px;
          margin: 0;
        }

        .speech-mode-section {
          margin-bottom: 16px;
        }

        .speech-mode-label {
          display: block;
          color: rgba(255, 255, 255, 0.7);
          font-size: 12px;
          margin-bottom: 8px;
        }

        .speech-mode-options {
          display: flex;
          gap: 8px;
        }

        .speech-mode-btn {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding: 12px 8px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .speech-mode-btn:hover {
          background: rgba(255, 255, 255, 0.1);
        }

        .speech-mode-btn.active {
          background: rgba(59, 130, 246, 0.2);
          border-color: rgba(59, 130, 246, 0.5);
        }

        .speech-mode-btn .mode-icon {
          font-size: 20px;
        }

        .speech-mode-btn .mode-name {
          color: white;
          font-size: 13px;
          font-weight: 600;
        }

        .speech-mode-btn .mode-desc {
          color: rgba(255, 255, 255, 0.5);
          font-size: 10px;
        }

        .speech-mode-btn .mode-warning {
          color: #fbbf24;
          font-size: 10px;
          font-weight: 600;
        }

        .auto-fallback-notice {
          margin-top: 8px;
          padding: 8px 12px;
          background: rgba(59, 130, 246, 0.15);
          border: 1px solid rgba(59, 130, 246, 0.3);
          border-radius: 8px;
          color: rgba(255, 255, 255, 0.9);
          font-size: 11px;
          text-align: center;
        }

        .whisper-status-section {
          margin-bottom: 12px;
        }

        .whisper-progress-bar {
          height: 6px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 3px;
          overflow: hidden;
          margin: 8px 0;
        }

        .whisper-progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #3b82f6, #8b5cf6);
          border-radius: 3px;
          transition: width 0.3s ease;
        }

        .whisper-info {
          color: rgba(255, 255, 255, 0.5);
          font-size: 11px;
          margin: 8px 0 0;
          line-height: 1.4;
        }

        .browser-speech-warning {
          color: #fbbf24;
          font-size: 11px;
          margin: 8px 0;
          padding: 8px;
          background: rgba(251, 191, 36, 0.1);
          border-radius: 6px;
        }

        .whisper-loading-bar {
          width: 120px;
          height: 4px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 2px;
          overflow: hidden;
          margin-top: 8px;
        }

        .whisper-loading-fill {
          height: 100%;
          background: linear-gradient(90deg, #3b82f6, #8b5cf6);
          border-radius: 2px;
          transition: width 0.3s ease;
        }

        .greeting-style-section {
          margin-bottom: 16px;
        }

        .greeting-style-section p {
          margin: 0 0 10px;
          color: rgba(255, 255, 255, 0.8);
          font-size: 13px;
        }

        .greeting-options {
          display: flex;
          gap: 10px;
        }

        .greeting-option {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding: 12px 8px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .greeting-option:hover {
          background: rgba(255, 255, 255, 0.1);
        }

        .greeting-option.selected {
          background: rgba(59, 130, 246, 0.2);
          border-color: rgba(59, 130, 246, 0.5);
        }

        .greeting-option .option-icon {
          font-size: 20px;
        }

        .greeting-option .option-label {
          color: white;
          font-size: 13px;
          font-weight: 600;
        }

        .greeting-option .option-desc {
          color: rgba(255, 255, 255, 0.5);
          font-size: 10px;
          text-align: center;
        }

        /* Live Audio Indicator */
        .live-audio-indicator {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          margin-bottom: 16px;
        }

        .audio-bars {
          display: flex;
          gap: 3px;
          align-items: flex-end;
          height: 40px;
        }

        .audio-bar {
          width: 6px;
          background: linear-gradient(to top, #3b82f6, #8b5cf6);
          border-radius: 3px;
          transition: height 0.1s ease;
          min-height: 4px;
        }

        .audio-status {
          font-size: 12px;
          color: rgba(255, 255, 255, 0.7);
          font-weight: 500;
        }

        .voice-chat-content {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 24px;
          width: 100%;
          max-width: 600px;
          padding: 20px;
        }

        .voice-history {
          display: flex;
          flex-direction: column;
          gap: 8px;
          width: 100%;
          max-height: 180px;
          overflow-y: auto;
          padding: 0 20px;
        }

        .voice-history-item {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 12px 16px;
          border-radius: 12px;
          font-size: 14px;
          animation: slideIn 0.3s ease;
        }

        @keyframes slideIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .voice-history-item.user {
          background: linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(139, 92, 246, 0.2) 100%);
          align-self: flex-end;
          max-width: 85%;
          border: 1px solid rgba(59, 130, 246, 0.3);
        }

        .voice-history-item.assistant {
          background: rgba(255, 255, 255, 0.08);
          align-self: flex-start;
          max-width: 85%;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .voice-history-role {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 1px;
          color: rgba(255, 255, 255, 0.5);
          font-weight: 600;
        }

        .voice-history-text {
          color: rgba(255, 255, 255, 0.95);
          line-height: 1.4;
        }

        .voice-orb-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 24px;
        }

        .voice-orb {
          width: 160px;
          height: 160px;
          border-radius: 50%;
          background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 50%, #3b82f6 100%);
          background-size: 200% 200%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: transform 0.15s ease, box-shadow 0.15s ease;
          position: relative;
          animation: gradientShift 3s ease infinite;
        }

        @keyframes gradientShift {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }

        .voice-orb:active {
          transform: scale(0.95) !important;
        }

        .voice-orb:hover {
          transform: scale(1.02);
        }

        .voice-orb:active {
          transform: scale(0.98);
        }

        .voice-orb.listening {
          box-shadow: 0 0 40px rgba(59, 130, 246, 0.5);
        }

        .voice-orb.processing {
          background: linear-gradient(135deg, #f59e0b 0%, #ef4444 50%, #f59e0b 100%);
          background-size: 200% 200%;
          animation: gradientShift 1s ease infinite;
        }

        .voice-orb.speaking {
          background: linear-gradient(135deg, #10b981 0%, #3b82f6 50%, #10b981 100%);
          background-size: 200% 200%;
          animation: gradientShift 2s ease infinite, speakPulse 0.6s ease-in-out infinite alternate;
        }

        @keyframes speakPulse {
          from { transform: scale(1); box-shadow: 0 0 30px rgba(16, 185, 129, 0.4); }
          to { transform: scale(1.03); box-shadow: 0 0 50px rgba(16, 185, 129, 0.6); }
        }

        .orb-inner {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .orb-mic {
          font-size: 48px;
        }

        .orb-waves {
          display: flex;
          gap: 6px;
          align-items: center;
        }

        .orb-waves span {
          width: 6px;
          background: white;
          border-radius: 3px;
          transition: height 0.1s ease;
          animation: wave 0.5s ease-in-out infinite;
        }

        @keyframes wave {
          0%, 100% { transform: scaleY(1); }
          50% { transform: scaleY(1.3); }
        }

        .orb-spinner {
          width: 50px;
          height: 50px;
          border: 4px solid rgba(255, 255, 255, 0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .orb-speaking {
          display: flex;
          gap: 4px;
          align-items: flex-end;
          height: 50px;
        }

        .orb-speaking span {
          width: 8px;
          background: white;
          border-radius: 4px;
          animation: speak 0.35s ease-in-out infinite;
        }

        .orb-speaking span:nth-child(1) { height: 18px; animation-delay: 0s; }
        .orb-speaking span:nth-child(2) { height: 28px; animation-delay: 0.08s; }
        .orb-speaking span:nth-child(3) { height: 40px; animation-delay: 0.16s; }
        .orb-speaking span:nth-child(4) { height: 28px; animation-delay: 0.24s; }
        .orb-speaking span:nth-child(5) { height: 18px; animation-delay: 0.32s; }

        @keyframes speak {
          0%, 100% { transform: scaleY(1); }
          50% { transform: scaleY(1.6); }
        }

        .voice-state-label {
          font-size: 18px;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.8);
          text-transform: uppercase;
          letter-spacing: 3px;
        }

        .voice-transcript {
          min-height: 120px;
          width: 100%;
          padding: 0 20px;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .transcript-bubble {
          padding: 16px 24px;
          border-radius: 16px;
          max-width: 90%;
          animation: bubbleIn 0.3s ease;
          transition: all 0.3s ease;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.15);
        }

        .transcript-bubble.waiting {
          background: rgba(255, 255, 255, 0.04);
          border-style: dashed;
        }

        .transcript-bubble.active {
          background: rgba(59, 130, 246, 0.15);
          border-color: rgba(59, 130, 246, 0.4);
          box-shadow: 0 0 20px rgba(59, 130, 246, 0.2);
        }

        .transcript-bubble.complete {
          background: rgba(255, 255, 255, 0.1);
        }

        .transcript-bubble.faded {
          opacity: 0.6;
          transform: scale(0.95);
        }

        .transcript-placeholder {
          color: rgba(255, 255, 255, 0.5);
          font-style: italic;
          margin: 0;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .placeholder-dots {
          display: inline-flex;
          gap: 4px;
        }

        .placeholder-dots span {
          animation: dotPulse 1.4s infinite;
          opacity: 0.3;
        }

        .placeholder-dots span:nth-child(2) { animation-delay: 0.2s; }
        .placeholder-dots span:nth-child(3) { animation-delay: 0.4s; }

        @keyframes dotPulse {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }

        .transcript-text.live {
          font-size: 18px;
          font-weight: 500;
          color: white;
        }

        .transcript-text.small {
          font-size: 14px;
          opacity: 0.8;
        }

        .typing-cursor.pulse {
          animation: cursorPulse 0.5s infinite;
        }

        @keyframes cursorPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }

        @keyframes bubbleIn {
          from { opacity: 0; transform: scale(0.95) translateY(10px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }

        .transcript-bubble.user {
          background: linear-gradient(135deg, rgba(59, 130, 246, 0.25) 0%, rgba(139, 92, 246, 0.25) 100%);
          border: 1px solid rgba(59, 130, 246, 0.4);
        }

        .transcript-bubble.assistant {
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(59, 130, 246, 0.2) 100%);
          border: 1px solid rgba(16, 185, 129, 0.4);
        }

        .bubble-label {
          display: block;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 1.5px;
          color: rgba(255, 255, 255, 0.5);
          margin-bottom: 8px;
          font-weight: 600;
        }

        .transcript-text {
          font-size: 20px;
          color: white;
          margin: 0;
          line-height: 1.5;
          text-align: center;
        }

        .transcript-text.processing {
          color: rgba(255, 255, 255, 0.6);
          font-style: italic;
        }

        .response-text {
          font-size: 20px;
          color: #34d399;
          margin: 0;
          line-height: 1.5;
          text-align: center;
        }

        .typing-cursor {
          display: inline-block;
          color: rgba(255, 255, 255, 0.7);
          animation: blink 0.8s infinite;
          margin-left: 2px;
          font-weight: 300;
        }

        .typing-cursor.speaking {
          color: #34d399;
        }

        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }

        .error-text {
          font-size: 16px;
          color: #f87171;
          margin: 8px 0 0;
          text-align: center;
        }

        .transcript-hint {
          font-size: 18px;
          color: rgba(255, 255, 255, 0.4);
          margin: 0;
          text-align: center;
        }

        .voice-hints {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          padding: 16px 24px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .hint-title {
          font-size: 12px;
          color: rgba(255, 255, 255, 0.5);
          text-transform: uppercase;
          letter-spacing: 1px;
        }

        .hint-examples {
          display: flex;
          flex-direction: column;
          gap: 6px;
          text-align: center;
        }

        .hint-examples span {
          font-size: 13px;
          color: rgba(255, 255, 255, 0.6);
          font-style: italic;
        }

        .voice-tap-hint {
          font-size: 13px;
          color: rgba(255, 255, 255, 0.4);
          margin-top: 8px;
        }
      `}</style>
    </div>
  );
}
