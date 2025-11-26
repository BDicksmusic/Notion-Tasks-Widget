import type {
  ChatbotActionExecutionResult,
  Task,
  TaskAction,
  TaskUpdatePayload
} from '../../shared/types';
import { createLocalTask, listTasks as listStoredTasks, updateLocalTask } from '../db/repositories/taskRepository';
import { createLocalTimeLogEntry } from '../db/repositories/timeLogRepository';

export async function executeChatbotActions(
  actions: TaskAction[]
): Promise<ChatbotActionExecutionResult[]> {
  if (!actions || actions.length === 0) {
    return [];
  }

  const taskCache = buildTaskCache();
  const results: ChatbotActionExecutionResult[] = [];

  for (const action of actions) {
    try {
      switch (action.type) {
        case 'create_task': {
          const created = createLocalTask({
            ...action.task,
            date: normalizeDateInput(action.task.date) ?? action.task.date,
            dateEnd: normalizeDateInput(action.task.dateEnd) ?? action.task.dateEnd
          });
          taskCache.set(created.id, created);
          results.push({
            action,
            status: 'applied',
            task: created,
            message: `Created task "${created.title}"`
          });
          break;
        }

        case 'update_status': {
          const target = ensureTaskExists(action, taskCache);
          if (!target) {
            results.push({
              action,
              status: 'failed',
              message: `Task ${action.taskId} not found`
            });
            break;
          }
          const updated = updateLocalTask(action.taskId, { status: action.status });
          taskCache.set(updated.id, updated);
          results.push({
            action,
            status: 'applied',
            task: updated,
            message: `Updated status to ${action.status} for "${updated.title}"`
          });
          break;
        }

        case 'update_dates': {
          const target = ensureTaskExists(action, taskCache);
          if (!target) {
            results.push({
              action,
              status: 'failed',
              message: `Task ${action.taskId} not found`
            });
            break;
          }
          const updates: TaskUpdatePayload = {
            dueDate:
              action.dueDate === null
                ? null
                : normalizeDateInput(action.dueDate) ?? action.dueDate ?? undefined,
            dueDateEnd:
              action.dueDateEnd === null
                ? null
                : normalizeDateInput(action.dueDateEnd) ?? action.dueDateEnd ?? undefined
          };
          const updated = updateLocalTask(action.taskId, updates);
          taskCache.set(updated.id, updated);
          results.push({
            action,
            status: 'applied',
            task: updated,
            message: `Updated dates for "${updated.title}"`
          });
          break;
        }

        case 'add_notes': {
          const target = ensureTaskExists(action, taskCache);
          if (!target) {
            results.push({
              action,
              status: 'failed',
              message: `Task ${action.taskId} not found`
            });
            break;
          }
          const combinedNotes = target.mainEntry
            ? `${target.mainEntry}\n\n${action.notes}`
            : action.notes;
          const updated = updateLocalTask(action.taskId, {
            mainEntry: combinedNotes
          });
          taskCache.set(updated.id, updated);
          results.push({
            action,
            status: 'applied',
            task: updated,
            message: `Added notes to "${updated.title}"`
          });
          break;
        }

        case 'assign_projects': {
          const target = ensureTaskExists(action, taskCache);
          if (!target) {
            results.push({
              action,
              status: 'failed',
              message: `Task ${action.taskId} not found`
            });
            break;
          }
          const updated = updateLocalTask(action.taskId, {
            projectIds: action.projectIds
          });
          taskCache.set(updated.id, updated);
          results.push({
            action,
            status: 'applied',
            task: updated,
            message: `Assigned projects to "${updated.title}"`
          });
          break;
        }

        case 'log_time': {
          const target = ensureTaskExists(action, taskCache);
          if (!target) {
            results.push({
              action,
              status: 'failed',
              message: `Task ${action.taskId} not found`
            });
            break;
          }
          const minutes = Math.round(action.minutes);
          const now = new Date();
          const startTime = new Date(now.getTime() - minutes * 60_000);
          const entry = createLocalTimeLogEntry({
            taskId: target.id,
            taskTitle: target.title,
            status: 'End',
            startTime: startTime.toISOString(),
            endTime: now.toISOString(),
            sessionLengthMinutes: minutes
          });
          results.push({
            action,
            status: 'applied',
            task: target,
            timeLogEntry: entry,
            message: `Logged ${minutes} minutes to "${target.title}"`
          });
          break;
        }

        default:
          results.push({
            action,
            status: 'skipped',
            message: `Unsupported action type ${(action as TaskAction).type}`
          });
      }
    } catch (error) {
      results.push({
        action,
        status: 'failed',
        message:
          error instanceof Error
            ? error.message
            : 'Unknown error while applying action'
      });
    }
  }

  return results;
}

function buildTaskCache() {
  const cache = new Map<string, Task>();
  const tasks = listStoredTasks();
  tasks.forEach((task) => cache.set(task.id, task));
  return cache;
}

function ensureTaskExists(
  action: Extract<TaskAction, { taskId: string }>,
  cache: Map<string, Task>
) {
  return cache.get(action.taskId);
}

function normalizeDateInput(value?: string | null) {
  if (value == null) return value;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const date = new Date(`${trimmed}T12:00:00`);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }
  return trimmed;
}

