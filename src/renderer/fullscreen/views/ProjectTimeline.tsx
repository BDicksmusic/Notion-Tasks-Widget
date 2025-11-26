import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import type { Project, Task } from '@shared/types';

interface Props {
  projects: Project[];
  tasks: Task[];
  onSelectProject?: (projectId: string) => void;
  onOpenProjectWorkspace?: (projectId: string) => void;
  selectedProjectId?: string | null;
}

type ColorScheme = 'status' | 'progress' | 'timeline' | 'project';
type GroupBy = 'none' | 'status' | 'timeline';

interface ProjectWithMeta extends Project {
  effectiveStart: Date | null;
  effectiveEnd: Date | null;
  progress: number;
  total: number;
  completed: number;
  urgent: number;
  overdue: number;
  statusColor: string;
  timelineStatus: 'upcoming' | 'active' | 'overdue' | 'completed' | 'no-dates';
  daysRemaining: number | null;
}

// Muted color palettes for dark mode
const STATUS_COLORS: Record<string, string> = {
  'done': 'rgba(34, 197, 94, 0.6)',
  'complete': 'rgba(34, 197, 94, 0.6)',
  'in progress': 'rgba(59, 130, 246, 0.6)',
  'active': 'rgba(59, 130, 246, 0.6)',
  'planning': 'rgba(139, 92, 246, 0.6)',
  'backlog': 'rgba(139, 92, 246, 0.6)',
  'on hold': 'rgba(245, 158, 11, 0.6)',
  'paused': 'rgba(245, 158, 11, 0.6)',
  'blocked': 'rgba(239, 68, 68, 0.6)',
  'stuck': 'rgba(239, 68, 68, 0.6)',
  'default': 'rgba(107, 114, 128, 0.6)'
};

const PROGRESS_COLORS = [
  { threshold: 0, color: 'rgba(239, 68, 68, 0.5)' },
  { threshold: 25, color: 'rgba(249, 115, 22, 0.5)' },
  { threshold: 50, color: 'rgba(234, 179, 8, 0.5)' },
  { threshold: 75, color: 'rgba(34, 197, 94, 0.5)' },
  { threshold: 100, color: 'rgba(16, 185, 129, 0.5)' },
];

const PROJECT_PALETTE = [
  'rgba(239, 68, 68, 0.5)', 'rgba(249, 115, 22, 0.5)', 'rgba(234, 179, 8, 0.5)',
  'rgba(34, 197, 94, 0.5)', 'rgba(6, 182, 212, 0.5)', 'rgba(59, 130, 246, 0.5)',
  'rgba(139, 92, 246, 0.5)', 'rgba(236, 72, 153, 0.5)', 'rgba(20, 184, 166, 0.5)',
  'rgba(244, 63, 94, 0.5)'
];

const TIMELINE_COLORS = {
  'upcoming': 'rgba(107, 114, 128, 0.5)',
  'active': 'rgba(59, 130, 246, 0.5)',
  'overdue': 'rgba(239, 68, 68, 0.5)',
  'completed': 'rgba(34, 197, 94, 0.5)',
  'no-dates': 'rgba(71, 85, 105, 0.5)'
};

const getStatusColor = (status: string | undefined): string => {
  if (!status) return STATUS_COLORS.default;
  const s = status.toLowerCase();
  for (const [key, color] of Object.entries(STATUS_COLORS)) {
    if (s.includes(key)) return color;
  }
  return STATUS_COLORS.default;
};

const getProgressColor = (progress: number): string => {
  for (let i = PROGRESS_COLORS.length - 1; i >= 0; i--) {
    if (progress >= PROGRESS_COLORS[i].threshold) {
      return PROGRESS_COLORS[i].color;
    }
  }
  return PROGRESS_COLORS[0].color;
};

