import { useCallback, useMemo, useState } from 'react';
import type { Project, Task } from '@shared/types';

interface Props {
  projects: Project[];
  tasks: Task[];
  onSelectProject?: (projectId: string) => void;
  onOpenProjectWorkspace?: (projectId: string) => void;
  selectedProjectId?: string | null;
}

// Health severity levels
type AttentionLevel = 'critical' | 'warning' | 'watch' | 'healthy';
type MomentumTrend = 'accelerating' | 'steady' | 'slowing' | 'stalled';

interface ProjectHealthData {
  project: Project;
  attentionLevel: AttentionLevel;
  attentionReasons: string[];
  healthScore: number;
  totalTasks: number;
  completedTasks: number;
  remainingTasks: number;
  overdueTasks: number;
  urgentTasks: number;
  tasksCompletedThisWeek: number;
  tasksCompletedLastWeek: number;
  progressPercent: number;
  daysRemaining: number | null;
  deadlineDate: string | null;
  deadlineRisk: 'on-track' | 'at-risk' | 'critical' | 'no-deadline';
  estimatedDaysNeeded: number | null;
  momentum: MomentumTrend;
  daysSinceLastCompletion: number | null;
  velocityPerDay: number;
  nextAction: Task | null;
  actionableInsight: string | null;
}

interface TimelineItem {
  date: Date;
  label: string;
  project: Project;
  type: 'deadline' | 'task' | 'milestone';
  urgency: 'critical' | 'warning' | 'normal';
  description: string;
}

const ATTENTION_CONFIG: Record<AttentionLevel, { 
  label: string; 
  icon: string; 
  color: string; 
  bg: string;
  bgSolid: string;
}> = {
  critical: { 
    label: 'Critical', 
    icon: '🔴', 
    color: '#ef4444', 
    bg: 'rgba(239, 68, 68, 0.08)',
    bgSolid: 'rgba(239, 68, 68, 0.12)'
  },
  warning: { 
    label: 'Warning', 
    icon: '🟡', 
    color: '#fbbf24', 
    bg: 'rgba(251, 191, 36, 0.08)',
    bgSolid: 'rgba(251, 191, 36, 0.12)'
  },
  watch: { 
    label: 'Watch', 
    icon: '🔵', 
    color: '#3b82f6', 
    bg: 'rgba(59, 130, 246, 0.08)',
    bgSolid: 'rgba(59, 130, 246, 0.12)'
  },
  healthy: { 
    label: 'Healthy', 
    icon: '🟢', 
    color: '#22c55e', 
    bg: 'rgba(34, 197, 94, 0.08)',
    bgSolid: 'rgba(34, 197, 94, 0.12)'
  }
};

const MOMENTUM_CONFIG: Record<MomentumTrend, { icon: string; label: string; color: string }> = {
  accelerating: { icon: '🚀', label: 'Accelerating', color: '#22c55e' },
  steady: { icon: '→', label: 'Steady', color: '#94a3b8' },
  slowing: { icon: '📉', label: 'Slowing', color: '#fbbf24' },
  stalled: { icon: '⏸️', label: 'Stalled', color: '#ef4444' }
};

