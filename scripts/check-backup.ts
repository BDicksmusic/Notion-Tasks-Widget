import Database = require('better-sqlite3');

const dbPath = 'C:/Users/Brandon/Dropbox/Apps/Notion Tasks Widget/backups/notion-backup.sqlite';
console.log('Database:', dbPath);

const db = new Database(dbPath);

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name: string}[];
console.log('Tables:', tables.map(t => t.name).join(', '));

const count = db.prepare('SELECT COUNT(*) as c FROM projects').get() as {c: number};
console.log('Projects count:', count.c);

if (count.c > 0) {
  const sample = db.prepare('SELECT client_id, title FROM projects LIMIT 5').all();
  console.log('Sample projects:', sample);
}

db.close();

