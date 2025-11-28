declare module 'is-hotkey' {
  import { KeyboardEvent as ReactKeyboardEvent } from 'react';

  type HotkeyEvent = KeyboardEvent | ReactKeyboardEvent<Element>;
  type HotkeyPredicate = (event: HotkeyEvent) => boolean;

  function isHotkey(hotkey: string, event: HotkeyEvent): boolean;
  function isHotkey(hotkey: string): HotkeyPredicate;

  export default isHotkey;
}