const ProjectHealth = ({
  projects,
  tasks,
  onSelectProject,
  onOpenProjectWorkspace,
  selectedProjectId
}: Props) => {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [collapsedLevels, setCollapsedLevels] = useState<Set<AttentionLevel>>(new Set());

  // Calculate health data for each project
  const projectHealthData = useMemo((): ProjectHealthData[] => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const oneWeekAgo = new Date(today);
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const twoWeeksAgo = new Date(today);
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    return projects.map(project => {
      const projectTasks = tasks.filter(t => (t.projectIds ?? []).includes(project.id));
      const completedTasks = projectTasks.filter(t => t.normalizedStatus === 'complete');
      const incompleteTasks = projectTasks.filter(t => t.normalizedStatus !== 'complete');
      const totalTasks = projectTasks.length;
      const remainingTasks = incompleteTasks.length;
      
      const overdueTasks = incompleteTasks.filter(t => 
        t.dueDate && new Date(t.dueDate) < today
      ).length;
      const urgentTasks = incompleteTasks.filter(t => t.urgent).length;
      
      const progressPercent = totalTasks > 0 
        ? Math.round((completedTasks.length / totalTasks) * 100) 
        : 0;
      
      let daysRemaining: number | null = null;
      let deadlineDate: string | null = null;
      if (project.endDate) {
        deadlineDate = project.endDate;
        const deadline = new Date(project.endDate);
        deadline.setHours(0, 0, 0, 0);
        daysRemaining = Math.round((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      }
      
      const tasksCompletedThisWeek = completedTasks.filter(t => {
        const completionDate = t.lastEdited ? new Date(t.lastEdited) : null;
        return completionDate && completionDate >= oneWeekAgo && completionDate < today;
      }).length;
      
      const tasksCompletedLastWeek = completedTasks.filter(t => {
        const completionDate = t.lastEdited ? new Date(t.lastEdited) : null;
        return completionDate && completionDate >= twoWeeksAgo && completionDate < oneWeekAgo;
      }).length;
      
      const velocityPerDay = (tasksCompletedThisWeek + tasksCompletedLastWeek) / 14;
      
      let estimatedDaysNeeded: number | null = null;
      if (velocityPerDay > 0 && remainingTasks > 0) {
        estimatedDaysNeeded = Math.ceil(remainingTasks / velocityPerDay);
      } else if (remainingTasks > 0) {
        estimatedDaysNeeded = null;
      } else {
        estimatedDaysNeeded = 0;
      }
      
      let daysSinceLastCompletion: number | null = null;
      const sortedCompleted = completedTasks
        .filter(t => t.lastEdited)
        .sort((a, b) => new Date(b.lastEdited!).getTime() - new Date(a.lastEdited!).getTime());
      if (sortedCompleted.length > 0 && sortedCompleted[0].lastEdited) {
        const lastDate = new Date(sortedCompleted[0].lastEdited);
        daysSinceLastCompletion = Math.floor((today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
      }
      
      let momentum: MomentumTrend;
      if (daysSinceLastCompletion !== null && daysSinceLastCompletion > 7) {
        momentum = 'stalled';
      } else if (tasksCompletedThisWeek > tasksCompletedLastWeek * 1.2) {
        momentum = 'accelerating';
      } else if (tasksCompletedThisWeek < tasksCompletedLastWeek * 0.8) {
        momentum = 'slowing';
      } else {
        momentum = 'steady';
      }
      
      let deadlineRisk: 'on-track' | 'at-risk' | 'critical' | 'no-deadline';
      if (daysRemaining === null) {
        deadlineRisk = 'no-deadline';
      } else if (daysRemaining < 0) {
        deadlineRisk = 'critical';
      } else if (estimatedDaysNeeded !== null && estimatedDaysNeeded > daysRemaining) {
        deadlineRisk = estimatedDaysNeeded > daysRemaining * 1.5 ? 'critical' : 'at-risk';
      } else if (daysRemaining <= 7 && progressPercent < 80) {
        deadlineRisk = 'at-risk';
      } else {
        deadlineRisk = 'on-track';
      }
      
      const attentionReasons: string[] = [];
      let attentionLevel: AttentionLevel = 'healthy';
      
      // Critical
      if (daysRemaining !== null && daysRemaining < 0) {
        attentionReasons.push(`${Math.abs(daysRemaining)}d overdue`);
        attentionLevel = 'critical';
      }
      if (overdueTasks > 3) {
        attentionReasons.push(`${overdueTasks} overdue tasks`);
        attentionLevel = 'critical';
      }
      if (deadlineRisk === 'critical' && daysRemaining !== null && daysRemaining >= 0) {
        attentionReasons.push(`Will miss deadline`);
        if (attentionLevel !== 'critical') attentionLevel = 'critical';
      }
      
      // Warning
      if (attentionLevel !== 'critical') {
        if (overdueTasks > 0 && overdueTasks <= 3) {
          attentionReasons.push(`${overdueTasks} overdue`);
          attentionLevel = 'warning';
        }
        if (momentum === 'stalled' && remainingTasks > 0) {
          attentionReasons.push(`Stalled ${daysSinceLastCompletion}d`);
          if (attentionLevel !== 'warning') attentionLevel = 'warning';
        }
        if (deadlineRisk === 'at-risk') {
          attentionReasons.push('At risk');
          if (attentionLevel !== 'warning') attentionLevel = 'warning';
        }
      }
      
      // Watch
      if (attentionLevel === 'healthy') {
        if (momentum === 'slowing') {
          attentionReasons.push('Slowing');
          attentionLevel = 'watch';
        }
        if (daysRemaining !== null && daysRemaining <= 14 && remainingTasks > 0) {
          attentionReasons.push(`${daysRemaining}d left`);
          attentionLevel = 'watch';
        }
        if (urgentTasks > 0) {
          attentionReasons.push(`${urgentTasks} urgent`);
          attentionLevel = 'watch';
        }
      }
      
      let healthScore = 100;
      if (overdueTasks > 0) healthScore -= Math.min(30, overdueTasks * 10);
      if (deadlineRisk === 'critical') healthScore -= 25;
      else if (deadlineRisk === 'at-risk') healthScore -= 15;
      if (momentum === 'stalled') healthScore -= 20;
      else if (momentum === 'slowing') healthScore -= 10;
      if (urgentTasks > 0) healthScore -= Math.min(15, urgentTasks * 5);
      healthScore = Math.max(0, healthScore);
      
      const nextAction = incompleteTasks
        .sort((a, b) => {
          const aOverdue = a.dueDate && new Date(a.dueDate) < today;
          const bOverdue = b.dueDate && new Date(b.dueDate) < today;
          if (aOverdue && !bOverdue) return -1;
          if (!aOverdue && bOverdue) return 1;
          if (a.urgent && !b.urgent) return -1;
          if (!a.urgent && b.urgent) return 1;
          if (a.dueDate && b.dueDate) {
            return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
          }
          if (a.dueDate) return -1;
          if (b.dueDate) return 1;
          return 0;
        })[0] || null;
      
      // Generate actionable insight
      let actionableInsight: string | null = null;
      if (attentionLevel === 'critical') {
        if (overdueTasks > 0) {
          actionableInsight = `Clear ${overdueTasks} overdue task${overdueTasks > 1 ? 's' : ''} to restore momentum`;
        } else if (daysRemaining !== null && daysRemaining < 0) {
          actionableInsight = `Project is ${Math.abs(daysRemaining)} days past deadline - reassess scope or timeline`;
        } else if (deadlineRisk === 'critical') {
          const tasksPerDay = velocityPerDay > 0 ? velocityPerDay : 0.5;
          const neededPerDay = remainingTasks / Math.max(1, daysRemaining ?? 7);
          actionableInsight = `Need ${neededPerDay.toFixed(1)} tasks/day (current: ${tasksPerDay.toFixed(1)})`;
        }
      } else if (attentionLevel === 'warning') {
        if (momentum === 'stalled') {
          actionableInsight = `No completions in ${daysSinceLastCompletion}d - start with "${nextAction?.title || 'next task'}"`;
        } else if (overdueTasks > 0) {
          actionableInsight = `${overdueTasks} overdue - prioritize before taking on new work`;
        }
      } else if (attentionLevel === 'watch') {
        if (momentum === 'slowing') {
          actionableInsight = `Velocity dropped ${Math.round((1 - tasksCompletedThisWeek / Math.max(1, tasksCompletedLastWeek)) * 100)}% this week`;
        } else if (daysRemaining !== null && daysRemaining <= 14) {
          actionableInsight = `${daysRemaining}d remaining - maintain current pace`;
        }
      }
      
      return {
        project,
        attentionLevel,
        attentionReasons,
        healthScore,
        totalTasks,
        completedTasks: completedTasks.length,
        remainingTasks,
        overdueTasks,
        urgentTasks,
        tasksCompletedThisWeek,
        tasksCompletedLastWeek,
        progressPercent,
        daysRemaining,
        deadlineDate,
        deadlineRisk,
        estimatedDaysNeeded,
        momentum,
        daysSinceLastCompletion,
        velocityPerDay,
        nextAction,
        actionableInsight
      };
    });
  }, [projects, tasks]);

  // Group projects by attention level
  const groupedProjects = useMemo(() => {
    const groups: Record<AttentionLevel, ProjectHealthData[]> = {
      critical: [],
      warning: [],
      watch: [],
      healthy: []
    };
    
    projectHealthData.forEach(data => {
      groups[data.attentionLevel].push(data);
    });
    
    // Sort within each group by health score
    Object.keys(groups).forEach(level => {
      groups[level as AttentionLevel].sort((a, b) => a.healthScore - b.healthScore);
    });
    
    return groups;
  }, [projectHealthData]);

  // Generate timeline items for next 2 weeks
  const timelineItems = useMemo((): TimelineItem[] => {
    const items: TimelineItem[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const twoWeeksOut = new Date(today);
    twoWeeksOut.setDate(twoWeeksOut.getDate() + 14);
    
    projectHealthData.forEach(data => {
      // Add project deadlines
      if (data.deadlineDate) {
        const deadlineDate = new Date(data.deadlineDate);
        if (deadlineDate >= today && deadlineDate <= twoWeeksOut) {
          items.push({
            date: deadlineDate,
            label: `${data.project.emoji ? data.project.emoji + ' ' : ''}${data.project.title}`,
            project: data.project,
            type: 'deadline',
            urgency: data.daysRemaining !== null && data.daysRemaining <= 3 ? 'critical' : 
                     data.daysRemaining !== null && data.daysRemaining <= 7 ? 'warning' : 'normal',
            description: `Project deadline (${data.remainingTasks} tasks left)`
          });
        }
      }
      
      // Add overdue tasks
      if (data.overdueTasks > 0 && data.nextAction) {
        items.push({
          date: today,
          label: `${data.project.emoji ? data.project.emoji + ' ' : ''}${data.nextAction.title}`,
          project: data.project,
          type: 'task',
          urgency: 'critical',
          description: `Overdue task from ${data.project.title}`
        });
      }
      
      // Add upcoming urgent tasks
      if (data.nextAction && data.nextAction.dueDate && !data.overdueTasks) {
        const taskDue = new Date(data.nextAction.dueDate);
        if (taskDue >= today && taskDue <= twoWeeksOut) {
          items.push({
            date: taskDue,
            label: `${data.project.emoji ? data.project.emoji + ' ' : ''}${data.nextAction.title}`,
            project: data.project,
            type: 'task',
            urgency: data.nextAction.urgent ? 'warning' : 'normal',
            description: `Next action for ${data.project.title}`
          });
        }
      }
    });
    
    // Sort by date, then urgency
    items.sort((a, b) => {
      if (a.date.getTime() !== b.date.getTime()) {
        return a.date.getTime() - b.date.getTime();
      }
      const urgencyOrder = { critical: 0, warning: 1, normal: 2 };
      return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    });
    
    return items.slice(0, 8);
  }, [projectHealthData]);

  // Summary counts
  const summary = useMemo(() => ({
    critical: groupedProjects.critical.length,
    warning: groupedProjects.warning.length,
    watch: groupedProjects.watch.length,
    healthy: groupedProjects.healthy.length,
    totalProjects: projects.length,
    avgHealthScore: projectHealthData.length > 0 
      ? Math.round(projectHealthData.reduce((sum, p) => sum + p.healthScore, 0) / projectHealthData.length)
      : 0
  }), [groupedProjects, projectHealthData, projects.length]);

  const toggleExpanded = useCallback((projectId: string) => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }, []);

  const toggleLevelCollapsed = useCallback((level: AttentionLevel) => {
    setCollapsedLevels(prev => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }, []);

  const formatDate = (date: Date): string => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    if (date.getTime() === today.getTime()) return 'Today';
    if (date.getTime() === tomorrow.getTime()) return 'Tomorrow';
    
    const diffDays = Math.round((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return `${Math.abs(diffDays)}d ago`;
    if (diffDays <= 7) return date.toLocaleDateString(undefined, { weekday: 'short' });
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  // Pie chart calculations
  const pieData = useMemo(() => {
    const total = summary.totalProjects || 1;
    const segments: { level: AttentionLevel; count: number; percent: number; offset: number }[] = [];
    let offset = 0;
    
    (['critical', 'warning', 'watch', 'healthy'] as AttentionLevel[]).forEach(level => {
      const count = summary[level];
      const percent = (count / total) * 100;
      if (count > 0) {
        segments.push({ level, count, percent, offset });
        offset += percent;
      }
    });
    
    return segments;
  }, [summary]);

  const renderPieChart = () => {
    const radius = 42;
    const circumference = 2 * Math.PI * radius;
    
    return (
      <svg viewBox="0 0 100 100" className="health-pie-chart">
        {pieData.map((segment) => {
          const config = ATTENTION_CONFIG[segment.level];
          const dashArray = `${(segment.percent / 100) * circumference} ${circumference}`;
          const rotation = (segment.offset / 100) * 360 - 90;
          
          return (
            <circle
              key={segment.level}
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke={config.color}
              strokeWidth="12"
              strokeDasharray={dashArray}
              transform={`rotate(${rotation} 50 50)`}
              className="pie-segment"
            />
          );
        })}
        <circle cx="50" cy="50" r="32" fill="var(--notion-bg)" />
        <text x="50" y="47" textAnchor="middle" className="pie-center-num">
          {summary.totalProjects}
        </text>
        <text x="50" y="60" textAnchor="middle" className="pie-center-label">
          projects
        </text>
      </svg>
    );
  };

  const renderProjectCard = (data: ProjectHealthData) => {
    const config = ATTENTION_CONFIG[data.attentionLevel];
    const momentumConfig = MOMENTUM_CONFIG[data.momentum];
    const isExpanded = expandedProjects.has(data.project.id);
    const isSelected = selectedProjectId === data.project.id;
    
    // Calculate progress bar color
    const progressColor = data.progressPercent >= 80 ? '#22c55e' : 
                          data.progressPercent >= 50 ? '#fbbf24' : 
                          data.progressPercent >= 25 ? '#f97316' : '#ef4444';
    
    return (
      <div 
        key={data.project.id}
        className={`health-card-v6 ${isSelected ? 'is-selected' : ''} ${isExpanded ? 'is-expanded' : ''}`}
        onClick={() => toggleExpanded(data.project.id)}
      >
        {/* Main Card Content */}
        <div className="card-header-row">
          {data.project.emoji && <span className="card-emoji">{data.project.emoji}</span>}
          <div className="card-title-area">
            <span className="card-title">{data.project.title || 'Untitled'}</span>
            {data.daysRemaining !== null && (
              <span className={`card-deadline ${data.daysRemaining < 0 ? 'overdue' : data.daysRemaining <= 7 ? 'soon' : ''}`}>
                {data.daysRemaining < 0 ? `${Math.abs(data.daysRemaining)}d over` : `${data.daysRemaining}d left`}
              </span>
            )}
          </div>
          <button 
            type="button"
            className="card-open-btn"
            onClick={(e) => {
              e.stopPropagation();
              onOpenProjectWorkspace?.(data.project.id);
            }}
          >
            Open →
          </button>
        </div>

        {/* Progress Bar */}
        <div className="card-progress-section">
          <div className="progress-bar-container">
            <div 
              className="progress-bar-fill" 
              style={{ 
                width: `${data.progressPercent}%`,
                backgroundColor: progressColor
              }} 
            />
          </div>
          <div className="progress-stats">
            <span className="stat-item">
              <span className="stat-value">{data.progressPercent}%</span>
              <span className="stat-label">complete</span>
            </span>
            <span className="stat-item">
              <span className="stat-value">{data.completedTasks}/{data.totalTasks}</span>
              <span className="stat-label">tasks</span>
            </span>
            {data.overdueTasks > 0 && (
              <span className="stat-item overdue">
                <span className="stat-value">{data.overdueTasks}</span>
                <span className="stat-label">overdue</span>
              </span>
            )}
            <span className="stat-item momentum" style={{ color: momentumConfig.color }}>
              <span className="stat-icon">{momentumConfig.icon}</span>
              <span className="stat-label">{momentumConfig.label}</span>
            </span>
          </div>
        </div>

        {/* Next Action */}
        {data.nextAction && (
          <div className="card-next-action">
            <span className="next-bullet" style={{ backgroundColor: config.color }}></span>
            <span className="next-label">Next:</span>
            <span className="next-task">{data.nextAction.title}</span>
          </div>
        )}

        {/* Expanded Section - Notes & Insights */}
        {isExpanded && (
          <div className="card-expanded-section">
            {/* Project Description/Notes */}
            {data.project.description ? (
              <div className="notes-section">
                <div className="notes-header">
                  <span className="notes-icon">📝</span>
                  <span className="notes-title">Notes</span>
                </div>
                <div className="notes-content">{data.project.description}</div>
              </div>
            ) : (
              <div className="notes-section empty">
                <span className="notes-placeholder">No notes yet — add a description in Notion</span>
              </div>
            )}

            {/* Actionable Insight */}
            {data.actionableInsight && (
              <div className="insight-section">
                <span className="insight-icon">💡</span>
                <span className="insight-text">{data.actionableInsight}</span>
              </div>
            )}

            {/* Mini Stats */}
            <div className="mini-stats">
              <div className="mini-stat">
                <span className="mini-label">Health</span>
                <span className="mini-value">{data.healthScore}</span>
              </div>
              <div className="mini-stat">
                <span className="mini-label">This Week</span>
                <span className="mini-value">{data.tasksCompletedThisWeek} done</span>
              </div>
              <div className="mini-stat">
                <span className="mini-label">Last Week</span>
                <span className="mini-value">{data.tasksCompletedLastWeek} done</span>
              </div>
              {data.velocityPerDay > 0 && (
                <div className="mini-stat">
                  <span className="mini-label">Velocity</span>
                  <span className="mini-value">{data.velocityPerDay.toFixed(1)}/day</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderQuadrant = (level: AttentionLevel) => {
    const items = groupedProjects[level];
    const config = ATTENTION_CONFIG[level];
    const isCollapsed = collapsedLevels.has(level);
    
    return (
      <div 
        className={`health-quadrant quadrant-${level} ${isCollapsed ? 'is-collapsed' : ''}`}
        style={{ 
          '--q-color': config.color,
          '--q-bg': config.bg,
          '--q-bg-solid': config.bgSolid
        } as React.CSSProperties}
      >
        <button
          type="button" 
          className="quadrant-header"
          onClick={() => toggleLevelCollapsed(level)}
        >
          <span className={`quadrant-chevron ${isCollapsed ? 'collapsed' : ''}`}>▼</span>
          <span className="quadrant-icon">{config.icon}</span>
          <span className="quadrant-label">{config.label}</span>
          <span className="quadrant-count">{items.length}</span>
        </button>
        {!isCollapsed && (
          <div className="quadrant-content">
            {items.length === 0 ? (
              <div className="quadrant-empty">No projects</div>
            ) : (
              items.map(data => renderProjectCard(data))
            )}
          </div>
        )}
      </div>
    );
  };

  const renderTimeline = () => {
    if (timelineItems.length === 0) {
      return (
        <div className="timeline-empty">
          <span className="empty-icon">✨</span>
          <span className="empty-text">All clear! No urgent deadlines</span>
        </div>
      );
    }
    
    return (
      <div className="timeline-list">
        {timelineItems.map((item, i) => (
          <div 
            key={`${item.project.id}-${i}`} 
            className={`timeline-row urgency-${item.urgency}`}
            onClick={() => onOpenProjectWorkspace?.(item.project.id)}
          >
            <span className="row-date">{formatDate(item.date)}</span>
            <span className="row-label">{item.label}</span>
          </div>
        ))}
      </div>
    );
  };

  if (projects.length === 0) {
    return (
      <div className="health-v6-empty">
        <span className="empty-icon">📊</span>
        <h3>No Projects</h3>
        <p>Create projects to see health metrics.</p>
      </div>
    );
  }

  return (
    <div className="project-health-v6">
      {/* Top Section: Timeline + Health Overview */}
      <div className="health-v6-top">
        {/* Left: What's Coming Up */}
        <div className="top-timeline-panel">
          <h3 className="panel-title">📅 What's Coming Up</h3>
          {renderTimeline()}
        </div>

        {/* Right: Health Overview */}
        <div className="top-health-panel">
          <div className="health-chart-container">
            {renderPieChart()}
          </div>
          <div className="health-score-container">
            <span className="health-score-value">{summary.avgHealthScore}</span>
            <span className="health-score-label">Avg Health</span>
          </div>
          <div className="health-legend">
            {(['critical', 'warning', 'watch', 'healthy'] as AttentionLevel[]).map(level => {
              const config = ATTENTION_CONFIG[level];
              const count = summary[level];
              return (
                <div 
                  key={level} 
                  className="legend-row"
                  style={{ '--legend-color': config.color } as React.CSSProperties}
                >
                  <span className="legend-dot"></span>
                  <span className="legend-count">{count}</span>
                  <span className="legend-label">{config.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom: 2x2 Quadrant Grid */}
      <div className="health-v6-grid">
        <div className="grid-row">
          {renderQuadrant('critical')}
          {renderQuadrant('warning')}
        </div>
        <div className="grid-row">
          {renderQuadrant('watch')}
          {renderQuadrant('healthy')}
        </div>
      </div>
    </div>
  );
};

export default ProjectHealth;
