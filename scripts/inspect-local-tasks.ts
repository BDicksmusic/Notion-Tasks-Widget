import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

function resolveDbPath() {
  const appData =
    process.env.APPDATA ||
    (process.platform === 'darwin'
      ? path.join(process.env.HOME ?? '', 'Library/Application Support')
      : path.join(process.env.HOME ?? '', '.config'));
  const dbPath = path.join(
    appData,
    'NotionTasksWidget',
    'data',
    'notion-widget.sqlite'
  );
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found at ${dbPath}`);
  }
  return dbPath;
}

function main() {
  const dbPath = resolveDbPath();
  const db = new Database(dbPath, { readonly: true });
  const rows = db
    .prepare(
      `SELECT payload FROM tasks ORDER BY last_modified_local DESC LIMIT 25`
    )
    .all() as { payload: string }[];

  if (!rows.length) {
    console.log('[inspect] No tasks stored locally.');
    return;
  }

  console.log(`[inspect] Showing ${rows.length} tasks from ${dbPath}:`);
  rows.forEach((row, index) => {
    try {
      const task = JSON.parse(row.payload) as { title?: string; status?: string };
      console.log(
        `${index + 1}. "${task.title ?? '(untitled)'}" | status: ${
          task.status ?? '—'
        }`
      );
    } catch (error) {
      console.warn('[inspect] Failed to parse row', error);
    }
  });
}

main();





