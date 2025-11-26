/**
 * Extracts the database ID from a Notion URL or returns the input if it's already an ID
 * 
 * Supports formats like:
 * - https://www.notion.so/workspace/12d8cc9f36f180849cc6d39db3826ac6
 * - https://www.notion.so/workspace/12d8cc9f36f180849cc6d39db3826ac6?v=...
 * - https://www.notion.so/bdicksmusic/12d8cc9f36f180849cc6d39db3826ac6?v=2028cc9f36f1806496a0000c8f2ae51c
 * - 12d8cc9f36f180849cc6d39db3826ac6 (already an ID)
 * - 12d8cc9f-36f1-8084-9cc6-d39db3826ac6 (ID with dashes)
 */
export function extractDatabaseId(input: string): string {
  if (!input || !input.trim()) {
    return '';
  }

  const trimmed = input.trim();

  // First, try to extract from Notion URL patterns
  // Pattern 1: notion.so/workspace/DATABASE_ID or notion.so/workspace/DATABASE_ID?v=...
  const urlPattern1 = /notion\.so\/[^\/]+\/([0-9a-f]{32})/i;
  const match1 = trimmed.match(urlPattern1);
  if (match1 && match1[1]) {
    return match1[1].toLowerCase();
  }

  // Pattern 2: Look for 32-character hex string anywhere in the URL
  const urlPattern2 = /([0-9a-f]{32})/i;
  const match2 = trimmed.match(urlPattern2);
  if (match2 && match2[1]) {
    return match2[1].toLowerCase();
  }

  // If it's already a 32-character hex string (with or without dashes), return it
  const cleanId = trimmed.replace(/[-\s]/g, '');
  if (/^[0-9a-f]{32}$/i.test(cleanId)) {
    return cleanId.toLowerCase();
  }

  // Try alternative pattern for UUID format with dashes
  const uuidPattern = /([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})/i;
  const uuidMatch = trimmed.match(uuidPattern);
  if (uuidMatch) {
    // Reconstruct the 32-character ID
    return uuidMatch.slice(1).join('').toLowerCase();
  }

  // If no pattern matches, return the original input (let validation handle it)
  return trimmed;
}

/**
 * Checks if the input looks like a Notion URL
 */
export function isNotionUrl(input: string): boolean {
  return /notion\.so/i.test(input.trim());
}

