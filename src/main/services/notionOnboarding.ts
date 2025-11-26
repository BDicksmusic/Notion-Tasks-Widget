/**
 * Notion Onboarding Service
 * 
 * Handles the connection and configuration of Notion integration:
 * 1. Tests API key validity
 * 2. Validates database access
 * 3. Compares local statuses with Notion statuses
 * 4. Checks for required/missing properties
 * 5. Provides conflict resolution options
 */

import type { TaskStatusOption, NotionSettings, ProjectsSettings } from '../../shared/types';
import { listLocalTaskStatuses, listLocalProjectStatuses, mergeNotionTaskStatuses, mergeNotionProjectStatuses } from '../db/repositories/localStatusRepository';

export interface PropertyValidation {
  name: string;
  configured: string | undefined;
  foundInNotion: boolean;
  type?: string;
  required: boolean;
  suggestion?: string;
}

export interface StatusComparison {
  localOnly: TaskStatusOption[];
  notionOnly: TaskStatusOption[];
  matching: TaskStatusOption[];
}

export interface OnboardingResult {
  success: boolean;
  message: string;
  latencyMs?: number;
  
  // Connection info
  userName?: string;
  workspaceName?: string;
  databaseName?: string;
  
  // Property validation
  properties?: PropertyValidation[];
  missingRequired?: PropertyValidation[];
  
  // Status comparison
  taskStatusComparison?: StatusComparison;
  projectStatusComparison?: StatusComparison;
  
  // Available options from Notion
  notionTaskStatuses?: TaskStatusOption[];
  notionProjectStatuses?: TaskStatusOption[];
}

export interface MergeDecision {
  keepLocal: boolean;      // Keep local statuses not in Notion
  importNotion: boolean;   // Import Notion statuses into local
  deleteOrphanedLocal: boolean; // Delete local statuses not in Notion
}

/**
 * Check if Notion is configured (has both API key and database ID)
 */
export function isNotionConfigured(settings: NotionSettings | null): boolean {
  return Boolean(settings?.apiKey?.trim() && settings?.databaseId?.trim());
}

/**
 * Check if Projects Notion is configured
 */
export function isProjectsNotionConfigured(settings: ProjectsSettings | null): boolean {
  return Boolean(settings?.databaseId?.trim());
}

/**
 * Compare local statuses with Notion statuses
 */
export function compareStatuses(
  localStatuses: TaskStatusOption[],
  notionStatuses: TaskStatusOption[]
): StatusComparison {
  const localNames = new Set(localStatuses.map(s => s.name.toLowerCase().trim()));
  const notionNames = new Set(notionStatuses.map(s => s.name.toLowerCase().trim()));
  
  const localOnly: TaskStatusOption[] = [];
  const notionOnly: TaskStatusOption[] = [];
  const matching: TaskStatusOption[] = [];
  
  // Find local-only statuses
  for (const status of localStatuses) {
    const normalizedName = status.name.toLowerCase().trim();
    if (!notionNames.has(normalizedName)) {
      localOnly.push(status);
    } else {
      matching.push(status);
    }
  }
  
  // Find Notion-only statuses
  for (const status of notionStatuses) {
    const normalizedName = status.name.toLowerCase().trim();
    if (!localNames.has(normalizedName)) {
      notionOnly.push(status);
    }
  }
  
  return { localOnly, notionOnly, matching };
}

/**
 * Validate required properties exist in Notion database
 */
