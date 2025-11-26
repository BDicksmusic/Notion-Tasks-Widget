import type { StatusDiagnostics, Task } from '../../shared/types';
import { getProjectStatusBreakdown } from '../db/repositories/projectRepository';
import { getTaskStatusBreakdown, listTasks } from '../db/repositories/taskRepository';

export interface DetailedStatusDiagnostics extends StatusDiagnostics {
  /** Sample of tasks with NULL status for debugging */
  nullStatusSamples: Array<{
    id: string;
    title: string;
    status: string | undefined;
    normalizedStatus: string | undefined;
    url?: string;
  }>;
  /** Sample of tasks WITH status for comparison */
  validStatusSamples: Array<{
    id: string;
    title: string;
    status: string | undefined;
    normalizedStatus: string | undefined;
  }>;
}

export function getStatusDiagnostics(): StatusDiagnostics {
  return {
    tasks: getTaskStatusBreakdown(),
    projects: getProjectStatusBreakdown()
  };
}

/**
 * Get detailed diagnostics including samples of tasks with/without status
 * Useful for debugging why some tasks have NULL status
 */
export function getDetailedStatusDiagnostics(): DetailedStatusDiagnostics {
  const tasks = listTasks(500);
  const taskBreakdown = getTaskStatusBreakdown();
  const projectBreakdown = getProjectStatusBreakdown();
  
  // Find tasks with NULL/undefined status
  const nullStatusTasks = tasks.filter(t => !t.status);
  const validStatusTasks = tasks.filter(t => t.status);
  
  // Get samples (up to 10 each)
  const nullStatusSamples = nullStatusTasks.slice(0, 10).map(t => ({
    id: t.id,
    title: t.title,
    status: t.status,
    normalizedStatus: t.normalizedStatus,
    url: t.url
  }));
  
  const validStatusSamples = validStatusTasks.slice(0, 5).map(t => ({
    id: t.id,
    title: t.title,
    status: t.status,
    normalizedStatus: t.normalizedStatus
  }));
  
  console.log('\n========== STATUS DIAGNOSTICS ==========');
  console.log(`Total tasks: ${tasks.length}`);
  console.log(`Tasks with status: ${validStatusTasks.length}`);
  console.log(`Tasks without status: ${nullStatusTasks.length}`);
  console.log('\nNull status samples:');
  nullStatusSamples.forEach(t => {
    console.log(`  - "${t.title}" (id: ${t.id.substring(0, 8)}...) → status="${t.status}", normalized="${t.normalizedStatus}"`);
  });
  console.log('\nValid status samples:');
  validStatusSamples.forEach(t => {
    console.log(`  - "${t.title}" → status="${t.status}", normalized="${t.normalizedStatus}"`);
  });
  console.log('==========================================\n');
  
  return {
    tasks: taskBreakdown,
    projects: projectBreakdown,
    nullStatusSamples,
    validStatusSamples
  };
}

