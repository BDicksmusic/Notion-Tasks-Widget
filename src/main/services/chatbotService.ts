import { fetch } from 'undici';
import type {
  ChatMessage,
  ChatbotProvider,
  ChatbotRequestPayload,
  ChatbotResponsePayload,
  ChatbotSettings,
  Project,
  Task,
  TaskAction,
  TaskStatusOption
} from '../../shared/types';
import type { NotionCreatePayload } from '../../shared/types';
import { listTasks as listStoredTasks } from '../db/repositories/taskRepository';
import { listProjects as listCachedProjects } from '../db/repositories/projectRepository';
import { getStatusOptions } from './notion';

const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_ANTHROPIC_MODEL = 'claude-3-5-sonnet-20241022';
const OPENAI_MODEL =
  process.env.CHATBOT_OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
const ANTHROPIC_MODEL =
  process.env.CHATBOT_ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL;
const MAX_CONTEXT_TASKS = 40;
const MAX_CONTEXT_PROJECTS = 15;

interface OpenAIChatResponse {
  choices: Array<{
    message?: { content?: string | Array<{ type: string; text?: string }> };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

interface AnthropicMessageResponse {
  content: Array<{ type: string; text?: string }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

interface ParsedAIResponse {
  reply: string;
  actions: TaskAction[];
  notes?: string;
}

export interface ChatbotCompletionOptions extends ChatbotRequestPayload {
  provider?: ChatbotProvider;
}

export async function generateChatbotResponse(
  settings: ChatbotSettings,
  options: ChatbotCompletionOptions
): Promise<ChatbotResponsePayload> {
  const provider = resolveProvider(settings, options.providerOverride);
  const apiKey = getProviderApiKey(settings, provider);
  const [tasks, projects] = await Promise.all([
    Promise.resolve(listStoredTasks()),
    Promise.resolve(listCachedProjects())
  ]);

  let statuses: TaskStatusOption[] = [];
  try {
    statuses = await getStatusOptions();
  } catch (error) {
    console.warn('[Chatbot] Unable to fetch status options:', error);
  }

  const systemPrompt = buildSystemPrompt(tasks, projects, statuses);
  const userPrompt = buildUserPrompt(options.prompt, options.speechSummary);

  if (provider === 'anthropic') {
    return callAnthropicChat({
      apiKey,
      model: ANTHROPIC_MODEL,
      systemPrompt,
      userPrompt,
      history: options.history
    });
  }

  return callOpenAIChat({
    apiKey,
    model: OPENAI_MODEL,
    systemPrompt,
    userPrompt,
    history: options.history
  });
}

function resolveProvider(
  settings: ChatbotSettings,
  override?: ChatbotProvider
): ChatbotProvider {
  if (override) return override;
  if (settings.preferredProvider === 'anthropic' && settings.anthropicApiKey?.trim()) {
    return 'anthropic';
  }
  return 'openai';
}

function getProviderApiKey(settings: ChatbotSettings, provider: ChatbotProvider): string {
  const key =
    provider === 'anthropic'
      ? settings.anthropicApiKey?.trim()
      : settings.openaiApiKey?.trim();
  if (!key) {
    throw new Error(
      provider === 'anthropic'
        ? 'Anthropic API key is required to use Claude.'
        : 'OpenAI API key is required to use the chatbot.'
    );
  }
  return key;
}

async function callOpenAIChat(params: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  history?: ChatMessage[];
}): Promise<ChatbotResponsePayload> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: params.model ?? DEFAULT_OPENAI_MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: params.systemPrompt },
        ...mapHistoryToOpenAIMessages(params.history),
        { role: 'user', content: params.userPrompt }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${errorText}`);
  }

  const payload = (await response.json()) as OpenAIChatResponse;
  const content = extractOpenAIContent(payload);
  const parsed = parseStructuredResponse(content);

  return {
    provider: 'openai',
    reply: parsed.reply,
    actions: parsed.actions,
    notes: parsed.notes,
    raw: payload,
    usage: {
      inputTokens: payload.usage?.prompt_tokens,
      outputTokens: payload.usage?.completion_tokens
    }
  };
}

async function callAnthropicChat(params: {
  apiKey: string;
  model?: string;
  systemPrompt: string;
  userPrompt: string;
  history?: ChatMessage[];
}): Promise<ChatbotResponsePayload> {
  const body = {
    model: params.model ?? DEFAULT_ANTHROPIC_MODEL,
    temperature: 0.2,
    max_tokens: 1500,
    system: params.systemPrompt,
    messages: [
      ...mapHistoryToAnthropicMessages(params.history),
      { role: 'user', content: [{ type: 'text', text: params.userPrompt }] }
    ]
  };

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': params.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic request failed (${response.status}): ${errorText}`);
  }

  const payload = (await response.json()) as AnthropicMessageResponse;
  const content = extractAnthropicContent(payload);
  const parsed = parseStructuredResponse(content);

  return {
    provider: 'anthropic',
    reply: parsed.reply,
    actions: parsed.actions,
    notes: parsed.notes,
    raw: payload,
    usage: {
      inputTokens: payload.usage?.input_tokens,
      outputTokens: payload.usage?.output_tokens
    }
  };
}

