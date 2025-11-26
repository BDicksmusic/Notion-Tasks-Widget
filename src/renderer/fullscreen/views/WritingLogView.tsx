import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import type { Task, Project, WritingSettings, WritingEntryPayload } from '@shared/types';
import { widgetBridge } from '@shared/platform';
import RichBodyEditor, {
  createInitialBodyValue,
  valueToMarkdownBlocks,
  valueToPlainText
} from '../../components/RichBodyEditor';
import SearchInput from '../../components/SearchInput';

interface WritingLogViewProps {
  tasks: Task[];
  projects: Project[];
  writingSettings: WritingSettings | null;
  completedStatus?: string;
  selectedProjectId?: string | null;
  onSelectProject?: (projectId: string | null) => void;
  onSelectTask?: (taskId: string) => void;
  onCreateWritingEntry?: (payload: WritingEntryPayload) => Promise<void>;
}

// Writing entry from Notion (simplified)
interface WritingEntry {
  id: string;
  title: string;
  summary?: string;
  status?: string;
  tags?: string[];
  createdTime?: string;
  lastEditedTime?: string;
  url?: string;
}

type ViewMode = 'by-task' | 'by-project' | 'timeline' | 'compose';
type SortOption = 'recent' | 'title';

const widgetAPI = widgetBridge;

const formatDate = (dateStr: string | undefined): string => {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
};

