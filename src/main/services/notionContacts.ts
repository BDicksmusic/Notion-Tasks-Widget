/**
 * Notion Contacts Service
 * 
 * Simple, direct API operations for contacts.
 * No timers, no queues, no hidden automation.
 */

import { Client } from '@notionhq/client';
import type { Contact, ContactsSettings } from '../../shared/types';
import { createNotionClient, withRetry } from './notionApi';
import { getContactsSettings, getTaskSettings } from '../configStore';

// Cache the client
let client: Client | null = null;
let cachedApiKey: string | null = null;

/**
 * Get or create the Notion client
 */
function getClient(): Client {
  const contactsSettings = getContactsSettings();
  const taskSettings = getTaskSettings();
  const apiKey = contactsSettings.apiKey || taskSettings.apiKey;
  
  if (!client || apiKey !== cachedApiKey) {
    if (!apiKey) {
      throw new Error('Notion API key not configured');
    }
    client = createNotionClient(apiKey);
    cachedApiKey = apiKey;
  }
  
  return client;
}

/**
 * Parse a Notion page into a Contact object
 */
function parseNotionPage(page: any, settings: ContactsSettings): Contact {
  const props = page.properties || {};
  
  const getText = (propName?: string): string | null => {
    if (!propName) return null;
    const prop = props[propName];
    if (!prop) return null;
    
    if (prop.type === 'title') {
      return prop.title?.[0]?.plain_text ?? null;
    }
    if (prop.type === 'rich_text') {
      return prop.rich_text?.[0]?.plain_text ?? null;
    }
    if (prop.type === 'email') {
      return prop.email ?? null;
    }
    if (prop.type === 'phone_number') {
      return prop.phone_number ?? null;
    }
    return null;
  };
  
  const getRelationIds = (propName?: string): string[] | null => {
    if (!propName) return null;
    const prop = props[propName];
    if (!prop || prop.type !== 'relation') return null;
    return prop.relation?.map((r: any) => r.id) ?? null;
  };
  
  return {
    id: page.id,
    name: getText(settings.nameProperty),
    email: getText(settings.emailProperty),
    phone: getText(settings.phoneProperty),
    company: getText(settings.companyProperty),
    role: getText(settings.roleProperty),
    notes: getText(settings.notesProperty),
    projectIds: getRelationIds(settings.projectsRelationProperty),
    url: page.url
  };
}

/**
 * Fetch contacts from Notion
 */
export async function fetchContacts(limit: number = 100): Promise<Contact[]> {
  const settings = getContactsSettings();
  const taskSettings = getTaskSettings();
  const apiKey = settings.apiKey || taskSettings.apiKey;
  
  if (!apiKey || !settings.databaseId) {
    console.warn('[NotionContacts] Cannot fetch - no settings configured');
    return [];
  }
  
  console.log('[NotionContacts] Fetching contacts...');
  
  const notionClient = getClient();
  const contacts: Contact[] = [];
  let cursor: string | undefined;
  let fetched = 0;
  
  do {
    const response: any = await withRetry(
      notionClient,
      () => (notionClient.databases as any).query({
        database_id: settings.databaseId,
        page_size: Math.min(100, limit - fetched),
        start_cursor: cursor
      }),
      'Fetch contacts'
    );
    
    for (const page of response.results) {
      try {
        contacts.push(parseNotionPage(page, settings));
        fetched++;
        if (fetched >= limit) break;
      } catch (err) {
        console.warn('[NotionContacts] Failed to parse page:', page.id, err);
      }
    }
    
    cursor = response.has_more && fetched < limit ? response.next_cursor : undefined;
  } while (cursor);
  
  console.log(`[NotionContacts] Fetched ${contacts.length} contacts`);
  return contacts;
}

/**
 * Fetch a single contact by ID
 */
export async function fetchContact(contactId: string): Promise<Contact | null> {
  const settings = getContactsSettings();
  const taskSettings = getTaskSettings();
  const apiKey = settings.apiKey || taskSettings.apiKey;
  
  if (!apiKey) {
    return null;
  }
  
  try {
    const notionClient = getClient();
    const page = await withRetry(
      notionClient,
      () => notionClient.pages.retrieve({ page_id: contactId }),
      `Fetch contact ${contactId.substring(0, 8)}`
    );
    
    return parseNotionPage(page, settings);
  } catch (error) {
    console.error('[NotionContacts] Failed to fetch contact:', contactId, error);
    return null;
  }
}

/**
 * Create a new contact in Notion
 */
