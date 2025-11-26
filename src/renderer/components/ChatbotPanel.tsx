import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChatbotSettings,
  ChatMessage,
  ChatbotResponse,
  TaskActionResult,
  Task,
  Project,
  SpeechInputMode
} from '@shared/types';
import { platformBridge } from '@shared/platform';
import { useSpeechCapture } from '../hooks/useSpeechCapture';
import { useLocalWhisper } from '../hooks/useLocalWhisper';

const widgetAPI = platformBridge.widgetAPI;

interface ChatbotPanelProps {
  tasks: Task[];
  projects: Project[];
  onTasksUpdated?: () => void;
  onClose?: () => void;
}

type PanelState = 'idle' | 'listening' | 'processing' | 'confirming' | 'executing';

export default function ChatbotPanel({
  tasks,
  projects,
  onTasksUpdated,
  onClose
}: ChatbotPanelProps) {
  const [panelState, setPanelState] = useState<PanelState>('idle');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [settings, setSettings] = useState<ChatbotSettings | null>(null);
  const [pendingResponse, setPendingResponse] = useState<ChatbotResponse | null>(null);
  const [executionResults, setExecutionResults] = useState<TaskActionResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Browser Web Speech API hook (free, requires internet)
  const {
    isListening: browserIsListening,
    isSupported: browserSpeechSupported,
    transcript: browserTranscript,
    startListening: browserStartListening,
    stopListening: browserStopListening,
    resetTranscript: browserResetTranscript
  } = useSpeechCapture();

  // Local Whisper hook (free, offline, powered by Transformers.js)
  const {
    isSupported: localWhisperSupported,
    isLoading: localWhisperLoading,
    isRecording: localWhisperRecording,
    isTranscribing: localWhisperTranscribing,
    transcript: localWhisperTranscript,
    error: localWhisperError,
    modelProgress: localWhisperProgress,
    startRecording: localWhisperStartRecording,
    stopRecording: localWhisperStopRecording,
    resetTranscript: localWhisperResetTranscript
  } = useLocalWhisper({ modelSize: 'tiny' });

  // Unified speech state based on active mode
  const speechMode: SpeechInputMode = settings?.speechInputMode || 'browser';
  const isListening = speechMode === 'transformers' ? localWhisperRecording : browserIsListening;
  const isTranscribing = speechMode === 'transformers' ? localWhisperTranscribing : false;
  const transcript = speechMode === 'transformers' ? localWhisperTranscript : browserTranscript;

  // Load settings on mount
  useEffect(() => {
    async function loadSettings() {
      try {
        const chatbotSettings = await widgetAPI.getChatbotSettings();
        setSettings(chatbotSettings);
        
        // If no API keys configured, show settings
        if (!chatbotSettings.openaiApiKey && !chatbotSettings.anthropicApiKey) {
          setSettingsOpen(true);
        }
      } catch (err) {
        console.error('Failed to load chatbot settings:', err);
        setError('Failed to load chatbot settings');
      }
    }
    loadSettings();
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle transcript updates from browser speech recognition
  useEffect(() => {
    if (browserTranscript && !browserIsListening) {
      setInputText(browserTranscript);
      browserResetTranscript();
    }
  }, [browserTranscript, browserIsListening, browserResetTranscript]);

  // Handle transcript updates from local Whisper
  useEffect(() => {
    if (localWhisperTranscript && !localWhisperRecording && !localWhisperTranscribing) {
      setInputText(localWhisperTranscript);
      localWhisperResetTranscript();
    }
  }, [localWhisperTranscript, localWhisperRecording, localWhisperTranscribing, localWhisperResetTranscript]);

  // Handle local Whisper errors
  useEffect(() => {
    if (localWhisperError) {
      setError(localWhisperError);
    }
  }, [localWhisperError]);

  // Update panel state based on listening/transcribing
  useEffect(() => {
    if (isListening || isTranscribing) {
      setPanelState('listening');
    } else if (panelState === 'listening') {
      setPanelState('idle');
    }
  }, [isListening, isTranscribing, panelState]);

  const addMessage = useCallback((role: 'user' | 'assistant' | 'system', content: string) => {
    const message: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      role,
      content,
      createdAt: new Date().toISOString()
    };
    setMessages(prev => [...prev, message]);
    return message;
  }, []);

  const handleMicrophoneClick = useCallback(async () => {
    setError(null);

    // Handle stopping based on current mode
    if (isListening || isTranscribing) {
      if (speechMode === 'transformers') {
        // For local Whisper, stop recording and transcribe
        try {
          await localWhisperStopRecording();
        } catch (err) {
          console.error('Stop recording error:', err);
        }
      } else {
        browserStopListening();
      }
      return;
    }

    // Handle starting based on settings
    switch (speechMode) {
      case 'transformers':
        // Local Whisper (Transformers.js) - offline, free
        if (!localWhisperSupported) {
          setError('Audio recording not supported in this browser');
          return;
        }
        try {
          await localWhisperStartRecording();
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to start recording');
        }
        break;

      case 'whisper':
        // OpenAI Whisper API - requires API key
        if (!settings?.openaiApiKey) {
          setError('OpenAI API key required for Whisper. Configure in settings or switch to Local Whisper.');
          setSettingsOpen(true);
          return;
        }
        // Fall back to browser speech for now (Whisper API transcription would need audio upload)
        if (browserSpeechSupported) {
          browserStartListening();
        } else {
          setError('Speech recognition not supported in this browser');
        }
        break;

      case 'browser':
      default:
        // Browser Web Speech API - free, requires internet
        if (browserSpeechSupported) {
          browserStartListening();
        } else {
          setError('Browser speech recognition not supported. Try "Local Whisper" mode.');
        }
        break;
    }
  }, [
    isListening, 
    isTranscribing, 
    speechMode, 
    settings, 
    browserSpeechSupported,
    localWhisperSupported,
    browserStartListening, 
    browserStopListening,
    localWhisperStartRecording,
    localWhisperStopRecording
  ]);

  const handleSendMessage = useCallback(async () => {
    const text = inputText.trim();
    if (!text) return;

    if (!settings?.openaiApiKey && !settings?.anthropicApiKey) {
      setError('Please configure an API key in settings first');
      setSettingsOpen(true);
      return;
    }

    setError(null);
    setInputText('');
    addMessage('user', text);
    setPanelState('processing');

    try {
      const response = await widgetAPI.sendChatbotMessage({
        message: text,
        tasks,
        projects
      });

      if (!response.success) {
        throw new Error(response.error || 'Failed to process message');
      }

      // Add assistant response
      addMessage('assistant', response.message);

      // If there are actions, show confirmation
      if (response.actions && response.actions.length > 0) {
        setPendingResponse(response);
        setPanelState('confirming');
      } else {
        setPanelState('idle');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
      setError(errorMessage);
      addMessage('system', `Error: ${errorMessage}`);
      setPanelState('idle');
    }
  }, [inputText, settings, tasks, projects, addMessage]);

  const handleConfirmActions = useCallback(async () => {
    if (!pendingResponse?.actions) return;

    setPanelState('executing');
    setError(null);

    try {
      const results = await widgetAPI.executeChatbotActions({
        actions: pendingResponse.actions
      });

      setExecutionResults(results.results);
      
      // Generate summary message
      const successCount = results.results.filter(r => r.success).length;
      const failCount = results.results.filter(r => !r.success).length;
      
      let summaryText = `Completed ${successCount} action${successCount !== 1 ? 's' : ''}`;
      if (failCount > 0) {
        summaryText += ` (${failCount} failed)`;
      }
      
      addMessage('system', summaryText);

      // Notify parent to refresh tasks
      onTasksUpdated?.();

      // Save summary if configured
      if (results.summary) {
        // Summary is automatically saved by the backend
        addMessage('assistant', `Summary saved: ${results.summary.title}`);
      }

      setPendingResponse(null);
      setPanelState('idle');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to execute actions';
      setError(errorMessage);
      addMessage('system', `Execution error: ${errorMessage}`);
      setPanelState('idle');
    }
  }, [pendingResponse, addMessage, onTasksUpdated]);

  const handleCancelActions = useCallback(() => {
    setPendingResponse(null);
    setPanelState('idle');
    addMessage('system', 'Actions cancelled');
  }, [addMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  }, [handleSendMessage]);

  const handleSettingsSave = useCallback(async (newSettings: Partial<ChatbotSettings>) => {
    if (!settings) return;
    
    try {
      const updated = await widgetAPI.updateChatbotSettings({
        ...settings,
        ...newSettings
      });
      setSettings(updated);
      setSettingsOpen(false);
      setError(null);
    } catch (err) {
      setError('Failed to save settings');
    }
  }, [settings]);

  const renderActionPreview = (response: ChatbotResponse) => {
    if (!response.actions || response.actions.length === 0) return null;

    return (
      <div className="chatbot-action-preview">
        <h4>Proposed Actions:</h4>
        <ul className="action-list">
          {response.actions.map((action, index) => (
            <li key={index} className={`action-item action-${action.type}`}>
              <span className="action-icon">
                {action.type === 'create_task' && '➕'}
                {action.type === 'update_status' && '🔄'}
                {action.type === 'update_dates' && '📅'}
                {action.type === 'add_notes' && '📝'}
                {action.type === 'assign_projects' && '📁'}
                {action.type === 'log_time' && '⏱️'}
              </span>
              <span className="action-description">
                {action.type === 'create_task' && `Create task: "${action.task.title}"`}
                {action.type === 'update_status' && `Update status to "${action.status}"`}
                {action.type === 'update_dates' && `Set date to ${action.dueDate || 'none'}`}
                {action.type === 'add_notes' && `Add notes`}
                {action.type === 'assign_projects' && `Assign to projects`}
                {action.type === 'log_time' && `Log ${action.minutes} minutes`}
              </span>
            </li>
          ))}
        </ul>
        <div className="action-buttons">
          <button
            type="button"
            className="btn-confirm"
            onClick={handleConfirmActions}
            disabled={panelState === 'executing'}
          >
            {panelState === 'executing' ? 'Executing...' : 'Confirm'}
          </button>
          <button
            type="button"
            className="btn-cancel"
            onClick={handleCancelActions}
            disabled={panelState === 'executing'}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  };

  const renderSettings = () => {
    if (!settingsOpen) return null;

    return (
      <div className="chatbot-settings-overlay">
        <div className="chatbot-settings-panel">
          <h3>Chatbot Settings</h3>
          <p className="settings-description">
            Configure your AI provider API keys. Your keys are stored locally and never shared.
          </p>
          
          <div className="settings-field">
            <label>AI Provider</label>
            <select
              value={settings?.preferredProvider || 'openai'}
              onChange={(e) => handleSettingsSave({ preferredProvider: e.target.value as 'openai' | 'anthropic' })}
            >
              <option value="openai">OpenAI (GPT-4)</option>
              <option value="anthropic">Anthropic (Claude)</option>
            </select>
          </div>

          <div className="settings-field">
            <label>OpenAI API Key</label>
            <input
              type="password"
              value={settings?.openaiApiKey || ''}
              onChange={(e) => handleSettingsSave({ openaiApiKey: e.target.value })}
              placeholder="sk-..."
            />
          </div>

          <div className="settings-field">
            <label>Anthropic API Key</label>
            <input
              type="password"
              value={settings?.anthropicApiKey || ''}
              onChange={(e) => handleSettingsSave({ anthropicApiKey: e.target.value })}
              placeholder="sk-ant-..."
            />
          </div>

          <div className="settings-field">
            <label>Speech Input Mode</label>
            <select
              value={settings?.speechInputMode || 'browser'}
              onChange={(e) => handleSettingsSave({ speechInputMode: e.target.value as SpeechInputMode })}
            >
              <option value="transformers">🔒 Local Whisper (Offline, Free, Private)</option>
              <option value="browser">🌐 Browser Speech (Free, Requires Internet)</option>
              <option value="whisper">☁️ OpenAI Whisper (Paid, Most Accurate)</option>
            </select>
            <p className="settings-hint">
              {settings?.speechInputMode === 'transformers' && 
                'Runs Whisper AI locally. First use downloads ~75MB model.'}
              {settings?.speechInputMode === 'browser' && 
                'Uses browser built-in speech recognition. Works in Chrome.'}
              {settings?.speechInputMode === 'whisper' && 
                'Uses OpenAI API for transcription. Requires API key.'}
              {!settings?.speechInputMode && 
                'Local Whisper recommended for privacy and offline use.'}
            </p>
          </div>

          <div className="settings-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={() => setSettingsOpen(false)}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="chatbot-panel">
      <div className="chatbot-header">
        <h3>🤖 Task Assistant</h3>
        <div className="chatbot-header-actions">
          <button
            type="button"
            className="settings-btn"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
          >
            ⚙️
          </button>
          {onClose && (
            <button
              type="button"
              className="close-btn"
              onClick={onClose}
              title="Close"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="chatbot-messages">
        {messages.length === 0 && (
          <div className="chatbot-welcome">
            <p>👋 Hi! I can help you manage your tasks.</p>
            <p className="hint">Try saying things like:</p>
            <ul>
              <li>"I finished the report today"</li>
              <li>"Add a task to call John tomorrow"</li>
              <li>"Mark the design review as complete"</li>
              <li>"Log 2 hours on the website project"</li>
            </ul>
          </div>
        )}
        
        {messages.map((msg) => (
          <div key={msg.id} className={`chat-message ${msg.role}`}>
            <div className="message-content">{msg.content}</div>
            <div className="message-time">
              {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        ))}

        {panelState === 'processing' && (
          <div className="chat-message assistant loading">
            <div className="typing-indicator">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        )}

        {panelState === 'confirming' && pendingResponse && renderActionPreview(pendingResponse)}

        {executionResults && executionResults.length > 0 && (
          <div className="execution-results">
            {executionResults.map((result, index) => (
              <div key={index} className={`result-item ${result.success ? 'success' : 'error'}`}>
                {result.success ? '✓' : '✗'} {result.message}
              </div>
            ))}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {error && (
        <div className="chatbot-error">
          <span className="error-icon">⚠️</span>
          <span className="error-text">{error}</span>
          <button type="button" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <div className="chatbot-input-area">
        {/* Local Whisper status indicators */}
        {speechMode === 'transformers' && (localWhisperLoading || isTranscribing) && (
          <div className="whisper-status">
            {localWhisperLoading && (
              <span>
                {localWhisperProgress < 100 
                  ? `📥 Loading Whisper model... ${localWhisperProgress}%`
                  : '⏳ Initializing...'}
              </span>
            )}
            {isTranscribing && <span>🎯 Transcribing audio...</span>}
          </div>
        )}
        <div className="input-wrapper">
          <textarea
            ref={inputRef}
            value={isListening ? transcript : inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isTranscribing ? 'Transcribing...' :
              isListening ? 'Listening... (click mic to stop)' : 
              'Type or speak your message...'
            }
            disabled={panelState === 'processing' || panelState === 'executing' || isTranscribing}
            rows={1}
          />
          <div className="input-actions">
            <button
              type="button"
              className={`mic-btn ${isListening ? 'listening' : ''} ${isTranscribing ? 'transcribing' : ''}`}
              onClick={handleMicrophoneClick}
              disabled={panelState === 'processing' || panelState === 'executing' || isTranscribing || localWhisperLoading}
              title={
                isTranscribing ? 'Transcribing...' :
                isListening ? 'Stop recording' : 
                `Start voice input (${speechMode === 'transformers' ? 'Local Whisper' : speechMode === 'browser' ? 'Browser' : 'Whisper API'})`
              }
            >
              {isTranscribing ? '⏳' : isListening ? '🔴' : '🎤'}
            </button>
            <button
              type="button"
              className="send-btn"
              onClick={handleSendMessage}
              disabled={!inputText.trim() || panelState === 'processing' || panelState === 'executing'}
              title="Send message"
            >
              ➤
            </button>
          </div>
        </div>
      </div>

      {renderSettings()}
    </div>
  );
}

