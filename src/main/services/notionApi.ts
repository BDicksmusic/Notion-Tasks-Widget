/**
 * Notion API wrapper with retry logic, rate limiting, and error handling.
 * This provides a resilient layer on top of the raw Notion SDK.
 */

import { Client, APIErrorCode, ClientErrorCode, isNotionClientError } from '@notionhq/client';
import fetch from 'node-fetch';

// Notion rate limits: 3 requests/second average
const MIN_REQUEST_INTERVAL_MS = 350; // ~2.8 req/sec to stay under limit
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
const REQUEST_TIMEOUT_MS = 120000; // 2 minutes for large Notion databases

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