export async function createContact(payload: {
  name: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  role?: string | null;
  notes?: string | null;
  projectIds?: string[] | null;
}): Promise<Contact | null> {
  const settings = getContactsSettings();
  const taskSettings = getTaskSettings();
  const apiKey = settings.apiKey || taskSettings.apiKey;
  
  if (!apiKey || !settings.databaseId) {
    throw new Error('Contacts settings not configured');
  }
  
  console.log('[NotionContacts] Creating contact:', payload.name);
  
  const properties: any = {};
  
  // Name (title)
  if (settings.nameProperty) {
    properties[settings.nameProperty] = {
      title: [{ text: { content: payload.name } }]
    };
  }
  
  // Email
  if (settings.emailProperty && payload.email) {
    properties[settings.emailProperty] = {
      email: payload.email
    };
  }
  
  // Phone
  if (settings.phoneProperty && payload.phone) {
    properties[settings.phoneProperty] = {
      phone_number: payload.phone
    };
  }
  
  // Company
  if (settings.companyProperty && payload.company) {
    properties[settings.companyProperty] = {
      rich_text: [{ text: { content: payload.company } }]
    };
  }
  
  // Role
  if (settings.roleProperty && payload.role) {
    properties[settings.roleProperty] = {
      rich_text: [{ text: { content: payload.role } }]
    };
  }
  
  // Notes
  if (settings.notesProperty && payload.notes) {
    properties[settings.notesProperty] = {
      rich_text: [{ text: { content: payload.notes } }]
    };
  }
  
  // Projects relation
  if (settings.projectsRelationProperty && payload.projectIds?.length) {
    properties[settings.projectsRelationProperty] = {
      relation: payload.projectIds.map(id => ({ id }))
    };
  }
  
  const notionClient = getClient();
  const page = await withRetry(
    notionClient,
    () => notionClient.pages.create({
      parent: { database_id: settings.databaseId },
      properties
    }),
    'Create contact'
  );
  
  console.log('[NotionContacts] Created contact:', page.id);
  return parseNotionPage(page, settings);
}

/**
 * Update a contact in Notion
 */
export async function updateContact(
  contactId: string,
  updates: {
    name?: string;
    email?: string | null;
    phone?: string | null;
    company?: string | null;
    role?: string | null;
    notes?: string | null;
    projectIds?: string[] | null;
  }
): Promise<Contact | null> {
  const settings = getContactsSettings();
  const taskSettings = getTaskSettings();
  const apiKey = settings.apiKey || taskSettings.apiKey;
  
  if (!apiKey) {
    throw new Error('Notion not configured');
  }
  
  console.log('[NotionContacts] Updating contact:', contactId.substring(0, 8));
  
  const properties: any = {};
  
  // Name
  if (updates.name !== undefined && settings.nameProperty) {
    properties[settings.nameProperty] = {
      title: [{ text: { content: updates.name } }]
    };
  }
  
  // Email
  if (updates.email !== undefined && settings.emailProperty) {
    properties[settings.emailProperty] = {
      email: updates.email ?? null
    };
  }
  
  // Phone
  if (updates.phone !== undefined && settings.phoneProperty) {
    properties[settings.phoneProperty] = {
      phone_number: updates.phone ?? null
    };
  }
  
  // Company
  if (updates.company !== undefined && settings.companyProperty) {
    properties[settings.companyProperty] = {
      rich_text: updates.company ? [{ text: { content: updates.company } }] : []
    };
  }
  
  // Role
  if (updates.role !== undefined && settings.roleProperty) {
    properties[settings.roleProperty] = {
      rich_text: updates.role ? [{ text: { content: updates.role } }] : []
    };
  }
  
  // Notes
  if (updates.notes !== undefined && settings.notesProperty) {
    properties[settings.notesProperty] = {
      rich_text: updates.notes ? [{ text: { content: updates.notes } }] : []
    };
  }
  
  // Projects relation
  if (updates.projectIds !== undefined && settings.projectsRelationProperty) {
    properties[settings.projectsRelationProperty] = {
      relation: (updates.projectIds ?? []).map(id => ({ id }))
    };
  }
  
  const notionClient = getClient();
  const page = await withRetry(
    notionClient,
    () => notionClient.pages.update({
      page_id: contactId,
      properties
    }),
    'Update contact'
  );
  
  console.log('[NotionContacts] Updated contact:', contactId.substring(0, 8));
  return parseNotionPage(page, settings);
}

/**
 * Check if contacts are configured
 */
export function isConfigured(): boolean {
  const settings = getContactsSettings();
  const taskSettings = getTaskSettings();
  const apiKey = settings.apiKey || taskSettings.apiKey;
  return Boolean(apiKey && settings.databaseId);
}