function mapHistoryToOpenAIMessages(history?: ChatMessage[]) {
  if (!history || history.length === 0) return [];
  return history
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role,
      content: message.content
    }));
}

function mapHistoryToAnthropicMessages(history?: ChatMessage[]) {
  if (!history || history.length === 0) return [];
  return history
    .filter((msg) => msg.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: [{ type: 'text', text: message.content }]
    }));
}

function extractOpenAIContent(payload: OpenAIChatResponse): string {
  const choice = payload.choices?.[0];
  if (!choice) {
    throw new Error('OpenAI response did not include any choices.');
  }

  if (typeof choice.message?.content === 'string') {
    return choice.message.content;
  }

  const contentBlock = choice.message?.content?.find(
    (block) => block.type === 'text' && block.text
  );
  if (!contentBlock?.text) {
    throw new Error('OpenAI response missing text content.');
  }
  return contentBlock.text;
}

function extractAnthropicContent(payload: AnthropicMessageResponse): string {
  const block = payload.content.find(
    (entry) => entry.type === 'text' && entry.text
  );
  if (!block?.text) {
    throw new Error('Anthropic response missing text content.');
  }
  return block.text;
}

function buildSystemPrompt(
  tasks: Task[],
  projects: Project[],
  statuses: TaskStatusOption[]
): string {
  const taskLines = summarizeTasks(tasks);
  const projectLines = summarizeProjects(projects);
  const statusLines = statuses.map((status) => `${status.name}`).join(', ');

  return [
    'You are a productivity copilot that manages tasks for the user.',
    'You MUST respond with valid JSON that matches the schema described below.',
    'Only reference tasks using their exact IDs.',
    '\n=== TASK SNAPSHOT ===',
    taskLines,
    '\n=== PROJECT SNAPSHOT ===',
    projectLines,
    '\nAvailable statuses:',
    statusLines || 'No custom statuses found.',
    '\n=== RESPONSE FORMAT ===',
    JSON_SCHEMA_DESCRIPTION
  ].join('\n');
}

const JSON_SCHEMA_DESCRIPTION = `
{
  "assistant_message": "Concise summary you will show to the user",
  "notes": "Optional additional notes for the summary log",
  "actions": [
    {
      "type": "create_task",
      "task": {
        "title": "string",
        "date": "YYYY-MM-DD" | null,
        "dateEnd": "YYYY-MM-DD" | null,
        "hardDeadline": boolean,
        "urgent": boolean,
        "important": boolean,
        "status": "Status emoji or text",
        "mainEntry": "Notes or description",
        "projectIds": ["id-123"]
      },
      "summary": "Why this task is needed"
    },
    {
      "type": "update_status",
      "taskId": "existing-task-id",
      "status": "New status",
      "summary": "Reason for the status change"
    },
    {
      "type": "update_dates",
      "taskId": "existing-task-id",
      "dueDate": "YYYY-MM-DD",
      "dueDateEnd": "YYYY-MM-DD",
      "summary": "Scheduling notes"
    },
    {
      "type": "add_notes",
      "taskId": "existing-task-id",
      "notes": "Appended notes or journal entry",
      "summary": "What changed in the notes"
    },
    {
      "type": "assign_projects",
      "taskId": "existing-task-id",
      "projectIds": ["project-id"],
      "summary": "Why this assignment was made"
    },
    {
      "type": "log_time",
      "taskId": "existing-task-id",
      "minutes": 45,
      "note": "Optional note about the session",
      "summary": "Reason for logging the time"
    }
  ]
}`.trim();

function buildUserPrompt(prompt: string, speechSummary?: string) {
  const sections = [];
  if (speechSummary) {
    sections.push(`Speech summary: ${speechSummary}`);
  }
  sections.push(`User request: ${prompt}`);
  sections.push('Return ONLY JSON. No prose outside of the JSON object.');
  return sections.join('\n\n');
}

function summarizeTasks(tasks: Task[]): string {
  if (!tasks.length) {
    return 'No tasks in the local database.';
  }

  const sorted = [...tasks]
    .sort((a, b) => {
      const aDate = a.dueDate ? Date.parse(a.dueDate) : Infinity;
      const bDate = b.dueDate ? Date.parse(b.dueDate) : Infinity;
      return aDate - bDate;
    })
    .slice(0, MAX_CONTEXT_TASKS);

  return sorted
    .map((task) => {
      const status = task.status ?? 'No status';
      const dueDate = task.dueDate
        ? `due ${formatDate(task.dueDate)}`
        : 'no due date';
      return `- ${task.id} | ${status} | ${task.title} (${dueDate})`;
    })
    .join('\n');
}

function summarizeProjects(projects: Project[]): string {
  if (!projects.length) return 'No projects available.';
  return projects
    .slice(0, MAX_CONTEXT_PROJECTS)
    .map((project) => {
      const status = project.status ?? 'No status';
      return `- ${project.id} | ${status} | ${project.title ?? 'Untitled project'}`;
    })
    .join('\n');
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });
}

