import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import type { Project, Task } from '@shared/types';

interface GanttChartProps {
  projects: Project[];
  tasks: Task[];
  completedStatus?: string;
  onSelectProject?: (projectId: string | null) => void;
  onUpdateProject?: (projectId: string, updates: { startDate?: string; endDate?: string }) => void;
  selectedProjectId?: string | null;
  onSelectTask?: (taskId: string) => void;
}

interface ProjectInsight {
  project: Project;
  tasks: Task[];
  openTasks: Task[];
  completedTasks: Task[];
  progress: number;
  startDate: Date | null;
  endDate: Date | null;
  timelineStatus: 'upcoming' | 'active' | 'overdue' | 'completed' | 'no-dates';
  daysRemaining: number | null;
  color: string;
}

// Color palette for projects - vibrant, distinguishable colors
const PROJECT_COLORS = [
  { bg: 'rgba(239, 68, 68, 0.35)', border: '#ef4444', light: '#fca5a5' },   // Red
  { bg: 'rgba(249, 115, 22, 0.35)', border: '#f97316', light: '#fdba74' },  // Orange
  { bg: 'rgba(234, 179, 8, 0.4)', border: '#eab308', light: '#fde047' },    // Yellow
  { bg: 'rgba(34, 197, 94, 0.35)', border: '#22c55e', light: '#86efac' },   // Green
  { bg: 'rgba(6, 182, 212, 0.35)', border: '#06b6d4', light: '#67e8f9' },   // Cyan
  { bg: 'rgba(59, 130, 246, 0.35)', border: '#3b82f6', light: '#93c5fd' },  // Blue
  { bg: 'rgba(139, 92, 246, 0.35)', border: '#8b5cf6', light: '#c4b5fd' },  // Violet
  { bg: 'rgba(236, 72, 153, 0.35)', border: '#ec4899', light: '#f9a8d4' },  // Pink
  { bg: 'rgba(168, 85, 247, 0.35)', border: '#a855f7', light: '#d8b4fe' },  // Purple
  { bg: 'rgba(20, 184, 166, 0.35)', border: '#14b8a6', light: '#5eead4' },  // Teal
];

const DAY_WIDTH = 24; // Width of each day in pixels
const ROW_HEIGHT = 40;
const SIDEBAR_WIDTH = 220;
const MIN_BAR_WIDTH = 20;

const formatDate = (date: Date): string => {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });
};

const formatFullDate = (date: Date): string => {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
};

const toISODateString = (date: Date): string => {
  return date.toISOString().split('T')[0];
};

