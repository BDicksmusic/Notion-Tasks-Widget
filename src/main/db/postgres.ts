/**
 * PostgreSQL database module for Notion Tasks Widget
 * Replaces SQLite with Postgres for more reliable sync
 */
import { Pool, PoolClient } from 'pg';

let pool: Pool | null = null;

export function initializePostgres(): Pool {
  if (pool) {
    return pool;
  }

  pool = new Pool({
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT || '5432'),
    database: process.env.PG_DATABASE || 'notion_tasks',
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || '',
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  pool.on('error', (err) => {
    console.error('[Postgres] Unexpected error on idle client', err);
  });

  console.log('[Postgres] Pool initialized', {
    host: process.env.PG_HOST || 'localhost',
    database: process.env.PG_DATABASE || 'notion_tasks',
  });

  return pool;
}

export function getPool(): Pool {
  if (!pool) {
    throw new Error('PostgreSQL pool has not been initialized yet');
  }
  return pool;
}

export async function getClient(): Promise<PoolClient> {
  const p = getPool();
  return p.connect();
}

export async function query<T = any>(text: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }> {
  const p = getPool();
  const result = await p.query(text, params);
  return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('[Postgres] Pool closed');
  }
}

// Check if Postgres is configured
export function isPostgresConfigured(): boolean {
  return !!(process.env.PG_HOST || process.env.PG_DATABASE);
}

// Test the connection
export async function testConnection(): Promise<{ success: boolean; message: string }> {
  try {
    const p = getPool();
    const client = await p.connect();
    const result = await client.query('SELECT COUNT(*) as count FROM tasks');
    client.release();
    return {
      success: true,
      message: `Connected to PostgreSQL (${result.rows[0].count} tasks)`
    };
  } catch (err: any) {
    return {
      success: false,
      message: err.message
    };
  }
}





