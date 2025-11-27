/**
 * Notion API wrapper with retry logic, rate limiting, and error handling.
 * This provides a resilient layer on top of the raw Notion SDK.
 */

import { Client, APIErrorCode, ClientErrorCode, isNotionClientError } from '@notionhq/client';
import fetch from 'node-fetch';

// Notion rate limits: 3 requests/second average
const MIN_REQUEST_INTERVAL_MS = 350; // ~2.8 req/sec to stay under limit
const MAX_RETRIES = 5; // Increased from 3 - 504s are often transient
const INITIAL_BACKOFF_MS = 2000; // Increased from 1000 - give Notion time to recover
const MAX_BACKOFF_MS = 60000; // Increased from 30000 - longer max backoff
const REQUEST_TIMEOUT_MS = 180000; // 3 minutes (increased from 2)

type RetryableError = {
  code: string;
  status?: number;
  message: string;
};

// Track last request time per client for rate limiting
const lastRequestTime = new WeakMap<Client, number>();

/**
 * Create a Notion client with extended timeout
 * Using default fetch (no custom wrapper) for better compatibility
 */
export function createNotionClient(apiKey: string): Client {
  return new Client({
    auth: apiKey,
    timeoutMs: REQUEST_TIMEOUT_MS
  });
}

/**
 * Check if an error is retryable
 */
function isRetryableError(error: unknown): error is RetryableError {
  if (!error || typeof error !== 'object') return false;
  
  const err = error as Record<string, unknown>;
  
  // Check HTTP status codes (504, 502, 503, 500 are retryable)
  const status = (err as any).status;
  if (typeof status === 'number') {
    if (status === 504 || status === 502 || status === 503 || status === 500 || status === 429) {
      return true;
    }
  }
  
  // Notion client errors
  if (isNotionClientError(error)) {
    // Retry on timeouts
    if (error.code === ClientErrorCode.RequestTimeout) return true;
    // Retry on rate limits
    if (error.code === APIErrorCode.RateLimited) return true;
    // Retry on service unavailable
    if (error.code === APIErrorCode.ServiceUnavailable) return true;
    // Retry on internal server errors
    if (error.code === APIErrorCode.InternalServerError) return true;
  }
  
  // Network errors
  const message = String(err.message ?? '');
  const networkPatterns = [
    'ECONNRESET',
    'ECONNREFUSED',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ETIMEDOUT',
    'socket hang up',
    'network',
    'timeout',
    'fetch failed',
    '504',
    '502',
    'gateway'
  ];
  
  return networkPatterns.some(pattern => 
    message.toLowerCase().includes(pattern.toLowerCase())
  );
}

/**
 * Calculate backoff delay with jitter
 */
function calculateBackoff(attempt: number, baseMs: number = INITIAL_BACKOFF_MS): number {
  const exponentialDelay = baseMs * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, MAX_BACKOFF_MS);
  // Add jitter: ±25%
  const jitter = cappedDelay * 0.25 * (Math.random() * 2 - 1);
  return Math.round(cappedDelay + jitter);
}

/**
 * Sleep for a given duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Rate-limited request wrapper
 */
async function rateLimitedRequest<T>(
  client: Client,
  operation: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const lastTime = lastRequestTime.get(client) ?? 0;
  const elapsed = now - lastTime;
  
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await sleep(MIN_REQUEST_INTERVAL_MS - elapsed);
  }
  
  lastRequestTime.set(client, Date.now());
  return operation();
}

/**
 * Execute a Notion API call with automatic retries and rate limiting
 */
export async function withRetry<T>(
  client: Client,
  operation: () => Promise<T>,
  context: string = 'Notion API call'
): Promise<T> {
  let lastError: unknown;
  
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await rateLimitedRequest(client, operation);
    } catch (error) {
      lastError = error;
      
      if (!isRetryableError(error)) {
        console.error(`[NotionAPI] ${context} failed (non-retryable):`, error);
        throw error;
      }
      
      if (attempt < MAX_RETRIES) {
        const backoff = calculateBackoff(attempt);
        console.warn(
          `[NotionAPI] ${context} failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}), ` +
          `retrying in ${backoff}ms:`,
          error instanceof Error ? error.message : error
        );
        await sleep(backoff);
      }
    }
  }
  
  console.error(`[NotionAPI] ${context} failed after ${MAX_RETRIES + 1} attempts`);
  throw lastError;
}

/**
 * Paginated query helper - fetches all pages of results
 */
export async function queryAllPages<T>(
  client: Client,
  queryFn: (cursor?: string) => Promise<{ results: T[]; next_cursor: string | null; has_more: boolean }>,
  context: string = 'paginated query'
): Promise<T[]> {
  const allResults: T[] = [];
  let cursor: string | undefined;
  let pageCount = 0;
  
  do {
    const response = await withRetry(
      client,
      () => queryFn(cursor),
      `${context} (page ${pageCount + 1})`
    );
    
    allResults.push(...response.results);
    cursor = response.next_cursor ?? undefined;
    pageCount++;
  } while (cursor);
  
  return allResults;
}

/**
 * Build a "last edited after" filter for incremental sync
 */
export function buildLastEditedFilter(since: string | null) {
  if (!since) return undefined;
  
  return {
    timestamp: 'last_edited_time' as const,
    last_edited_time: {
      on_or_after: since
    }
  };
}

/**
 * Combine filters with AND logic
 */
