const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Check multiple possible paths - NOTE: app name is NotionTasksWidget not notion-tasks-widget
const paths = [
  path.join(os.homedir(), 'AppData', 'Roaming', 'NotionTasksWidget', 'data', 'notion-widget.sqlite'),  // CORRECT PATH
  path.join(os.homedir(), 'AppData', 'Roaming', 'notion-tasks-widget', 'data', 'notion-widget.sqlite'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'notion-tasks-widget', 'notion-tasks.sqlite'),
  path.join(__dirname, '..', 'backups', 'notion-backup.sqlite'),
  path.join(__dirname, '..', 'backups', 'app-db-copy.sqlite'),
];

let dbPath = null;
for (const p of paths) {
  if (fs.existsSync(p)) {
    const stats = fs.statSync(p);
    console.log(`Found: ${p} (${stats.size} bytes)`);
    if (stats.size > 0 && !dbPath) {
      dbPath = p;
    }
  } else {
    console.log(`Not found: ${p}`);
  }
}

// Check ALL valid databases
const validPaths = paths.filter(p => {
  try {
    return fs.existsSync(p) && fs.statSync(p).size > 0;
  } catch { return false; }
});

if (validPaths.length === 0) {
  console.log('No valid database found!');
  process.exit(1);
}

for (const dbPath of validPaths) {
  console.log('\n' + '='.repeat(60));
  console.log('Checking DB:', dbPath);

try {
  const db = new Database(dbPath);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log('Tables:', tables.map(t => t.name));
  
  if (tables.some(t => t.name === 'tasks')) {
    const taskCount = db.prepare('SELECT COUNT(*) as cnt FROM tasks').get();
    console.log('Task count:', taskCount?.cnt || 0);
    
    // Check for duplicates
    const duplicates = db.prepare(`
      SELECT notion_id, COUNT(*) as cnt 
      FROM tasks 
      WHERE notion_id IS NOT NULL 
      GROUP BY notion_id 
      HAVING cnt > 1
    `).all();
    console.log('Duplicate notion_ids in tasks:', duplicates.length);
    if (duplicates.length > 0) {
      console.log('Duplicates:', duplicates);
    }
  }
  
  db.close();
} catch(e) {
  console.log('Error:', e.message);
}
} // end for loop

