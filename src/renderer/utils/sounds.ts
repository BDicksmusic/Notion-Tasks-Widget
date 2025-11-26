/**
 * Sound utilities for widget actions
 */

let widgetAudioCtx: AudioContext | null = null;

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

export { playWidgetSound };







