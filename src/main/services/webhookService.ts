/**
 * Webhook Service
 * 
 * Handles real-time sync from Notion via Cloudflare Worker relay.
 * Polls for webhook events and processes them to update local data.
 */

import { fetch } from 'undici';
import type { WebhookEvent, Task } from '../../shared/types';
import { getAppPreferences, updateAppPreferences } from '../configStore';
import { upsertRemoteTask } from '../db/repositories/taskRepository';
import { fetchTask } from './notionTasks';
import { BrowserWindow } from 'electron';

// Cloudflare Worker URL
const WEBHOOK_RELAY_URL = process.env.WEBHOOK_RELAY_URL || 'https://notion-tasks-webhook-relay.bdicksmusic.workers.dev';

let pollInterval: NodeJS.Timeout | null = null;
let lastEventTimestamp: string | null = null;

/**
 * Register with the webhook relay and get a unique webhook URL
 */
export async function registerWebhook(): Promise<{ webhookUrl: string; userId: string }> {
  const registerUrl = `${WEBHOOK_RELAY_URL}/register`;
  console.log('[Webhook] Registering with relay at:', registerUrl);
  
  const response = await fetch(registerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId: 'notion-tasks-widget' }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Webhook] Registration failed:', response.status, errorText);
    throw new Error(`Failed to register: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as { webhookUrl: string; userId: string; verifyUrl?: string };
  console.log('[Webhook] Registration response:', JSON.stringify(data));
  
  // Immediately verify the user was created by checking the debug endpoint
  const debugUrl = `${WEBHOOK_RELAY_URL}/debug/${data.userId}`;
  console.log('[Webhook] Verifying user exists at:', debugUrl);
  
  try {
    const verifyResponse = await fetch(debugUrl);
    const verifyData = await verifyResponse.json();
    console.log('[Webhook] Verification response:', JSON.stringify(verifyData));
    
    if (verifyData.error) {
      console.error('[Webhook] User was NOT created in KV!', verifyData);
    } else {
      console.log('[Webhook] User verified in KV successfully!');
    }
  } catch (verifyError) {
    console.error('[Webhook] Verification check failed:', verifyError);
  }
  
  // Save to preferences
  const prefs = getAppPreferences();
  await updateAppPreferences({
    ...prefs,
    webhookEnabled: true,
    webhookUserId: data.userId,
    webhookUrl: data.webhookUrl,
  });

  return data;
}

/**
 * Start polling for webhook events
 */
export function startWebhookPolling(intervalMs = 5000): void {
  const prefs = getAppPreferences();
  
  if (!prefs.webhookEnabled || !prefs.webhookUserId) {
    console.log('[Webhook] Not enabled or not registered');
    return;
  }

  if (pollInterval) {
    console.log('[Webhook] Already polling');
    return;
  }

  console.log(`[Webhook] Starting polling every ${intervalMs}ms`);
  
  // Poll immediately, then on interval
  void pollForEvents(prefs.webhookUserId);
  
  pollInterval = setInterval(() => {
    const currentPrefs = getAppPreferences();
    if (currentPrefs.webhookEnabled && currentPrefs.webhookUserId) {
      void pollForEvents(currentPrefs.webhookUserId);
    }
  }, intervalMs);
}

/**
 * Stop polling for webhook events
 */
export function stopWebhookPolling(): void {
  if (pollInterval) {
    console.log('[Webhook] Stopping polling');
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

/**
 * Poll the relay for new events
 */
async function pollForEvents(userId: string): Promise<void> {
  try {
    const url = new URL(`${WEBHOOK_RELAY_URL}/events/${userId}`);
    if (lastEventTimestamp) {
      url.searchParams.set('since', lastEventTimestamp);
    }

    const response = await fetch(url.toString());
    
    if (!response.ok) {
      console.error('[Webhook] Poll failed:', response.status);
      return;
    }

    const data = await response.json() as { events: WebhookEvent[]; count: number };
    
    if (data.count > 0) {
      console.log(`[Webhook] Received ${data.count} events`);
      await processEvents(data.events);
      
      // Update last timestamp
      const lastEvent = data.events[data.events.length - 1];
      if (lastEvent) {
        lastEventTimestamp = lastEvent.timestamp;
      }

      // Clear processed events
      await fetch(`${WEBHOOK_RELAY_URL}/events/${userId}?before=${lastEventTimestamp}`, {
        method: 'DELETE',
      });
    }
  } catch (error) {
    console.error('[Webhook] Poll error:', error);
  }
}

/**
 * Process webhook events and update local data
 */
async function processEvents(events: WebhookEvent[]): Promise<void> {
  for (const event of events) {
    try {
      await processEvent(event);
    } catch (error) {
      console.error('[Webhook] Error processing event:', event.id, error);
    }
  }

  // Notify renderer to refresh
  notifyRenderer('webhook:events-processed', { count: events.length });
}

/**
 * Process a single webhook event
 */
async function processEvent(event: WebhookEvent): Promise<void> {
  const eventType = event.data?.type || event.type;
  const entity = event.data?.entity;

  console.log(`[Webhook] Processing event: ${eventType}`, entity?.id?.substring(0, 8));

  switch (eventType) {
    case 'page.created': {
      if (entity?.type === 'page' && entity?.id) {
        // New task created in Notion - fetch and add to local DB
        const pageId = entity.id.replace(/-/g, '');
        console.log(`[Webhook] New task created in Notion: ${pageId}`);
        const task = await fetchTask(pageId);
        if (task) {
          upsertRemoteTask(task, task.id, new Date().toISOString());
          console.log(`[Webhook] ✨ Created new task locally: "${task.title}"`);
          notifyRenderer('webhook:task-created', { task });
        }
      }
      break;
    }
    
    case 'page.content_updated':
    case 'page.properties_updated':
    case 'page.updated': {
      if (entity?.type === 'page' && entity?.id) {
        // Existing task updated in Notion - fetch and update local DB
        const pageId = entity.id.replace(/-/g, '');
        console.log(`[Webhook] Task updated in Notion: ${pageId}`);
        const task = await fetchTask(pageId);
        if (task) {
          upsertRemoteTask(task, task.id, new Date().toISOString());
          console.log(`[Webhook] 🔄 Updated task locally: "${task.title}"`);
          notifyRenderer('webhook:task-updated', { task });
        }
      }
      break;
    }

    case 'page.deleted':
    case 'page.moved_to_trash': {
      if (entity?.type === 'page' && entity?.id) {
        // Mark task as deleted/trashed locally
        // For now, we'll let the next full sync handle this
        console.log(`[Webhook] Page deleted: ${entity.id}`);
        notifyRenderer('webhook:page-deleted', { pageId: entity.id });
      }
      break;
    }

    case 'page.restored': {
      if (entity?.type === 'page' && entity?.id) {
        const pageId = entity.id.replace(/-/g, '');
        const task = await fetchTask(pageId);
        if (task) {
          upsertRemoteTask(task, task.id, new Date().toISOString());
          console.log(`[Webhook] Restored task: ${task.title}`);
        }
      }
      break;
    }

    default:
      console.log(`[Webhook] Unhandled event type: ${eventType}`);
  }
}

/**
 * Notify renderer process of webhook events
 */
function notifyRenderer(channel: string, data: unknown): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  }
}

/**
 * Disable webhooks and clean up
 */
export async function disableWebhook(): Promise<void> {
  stopWebhookPolling();
  
  const prefs = getAppPreferences();
  await updateAppPreferences({
    ...prefs,
    webhookEnabled: false,
    webhookUserId: undefined,
    webhookUrl: undefined,
  });
  
  lastEventTimestamp = null;
  console.log('[Webhook] Disabled');
}

/**
 * Get current webhook status
 */
export function getWebhookStatus(): {
  enabled: boolean;
  webhookUrl?: string;
  webhookUserId?: string;
  isPolling: boolean;
} {
  const prefs = getAppPreferences();
  return {
    enabled: prefs.webhookEnabled ?? false,
    webhookUrl: prefs.webhookUrl,
    webhookUserId: prefs.webhookUserId,
    isPolling: pollInterval !== null,
  };
}

/**
 * Get the verification token that Notion sent (user pastes this back into Notion)
 */
export async function getVerificationToken(): Promise<{ verificationToken: string | null; message: string }> {
  const prefs = getAppPreferences();
  
  if (!prefs.webhookUserId) {
    return { verificationToken: null, message: 'Webhook not registered. Enable real-time sync first.' };
  }

  const response = await fetch(`${WEBHOOK_RELAY_URL}/verify/${prefs.webhookUserId}`);
  
  if (!response.ok) {
    return { verificationToken: null, message: 'Failed to fetch verification token.' };
  }

  const data = await response.json() as { verificationToken: string | null; message: string };
  return data;
}

