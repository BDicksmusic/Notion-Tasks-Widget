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
import VoiceChatOverlay from './VoiceChatOverlay';
import { playUISound } from '../utils/sounds';

const widgetAPI = platformBridge.widgetAPI;

interface ChatbotPanelProps {
  tasks: Task[];
  projects: Project[];
  onTasksUpdated?: () => void;
  onClose?: () => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

type PanelState = 'idle' | 'listening' | 'processing' | 'confirming' | 'executing';

export default function ChatbotPanel({
  tasks,
  projects,
  onTasksUpdated,
  onClose,
  isExpanded = false,
  onToggleExpand
}: ChatbotPanelProps) {
  const [panelState, setPanelState] = useState<PanelState>('idle');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [settings, setSettings] = useState<ChatbotSettings | null>(null);
  const [pendingResponse, setPendingResponse] = useState<ChatbotResponse | null>(null);
  const [executionResults, setExecutionResults] = useState<TaskActionResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [voiceChatOpen, setVoiceChatOpen] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Browser Web Speech API hook (free, requires internet)
  const {
    isListening: browserIsListening,
    isSupported: browserSpeechSupported,
    transcript: browserTranscript,
    interimTranscript: browserInterimTranscript,
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
  const interimTranscript = speechMode === 'browser' ? browserInterimTranscript : '';

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

  // Handle voice chat send - processes message and returns response text
  const handleVoiceChatSend = useCallback(async (text: string): Promise<string> => {
    if (!settings?.openaiApiKey && !settings?.anthropicApiKey) {
      throw new Error('Please configure an API key first');
    }

    addMessage('user', text);

    try {
      const response = await widgetAPI.sendChatbotMessage({
        message: text,
        tasks,
        projects
      });

      if (!response.success) {
        throw new Error(response.error || 'Failed to process message');
      }

      addMessage('assistant', response.message);

      // If there are actions, auto-execute them in voice mode
      if (response.actions && response.actions.length > 0) {
        const results = await widgetAPI.executeChatbotActions({
          actions: response.actions
        });
        onTasksUpdated?.();
        
        const successCount = results.results.filter(r => r.success).length;
        return `${response.message}. Done! Completed ${successCount} action${successCount !== 1 ? 's' : ''}.`;
      }

      return response.message;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to process';
      throw new Error(errorMessage);
    }
  }, [settings, tasks, projects, addMessage, onTasksUpdated]);

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
              <option value="browser">🌐 Browser Speech (Free) - Real-time words</option>
              <option value="transformers">🔒 Local Whisper (Free) - Offline after download</option>
              <option value="whisper">☁️ OpenAI Whisper (Paid) - Most accurate</option>
            </select>
            <div className="settings-hint-box">
              {settings?.speechInputMode === 'transformers' && (
                <>
                  <p className="settings-hint">
                    🔒 <strong>Private & Offline</strong> - Runs AI locally on your device.
                  </p>
                  <p className="settings-hint settings-hint-detail">
                    • First use downloads ~75MB model (requires internet once)
                    <br />• After download, works completely offline
                    <br />• Audio never leaves your device
                    <br />• Transcribes after you stop speaking
                  </p>
                  {localWhisperLoading && (
                    <div className="model-download-status">
                      📥 Downloading model... {localWhisperProgress}%
                      <div className="model-progress-bar">
                        <div 
                          className="model-progress-fill" 
                          style={{ width: `${localWhisperProgress}%` }} 
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
              {settings?.speechInputMode === 'browser' && (
                <>
                  <p className="settings-hint">
                    🌐 <strong>Real-time transcription</strong> - Words appear as you speak.
                  </p>
                  <p className="settings-hint settings-hint-detail">
                    • Requires internet connection (uses Google's servers)
                    <br />• Works in Chrome, Edge, and Safari
                    <br />• Free with no usage limits
                    <br />• Audio is processed by Google
                  </p>
                </>
              )}
              {settings?.speechInputMode === 'whisper' && (
                <>
                  <p className="settings-hint">
                    ☁️ <strong>Highest accuracy</strong> - OpenAI's Whisper API.
                  </p>
                  <p className="settings-hint settings-hint-detail">
                    • Requires OpenAI API key
                    <br />• Pay-per-use ($0.006/minute)
                    <br />• Best accuracy for complex speech
                    <br />• Transcribes after you stop speaking
                  </p>
                  {!settings?.openaiApiKey && (
                    <p className="settings-hint settings-hint-warning">
                      ⚠️ Add your OpenAI API key above to use this mode.
                    </p>
                  )}
                </>
              )}
              {!settings?.speechInputMode && (
                <p className="settings-hint">
                  Choose how you want speech-to-text to work. Browser Speech is recommended for real-time feedback.
                </p>
              )}
            </div>
          </div>

          <div className="settings-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                playUISound('menu-close');
                setSettingsOpen(false);
              }}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={`chatbot-panel ${isExpanded ? 'is-expanded' : ''}`}>
      <div className="chatbot-header">
        <h3>🤖 Task Assistant</h3>
        <div className="chatbot-header-actions">
          <button
            type="button"
            className="voice-chat-btn"
            onClick={() => {
              playUISound('panel-open');
              setVoiceChatOpen(true);
            }}
            title="Voice Chat Mode"
          >
            🎙️
          </button>
          <button
            type="button"
            className="settings-btn"
            onClick={() => {
              playUISound('menu-open');
              setSettingsOpen(true);
            }}
            title="Settings"
          >
            ⚙️
          </button>
          {onToggleExpand && (
            <button
              type="button"
              className="expand-btn"
              onClick={() => {
                playUISound('click');
                onToggleExpand();
              }}
              title={isExpanded ? 'Collapse to sidebar' : 'Expand to full panel'}
            >
              {isExpanded ? '⊟' : '⊞'}
            </button>
          )}
          {onClose && (
            <button
              type="button"
              className="close-btn"
              onClick={() => {
                playUISound('panel-close');
                onClose();
              }}
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
            {(() => {
              const today = new Date().toISOString().split('T')[0];
              const activeTasks = tasks.filter(t => 
                t.status?.toLowerCase() !== 'done' && 
                t.status?.toLowerCase() !== 'completed'
              );
              const overdueTasks = activeTasks.filter(t => t.dueDate && t.dueDate < today);
              const todayTasks = activeTasks.filter(t => t.dueDate === today);
              const urgentTasks = activeTasks.filter(t => t.urgent);

              if (activeTasks.length === 0) {
                return (
                  <>
                    <p>👋 Hi! You're all caught up - no active tasks!</p>
                    <p className="hint">Would you like to:</p>
                    <ul>
                      <li>"Add a task for tomorrow"</li>
                      <li>"What did I complete this week?"</li>
                    </ul>
                  </>
                );
              }

              return (
                <>
                  <p>👋 Hi! You have <strong>{activeTasks.length}</strong> active task{activeTasks.length !== 1 ? 's' : ''}.</p>
                  {overdueTasks.length > 0 && (
                    <p className="alert">⚠️ <strong>{overdueTasks.length}</strong> overdue: "{overdueTasks[0].title}"</p>
                  )}
                  {todayTasks.length > 0 && (
                    <p className="today">📅 Due today: "{todayTasks[0].title}"{todayTasks.length > 1 ? ` +${todayTasks.length - 1} more` : ''}</p>
                  )}
                  {urgentTasks.length > 0 && !overdueTasks.length && !todayTasks.length && (
                    <p className="urgent">🔥 Urgent: "{urgentTasks[0].title}"</p>
                  )}
                  <p className="hint">Try saying:</p>
                  <ul>
                    {overdueTasks.length > 0 && <li>"I finished {overdueTasks[0].title}"</li>}
                    {todayTasks.length > 0 && <li>"Start working on {todayTasks[0].title}"</li>}
                    <li>"What's my most important task?"</li>
                    <li>"Add a task for tomorrow"</li>
                  </ul>
                </>
              );
            })()}
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
            value={isListening ? (transcript + interimTranscript) : inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isTranscribing ? 'Transcribing...' :
              isListening ? 'Listening... speak now' : 
              'Type or speak your message...'
            }
            disabled={panelState === 'processing' || panelState === 'executing' || isTranscribing}
            rows={1}
          />
          {isListening && interimTranscript && (
            <div className="interim-indicator">
              <span className="interim-dot"></span>
              <span className="interim-label">Live</span>
            </div>
          )}
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

      {/* Voice Chat Overlay */}
      <VoiceChatOverlay
        isOpen={voiceChatOpen}
        onClose={() => setVoiceChatOpen(false)}
        onTranscript={(text) => setInputText(text)}
        onSend={handleVoiceChatSend}
        tasks={tasks}
        projects={projects}
      />
    </div>
  );
}

