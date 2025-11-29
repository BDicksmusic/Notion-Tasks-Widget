import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TaskStatusOption } from '@shared/types';

// Get color class from Notion color
const getColorClass = (color?: string): string => {
  if (!color) return 'status-gray';
  const colorMap: Record<string, string> = {
    gray: 'status-gray',
    brown: 'status-brown',
    orange: 'status-orange',
    yellow: 'status-yellow',
    green: 'status-green',
    blue: 'status-blue',
    purple: 'status-purple',
    pink: 'status-pink',
    red: 'status-red',
    default: 'status-gray',
  };
  return colorMap[color.toLowerCase()] ?? 'status-gray';
};

interface StatusSelectProps {
  value: string;
  options: TaskStatusOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  showLabel?: boolean;
  className?: string;
}

export const StatusSelect = ({
  value,
  options,
  onChange,
  disabled = false,
  showLabel = true,
  className = ''
}: StatusSelectProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Find current option
  const currentOption = options.find(opt => opt.name === value);
  const currentColor = currentOption?.color;
  const colorClass = getColorClass(currentColor);

  // Calculate dropdown position
  const updatePosition = () => {
    if (!containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const dropdownHeight = Math.min(options.length * 36 + 16, 300);
    const dropdownWidth = 180;
    
    // Position below by default
    let top = rect.bottom + 4;
    let left = rect.left;
    
    // Flip to above if not enough space below
    if (top + dropdownHeight > viewportHeight - 10) {
      top = rect.top - dropdownHeight - 4;
    }
    
    // Keep within horizontal bounds
    if (left + dropdownWidth > viewportWidth - 10) {
      left = viewportWidth - dropdownWidth - 10;
    }
    left = Math.max(10, left);
    
    setDropdownPosition({ top, left });
  };

  // Open dropdown
  const handleOpen = () => {
    if (disabled) return;
    updatePosition();
    setIsOpen(true);
  };

  // Select option
  const handleSelect = (optionName: string) => {
    onChange(optionName);
    setIsOpen(false);
  };

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current && 
        !containerRef.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  // Update position on scroll/resize
  useEffect(() => {
    if (!isOpen) return;
    
    const handleUpdate = () => updatePosition();
    window.addEventListener('scroll', handleUpdate, true);
    window.addEventListener('resize', handleUpdate);
    return () => {
      window.removeEventListener('scroll', handleUpdate, true);
      window.removeEventListener('resize', handleUpdate);
    };
  }, [isOpen]);

  // Dropdown content rendered via portal
  const dropdownContent = isOpen ? (
    <div
      ref={dropdownRef}
      className="status-select-dropdown"
      role="listbox"
      style={{ top: dropdownPosition.top, left: dropdownPosition.left }}
      onClick={(e) => e.stopPropagation()}
    >
      {options.map((option) => {
        const optionColorClass = getColorClass(option.color);
        const isSelected = option.name === value;
        
        return (
          <button
            key={option.id}
            type="button"
            role="option"
            aria-selected={isSelected}
            className={`status-select-option ${optionColorClass} ${isSelected ? 'is-selected' : ''}`}
            onClick={() => handleSelect(option.name)}
          >
            <span className="status-option-check">{isSelected ? '✓' : ''}</span>
            <span className={`status-option-color-dot ${optionColorClass}`} />
            <span className="status-option-label">{option.name}</span>
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <div 
      ref={containerRef}
      className={`status-select-container ${className}`}
    >
      <button
        type="button"
        className={`status-select-trigger status-pill ${colorClass} ${isOpen ? 'is-open' : ''}`}
        onClick={handleOpen}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        {showLabel && <span className="status-select-label">{value || 'Select'}</span>}
      </button>

      {dropdownContent && createPortal(dropdownContent, document.body)}
    </div>
  );
};

export default StatusSelect;