function parseStructuredResponse(rawText: string): ParsedAIResponse {
  const jsonText = extractJson(rawText);
  const parsed = JSON.parse(jsonText) as {
    assistant_message?: string;
    actions?: unknown;
    notes?: string;
  };

  return {
    reply: parsed.assistant_message ?? 'No summary provided.',
    actions: normalizeTaskActions(parsed.actions),
    notes: parsed.notes
  };
}

function extractJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Model response did not contain a JSON object.');
  }
  return text.slice(start, end + 1);
}

function normalizeTaskActions(value: unknown): TaskAction[] {
  if (!Array.isArray(value)) return [];
  const normalized: TaskAction[] = [];

  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const action = raw as Record<string, unknown>;
    const type = action.type;

    if (type === 'create_task') {
      const taskPayload = normalizeCreatePayload(action.task);
      if (taskPayload) {
        normalized.push({
          type: 'create_task',
          task: taskPayload,
          summary: toOptionalString(action.summary)
        });
      }
    } else if (type === 'update_status') {
      const taskId = toString(action.taskId);
      const status = toString(action.status);
      if (taskId && status) {
        normalized.push({
          type: 'update_status',
          taskId,
          status,
          summary: toOptionalString(action.summary)
        });
      }
    } else if (type === 'update_dates') {
      const taskId = toString(action.taskId);
      if (taskId) {
        normalized.push({
          type: 'update_dates',
          taskId,
          dueDate: toOptionalString(action.dueDate),
          dueDateEnd: toOptionalString(action.dueDateEnd),
          summary: toOptionalString(action.summary)
        });
      }
    } else if (type === 'add_notes') {
      const taskId = toString(action.taskId);
      const notes = toString(action.notes);
      if (taskId && notes) {
        normalized.push({
          type: 'add_notes',
          taskId,
          notes,
          summary: toOptionalString(action.summary)
        });
      }
    } else if (type === 'assign_projects') {
      const taskId = toString(action.taskId);
      const projectIds = Array.isArray(action.projectIds)
        ? action.projectIds.map(toString).filter(Boolean) as string[]
        : [];
      if (taskId && projectIds.length > 0) {
        normalized.push({
          type: 'assign_projects',
          taskId,
          projectIds,
          summary: toOptionalString(action.summary)
        });
      }
    } else if (type === 'log_time') {
      const taskId = toString(action.taskId);
      const minutes = Number(action.minutes);
      if (taskId && Number.isFinite(minutes) && minutes > 0) {
        normalized.push({
          type: 'log_time',
          taskId,
          minutes,
          note: toOptionalString(action.note),
          summary: toOptionalString(action.summary)
        });
      }
    }
  }

  return normalized;
}

function normalizeCreatePayload(value: unknown): NotionCreatePayload | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as Record<string, unknown>;
  const title = toString(payload.title);
  if (!title) return null;

  const projectIds = Array.isArray(payload.projectIds)
    ? (payload.projectIds.map(toString).filter(Boolean) as string[])
    : undefined;

  return {
    title,
    date: toOptionalString(payload.date) ?? undefined,
    dateEnd: toOptionalString(payload.dateEnd),
    hardDeadline: typeof payload.hardDeadline === 'boolean' ? payload.hardDeadline : undefined,
    urgent: typeof payload.urgent === 'boolean' ? payload.urgent : undefined,
    important: typeof payload.important === 'boolean' ? payload.important : undefined,
    status: toOptionalString(payload.status),
    mainEntry: toOptionalString(payload.mainEntry),
    projectIds: projectIds && projectIds.length > 0 ? projectIds : undefined,
    parentTaskId: toOptionalString(payload.parentTaskId) ?? undefined
  };
}

function toString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

function toOptionalString(value: unknown): string | undefined {
  const str = toString(value);
  return str ?? undefined;
}

// ============================================================================
// IPC-facing function for main.ts
// ============================================================================

import type { ChatbotResponse } from '../../shared/types';
import { getChatbotSettings } from '../configStore';

/**
 * Process a chat message and return structured response with task actions
 * This is the main entry point called from IPC handlers in main.ts
 */
export async function processChatMessage(payload: {
  message: string;
  tasks: Task[];
  projects: Project[];
}): Promise<ChatbotResponse> {
  try {
    const settings = getChatbotSettings();
    
    // Check if we have a valid API key
    if (!settings.openaiApiKey?.trim() && !settings.anthropicApiKey?.trim()) {
      return {
        success: false,
        message: 'No API key configured',
        error: 'Please configure an OpenAI or Anthropic API key in settings'
      };
    }

    const response = await generateChatbotResponse(settings, {
      prompt: payload.message
    });

    return {
      success: true,
      message: response.reply,
      actions: response.actions
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error('[Chatbot] processChatMessage error:', error);
    return {
      success: false,
      message: 'Failed to process message',
      error: errorMessage
    };
  }
}

