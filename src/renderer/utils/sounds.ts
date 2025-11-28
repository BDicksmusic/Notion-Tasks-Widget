/**
 * Sound utilities for widget actions
 */

let widgetAudioCtx: AudioContext | null = null;

// Check if UI sounds are enabled (reads from localStorage)
const areUISoundsEnabled = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    const prefs = localStorage.getItem('appPreferences');
    if (prefs) {
      const parsed = JSON.parse(prefs);
      return parsed.enableUISounds !== false; // Default to true
    }
    return true; // Default enabled
  } catch {
    return true;
  }
};

type WidgetSoundVariant = 'collapse' | 'expand' | 'capture';

const playWidgetSound = (variant: WidgetSoundVariant) => {
  if (typeof window === 'undefined') return;
  const AudioCtor =
    window.AudioContext ||
    (window as typeof window & {
      webkitAudioContext?: typeof AudioContext;
    }).webkitAudioContext;
  if (!AudioCtor) return;
  if (!widgetAudioCtx) {
    widgetAudioCtx = new AudioCtor();
  }
  const ctx = widgetAudioCtx;
  if (ctx.state === 'suspended') {
    void ctx.resume();
  }
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();
  oscillator.type = 'sine';
  
  // Different frequencies for different actions
  switch (variant) {
    case 'collapse':
      oscillator.frequency.value = 400;
      break;
    case 'expand':
      oscillator.frequency.value = 600;
      break;
    case 'capture':
      oscillator.frequency.value = 500;
      break;
  }
  
  const now = ctx.currentTime;
  gainNode.gain.setValueAtTime(0.12, now);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
  oscillator.connect(gainNode).connect(ctx.destination);
  oscillator.start();
  oscillator.stop(now + 0.2);
};

// UI Interaction sound types
type UISoundVariant = 
  | 'click'        // Generic button click
  | 'hover'        // Hover over interactive element
  | 'toggle-on'    // Toggle/checkbox enabled
  | 'toggle-off'   // Toggle/checkbox disabled
  | 'menu-open'    // Opening a menu/dropdown
  | 'menu-close'   // Closing a menu/dropdown
  | 'select'       // Selecting an item from a list
  | 'success'      // Action completed successfully
  | 'error'        // Error or invalid action
  | 'tab-switch'   // Switching tabs
  | 'panel-open'   // Opening a panel/modal
  | 'panel-close'; // Closing a panel/modal

/**
 * Play UI interaction sounds
 * These are subtle, non-intrusive sounds for menu navigation and interactions
 */
const playUISound = (variant: UISoundVariant) => {
  if (typeof window === 'undefined') return;
  if (!areUISoundsEnabled()) return;
  
  const AudioCtor =
    window.AudioContext ||
    (window as typeof window & {
      webkitAudioContext?: typeof AudioContext;
    }).webkitAudioContext;
  if (!AudioCtor) return;
  
  if (!widgetAudioCtx) {
    widgetAudioCtx = new AudioCtor();
  }
  const ctx = widgetAudioCtx;
  if (ctx.state === 'suspended') {
    void ctx.resume();
  }
  
  const now = ctx.currentTime;
  
  // Sound configurations for different interactions
  const soundConfigs: Record<UISoundVariant, {
    type: OscillatorType;
    frequency: number;
    frequency2?: number;
    duration: number;
    volume: number;
    ramp?: 'up' | 'down';
  }> = {
    'click': {
      type: 'sine',
      frequency: 800,
      duration: 0.05,
      volume: 0.08,
    },
    'hover': {
      type: 'sine',
      frequency: 1200,
      duration: 0.03,
      volume: 0.03,
    },
    'toggle-on': {
      type: 'sine',
      frequency: 600,
      frequency2: 900,
      duration: 0.1,
      volume: 0.08,
      ramp: 'up',
    },
    'toggle-off': {
      type: 'sine',
      frequency: 700,
      frequency2: 500,
      duration: 0.1,
      volume: 0.08,
      ramp: 'down',
    },
    'menu-open': {
      type: 'sine',
      frequency: 500,
      frequency2: 700,
      duration: 0.08,
      volume: 0.06,
      ramp: 'up',
    },
    'menu-close': {
      type: 'sine',
      frequency: 600,
      frequency2: 400,
      duration: 0.08,
      volume: 0.06,
      ramp: 'down',
    },
    'select': {
      type: 'sine',
      frequency: 880,
      duration: 0.06,
      volume: 0.07,
    },
    'success': {
      type: 'sine',
      frequency: 660,
      frequency2: 880,
      duration: 0.15,
      volume: 0.1,
      ramp: 'up',
    },
    'error': {
      type: 'square',
      frequency: 200,
      duration: 0.15,
      volume: 0.08,
    },
    'tab-switch': {
      type: 'sine',
      frequency: 700,
      duration: 0.05,
      volume: 0.06,
    },
    'panel-open': {
      type: 'sine',
      frequency: 400,
      frequency2: 600,
      duration: 0.12,
      volume: 0.07,
      ramp: 'up',
    },
    'panel-close': {
      type: 'sine',
      frequency: 500,
      frequency2: 350,
      duration: 0.1,
      volume: 0.06,
      ramp: 'down',
    },
  };
  
  const config = soundConfigs[variant];
  
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();
  
  oscillator.type = config.type;
  oscillator.frequency.setValueAtTime(config.frequency, now);
  
  // Add frequency ramp for two-tone sounds
  if (config.frequency2) {
    oscillator.frequency.linearRampToValueAtTime(config.frequency2, now + config.duration);
  }
  
  // Volume envelope
  gainNode.gain.setValueAtTime(config.volume, now);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + config.duration);
  
  oscillator.connect(gainNode).connect(ctx.destination);
  oscillator.start(now);
  oscillator.stop(now + config.duration);
};

export { playWidgetSound, playUISound, areUISoundsEnabled };
export type { UISoundVariant };







