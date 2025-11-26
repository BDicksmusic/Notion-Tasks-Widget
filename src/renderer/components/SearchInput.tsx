import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  debounceMs?: number;
  className?: string;
  onClear?: () => void;
  compact?: boolean;
}

const SearchInput = ({
  value,
  onChange,
  placeholder = 'Search…',
  autoFocus = false,
  debounceMs = 150,
  className = '',
  onClear,
  compact = false
}: Props) => {
  const [localValue, setLocalValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync external value changes
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = useCallback(
    (nextValue: string) => {
      setLocalValue(nextValue);
      
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
      
      debounceTimer.current = setTimeout(() => {
        onChange(nextValue);
      }, debounceMs);
    },
    [onChange, debounceMs]
  );

  const handleClear = useCallback(() => {
    setLocalValue('');
    onChange('');
    onClear?.();
    inputRef.current?.focus();
  }, [onChange, onClear]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleClear();
      }
    },
    [handleClear]
  );

  // Keyboard shortcut: Ctrl/Cmd + F to focus search
  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (
        (event.key === 'f' || event.key === 'F') &&
        (event.metaKey || event.ctrlKey)
      ) {
        // Only handle if no other input is focused
        const activeElement = document.activeElement;
        const isInputActive =
          activeElement instanceof HTMLInputElement ||
          activeElement instanceof HTMLTextAreaElement ||
          (activeElement instanceof HTMLElement && activeElement.isContentEditable);
        
        if (!isInputActive) {
          event.preventDefault();
          inputRef.current?.focus();
          inputRef.current?.select();
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, []);

  // Cleanup debounce timer
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  const hasValue = localValue.length > 0;
  const wrapperClasses = [
    'search-input-wrapper',
    compact ? 'search-input-compact' : '',
    hasValue ? 'has-value' : '',
    className
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={wrapperClasses}>
      <span className="search-input-icon" aria-hidden="true">
        🔍
      </span>
      <input
        ref={inputRef}
        type="text"
        className="search-input"
        value={localValue}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label={placeholder}
      />
      {hasValue && (
        <button
          type="button"
          className="search-input-clear"
          onClick={handleClear}
          aria-label="Clear search"
          title="Clear (Esc)"
        >
          ×
        </button>
      )}
      <span className="search-input-shortcut" title="Focus search">
        Ctrl+F
      </span>
    </div>
  );
};

export default SearchInput;