const GanttChart = ({
  projects,
  tasks,
  completedStatus,
  onSelectProject,
  onUpdateProject,
  selectedProjectId,
  onSelectTask
}: GanttChartProps) => {
  const [zoomLevel, setZoomLevel] = useState<'week' | 'month' | 'quarter'>('month');
  const [hoveredProjectId, setHoveredProjectId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<{
    projectId: string;
    type: 'move' | 'resize-start' | 'resize-end';
    initialStartDate: Date | null;
    initialEndDate: Date | null;
    startX: number;
    currentX: number;
  } | null>(null);
  const [timelineOffset, setTimelineOffset] = useState(0);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Build project insights with colors
  const projectInsights = useMemo(() => {
    const tasksByProject = new Map<string, Task[]>();
    
    tasks.forEach((task) => {
      const projectIds = task.projectIds ?? [];
      projectIds.forEach((projectId) => {
        const bucket = tasksByProject.get(projectId) ?? [];
        bucket.push(task);
        tasksByProject.set(projectId, bucket);
      });
    });

    return projects.map((project, index) => {
      const projectTasks = tasksByProject.get(project.id) ?? [];
      const openTasks = projectTasks.filter(
        (t) => t.normalizedStatus !== 'complete'
      );
      const completedTasks = projectTasks.filter(
        (t) => t.normalizedStatus === 'complete'
      );
      
      const startDate = project.startDate ? new Date(project.startDate) : null;
      const endDate = project.endDate ? new Date(project.endDate) : null;
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      
      let timelineStatus: ProjectInsight['timelineStatus'] = 'no-dates';
      let daysRemaining: number | null = null;
      
      if (startDate && endDate) {
        if (now < startDate) {
          timelineStatus = 'upcoming';
          daysRemaining = Math.ceil((startDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        } else if (now > endDate) {
          timelineStatus = openTasks.length > 0 ? 'overdue' : 'completed';
          daysRemaining = -Math.floor((now.getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24));
        } else {
          timelineStatus = 'active';
          daysRemaining = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        }
      } else if (endDate) {
        if (now > endDate) {
          timelineStatus = openTasks.length > 0 ? 'overdue' : 'completed';
          daysRemaining = -Math.floor((now.getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24));
        } else {
          timelineStatus = 'active';
          daysRemaining = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        }
      }

      // Assign color based on project index
      const colorIndex = index % PROJECT_COLORS.length;
      const color = PROJECT_COLORS[colorIndex];

      return {
        project,
        tasks: projectTasks,
        openTasks,
        completedTasks,
        progress: projectTasks.length
          ? completedTasks.length / projectTasks.length
          : 0,
        startDate,
        endDate,
        timelineStatus,
        daysRemaining,
        color: color.border
      } as ProjectInsight & { color: string };
    }).sort((a, b) => {
      // Sort by end date, then start date
      const aEnd = a.endDate?.getTime() ?? Infinity;
      const bEnd = b.endDate?.getTime() ?? Infinity;
      if (aEnd !== bEnd) return aEnd - bEnd;
      const aStart = a.startDate?.getTime() ?? Infinity;
      const bStart = b.startDate?.getTime() ?? Infinity;
      return aStart - bStart;
    });
  }, [projects, tasks, completedStatus]);

  // Calculate timeline bounds
  const ganttBounds = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    
    // Calculate visible range based on zoom level
    const visibleDays = zoomLevel === 'week' ? 42 : zoomLevel === 'month' ? 90 : 180;
    
    const start = new Date(now);
    start.setDate(start.getDate() + timelineOffset - Math.floor(visibleDays / 4));
    
    const end = new Date(start);
    end.setDate(end.getDate() + visibleDays);
    
    return { start, end, totalDays: visibleDays, now };
  }, [zoomLevel, timelineOffset]);

  // Calculate total timeline width in pixels
  const timelineWidth = ganttBounds.totalDays * DAY_WIDTH;

  // Generate days array
  const days = useMemo(() => {
    const result: Date[] = [];
    const current = new Date(ganttBounds.start);
    while (current <= ganttBounds.end) {
      result.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    return result;
  }, [ganttBounds]);

  // Generate month headers
  const monthHeaders = useMemo(() => {
    const months: { label: string; startIndex: number; days: number }[] = [];
    let currentMonth = '';
    
    days.forEach((day, index) => {
      const monthLabel = day.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      if (monthLabel !== currentMonth) {
        months.push({ label: monthLabel, startIndex: index, days: 1 });
        currentMonth = monthLabel;
      } else {
        months[months.length - 1].days++;
      }
    });
    
    return months;
  }, [days]);

  // Today's position
  const todayIndex = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return days.findIndex(d => d.toDateString() === today.toDateString());
  }, [days]);

  // Scroll to today on mount
  useEffect(() => {
    if (bodyScrollRef.current && todayIndex >= 0) {
      const scrollPosition = todayIndex * DAY_WIDTH - bodyScrollRef.current.clientWidth / 3;
      bodyScrollRef.current.scrollLeft = Math.max(0, scrollPosition);
      if (headerScrollRef.current) {
        headerScrollRef.current.scrollLeft = Math.max(0, scrollPosition);
      }
    }
  }, [todayIndex]);

  // Sync header and body scroll (horizontal) and sidebar (vertical)
  const handleBodyScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (headerScrollRef.current) {
      headerScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
    if (sidebarRef.current) {
      sidebarRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  }, []);

  // Sync sidebar scroll to timeline (vertical)
  const handleSidebarScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (bodyScrollRef.current) {
      bodyScrollRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  }, []);

  // Jump to today
  const jumpToToday = useCallback(() => {
    setTimelineOffset(0);
    setTimeout(() => {
      if (bodyScrollRef.current && todayIndex >= 0) {
        const scrollPosition = todayIndex * DAY_WIDTH - bodyScrollRef.current.clientWidth / 3;
        bodyScrollRef.current.scrollLeft = Math.max(0, scrollPosition);
        if (headerScrollRef.current) {
          headerScrollRef.current.scrollLeft = Math.max(0, scrollPosition);
        }
      }
    }, 50);
  }, [todayIndex]);

  // Navigate timeline
  const navigate = useCallback((direction: -1 | 1) => {
    const amount = zoomLevel === 'week' ? 7 : zoomLevel === 'month' ? 14 : 30;
    setTimelineOffset(prev => prev + direction * amount);
  }, [zoomLevel]);

  // Convert date to pixel position
  const dateToPixel = useCallback((date: Date): number => {
    const daysDiff = Math.floor((date.getTime() - ganttBounds.start.getTime()) / (1000 * 60 * 60 * 24));
    return daysDiff * DAY_WIDTH;
  }, [ganttBounds.start]);

  // Convert pixel to date
  const pixelToDate = useCallback((pixel: number): Date => {
    const daysDiff = Math.round(pixel / DAY_WIDTH);
    const date = new Date(ganttBounds.start);
    date.setDate(date.getDate() + daysDiff);
    return date;
  }, [ganttBounds.start]);

  // Handle resize/drag start
  const handleDragStart = useCallback((
    e: React.PointerEvent,
    projectId: string,
    type: 'move' | 'resize-start' | 'resize-end',
    startDate: Date | null,
    endDate: Date | null
  ) => {
    e.preventDefault();
    e.stopPropagation();
    
    setDragState({
      projectId,
      type,
      initialStartDate: startDate,
      initialEndDate: endDate,
      startX: e.clientX,
      currentX: e.clientX
    });

    // Add global listeners
    const handleMove = (moveEvent: PointerEvent) => {
      setDragState(prev => prev ? { ...prev, currentX: moveEvent.clientX } : null);
    };

    const handleUp = () => {
      setDragState(prev => {
        if (prev && onUpdateProject) {
          const pixelDelta = prev.currentX - prev.startX;
          const daysDelta = Math.round(pixelDelta / DAY_WIDTH);
          
          if (daysDelta !== 0) {
            if (prev.type === 'resize-start' && prev.initialStartDate) {
              const newStart = new Date(prev.initialStartDate);
              newStart.setDate(newStart.getDate() + daysDelta);
              // Don't allow start after end
              if (!prev.initialEndDate || newStart < prev.initialEndDate) {
                onUpdateProject(prev.projectId, { startDate: toISODateString(newStart) });
              }
            } else if (prev.type === 'resize-end' && prev.initialEndDate) {
              const newEnd = new Date(prev.initialEndDate);
              newEnd.setDate(newEnd.getDate() + daysDelta);
              // Don't allow end before start
              if (!prev.initialStartDate || newEnd > prev.initialStartDate) {
                onUpdateProject(prev.projectId, { endDate: toISODateString(newEnd) });
              }
            } else if (prev.type === 'move' && prev.initialStartDate && prev.initialEndDate) {
              const newStart = new Date(prev.initialStartDate);
              const newEnd = new Date(prev.initialEndDate);
              newStart.setDate(newStart.getDate() + daysDelta);
              newEnd.setDate(newEnd.getDate() + daysDelta);
              onUpdateProject(prev.projectId, {
                startDate: toISODateString(newStart),
                endDate: toISODateString(newEnd)
              });
            }
          }
        }
        return null;
      });
      
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
    };

    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
  }, [onUpdateProject]);

  // Calculate bar position with drag offset
  const getBarPosition = useCallback((insight: ProjectInsight, index: number) => {
    const isDragging = dragState?.projectId === insight.project.id;
    let startDate = insight.startDate;
    let endDate = insight.endDate;
    
    if (isDragging && dragState) {
      const pixelDelta = dragState.currentX - dragState.startX;
      const daysDelta = Math.round(pixelDelta / DAY_WIDTH);
      
      if (dragState.type === 'resize-start' && dragState.initialStartDate) {
        const newStart = new Date(dragState.initialStartDate);
        newStart.setDate(newStart.getDate() + daysDelta);
        startDate = newStart;
      } else if (dragState.type === 'resize-end' && dragState.initialEndDate) {
        const newEnd = new Date(dragState.initialEndDate);
        newEnd.setDate(newEnd.getDate() + daysDelta);
        endDate = newEnd;
      } else if (dragState.type === 'move' && dragState.initialStartDate && dragState.initialEndDate) {
        const newStart = new Date(dragState.initialStartDate);
        const newEnd = new Date(dragState.initialEndDate);
        newStart.setDate(newStart.getDate() + daysDelta);
        newEnd.setDate(newEnd.getDate() + daysDelta);
        startDate = newStart;
        endDate = newEnd;
      }
    }

    if (!startDate && !endDate) return null;
    
    // If only end date, create a small bar at the end
    if (!startDate && endDate) {
      const left = dateToPixel(endDate) - MIN_BAR_WIDTH;
      return { left, width: MIN_BAR_WIDTH, startDate: null, endDate };
    }
    
    // If only start date, create a bar extending to "now" or a default width
    if (startDate && !endDate) {
      const left = dateToPixel(startDate);
      const now = new Date();
      const width = Math.max(MIN_BAR_WIDTH, dateToPixel(now) - left);
      return { left, width, startDate, endDate: null };
    }
    
    const left = dateToPixel(startDate!);
    const right = dateToPixel(endDate!);
    const width = Math.max(MIN_BAR_WIDTH, right - left);
    
    return { left, width, startDate, endDate };
  }, [dateToPixel, dragState]);

  // Get bar style for a project
  const getBarStyle = useCallback((insight: ProjectInsight, index: number) => {
    const colorSet = PROJECT_COLORS[index % PROJECT_COLORS.length];
    
    if (insight.timelineStatus === 'overdue') {
      return {
        background: 'rgba(239, 68, 68, 0.4)',
        borderColor: '#ef4444',
        textColor: '#fca5a5'
      };
    }
    if (insight.timelineStatus === 'completed') {
      return {
        background: 'rgba(107, 114, 128, 0.35)',
        borderColor: '#6b7280',
        textColor: '#9ca3af'
      };
    }
    
    return {
      background: colorSet.bg,
      borderColor: colorSet.border,
      textColor: colorSet.light
    };
  }, []);

  if (projects.length === 0) {
    return (
      <div className="gantt-v2-empty">
        <div className="gantt-empty-icon">📊</div>
        <h3>No Projects</h3>
        <p>Add projects with dates to see them on the timeline.</p>
      </div>
    );
  }

  const projectsWithDates = projectInsights.filter(p => p.startDate || p.endDate);
  const projectsWithoutDates = projectInsights.filter(p => !p.startDate && !p.endDate);

  return (
    <div className="gantt-v3" ref={containerRef}>
      {/* Controls */}
      <div className="gantt-v3-controls">
        <div className="gantt-v3-nav">
          <button
            type="button"
            className="gantt-nav-btn"
            onClick={() => navigate(-1)}
          >
            ← {zoomLevel === 'week' ? '1w' : zoomLevel === 'month' ? '2w' : '1m'}
          </button>
          <button
            type="button"
            className="gantt-today-btn"
            onClick={jumpToToday}
          >
            Today
          </button>
          <button
            type="button"
            className="gantt-nav-btn"
            onClick={() => navigate(1)}
          >
            {zoomLevel === 'week' ? '1w' : zoomLevel === 'month' ? '2w' : '1m'} →
          </button>
        </div>
        <div className="gantt-v3-zoom">
          {(['week', 'month', 'quarter'] as const).map(level => (
            <button
              key={level}
              type="button"
              className={zoomLevel === level ? 'active' : ''}
              onClick={() => setZoomLevel(level)}
            >
              {level.charAt(0).toUpperCase() + level.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Main grid area */}
      <div className="gantt-v3-grid">
        {/* Header row */}
        <div className="gantt-v3-header">
          {/* Sidebar header */}
          <div className="gantt-v3-sidebar-header" style={{ width: SIDEBAR_WIDTH }}>
            Project
          </div>
          {/* Timeline header (scrollable) */}
          <div className="gantt-v3-timeline-header" ref={headerScrollRef}>
            <div className="gantt-v3-timeline-scroll" style={{ width: timelineWidth }}>
              {/* Month row */}
              <div className="gantt-v3-months">
                {monthHeaders.map((month, i) => (
                  <div
                    key={i}
                    className="gantt-v3-month"
                    style={{
                      left: month.startIndex * DAY_WIDTH,
                      width: month.days * DAY_WIDTH
                    }}
                  >
                    {month.label}
                  </div>
                ))}
              </div>
              {/* Days row */}
              <div className="gantt-v3-days">
                {days.map((day, i) => {
                  const isToday = i === todayIndex;
                  const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                  
                  return (
                    <div
                      key={i}
                      className={`gantt-v3-day ${isToday ? 'is-today' : ''} ${isWeekend ? 'is-weekend' : ''}`}
                      style={{ width: DAY_WIDTH }}
                    >
                      {day.getDate()}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Body area */}
        <div className="gantt-v3-body">
          {/* Sidebar (fixed) */}
          <div 
            className="gantt-v3-sidebar" 
            style={{ width: SIDEBAR_WIDTH }}
            ref={sidebarRef}
            onScroll={handleSidebarScroll}
          >
            {projectsWithDates.map((insight, index) => {
              const { project, openTasks, timelineStatus, daysRemaining } = insight;
              const isSelected = selectedProjectId === project.id;
              const isHovered = hoveredProjectId === project.id;
              const colorSet = PROJECT_COLORS[index % PROJECT_COLORS.length];

              return (
                <div
                  key={project.id}
                  className={`gantt-v3-sidebar-row ${isSelected ? 'is-selected' : ''} ${isHovered ? 'is-hovered' : ''}`}
                  style={{ height: ROW_HEIGHT }}
                  onClick={() => onSelectProject?.(isSelected ? null : project.id)}
                  onMouseEnter={() => setHoveredProjectId(project.id)}
                  onMouseLeave={() => setHoveredProjectId(null)}
                >
                  <span className="gantt-v3-emoji">{project.emoji || '📁'}</span>
                  <span 
                    className="gantt-v3-status-dot" 
                    style={{ background: colorSet.border }}
                  />
                  <span className="gantt-v3-project-title">{project.title || 'Untitled'}</span>
                  <span className="gantt-v3-task-count">{openTasks.length}</span>
                </div>
              );
            })}

            {/* Projects without dates */}
            {projectsWithoutDates.length > 0 && (
              <>
                <div className="gantt-v3-no-dates-divider">
                  No Dates ({projectsWithoutDates.length})
                </div>
                {projectsWithoutDates.map((insight) => {
                  const { project, openTasks } = insight;
                  const isSelected = selectedProjectId === project.id;

                  return (
                    <div
                      key={project.id}
                      className={`gantt-v3-sidebar-row no-dates ${isSelected ? 'is-selected' : ''}`}
                      style={{ height: ROW_HEIGHT }}
                      onClick={() => onSelectProject?.(project.id)}
                    >
                      <span className="gantt-v3-emoji">{project.emoji || '📁'}</span>
                      <span className="gantt-v3-project-title">{project.title || 'Untitled'}</span>
                      <span className="gantt-v3-task-count">{openTasks.length}</span>
                    </div>
                  );
                })}
              </>
            )}
          </div>

          {/* Timeline (scrollable) */}
          <div 
            className="gantt-v3-timeline" 
            ref={bodyScrollRef}
            onScroll={handleBodyScroll}
          >
            <div className="gantt-v3-timeline-scroll" style={{ width: timelineWidth }}>
              {/* Grid lines */}
              <div className="gantt-v3-grid-lines">
                {days.map((day, i) => {
                  const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                  const isMonthStart = day.getDate() === 1;
                  
                  return (
                    <div
                      key={i}
                      className={`gantt-v3-grid-line ${isWeekend ? 'is-weekend' : ''} ${isMonthStart ? 'is-month' : ''}`}
                      style={{ left: i * DAY_WIDTH, width: DAY_WIDTH }}
                    />
                  );
                })}
              </div>

              {/* Today line */}
              {todayIndex >= 0 && (
                <div 
                  className="gantt-v3-today-line"
                  style={{ left: todayIndex * DAY_WIDTH + DAY_WIDTH / 2 }}
                />
              )}

              {/* Drag indicator */}
              {dragState && (
                <div className="gantt-v3-drag-indicator">
                  <div 
                    className="gantt-v3-drag-date"
                    style={{ 
                      left: Math.max(0, dragState.currentX - (bodyScrollRef.current?.getBoundingClientRect().left ?? 0) + (bodyScrollRef.current?.scrollLeft ?? 0))
                    }}
                  >
                    {formatFullDate(pixelToDate(dragState.currentX - (bodyScrollRef.current?.getBoundingClientRect().left ?? 0) + (bodyScrollRef.current?.scrollLeft ?? 0)))}
                  </div>
                </div>
              )}

              {/* Project bars */}
              {projectsWithDates.map((insight, index) => {
                const { project, progress, timelineStatus, tasks: projectTasks } = insight;
                const isSelected = selectedProjectId === project.id;
                const isHovered = hoveredProjectId === project.id;
                const isDragging = dragState?.projectId === project.id;
                
                const barPos = getBarPosition(insight, index);
                const barStyle = getBarStyle(insight, index);

                return (
                  <div
                    key={project.id}
                    className={`gantt-v3-row ${isSelected ? 'is-selected' : ''} ${isHovered ? 'is-hovered' : ''} ${isDragging ? 'is-dragging' : ''}`}
                    style={{ height: ROW_HEIGHT }}
                    onMouseEnter={() => setHoveredProjectId(project.id)}
                    onMouseLeave={() => setHoveredProjectId(null)}
                  >
                    {/* Task markers */}
                    {projectTasks.map((task) => {
                      if (!task.dueDate) return null;
                      const taskDate = new Date(task.dueDate);
                      const taskLeft = dateToPixel(taskDate);
                      if (taskLeft < 0 || taskLeft > timelineWidth) return null;
                      
                      const isComplete = task.normalizedStatus === 'complete';
                      const isOverdue = !isComplete && taskDate < new Date();
                      
                      return (
                        <div
                          key={task.id}
                          className={`gantt-v3-task-marker ${isComplete ? 'completed' : ''} ${isOverdue ? 'overdue' : ''}`}
                          style={{ left: taskLeft }}
                          title={`${task.title}\n${formatDate(taskDate)}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectTask?.(task.id);
                          }}
                        />
                      );
                    })}

                    {/* Project bar */}
                    {barPos && (
                      <div
                        className={`gantt-v3-bar ${timelineStatus} ${isDragging ? 'is-dragging' : ''}`}
                        style={{
                          left: barPos.left,
                          width: barPos.width,
                          background: barStyle.background,
                          borderColor: barStyle.borderColor
                        }}
                        onClick={() => onSelectProject?.(isSelected ? null : project.id)}
                      >
                        {/* Progress fill */}
                        <div 
                          className="gantt-v3-bar-progress"
                          style={{ width: `${progress * 100}%` }}
                        />
                        
                        {/* Start resize handle */}
                        {insight.startDate && (
                          <div 
                            className="gantt-v3-bar-handle gantt-v3-bar-handle-start"
                            onPointerDown={(e) => handleDragStart(
                              e, 
                              project.id, 
                              'resize-start',
                              insight.startDate,
                              insight.endDate
                            )}
                          />
                        )}
                        
                        {/* Move handle (center) */}
                        {insight.startDate && insight.endDate && (
                          <div 
                            className="gantt-v3-bar-move"
                            onPointerDown={(e) => handleDragStart(
                              e, 
                              project.id, 
                              'move',
                              insight.startDate,
                              insight.endDate
                            )}
                          />
                        )}
                        
                        {/* End resize handle */}
                        {insight.endDate && (
                          <div 
                            className="gantt-v3-bar-handle gantt-v3-bar-handle-end"
                            onPointerDown={(e) => handleDragStart(
                              e, 
                              project.id, 
                              'resize-end',
                              insight.startDate,
                              insight.endDate
                            )}
                          />
                        )}
                        
                        {/* Bar content - dates and days remaining */}
                        {barPos.width > 80 && (
                          <div className="gantt-v3-bar-content">
                            {insight.daysRemaining !== null && (
                              <span className={`gantt-v3-bar-days ${insight.daysRemaining < 0 ? 'overdue' : insight.daysRemaining <= 7 ? 'soon' : ''}`}>
                                {insight.daysRemaining > 0 
                                  ? `${insight.daysRemaining}d` 
                                  : insight.daysRemaining < 0 
                                    ? `${Math.abs(insight.daysRemaining)}d over` 
                                    : 'Today'}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Spacer rows for projects without dates */}
              {projectsWithoutDates.length > 0 && (
                <>
                  <div className="gantt-v3-no-dates-spacer" style={{ height: ROW_HEIGHT }} />
                  {projectsWithoutDates.map((insight) => (
                    <div
                      key={insight.project.id}
                      className="gantt-v3-row no-dates"
                      style={{ height: ROW_HEIGHT }}
                    />
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GanttChart;