const formatRelativeDate = (date: Date): string => {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// Helper function to search task text
const taskMatchesSearch = (task: Task, query: string): boolean => {
  if (!query.trim()) return true;
  const lowerQuery = query.toLowerCase().trim();
  const searchFields = [
    task.title,
    task.status,
    task.mainEntry,
    task.normalizedStatus
  ].filter(Boolean);
  return searchFields.some((field) =>
    field!.toLowerCase().includes(lowerQuery)
  );
};

const WritingLogView = ({
  tasks,
  projects,
  writingSettings,
  completedStatus,
  selectedProjectId,
  onSelectProject,
  onSelectTask,
  onCreateWritingEntry
}: WritingLogViewProps) => {
  const [viewMode, setViewMode] = useState<ViewMode>('by-project');
  const [sortBy, setSortBy] = useState<SortOption>('recent');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Compose mode state
  const [composeTarget, setComposeTarget] = useState<{
    type: 'task' | 'project';
    id: string;
    title: string;
  } | null>(null);
  const bodyValueRef = useRef(createInitialBodyValue());
  const [editorResetSignal, setEditorResetSignal] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  // Filter tasks by project and search query
  const filteredTasks = useMemo(() => {
    let result = tasks;
    
    // Apply search filter
    if (searchQuery) {
      result = result.filter((task) => taskMatchesSearch(task, searchQuery));
    }
    
    if (selectedProjectId) {
      result = result.filter((task) =>
        (task.projectIds ?? []).includes(selectedProjectId)
      );
    }
    
    return result;
  }, [tasks, selectedProjectId, searchQuery]);

  // Group tasks by project for the by-project view
  const tasksByProject = useMemo(() => {
    const groups = new Map<string, { project: Project; tasks: Task[] }>();
    
    // Add "No Project" group
    groups.set('__none__', { project: { id: '__none__', title: 'No Project' }, tasks: [] });
    
    // Initialize project groups
    projects.forEach((project) => {
      groups.set(project.id, { project, tasks: [] });
    });
    
    // Assign tasks to projects
    filteredTasks.forEach((task) => {
      const projectIds = task.projectIds ?? [];
      if (projectIds.length === 0) {
        groups.get('__none__')!.tasks.push(task);
      } else {
        projectIds.forEach((projectId) => {
          const group = groups.get(projectId);
          if (group) {
            group.tasks.push(task);
          }
        });
      }
    });
    
    // Filter out empty groups and sort
    return Array.from(groups.values())
      .filter((g) => g.tasks.length > 0)
      .sort((a, b) => {
        if (a.project.id === '__none__') return 1;
        if (b.project.id === '__none__') return -1;
        return (a.project.title ?? '').localeCompare(b.project.title ?? '');
      });
  }, [projects, filteredTasks]);

  const handleStartCompose = useCallback((type: 'task' | 'project', id: string, title: string) => {
    setComposeTarget({ type, id, title });
    setViewMode('compose');
    bodyValueRef.current = createInitialBodyValue();
    setEditorResetSignal((s) => s + 1);
    setFeedback(null);
  }, []);

  const handleCancelCompose = useCallback(() => {
    setComposeTarget(null);
    setViewMode('by-project');
    setFeedback(null);
  }, []);

  const handleSubmitEntry = useCallback(async () => {
    if (!composeTarget || !onCreateWritingEntry) return;
    
    const content = valueToPlainText(bodyValueRef.current);
    if (!content.trim()) {
      setFeedback({ kind: 'error', message: 'Please enter some content' });
      return;
    }
    
    const blocks = valueToMarkdownBlocks(bodyValueRef.current);
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
    const title = `${composeTarget.title} - ${dateStr}`;
    
    try {
      setSubmitting(true);
      setFeedback(null);
      await onCreateWritingEntry({
        title,
        content,
        contentBlocks: blocks,
        tags: composeTarget.type === 'project' 
          ? ['project-log'] 
          : ['task-log']
      });
      setFeedback({ kind: 'success', message: 'Entry saved to Notion' });
      bodyValueRef.current = createInitialBodyValue();
      setEditorResetSignal((s) => s + 1);
      
      // Return to previous view after short delay
      setTimeout(() => {
        setComposeTarget(null);
        setViewMode('by-project');
        setFeedback(null);
      }, 1500);
    } catch (err) {
      setFeedback({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to save entry'
      });
    } finally {
      setSubmitting(false);
    }
  }, [composeTarget, onCreateWritingEntry]);

  const renderTaskCard = (task: Task, showProjectBadge = false) => {
    const isExpanded = expandedId === task.id;
    const isComplete = task.status === completedStatus;
    
    return (
      <div
        key={task.id}
        className={`writing-task-card ${isExpanded ? 'is-expanded' : ''} ${isComplete ? 'is-complete' : ''}`}
      >
        <div
          className="writing-task-header"
          onClick={() => setExpandedId(isExpanded ? null : task.id)}
        >
          <div className="writing-task-info">
            <div className="writing-task-title">{task.title}</div>
            {showProjectBadge && task.projectIds?.length ? (
              <div className="writing-task-projects">
                {task.projectIds.slice(0, 2).map((pid) => {
                  const project = projects.find((p) => p.id === pid);
                  return (
                    <span key={pid} className="writing-project-badge">
                      {project?.title ?? 'Project'}
                    </span>
                  );
                })}
              </div>
            ) : null}
          </div>
          <div className="writing-task-actions">
            <button
              type="button"
              className="writing-compose-btn"
              onClick={(e) => {
                e.stopPropagation();
                handleStartCompose('task', task.id, task.title);
              }}
            >
              ✏️ Write
            </button>
            <span className="writing-expand-icon">{isExpanded ? '▾' : '▸'}</span>
          </div>
        </div>
        
        {isExpanded && (
          <div className="writing-task-details">
            <div className="writing-task-meta">
              {task.dueDate && (
                <span className="writing-meta-item">
                  📅 Due {formatDate(task.dueDate)}
                </span>
              )}
              {task.status && (
                <span className="writing-meta-item">
                  Status: {task.status}
                </span>
              )}
              {task.estimatedLengthMinutes && (
                <span className="writing-meta-item">
                  ⏱ Est: {task.estimatedLengthMinutes}m
                </span>
              )}
            </div>
            {task.mainEntry && (
              <div className="writing-task-notes">
                <div className="writing-notes-label">Notes:</div>
                <div className="writing-notes-content">{task.mainEntry}</div>
              </div>
            )}
            <div className="writing-task-footer">
              <button
                type="button"
                className="writing-open-task"
                onClick={() => onSelectTask?.(task.id)}
              >
                Open task details →
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderByProjectView = () => (
    <div className="writing-by-project">
      {tasksByProject.map(({ project, tasks: projectTasks }) => (
        <div key={project.id} className="writing-project-group">
          <div className="writing-project-header">
            <div className="writing-project-info">
              <span className="writing-project-icon">📁</span>
              <span className="writing-project-name">{project.title}</span>
              <span className="writing-project-count">{projectTasks.length}</span>
            </div>
            {project.id !== '__none__' && (
              <button
                type="button"
                className="writing-compose-btn project"
                onClick={() => handleStartCompose('project', project.id, project.title ?? 'Project')}
              >
                ✏️ Project Log
              </button>
            )}
          </div>
          <div className="writing-project-tasks">
            {projectTasks.map((task) => renderTaskCard(task, false))}
          </div>
        </div>
      ))}
    </div>
  );

  const renderByTaskView = () => {
    const sortedTasks = [...filteredTasks].sort((a, b) => {
      if (sortBy === 'title') {
        return (a.title ?? '').localeCompare(b.title ?? '');
      }
      // Recent - by due date
      const dateA = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const dateB = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      return dateA - dateB;
    });
    
    return (
      <div className="writing-by-task">
        {sortedTasks.map((task) => renderTaskCard(task, true))}
      </div>
    );
  };

  const renderComposeView = () => {
    if (!composeTarget) return null;
    
    return (
      <div className="writing-compose">
        <div className="writing-compose-header">
          <button
            type="button"
            className="writing-compose-back"
            onClick={handleCancelCompose}
          >
            ← Back
          </button>
          <div className="writing-compose-target">
            <span className="writing-compose-type">
              {composeTarget.type === 'project' ? '📁 Project Log' : '📝 Task Log'}
            </span>
            <span className="writing-compose-title">{composeTarget.title}</span>
          </div>
        </div>
        
        {feedback && (
          <div className={`writing-feedback ${feedback.kind}`}>
            {feedback.message}
          </div>
        )}
        
        <div className="writing-compose-editor">
          <RichBodyEditor
            onValueChange={(val) => { bodyValueRef.current = val; }}
            placeholder={`Write your ${composeTarget.type} log entry here...`}
            resetSignal={editorResetSignal}
          />
        </div>
        
        <div className="writing-compose-actions">
          <button
            type="button"
            className="writing-cancel-btn"
            onClick={handleCancelCompose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="writing-submit-btn"
            onClick={handleSubmitEntry}
            disabled={submitting}
          >
            {submitting ? 'Saving...' : 'Save to Writing Log'}
          </button>
        </div>
      </div>
    );
  };

  if (!writingSettings?.databaseId) {
    return (
      <div className="writing-view-empty">
        <div className="writing-empty-icon">📝</div>
        <h3>Writing Log not configured</h3>
        <p>Configure your Writing database in settings to start logging.</p>
      </div>
    );
  }

  return (
    <div className="writing-log-view">
      {viewMode !== 'compose' && (
        <div className="writing-view-toolbar">
          <div className="writing-toolbar-left">
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search tasks…"
              compact
            />
            <select
              className="writing-project-filter"
              value={selectedProjectId ?? ''}
              onChange={(e) => onSelectProject?.(e.target.value || null)}
            >
              <option value="">All Projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title ?? 'Untitled'}
                </option>
              ))}
            </select>
            {viewMode === 'by-task' && (
              <select
                className="writing-sort-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
              >
                <option value="recent">By Due Date</option>
                <option value="title">By Title</option>
              </select>
            )}
          </div>
          <div className="writing-toolbar-right">
            {searchQuery && (
              <span className={`search-results-count ${filteredTasks.length > 0 ? 'has-results' : 'no-results'}`}>
                {filteredTasks.length} {filteredTasks.length === 1 ? 'result' : 'results'}
              </span>
            )}
            <div className="writing-view-toggle">
              <button
                type="button"
                className={viewMode === 'by-project' ? 'active' : ''}
                onClick={() => setViewMode('by-project')}
              >
                By Project
              </button>
              <button
                type="button"
                className={viewMode === 'by-task' ? 'active' : ''}
                onClick={() => setViewMode('by-task')}
              >
                By Task
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="writing-view-content">
        {viewMode === 'compose' ? (
          renderComposeView()
        ) : viewMode === 'by-project' ? (
          renderByProjectView()
        ) : (
          renderByTaskView()
        )}
        
        {viewMode !== 'compose' && filteredTasks.length === 0 && (
          <div className="writing-empty">
            <span className="writing-empty-icon">{searchQuery ? '🔍' : '📝'}</span>
            <h3>{searchQuery ? `No results for "${searchQuery}"` : 'No tasks found'}</h3>
            <p>
              {searchQuery
                ? 'Try a different search term'
                : selectedProjectId
                  ? 'This project has no tasks yet.'
                  : 'Add tasks to start writing logs.'}
            </p>
            {searchQuery && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={() => setSearchQuery('')}
                style={{
                  marginTop: '12px',
                  padding: '6px 14px',
                  fontSize: '12px',
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid var(--notion-border)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--notion-text)',
                  cursor: 'pointer'
                }}
              >
                Clear search
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default WritingLogView;

