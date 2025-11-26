/**
 * Quick script to check the actual SQLite database contents
 */
import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(
  process.env.APPDATA || '',
  'NotionTasksWidget',
  'data',
  'notion-widget.sqlite'
);

console.log('Database path:', dbPath);

const db = new Database(dbPath);

// Get task count
const count = db.prepare('SELECT COUNT(*) as count FROM tasks').get() as { count: number };
console.log('\n=== ACTUAL DATABASE CONTENTS ===');
console.log('Total tasks in database:', count.count);

// Get status breakdown
const statuses = db.prepare(`
  SELECT json_extract(payload, '$.status') as status, COUNT(*) as cnt 
  FROM tasks 
  GROUP BY status 
  ORDER BY cnt DESC 
  LIMIT 15
`).all() as { status: string | null; cnt: number }[];

console.log('\nTask status breakdown:');
statuses.forEach(s => console.log(`  ${s.status || '(null)'}: ${s.cnt}`));

// Get sample tasks
const samples = db.prepare(`
  SELECT 
    json_extract(payload, '$.title') as title, 
    json_extract(payload, '$.status') as status 
  FROM tasks 
  LIMIT 10
`).all() as { title: string; status: string }[];

console.log('\nSample tasks (first 10):');
samples.forEach((t, i) => console.log(`  ${i + 1}. "${t.title}" [${t.status}]`));

// Check sync state
const syncState = db.prepare('SELECT * FROM sync_state').all() as { key: string; value: string }[];
console.log('\nSync state:');
syncState.forEach(s => console.log(`  ${s.key}: ${s.value.substring(0, 50)}${s.value.length > 50 ? '...' : ''}`));

db.close();
console.log('\nDone!');