const formatDateShort = (date: Date): string => {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const toISODateString = (date: Date): string => {
  return date.toISOString().split('T')[0];
};

// Zoom levels configuration - from 5 years down to 2 weeks
type ZoomLevel = '5y' | '2y' | '1y' | '6m' | '2m' | '1m' | '2w';

const ZOOM_CONFIG: Record<ZoomLevel, { label: string; dayWidth: number; daysVisible: number }> = {
  '5y': { label: '5 Years', dayWidth: 0.8, daysVisible: 1825 },
  '2y': { label: '2 Years', dayWidth: 1.5, daysVisible: 730 },
  '1y': { label: '1 Year', dayWidth: 2.5, daysVisible: 365 },
  '6m': { label: '6 Months', dayWidth: 4, daysVisible: 180 },
  '2m': { label: '2 Months', dayWidth: 12, daysVisible: 60 },
  '1m': { label: '1 Month', dayWidth: 24, daysVisible: 30 },
  '2w': { label: '2 Weeks', dayWidth: 48, daysVisible: 14 },
};

const ZOOM_ORDER: ZoomLevel[] = ['5y', '2y', '1y', '6m', '2m', '1m', '2w'];

const ROW_HEIGHT = 40;

const ProjectTimeline = ({
  projects,
  tasks,
  onSelectProject,
  onOpenProjectWorkspace,
  selectedProjectId
}: Props) => {
  const headerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Local project date overrides (for immediate visual feedback)
  const [localDateOverrides, setLocalDateOverrides] = useState<Record<string, { startDate?: string; endDate?: string }>>({});
  
  // Zoom level
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>('1m');
  const zoomConfig = ZOOM_CONFIG[zoomLevel];
  const DAY_WIDTH = zoomConfig.dayWidth;
  
  // Truly infinite scroll - start with a large range and extend as needed
  // No maximum limits - can scroll from year 1900 to 3000+
  const [daysBefore, setDaysBefore] = useState(365 * 5); // Start with 5 years before
  const [daysAfter, setDaysAfter] = useState(365 * 5);   // Start with 5 years after (10 years total)
  const [showCompleted, setShowCompleted] = useState(false);
  const [colorScheme, setColorScheme] = useState<ColorScheme>('timeline');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  
  // Drag state for resizing
  const [dragState, setDragState] = useState<{
    projectId: string;
    type: 'move' | 'resize-start' | 'resize-end';
    initialStartDate: Date | null;
    initialEndDate: Date | null;
    startX: number;
    currentDelta: number;
  } | null>(null);
  
  // Scroll position for sticky title
  const [scrollLeft, setScrollLeft] = useState(0);
  
  // Project info card state
  const [infoCard, setInfoCard] = useState<{
    project: ProjectWithMeta;
    x: number;
    y: number;
  } | null>(null);
  const clickTimeoutRef = useRef<number | null>(null);
  const [hasScrolledToToday, setHasScrolledToToday] = useState(false);

  // Calculate view range
  const { viewStart, days, todayIndex } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const start = new Date(today);
    start.setDate(start.getDate() - daysBefore);
    
    const end = new Date(today);
    end.setDate(end.getDate() + daysAfter);
    
    const dayArray: Date[] = [];
    const current = new Date(start);
    while (current <= end) {
      dayArray.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    
    return { viewStart: start, days: dayArray, todayIndex: daysBefore };
  }, [daysBefore, daysAfter]);

  // Process projects with metadata (including local overrides)
  const projectsWithMeta = useMemo((): ProjectWithMeta[] => {
    let result = projects;
    
    if (!showCompleted) {
      result = result.filter(p => {
        const s = p.status?.toLowerCase() || '';
        return !s.includes('done') && !s.includes('complete') && !s.includes('cancel');
      });
    }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    return result.map((project, index) => {
      const projectTasks = tasks.filter(t => (t.projectIds ?? []).includes(project.id));
      const completed = projectTasks.filter(t => t.normalizedStatus === 'complete').length;
      const total = projectTasks.length;
      const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
      const urgent = projectTasks.filter(t => t.urgent && t.normalizedStatus !== 'complete').length;
      
      const overdue = projectTasks.filter(t => 
        t.dueDate && new Date(t.dueDate) < today && t.normalizedStatus !== 'complete'
      ).length;
      
      // Apply local overrides if present
      const override = localDateOverrides[project.id];
      let effectiveStart = override?.startDate 
        ? new Date(override.startDate) 
        : (project.startDate ? new Date(project.startDate) : null);
      let effectiveEnd = override?.endDate 
        ? new Date(override.endDate) 
        : (project.endDate ? new Date(project.endDate) : null);
      
      // Fallback to task dates
      if (!effectiveStart || !effectiveEnd) {
        const taskDates = projectTasks
          .filter(t => t.dueDate)
          .map(t => new Date(t.dueDate!))
          .sort((a, b) => a.getTime() - b.getTime());
        
        if (taskDates.length > 0) {
          if (!effectiveStart) effectiveStart = taskDates[0];
          if (!effectiveEnd) effectiveEnd = taskDates[taskDates.length - 1];
        }
      }
      
      // Determine timeline status
      let timelineStatus: ProjectWithMeta['timelineStatus'] = 'no-dates';
      let daysRemaining: number | null = null;
      
      if (effectiveStart && effectiveEnd) {
        if (today < effectiveStart) {
          timelineStatus = 'upcoming';
          daysRemaining = Math.ceil((effectiveStart.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        } else if (today > effectiveEnd) {
          const hasOpenTasks = projectTasks.some(t => t.normalizedStatus !== 'complete');
          timelineStatus = hasOpenTasks ? 'overdue' : 'completed';
          daysRemaining = -Math.floor((today.getTime() - effectiveEnd.getTime()) / (1000 * 60 * 60 * 24));
        } else {
          timelineStatus = 'active';
          daysRemaining = Math.ceil((effectiveEnd.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        }
      } else if (effectiveEnd) {
        if (today > effectiveEnd) {
          const hasOpenTasks = projectTasks.some(t => t.normalizedStatus !== 'complete');
          timelineStatus = hasOpenTasks ? 'overdue' : 'completed';
          daysRemaining = -Math.floor((today.getTime() - effectiveEnd.getTime()) / (1000 * 60 * 60 * 24));
        } else {
          timelineStatus = 'active';
          daysRemaining = Math.ceil((effectiveEnd.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        }
      }
      
      return {
        ...project,
        effectiveStart,
        effectiveEnd,
        progress,
        total,
        completed,
        urgent,
        overdue,
        statusColor: getStatusColor(project.status),
        timelineStatus,
        daysRemaining
      };
    }).sort((a, b) => {
      if (!a.effectiveStart && !b.effectiveStart) return 0;
      if (!a.effectiveStart) return 1;
      if (!b.effectiveStart) return -1;
      return a.effectiveStart.getTime() - b.effectiveStart.getTime();
    });
  }, [projects, tasks, showCompleted, localDateOverrides]);

  // Group projects
  const groupedProjects = useMemo(() => {
    if (groupBy === 'none') {
      return [{ id: 'all', label: 'All Projects', projects: projectsWithMeta }];
    }
    
    if (groupBy === 'status') {
      const groups = new Map<string, ProjectWithMeta[]>();
      projectsWithMeta.forEach(p => {
        const key = p.status || 'No Status';
        const list = groups.get(key) ?? [];
        list.push(p);
        groups.set(key, list);
      });
      
      const statusOrder = ['In Progress', 'Active', 'Planning', 'Backlog', 'On Hold', 'Blocked', 'Done', 'No Status'];
      const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
        const aIdx = statusOrder.findIndex(s => a.toLowerCase().includes(s.toLowerCase()));
        const bIdx = statusOrder.findIndex(s => b.toLowerCase().includes(s.toLowerCase()));
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;
        return a.localeCompare(b);
      });
      
      return sortedKeys.map(key => ({
        id: key.toLowerCase().replace(/\s+/g, '-'),
        label: key,
        projects: groups.get(key) ?? []
      }));
    }
    
    if (groupBy === 'timeline') {
      const groups: Record<string, ProjectWithMeta[]> = {
        'overdue': [],
        'active': [],
        'upcoming': [],
        'completed': [],
        'no-dates': []
      };
      
      projectsWithMeta.forEach(p => {
        groups[p.timelineStatus].push(p);
      });
      
      const labels: Record<string, string> = {
        'overdue': '🔴 Overdue',
        'active': '🟢 Active',
        'upcoming': '🔵 Upcoming',
        'completed': '✅ Completed',
        'no-dates': '⚪ No Dates'
      };
      
      return Object.entries(groups)
        .filter(([, projects]) => projects.length > 0)
        .map(([id, projects]) => ({
          id,
          label: labels[id],
          projects
        }));
    }
    
    return [{ id: 'all', label: 'All Projects', projects: projectsWithMeta }];
  }, [projectsWithMeta, groupBy]);

  // Toggle group collapse
  const toggleGroup = useCallback((groupId: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  // Get bar color based on color scheme
  const getBarColor = useCallback((project: ProjectWithMeta, index: number): string => {
    switch (colorScheme) {
      case 'status':
        return project.statusColor;
      case 'progress':
        return getProgressColor(project.progress);
      case 'timeline':
        return TIMELINE_COLORS[project.timelineStatus];
      case 'project':
        return PROJECT_PALETTE[index % PROJECT_PALETTE.length];
      default:
        return project.statusColor;
    }
  }, [colorScheme]);

  // Dynamic headers based on zoom level
  const timeHeaders = useMemo(() => {
    // Primary row (top) - larger increments
    const primaryHeaders: { label: string; startIndex: number; width: number }[] = [];
    // Secondary row (bottom) - smaller increments  
    const secondaryHeaders: { label: string; startIndex: number; width: number; isToday?: boolean }[] = [];
    
    // For performance, limit processing for very large ranges
    // Optimized header generation with proper width calculations
    const len = days.length;
    
    if (zoomLevel === '5y' || zoomLevel === '2y') {
      // For 5y/2y, only check key days (1st of each month) 
      let currentDecade = '';
      let currentYear = '';
      let lastPrimaryWidth = 0;
      let lastSecondaryWidth = 0;
      
      for (let index = 0; index < len; index++) {
        const day = days[index];
        const year = day.getFullYear();
        const decadeLabel = `${Math.floor(year / 10) * 10}s`;
        const yearLabel = year.toString();
        
        if (zoomLevel === '5y') {
          if (decadeLabel !== currentDecade) {
            if (primaryHeaders.length > 0) {
              primaryHeaders[primaryHeaders.length - 1].width = index - lastPrimaryWidth;
            }
            primaryHeaders.push({ label: decadeLabel, startIndex: index, width: 1 });
            lastPrimaryWidth = index;
            currentDecade = decadeLabel;
          }
          
          if (day.getMonth() === 0 && day.getDate() === 1) {
            if (secondaryHeaders.length > 0) {
              secondaryHeaders[secondaryHeaders.length - 1].width = index - lastSecondaryWidth;
            }
            secondaryHeaders.push({ label: yearLabel, startIndex: index, width: 1 });
            lastSecondaryWidth = index;
          }
        } else {
          if (yearLabel !== currentYear) {
            if (primaryHeaders.length > 0) {
              primaryHeaders[primaryHeaders.length - 1].width = index - lastPrimaryWidth;
            }
            primaryHeaders.push({ label: yearLabel, startIndex: index, width: 1 });
            lastPrimaryWidth = index;
            currentYear = yearLabel;
          }
          
          if (day.getDate() === 1 && (day.getMonth() % 3 === 0)) {
            const quarter = `Q${Math.floor(day.getMonth() / 3) + 1}`;
            if (secondaryHeaders.length > 0) {
              secondaryHeaders[secondaryHeaders.length - 1].width = index - lastSecondaryWidth;
            }
            secondaryHeaders.push({ label: quarter, startIndex: index, width: 1 });
            lastSecondaryWidth = index;
          }
        }
      }
      // Set final widths
      if (primaryHeaders.length > 0) primaryHeaders[primaryHeaders.length - 1].width = len - lastPrimaryWidth;
      if (secondaryHeaders.length > 0) secondaryHeaders[secondaryHeaders.length - 1].width = len - lastSecondaryWidth;
      
    } else if (zoomLevel === '1y' || zoomLevel === '6m') {
      // Years/Months view - check on month boundaries
      let currentYear = '';
      let currentMonth = '';
      let lastPrimaryWidth = 0;
      let lastSecondaryWidth = 0;
      
      for (let index = 0; index < len; index++) {
        const day = days[index];
        const yearLabel = day.getFullYear().toString();
        const monthLabel = day.toLocaleDateString('en-US', { month: 'short' });
        
        if (yearLabel !== currentYear) {
          if (primaryHeaders.length > 0) {
            primaryHeaders[primaryHeaders.length - 1].width = index - lastPrimaryWidth;
          }
          primaryHeaders.push({ label: yearLabel, startIndex: index, width: 1 });
          lastPrimaryWidth = index;
          currentYear = yearLabel;
        }
        
        if (day.getDate() === 1 || index === 0) {
          if (secondaryHeaders.length > 0) {
            secondaryHeaders[secondaryHeaders.length - 1].width = index - lastSecondaryWidth;
          }
          secondaryHeaders.push({ label: monthLabel, startIndex: index, width: 1 });
          lastSecondaryWidth = index;
          currentMonth = monthLabel;
        }
      }
      if (primaryHeaders.length > 0) primaryHeaders[primaryHeaders.length - 1].width = len - lastPrimaryWidth;
      if (secondaryHeaders.length > 0) secondaryHeaders[secondaryHeaders.length - 1].width = len - lastSecondaryWidth;
      
    } else if (zoomLevel === '2m') {
      // Months/Weeks view
      let currentMonth = '';
      let lastPrimaryWidth = 0;
      let lastSecondaryWidth = 0;
      
      for (let index = 0; index < len; index++) {
        const day = days[index];
        const monthLabel = day.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        
        if (monthLabel !== currentMonth) {
          if (primaryHeaders.length > 0) {
            primaryHeaders[primaryHeaders.length - 1].width = index - lastPrimaryWidth;
          }
          primaryHeaders.push({ label: monthLabel, startIndex: index, width: 1 });
          lastPrimaryWidth = index;
          currentMonth = monthLabel;
        }
        
        if (day.getDay() === 0 || index === 0) {
          if (secondaryHeaders.length > 0) {
            secondaryHeaders[secondaryHeaders.length - 1].width = index - lastSecondaryWidth;
          }
          const weekLabel = day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          secondaryHeaders.push({ 
            label: weekLabel, 
            startIndex: index, 
            width: 1,
            isToday: index === todayIndex
          });
          lastSecondaryWidth = index;
        }
      }
      if (primaryHeaders.length > 0) primaryHeaders[primaryHeaders.length - 1].width = len - lastPrimaryWidth;
      if (secondaryHeaders.length > 0) secondaryHeaders[secondaryHeaders.length - 1].width = len - lastSecondaryWidth;
      
    } else if (zoomLevel === '1m') {
      // Months/Days view - need all days for secondary
      let currentMonth = '';
      let lastPrimaryWidth = 0;
      
      for (let index = 0; index < len; index++) {
        const day = days[index];
        const monthLabel = day.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        
        if (monthLabel !== currentMonth) {
          if (primaryHeaders.length > 0) {
            primaryHeaders[primaryHeaders.length - 1].width = index - lastPrimaryWidth;
          }
          primaryHeaders.push({ label: monthLabel, startIndex: index, width: 1 });
          lastPrimaryWidth = index;
          currentMonth = monthLabel;
        }
        
        secondaryHeaders.push({ 
          label: day.getDate().toString(), 
          startIndex: index, 
          width: 1,
          isToday: index === todayIndex
        });
      }
      if (primaryHeaders.length > 0) primaryHeaders[primaryHeaders.length - 1].width = len - lastPrimaryWidth;
      
    } else {
      // 2 weeks: Weeks/Days view
      let lastPrimaryWidth = 0;
      
      for (let index = 0; index < len; index++) {
        const day = days[index];
        
        if (day.getDay() === 0 || index === 0) {
          if (primaryHeaders.length > 0) {
            primaryHeaders[primaryHeaders.length - 1].width = index - lastPrimaryWidth;
          }
          const weekLabel = `Week of ${day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
          primaryHeaders.push({ label: weekLabel, startIndex: index, width: 1 });
          lastPrimaryWidth = index;
        }
        
        const dayName = day.toLocaleDateString('en-US', { weekday: 'short' });
        secondaryHeaders.push({ 
          label: `${dayName} ${day.getDate()}`, 
          startIndex: index, 
          width: 1,
          isToday: index === todayIndex
        });
      }
      if (primaryHeaders.length > 0) primaryHeaders[primaryHeaders.length - 1].width = len - lastPrimaryWidth;
    }
    
    return { primaryHeaders, secondaryHeaders };
  }, [days, zoomLevel, todayIndex]);

  const totalWidth = days.length * DAY_WIDTH;

  // Scroll to today on first mount only
  useEffect(() => {
    if (chartRef.current && !hasScrolledToToday) {
      // Position today line at roughly 1/3 from left (good viewing position)
      const scrollPosition = todayIndex * DAY_WIDTH - chartRef.current.clientWidth / 3;
      chartRef.current.scrollLeft = Math.max(0, scrollPosition);
      if (headerRef.current) {
        headerRef.current.scrollLeft = Math.max(0, scrollPosition);
      }
      setScrollLeft(Math.max(0, scrollPosition));
      setHasScrolledToToday(true);
    }
  }, [todayIndex, DAY_WIDTH, hasScrolledToToday]);
  
  // Reset scroll flag when zoom changes to recenter
  useEffect(() => {
    setHasScrolledToToday(false);
  }, [zoomLevel]);

  // Handle scroll - truly infinite, no limits
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const { scrollLeft: newScrollLeft, scrollWidth, clientWidth } = target;
    
    if (headerRef.current) {
      headerRef.current.scrollLeft = newScrollLeft;
    }
    setScrollLeft(newScrollLeft);
    
    // Extend past (left edge) - add a full year when getting close
    // Also adjust scroll position to prevent jumping
    if (newScrollLeft < 500) {
      const extensionDays = 365;
      const extensionPixels = extensionDays * DAY_WIDTH;
      setDaysBefore(prev => prev + extensionDays);
      // After state updates, adjust scroll to maintain position
      requestAnimationFrame(() => {
        if (chartRef.current && headerRef.current) {
          chartRef.current.scrollLeft = newScrollLeft + extensionPixels;
          headerRef.current.scrollLeft = newScrollLeft + extensionPixels;
        }
      });
    }
    
    // Extend future (right edge) - add a full year when getting close
    if (scrollWidth - newScrollLeft - clientWidth < 500) {
      setDaysAfter(prev => prev + 365);
    }
  }, [DAY_WIDTH]);

  // Jump to today
  const goToToday = useCallback(() => {
    if (chartRef.current) {
      const scrollPosition = todayIndex * DAY_WIDTH - chartRef.current.clientWidth / 3;
      chartRef.current.scrollLeft = Math.max(0, scrollPosition);
      if (headerRef.current) {
        headerRef.current.scrollLeft = Math.max(0, scrollPosition);
      }
    }
  }, [todayIndex, DAY_WIDTH]);
  
  // Handle single click - show info card
  const handleBarClick = useCallback((e: React.MouseEvent, project: ProjectWithMeta) => {
    // Don't trigger click if we're dragging
    if (dragState) return;
    
    e.stopPropagation();
    e.preventDefault();
    
    // Store click position before timeout
    const clickX = e.clientX;
    const clickY = e.clientY;
    const barRect = (e.currentTarget as HTMLElement).closest('.timeline-bar')?.getBoundingClientRect();
    
    // If there's a pending double-click timeout, this is a double click
    if (clickTimeoutRef.current !== null) {
      window.clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
      // Double click - open project workspace
      onOpenProjectWorkspace?.(project.id);
      setInfoCard(null);
      return;
    }
    
    // Single click - wait a bit to see if it's a double click
    clickTimeoutRef.current = window.setTimeout(() => {
      clickTimeoutRef.current = null;
      // Show info card near the click position
      setInfoCard({
        project,
        x: Math.min(clickX, window.innerWidth - 320), // Keep on screen
        y: Math.min((barRect?.bottom ?? clickY) + 8, window.innerHeight - 350)
      });
      onSelectProject?.(project.id);
    }, 250);
  }, [onSelectProject, onOpenProjectWorkspace, dragState]);
  
  // Close info card when clicking outside
  useEffect(() => {
    if (!infoCard) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.project-info-card') && !target.closest('.timeline-bar')) {
        setInfoCard(null);
      }
    };
    
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setInfoCard(null);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [infoCard]);

  // Zoom in (more detail)
  const zoomIn = useCallback(() => {
    const currentIdx = ZOOM_ORDER.indexOf(zoomLevel);
    if (currentIdx < ZOOM_ORDER.length - 1) {
      setZoomLevel(ZOOM_ORDER[currentIdx + 1]);
    }
  }, [zoomLevel]);

  // Zoom out (less detail)
  const zoomOut = useCallback(() => {
    const currentIdx = ZOOM_ORDER.indexOf(zoomLevel);
    if (currentIdx > 0) {
      setZoomLevel(ZOOM_ORDER[currentIdx - 1]);
    }
  }, [zoomLevel]);

  // Handle Ctrl+Shift+Scroll for zoom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey && e.shiftKey) {
        e.preventDefault();
        if (e.deltaY < 0) {
          zoomIn();
        } else {
          zoomOut();
        }
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [zoomIn, zoomOut]);

  // Date to pixel conversion - MUST include DAY_WIDTH in deps
  const dateToPixel = useCallback((date: Date): number => {
    const daysDiff = Math.floor((date.getTime() - viewStart.getTime()) / (1000 * 60 * 60 * 24));
    return daysDiff * DAY_WIDTH;
  }, [viewStart, DAY_WIDTH]);

  // Get bar position - accounts for drag state
  const getBarPosition = useCallback((project: ProjectWithMeta) => {
    if (!project.effectiveStart) return null;
    
    let startDate = new Date(project.effectiveStart);
    let endDate = project.effectiveEnd ? new Date(project.effectiveEnd) : new Date(startDate.getTime() + 14 * 24 * 60 * 60 * 1000);
    
    // Apply drag offset
    if (dragState?.projectId === project.id && dragState.currentDelta !== 0) {
      const daysDelta = Math.round(dragState.currentDelta / DAY_WIDTH);
      
      if (dragState.type === 'resize-start' && dragState.initialStartDate) {
        startDate = new Date(dragState.initialStartDate);
        startDate.setDate(startDate.getDate() + daysDelta);
      } else if (dragState.type === 'resize-end' && dragState.initialEndDate) {
        endDate = new Date(dragState.initialEndDate);
        endDate.setDate(endDate.getDate() + daysDelta);
      } else if (dragState.type === 'move') {
        if (dragState.initialStartDate) {
          startDate = new Date(dragState.initialStartDate);
          startDate.setDate(startDate.getDate() + daysDelta);
        }
        if (dragState.initialEndDate) {
          endDate = new Date(dragState.initialEndDate);
          endDate.setDate(endDate.getDate() + daysDelta);
        }
      }
    }
    
    const left = dateToPixel(startDate);
    const right = dateToPixel(endDate);
    // Ensure bars are visible at all zoom levels
    const minWidth = zoomLevel === '5y' ? DAY_WIDTH * 30 
      : zoomLevel === '2y' ? DAY_WIDTH * 14 
      : zoomLevel === '1y' ? DAY_WIDTH * 7 
      : zoomLevel === '6m' ? DAY_WIDTH * 7 
      : DAY_WIDTH * 2;
    const width = Math.max(right - left, minWidth);
    
    return { left, width, startDate, endDate };
  }, [dateToPixel, dragState, DAY_WIDTH, zoomLevel]);

  // Handle drag start - SAVES locally on release
  const handleDragStart = useCallback((
    e: React.PointerEvent,
    project: ProjectWithMeta,
    type: 'move' | 'resize-start' | 'resize-end'
  ) => {
    e.preventDefault();
    e.stopPropagation();
    
    const startX = e.clientX;
    const currentDayWidth = DAY_WIDTH; // Capture current DAY_WIDTH
    
    setDragState({
      projectId: project.id,
      type,
      initialStartDate: project.effectiveStart,
      initialEndDate: project.effectiveEnd,
      startX,
      currentDelta: 0
    });

    const handleMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      setDragState(prev => prev ? { ...prev, currentDelta: delta } : null);
    };

    const handleUp = (upEvent: PointerEvent) => {
      const delta = upEvent.clientX - startX;
      const daysDelta = Math.round(delta / currentDayWidth);
      
      if (daysDelta !== 0) {
        // Save to local overrides so it persists visually
        setLocalDateOverrides(prev => {
          const current = prev[project.id] || {};
          const newOverride = { ...current };
          
          if (type === 'resize-start' && project.effectiveStart) {
            const newStart = new Date(project.effectiveStart);
            newStart.setDate(newStart.getDate() + daysDelta);
            if (!project.effectiveEnd || newStart < project.effectiveEnd) {
              newOverride.startDate = toISODateString(newStart);
            }
          } else if (type === 'resize-end' && project.effectiveEnd) {
            const newEnd = new Date(project.effectiveEnd);
            newEnd.setDate(newEnd.getDate() + daysDelta);
            if (!project.effectiveStart || newEnd > project.effectiveStart) {
              newOverride.endDate = toISODateString(newEnd);
            }
          } else if (type === 'move' && project.effectiveStart && project.effectiveEnd) {
            const newStart = new Date(project.effectiveStart);
            const newEnd = new Date(project.effectiveEnd);
            newStart.setDate(newStart.getDate() + daysDelta);
            newEnd.setDate(newEnd.getDate() + daysDelta);
            newOverride.startDate = toISODateString(newStart);
            newOverride.endDate = toISODateString(newEnd);
          }
          
          return { ...prev, [project.id]: newOverride };
        });
      }
      
      setDragState(null);
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
    };

    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
  }, [DAY_WIDTH]);

  // Sticky title offset
  const getStickyOffset = useCallback((barLeft: number, barWidth: number): number => {
    const scrolledOff = scrollLeft - barLeft;
    if (scrolledOff > 0 && scrolledOff < barWidth - 80) {
      return scrolledOff;
    }
    return 0;
  }, [scrollLeft]);

  if (projectsWithMeta.length === 0) {
    return (
      <div className="timeline-v4-empty">
        <span className="empty-icon">📅</span>
        <p>No projects to display</p>
      </div>
    );
  }

  let globalIndex = 0;

  return (
    <div className="timeline-v4" ref={containerRef}>
      {/* Controls */}
      <div className="timeline-v4-controls">
        <button type="button" className="today-btn" onClick={goToToday}>
          Today
        </button>
        
        {/* Zoom controls */}
        <div className="zoom-controls">
          <button 
            type="button" 
            className="zoom-btn"
            onClick={zoomOut}
            disabled={zoomLevel === '6m'}
            title="Zoom out (Ctrl+Shift+Scroll)"
          >
            −
          </button>
          <select 
            value={zoomLevel} 
            onChange={(e) => setZoomLevel(e.target.value as ZoomLevel)}
            className="zoom-select"
          >
            {ZOOM_ORDER.map(level => (
              <option key={level} value={level}>{ZOOM_CONFIG[level].label}</option>
            ))}
          </select>
          <button 
            type="button" 
            className="zoom-btn"
            onClick={zoomIn}
            disabled={zoomLevel === '2w'}
            title="Zoom in (Ctrl+Shift+Scroll)"
          >
            +
          </button>
        </div>
        
        <div className="control-group">
          <label>Color:</label>
          <select 
            value={colorScheme} 
            onChange={(e) => setColorScheme(e.target.value as ColorScheme)}
          >
            <option value="timeline">Timeline Status</option>
            <option value="status">Project Status</option>
            <option value="progress">Progress</option>
            <option value="project">By Project</option>
          </select>
        </div>
        
        <div className="control-group">
          <label>Group:</label>
          <select 
            value={groupBy} 
            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
          >
            <option value="none">None</option>
            <option value="status">Status</option>
            <option value="timeline">Timeline</option>
          </select>
        </div>
        
        <button
          type="button"
          className={`toggle-btn ${showCompleted ? 'active' : ''}`}
          onClick={() => setShowCompleted(!showCompleted)}
        >
          Show Done
        </button>
        
        <span className="project-count">{projectsWithMeta.length} projects</span>
      </div>

      {/* Main area */}
      <div className="timeline-v4-main">
        {/* Header */}
        <div className="timeline-v4-header">
          <div 
            className="timeline-v4-header-scroll" 
            ref={headerRef}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ width: totalWidth, display: 'flex', flexDirection: 'column' }}>
              {/* Primary row (larger increments: years, months, weeks) */}
              <div className="primary-header-row" style={{ position: 'relative', height: 24 }}>
                {timeHeaders.primaryHeaders
                  .filter(h => {
                    // Only render if visible (with buffer)
                    const left = h.startIndex * DAY_WIDTH;
                    const right = left + h.width * DAY_WIDTH;
                    return right >= scrollLeft - 200 && left <= scrollLeft + 2200;
                  })
                  .map((header, i) => (
                  <div
                    key={`${header.label}-${header.startIndex}`}
                    className="primary-header-cell"
                    style={{
                      position: 'absolute',
                      left: header.startIndex * DAY_WIDTH,
                      width: header.width * DAY_WIDTH
                    }}
                  >
                    {header.label}
                  </div>
                ))}
              </div>
              {/* Secondary row (smaller increments: months, weeks, days) */}
              <div className="secondary-header-row" style={{ position: 'relative', height: 24 }}>
                {timeHeaders.secondaryHeaders
                  .filter(h => {
                    // Only render if visible (with buffer)
                    const left = h.startIndex * DAY_WIDTH;
                    const right = left + h.width * DAY_WIDTH;
                    return right >= scrollLeft - 200 && left <= scrollLeft + 2200;
                  })
                  .map((header, i) => {
                  const isWeekend = zoomLevel !== '6m' && zoomLevel !== '2m' && 
                    days[header.startIndex] && 
                    (days[header.startIndex].getDay() === 0 || days[header.startIndex].getDay() === 6);
                  
                  return (
                    <div
                      key={`${header.label}-${header.startIndex}`}
                      className={`secondary-header-cell ${header.isToday ? 'is-today' : ''} ${isWeekend ? 'is-weekend' : ''}`}
                      style={{
                        position: 'absolute',
                        left: header.startIndex * DAY_WIDTH,
                        width: header.width * DAY_WIDTH
                      }}
                    >
                      {header.label}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="timeline-v4-body">
          <div 
            className="timeline-v4-chart" 
            ref={chartRef}
            onScroll={handleScroll}
          >
            <div 
              className="timeline-v4-chart-inner" 
              style={{ 
                width: totalWidth,
                // CSS-based grid - much faster than rendering thousands of divs
                backgroundImage: `repeating-linear-gradient(
                  to right,
                  transparent 0px,
                  transparent ${DAY_WIDTH - 1}px,
                  rgba(255,255,255,0.04) ${DAY_WIDTH - 1}px,
                  rgba(255,255,255,0.04) ${DAY_WIDTH}px
                )`,
                backgroundSize: `${DAY_WIDTH}px 100%`
              }}
            >
              {/* Today line */}
              <div 
                className="today-line"
                style={{ left: todayIndex * DAY_WIDTH + DAY_WIDTH / 2 }}
              />

              {/* Grouped project rows */}
              {groupedProjects.map((group) => {
                const isCollapsed = collapsedGroups.has(group.id);
                
                return (
                  <div key={group.id} className="timeline-group">
                    {groupBy !== 'none' && (
                      <div 
                        className={`timeline-group-header ${isCollapsed ? 'is-collapsed' : ''}`}
                        onClick={() => toggleGroup(group.id)}
                      >
                        <span className="collapse-icon">{isCollapsed ? '▶' : '▼'}</span>
                        <span className="group-label">{group.label}</span>
                        <span className="group-count">{group.projects.length}</span>
                      </div>
                    )}
                    
                    {!isCollapsed && group.projects.map((project) => {
                      const projectIndex = globalIndex++;
                      const barPos = getBarPosition(project);
                      const isSelected = selectedProjectId === project.id;
                      const isDragging = dragState?.projectId === project.id;
                      const barColor = getBarColor(project, projectIndex);

                      return (
                        <div
                          key={project.id}
                          className={`timeline-row ${isSelected ? 'is-selected' : ''} ${isDragging ? 'is-dragging' : ''}`}
                          style={{ height: ROW_HEIGHT }}
                        >
                          {barPos && (
                            <div
                              className={`timeline-bar ${project.timelineStatus} ${infoCard?.project.id === project.id ? 'is-info-open' : ''}`}
                              style={{
                                left: barPos.left,
                                width: barPos.width,
                                background: barColor
                              }}
                              onClick={(e) => handleBarClick(e, project)}
                            >
                              {/* Progress fill */}
                              <div 
                                className="bar-progress"
                                style={{ width: `${project.progress}%` }}
                              />

                              {/* Resize handle - start */}
                              {project.effectiveStart && (
                                <div
                                  className="resize-handle resize-start"
                                  onPointerDown={(e) => handleDragStart(e, project, 'resize-start')}
                                />
                              )}

                              {/* Move area - also handles clicks */}
                              {project.effectiveStart && project.effectiveEnd && (
                                <div
                                  className="move-handle"
                                  onPointerDown={(e) => handleDragStart(e, project, 'move')}
                                  onClick={(e) => handleBarClick(e, project)}
                                />
                              )}

                              {/* Resize handle - end */}
                              {project.effectiveEnd && (
                                <div
                                  className="resize-handle resize-end"
                                  onPointerDown={(e) => handleDragStart(e, project, 'resize-end')}
                                />
                              )}

                              {/* Sticky title content - can overflow */}
                              <div 
                                className="bar-content"
                                style={{ transform: `translateX(${getStickyOffset(barPos.left, barPos.width)}px)` }}
                                onClick={(e) => handleBarClick(e, project)}
                              >
                                <span className="bar-emoji">{project.emoji || '📁'}</span>
                                <span className="bar-title">{project.title || 'Untitled'}</span>
                                {project.daysRemaining !== null && (
                                  <span className={`bar-days ${project.timelineStatus}`}>
                                    {project.daysRemaining > 0 
                                      ? `${project.daysRemaining}d` 
                                      : project.daysRemaining < 0 
                                        ? `${Math.abs(project.daysRemaining)}d over` 
                                        : 'Today'}
                                  </span>
                                )}
                                <span className="bar-stats">{project.completed}/{project.total}</span>
                              </div>
                            </div>
                          )}
                          
                          {/* No bar placeholder */}
                          {!barPos && (
                            <div 
                              className="no-dates-label"
                              onClick={() => onSelectProject?.(project.id)}
                            >
                              <span className="bar-emoji">{project.emoji || '📁'}</span>
                              <span className="bar-title">{project.title || 'Untitled'}</span>
                              <span className="no-dates-hint">No dates</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      
      {/* Project Info Card */}
      {infoCard && (
        <div 
          className="project-info-card"
          style={{
            left: infoCard.x,
            top: infoCard.y
          }}
        >
          <div className="info-card-header">
            <span className="info-card-emoji">{infoCard.project.emoji || '📁'}</span>
            <div className="info-card-title-group">
              <h3 className="info-card-title">{infoCard.project.title || 'Untitled'}</h3>
              {infoCard.project.status && (
                <span 
                  className="info-card-status"
                  style={{ background: infoCard.project.statusColor }}
                >
                  {infoCard.project.status}
                </span>
              )}
            </div>
            <button 
              className="info-card-close"
              onClick={() => setInfoCard(null)}
            >
              ✕
            </button>
          </div>
          
          <div className="info-card-dates">
            {infoCard.project.effectiveStart && (
              <div className="info-card-date">
                <span className="date-label">Start</span>
                <span className="date-value">
                  {infoCard.project.effectiveStart.toLocaleDateString('en-US', { 
                    month: 'short', 
                    day: 'numeric',
                    year: 'numeric'
                  })}
                </span>
              </div>
            )}
            {infoCard.project.effectiveEnd && (
              <div className="info-card-date">
                <span className="date-label">Deadline</span>
                <span className="date-value">
                  {infoCard.project.effectiveEnd.toLocaleDateString('en-US', { 
                    month: 'short', 
                    day: 'numeric',
                    year: 'numeric'
                  })}
                </span>
              </div>
            )}
            {infoCard.project.daysRemaining !== null && (
              <div className={`info-card-date ${infoCard.project.timelineStatus}`}>
                <span className="date-label">Time Left</span>
                <span className="date-value">
                  {infoCard.project.daysRemaining > 0 
                    ? `${infoCard.project.daysRemaining} days`
                    : infoCard.project.daysRemaining < 0 
                      ? `${Math.abs(infoCard.project.daysRemaining)} days overdue`
                      : 'Due today'}
                </span>
              </div>
            )}
          </div>
          
          <div className="info-card-stats">
            <div className="info-card-stat">
              <span className="stat-value">{infoCard.project.progress}%</span>
              <span className="stat-label">Progress</span>
              <div className="stat-bar">
                <div className="stat-bar-fill" style={{ width: `${infoCard.project.progress}%` }} />
              </div>
            </div>
            <div className="info-card-stat-row">
              <div className="info-card-stat-item">
                <span className="stat-num">{infoCard.project.completed}</span>
                <span className="stat-desc">Completed</span>
              </div>
              <div className="info-card-stat-item">
                <span className="stat-num">{infoCard.project.total - infoCard.project.completed}</span>
                <span className="stat-desc">Remaining</span>
              </div>
              {infoCard.project.urgent > 0 && (
                <div className="info-card-stat-item urgent">
                  <span className="stat-num">{infoCard.project.urgent}</span>
                  <span className="stat-desc">Urgent</span>
                </div>
              )}
              {infoCard.project.overdue > 0 && (
                <div className="info-card-stat-item overdue">
                  <span className="stat-num">{infoCard.project.overdue}</span>
                  <span className="stat-desc">Overdue</span>
                </div>
              )}
            </div>
          </div>
          
          <div className="info-card-actions">
            <button 
              className="info-card-action primary"
              onClick={() => {
                onOpenProjectWorkspace?.(infoCard.project.id);
                setInfoCard(null);
              }}
            >
              Open Project
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectTimeline;