export function andFilters(...filters: (object | undefined)[]): object | undefined {
  const validFilters = filters.filter(Boolean) as object[];
  
  if (validFilters.length === 0) return undefined;
  if (validFilters.length === 1) return validFilters[0];
  
  return { and: validFilters };
}

/**
 * Error classification for UI feedback
 */
export type SyncErrorType = 'network' | 'auth' | 'rate_limit' | 'not_found' | 'validation' | 'unknown';

export function classifyError(error: unknown): SyncErrorType {
  if (!error) return 'unknown';
  
  if (isNotionClientError(error)) {
    switch (error.code) {
      case ClientErrorCode.RequestTimeout:
        return 'network';
      case APIErrorCode.RateLimited:
        return 'rate_limit';
      case APIErrorCode.Unauthorized:
        return 'auth';
      case APIErrorCode.ObjectNotFound:
        return 'not_found';
      case APIErrorCode.ValidationError:
        return 'validation';
      default:
        return 'unknown';
    }
  }
  
  const message = String((error as any)?.message ?? '');
  if (/network|timeout|ECONN|EAI_AGAIN|fetch failed/i.test(message)) {
    return 'network';
  }
  
  return 'unknown';
}

export function getErrorMessage(error: unknown, type: SyncErrorType): string {
  switch (type) {
    case 'network':
      return 'Network connection issue. Will retry automatically.';
    case 'auth':
      return 'Authentication failed. Please check your API key in Settings.';
    case 'rate_limit':
      return 'Rate limited by Notion. Will retry shortly.';
    case 'not_found':
      return 'Database not found. Please verify your database ID.';
    case 'validation':
      return 'Invalid data format. Please check your configuration.';
    default:
      return error instanceof Error ? error.message : 'An unknown error occurred.';
  }
}

/**
 * Check if an error is a 504 Gateway Timeout
 */
export function is504Error(error: unknown): boolean {
  if (!error) return false;
  
  const status = (error as any)?.status;
  if (status === 504) return true;
  
  const message = String((error as any)?.message ?? '');
  return message.includes('504') || message.toLowerCase().includes('gateway timeout');
}

/**
 * Use Notion Search API to find pages in a database.
 * This is MUCH faster than databases.query for complex databases because:
 * 1. It doesn't compute rollups/relations
 * 2. Returns minimal data
 * 3. Uses Notion's search index instead of scanning the database
 * 
 * @param client - Notion client
 * @param databaseId - Database ID to search within
 * @param query - Optional search query (empty = all pages)
 * @param pageSize - Number of results per page
 * @param cursor - Pagination cursor
 * @returns Page IDs and pagination info
 */
export async function searchPagesInDatabase(
  client: Client,
  databaseId: string,
  query: string = '',
  pageSize: number = 10,
  cursor?: string
): Promise<{
  pageIds: string[];
  nextCursor: string | null;
  hasMore: boolean;
}> {
  const cleanDbId = databaseId.replace(/-/g, '').trim();
  
  console.log(`[NotionAPI] Using Search API for database ${cleanDbId.substring(0, 8)}... (query: "${query || '*'}", pageSize: ${pageSize})`);
  
  const searchParams: Parameters<typeof client.search>[0] = {
    query,
    page_size: pageSize,
    filter: {
      property: 'object',
      value: 'page'
    },
    ...(cursor && { start_cursor: cursor })
  };
  
  const response = await withRetry(
    client,
    () => client.search(searchParams),
    'Search for pages'
  );
  
  // Filter results to only pages from our target database
  const pageIds: string[] = [];
  for (const result of response.results) {
    if (result.object !== 'page') continue;
    const parent = (result as any).parent;
    if (!parent || parent.type !== 'database_id') continue;
    const parentDbId = parent.database_id.replace(/-/g, '');
    if (parentDbId === cleanDbId) {
      pageIds.push(result.id);
    }
  }
  
  console.log(`[NotionAPI] Search found ${pageIds.length} pages in target database (total results: ${response.results.length})`);
  
  return {
    pageIds,
    nextCursor: response.next_cursor ?? null,
    hasMore: response.has_more
  };
}

/**
 * Retrieve multiple pages by their IDs in parallel.
 * pages.retrieve NEVER times out on complex databases because it only fetches one page.
 * 
 * @param client - Notion client
 * @param pageIds - Array of page IDs to retrieve
 * @param concurrency - Number of parallel requests (default 3)
 * @returns Array of page responses
 */
export async function retrievePagesById<T>(
  client: Client,
  pageIds: string[],
  concurrency: number = 3
): Promise<T[]> {
  const pages: T[] = [];
  
  // Process in batches for controlled concurrency
  for (let i = 0; i < pageIds.length; i += concurrency) {
    const batch = pageIds.slice(i, i + concurrency);
    
    const results = await Promise.all(
      batch.map(async (pageId) => {
        try {
          const page = await withRetry(
            client,
            () => client.pages.retrieve({ page_id: pageId }),
            `Retrieve page ${pageId.substring(0, 8)}`
          );
          return page as T;
        } catch (error) {
          console.error(`[NotionAPI] Failed to retrieve page ${pageId}:`, error);
          return null;
        }
      })
    );
    
    // Filter out nulls and add to pages array
    for (const result of results) {
      if (result !== null) {
        pages.push(result);
      }
    }
  }
  
  return pages;
}

