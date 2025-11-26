import type { Project, Task } from '@shared/types';
import {
  findMatrixOptionFromFlags,
  type MatrixOptionId
} from '../constants/matrix';

export type MatrixCounts = Record<MatrixOptionId, number>;

export interface ProjectActionSummary {
  projectId: string;
  project?: Project;
  tasks: Task[];
  totalActions: number;
  openActions: number;
  completedActions: number;
  nextAction?: Task;
  progress: number;
  matrixCounts: MatrixCounts;
}

export interface ProjectInsights {
  summaries: ProjectActionSummary[];
  totals: {
    projects: number;
    trackedActions: number;
    openActions: number;
    doNowActions: number;
    averageCompletion: number;
  };
  tasksByProject: Map<string, Task[]>;
  unassignedTasks: Task[];
}

interface BuildInsightsInput {
  projects: Project[];
  tasks: Task[];
  completedStatus?: string;
}

export function buildProjectInsights({
  projects,
  tasks,
  completedStatus
}: BuildInsightsInput): ProjectInsights {
  const projectMap = new Map(projects.map((project) => [project.id, project]));
  const tasksByProject = new Map<string, Task[]>();
  const trackedTaskIds = new Set<string>();
  const unassignedTasks: Task[] = [];

  tasks.forEach((task) => {
    const projectIds = Array.from(new Set(task.projectIds ?? [])).filter(
      Boolean
    );
    if (!projectIds.length) {
      unassignedTasks.push(task);
      return;
    }

    projectIds.forEach((projectId) => {
      const bucket = tasksByProject.get(projectId) ?? [];
      bucket.push(task);
      tasksByProject.set(projectId, bucket);
    });
    trackedTaskIds.add(task.id);
  });

  const summaries: ProjectActionSummary[] = [];
  let cumulativeCompletion = 0;
  let projectsWithActions = 0;
  let openActionsTotal = 0;
  let doNowActions = 0;

  tasksByProject.forEach((projectTasks, projectId) => {
    const summary = buildSummaryForProject(
      projectId,
      projectMap.get(projectId),
      projectTasks,
      completedStatus
    );
    summaries.push(summary);
    if (summary.totalActions > 0) {
      cumulativeCompletion += summary.progress;
      projectsWithActions += 1;
    }
    openActionsTotal += summary.openActions;
    doNowActions += summary.matrixCounts['do-now'];
  });

  // Ensure projects with zero actions are still represented
  projects.forEach((project) => {
    if (!tasksByProject.has(project.id)) {
      summaries.push({
        projectId: project.id,
        project,
        tasks: [],
        totalActions: 0,
        openActions: 0,
        completedActions: 0,
        nextAction: undefined,
        progress: 0,
        matrixCounts: createEmptyMatrixCounts()
      });
    }
  });

  summaries.sort((a, b) => {
    if (a.openActions === b.openActions) {
      return (a.project?.title ?? '').localeCompare(b.project?.title ?? '');
    }
    return b.openActions - a.openActions;
  });

  const averageCompletion =
    projectsWithActions === 0
      ? 0
      : cumulativeCompletion / projectsWithActions;

  return {
    summaries,
    totals: {
      projects: projects.length,
      trackedActions: trackedTaskIds.size,
      openActions: openActionsTotal,
      doNowActions,
      averageCompletion
    },
    tasksByProject,
    unassignedTasks
  };
}

function buildSummaryForProject(
  projectId: string,
  project: Project | undefined,
  tasks: Task[],
  completedStatus?: string
): ProjectActionSummary {
  const matrixCounts = createEmptyMatrixCounts();
  const openTasks: Task[] = [];

  tasks.forEach((task) => {
    const completed = isCompleted(task, completedStatus);
    if (!completed) {
      openTasks.push(task);
      const category = getMatrixCategory(task);
      matrixCounts[category] += 1;
    }
  });

  return {
    projectId,
    project,
    tasks,
    totalActions: tasks.length,
    openActions: openTasks.length,
    completedActions: tasks.length - openTasks.length,
    nextAction: selectNextAction(openTasks),
    progress: tasks.length
      ? (tasks.length - openTasks.length) / tasks.length
      : 0,
    matrixCounts
  };
}

const matrixOrder: MatrixOptionId[] = [
  'do-now',
  'delegate',
  'deep-work',
  'trash'
];

function selectNextAction(openTasks: Task[]): Task | undefined {
  if (!openTasks.length) return undefined;
  const sorted = [...openTasks].sort((a, b) => {
    const rankA = matrixOrder.indexOf(getMatrixCategory(a));
    const rankB = matrixOrder.indexOf(getMatrixCategory(b));
    if (rankA !== rankB) return rankA - rankB;

    const dueA = parseDueDate(a.dueDate);
    const dueB = parseDueDate(b.dueDate);
    if (dueA !== dueB) return dueA - dueB;

    return (a.title ?? '').localeCompare(b.title ?? '');
  });
  return sorted[0];
}

function parseDueDate(value?: string) {
  if (!value) return Number.POSITIVE_INFINITY;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp;
}

function createEmptyMatrixCounts(): MatrixCounts {
  return {
    'do-now': 0,
    'deep-work': 0,
    delegate: 0,
    trash: 0
  };
}

export function getMatrixCategory(task: Task): MatrixOptionId {
  return (
    findMatrixOptionFromFlags(Boolean(task.urgent), Boolean(task.important))
      ?.id ?? 'trash'
  );
}

function isCompleted(task: Task, completedStatus?: string) {
  if (!completedStatus) return false;
  return task.status === completedStatus;
}