export function validateProperties(
  settings: NotionSettings,
  notionProperties: Record<string, { type: string; name: string }>
): PropertyValidation[] {
  const validations: PropertyValidation[] = [];
  const propNames = Object.keys(notionProperties);
  
  // Title property (required)
  const titleProp = settings.titleProperty || 'Name';
  const titleFound = propNames.some(p => p.toLowerCase() === titleProp.toLowerCase());
  validations.push({
    name: 'Title',
    configured: titleProp,
    foundInNotion: titleFound,
    type: titleFound ? notionProperties[titleProp]?.type : undefined,
    required: true,
    suggestion: !titleFound ? propNames.find(p => notionProperties[p].type === 'title') : undefined
  });
  
  // Status property (required for status features)
  const statusProp = settings.statusProperty || 'Status';
  const statusFound = propNames.some(p => p.toLowerCase() === statusProp.toLowerCase());
  const statusType = statusFound ? notionProperties[statusProp]?.type : undefined;
  validations.push({
    name: 'Status',
    configured: statusProp,
    foundInNotion: statusFound,
    type: statusType,
    required: true,
    suggestion: !statusFound 
      ? propNames.find(p => ['status', 'select'].includes(notionProperties[p].type))
      : (statusType && !['status', 'select'].includes(statusType) 
          ? `Property "${statusProp}" is type "${statusType}" but should be "status" or "select"`
          : undefined)
  });
  
  // Date property (optional but recommended)
  const dateProp = settings.dateProperty;
  if (dateProp) {
    const dateFound = propNames.some(p => p.toLowerCase() === dateProp.toLowerCase());
    validations.push({
      name: 'Date',
      configured: dateProp,
      foundInNotion: dateFound,
      type: dateFound ? notionProperties[dateProp]?.type : undefined,
      required: false,
      suggestion: !dateFound ? propNames.find(p => notionProperties[p].type === 'date') : undefined
    });
  }
  
  // Urgent/Important checkboxes (optional)
  for (const [label, configProp] of [
    ['Urgent', settings.urgentProperty],
    ['Important', settings.importantProperty]
  ] as const) {
    if (configProp) {
      const found = propNames.some(p => p.toLowerCase() === configProp.toLowerCase());
      validations.push({
        name: label,
        configured: configProp,
        foundInNotion: found,
        type: found ? notionProperties[configProp]?.type : undefined,
        required: false
      });
    }
  }
  
  return validations;
}

/**
 * Execute merge based on user decisions
 */
export async function executeStatusMerge(
  type: 'task' | 'project',
  notionStatuses: TaskStatusOption[],
  decision: MergeDecision
): Promise<{ merged: number; kept: number; deleted: number }> {
  let merged = 0;
  let kept = 0;
  let deleted = 0;
  
  if (decision.importNotion) {
    // Import Notion statuses into local database
    if (type === 'task') {
      mergeNotionTaskStatuses(notionStatuses);
    } else {
      mergeNotionProjectStatuses(notionStatuses);
    }
    merged = notionStatuses.length;
  }
  
  if (!decision.deleteOrphanedLocal) {
    // Count how many local-only we're keeping
    const localStatuses = type === 'task' ? listLocalTaskStatuses() : listLocalProjectStatuses();
    const notionNames = new Set(notionStatuses.map(s => s.name.toLowerCase().trim()));
    kept = localStatuses.filter(s => !notionNames.has(s.name.toLowerCase().trim())).length;
  }
  
  // Note: deleteOrphanedLocal would need additional implementation to actually delete
  // For now, we just count - the actual deletion would require a separate function
  
  return { merged, kept, deleted };
}

/**
 * Generate a summary message for the onboarding result
 */
export function generateOnboardingSummary(result: OnboardingResult): string {
  if (!result.success) {
    return result.message;
  }
  
  const parts: string[] = [];
  
  if (result.workspaceName) {
    parts.push(`Connected to workspace: ${result.workspaceName}`);
  }
  
  if (result.databaseName) {
    parts.push(`Database: ${result.databaseName}`);
  }
  
  if (result.missingRequired && result.missingRequired.length > 0) {
    parts.push(`⚠️ Missing required properties: ${result.missingRequired.map(p => p.name).join(', ')}`);
  }
  
  if (result.taskStatusComparison) {
    const { localOnly, notionOnly, matching } = result.taskStatusComparison;
    if (notionOnly.length > 0) {
      parts.push(`📥 ${notionOnly.length} new status(es) from Notion`);
    }
    if (localOnly.length > 0) {
      parts.push(`📤 ${localOnly.length} local-only status(es)`);
    }
  }
  
  if (result.latencyMs) {
    parts.push(`Response time: ${result.latencyMs}ms`);
  }
  
  return parts.join('\n');
}

/**
 * Default merge decision - import from Notion, keep local
 */
export const DEFAULT_MERGE_DECISION: MergeDecision = {
  keepLocal: true,
  importNotion: true,
  deleteOrphanedLocal: false
};



