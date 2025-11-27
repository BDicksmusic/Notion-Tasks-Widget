# 🔍 Hidden Automation & Background Processes
**Deep Dive Audit** - November 27, 2025  
**Every automatic trigger, timer, watcher, and background process**

---

## ⚡ AUTOMATIC TIMERS & INTERVALS

### 🔴 CRITICAL: Main Sync Loop (Backend)
```javascript
// File: src/main/services/syncEngine.ts:230
this.timer = setInterval(() => {
  void this.tick();
}, SYNC_INTERVAL_MS);  // 5 * 60 * 1000 = 5 minutes
```
**Runs:** Every 5 minutes, automatically  
**Does:** Pushes local changes, pulls remote updates  
**Can't be disabled!** Always runs once sync engine starts  
**Impact:** 🔴 HIGH - Core sync mechanism

---

### 💾 Database Backup Loop (Backend)
```javascript
// File: src/main/db/backupService.ts:74
const timer = setInterval(() => {
  void runBackup('scheduled');
}, intervalMs);  // DEFAULT: 5 * 60 * 1000 = 5 minutes
```
**Runs:** Every 5 minutes (same as sync!)  
**Does:** Creates SQLite backup file in `backups/notion-backup.sqlite`  
**Started:** Line 893 in main.ts: `startDatabaseBackupRoutine(db)`  
**Impact:** 🟡 MEDIUM - Competes with sync for disk I/O  
**Note:** Backup runs EVERY 5 MINUTES regardless of whether data changed!

---

### 🔄 UI Task Refresh Loops (Frontend)

#### Widget Window Auto-Refresh
```javascript
// File: src/renderer/App.tsx:699
if (appPreferences?.autoRefreshTasks) {
  const interval = window.setInterval(() => {
    fetchTasks();  // Calls IPC: tasks:fetch
  }, 5 * 60 * 1000);  // 5 minutes
}
```
**Runs:** Every 5 minutes (IF enabled in preferences)  
**Does:** Refetches task list from local SQLite  
**Controlled by:** `autoRefreshTasks` preference (default: false)  
**Impact:** 🟢 LOW - Local query only, but uses CPU

#### Fullscreen Window Auto-Refresh  
```javascript
// File: src/renderer/fullscreen/FullScreenApp.tsx:1718
if (appPreferences?.autoRefreshTasks) {
  const interval = window.setInterval(() => {
    fetchTasks();
  }, 5 * 60 * 1000);
}
```
**Runs:** Every 5 minutes in fullscreen view  
**Impact:** 🟢 LOW - Same as widget refresh

---

### ⏱️ Timer/Clock Update Loops (Frontend)

#### Task List View Timers (3 separate intervals!)
```javascript
// File: src/renderer/components/TaskList.tsx:403
const interval = window.setInterval(() => {
  setNow(Date.now());  // Update "5 minutes ago" displays
}, 60_000);  // Every 1 minute
```
**Count:** 3 different setInterval calls in TaskList.tsx  
**Impact:** 🟢 VERY LOW - Just UI updates

#### Time Tracker (Live Timer)
```javascript
// File: src/renderer/utils/useTimeTracker.ts:90
intervalRef.current = window.setInterval(() => {
  // Update elapsed seconds for running timers
}, 1000);  // Every 1 second
```
**Runs:** Only when task status = ⌚ (timer active)  
**Impact:** 🟢 VERY LOW - Just UI counter

#### Countdown Timer (Deadlines)
```javascript
// File: src/renderer/utils/useCountdownTimer.ts:211
intervalRef.current = window.setInterval(() => {
  // Update countdown displays
}, 1000);  // Every 1 second
```
**Impact:** 🟢 VERY LOW - Just UI

---

## 👁️ EVENT LISTENERS (Hidden Triggers)

### 🚨 CRITICAL: Window Focus Sync (Frontend)
```javascript
// File: src/renderer/App.tsx:712-720
window.addEventListener('focus', handleWindowFocus);

function handleWindowFocus() {
  // Trigger background sync when window gains focus
  widgetAPI.forceSync();  // ← HIDDEN SYNC TRIGGER!
  fetchTasks();
}
```
**Triggers:** EVERY TIME you click on the widget window!  
**Does:** Forces full sync cycle (push + pull)  
**Impact:** 🔴 HIGH - Can cause unexpected syncs  
**Problem:** If you click on widget frequently, triggers many syncs!

---

### 📡 Sync Engine Event Emitters (Backend)
```javascript
// File: src/main/services/syncEngine.ts:189
class SyncEngine extends EventEmitter {
  // Emits these events:
  this.emit('task-updated', task);           // Line 1597
  this.emit('timeLog-updated', entry);       // Line 1601  
  this.emit('projects-updated', projects);   // Line 1605
  this.emit('status', this.status);          // Line 1593
  this.emit('import-progress', progress);    // Line 455
  this.emit('tasksUpdated');                 // Line 306, 390
  this.emit('projectsUpdated');              // Line 404
}
```
**Listeners in main.ts (lines 968-992):**
- Broadcasts to ALL windows when tasks/projects update
- Triggers UI re-renders automatically
**Impact:** 🟡 MEDIUM - Broadcasts on every sync

### 📊 Import Queue Event Emitters (Backend)
```javascript
// File: src/main/services/importQueueManager.ts:265-266
this.emit('status-changed', type, updated);
this.emit('all-status-changed', this.getAllStatuses());
```
**Listener in main.ts (lines 1645-1649):**
- Broadcasts import progress to all windows
**Impact:** 🟢 LOW - Just progress updates

### 🔄 Auto-Updater Event Listeners (Backend)
```javascript
// File: src/main/services/updater.ts:81-137
autoUpdater.on('checking-for-update', ...);
autoUpdater.on('update-available', ...);
autoUpdater.on('update-not-available', ...);
autoUpdater.on('error', ...);
autoUpdater.on('download-progress', ...);
autoUpdater.on('update-downloaded', ...);
```
**Impact:** 🟢 LOW - Just update notifications

---

## 🎬 STARTUP AUTOMATION

### App Launch Sequence (main.ts: app.whenReady())
```
1. Initialize SQLite database
2. Start backup routine (every 5 min) ← AUTOMATIC
3. Initialize config store
4. Start sync engine ← TRIGGERS:
   - Clear stuck sync queue entries
   - Clear timeLog entries
   - Clear task entries  
   - Start syncActiveTasksOnStartup() ← BACKGROUND
   - Start 5-minute timer
5. Clean up old trashed tasks (>30 days)
6. Register global shortcuts
7. Create main window
8. Initialize updater
9. Open Control Center if credentials missing
```

**Hidden Problem:** Steps 2 & 4 start TWO timers that both run every 5 minutes!

---

## 🎯 PREFERENCE-CONTROLLED AUTO-FEATURES

### Auto-Refresh Tasks (Can Be Toggled Off)
- **Setting:** `autoRefreshTasks` (default: FALSE)
- **Where defined:** 
  - `src/main/system/appPreferences.ts:13`
  - `src/renderer/constants/preferences.ts:9`
- **What it does:** Adds 5-minute refresh timer in UI
- **Default:** Disabled ✓ Good!
- **Controlled by:** User checkbox in Settings

### Launch on Startup (Can Be Toggled Off)
- **Setting:** `launchOnStartup` (default: FALSE)
- **Where defined:** `src/main/system/appPreferences.ts:8`
- **What it does:** `app.setLoginItemSettings({ openAtLogin: true })`
- **Impact:** App auto-starts when you login to Windows

---

## 🗂️ SCRIPTS (Manual, But Could Be Automated)

### ⚠️ Potentially Dangerous Scripts
| Script | File | What It Does | Risk |
|--------|------|--------------|------|
| **sync-tasks-postgres.ts** | scripts/ | Syncs SQLite → PostgreSQL | 🔴 UNUSED FEATURE |
| **setup-postgres.ts** | scripts/ | Sets up PostgreSQL database | 🔴 UNUSED FEATURE |
| **clear-sync-queue.js** | scripts/ | Deletes ALL sync queue entries | 🟡 EMERGENCY TOOL |
| **reset-import.js** | scripts/ | Resets import state, optionally deletes tasks | 🟡 NUCLEAR OPTION |

### 🔧 Import/Testing Scripts (Safe)
| Script | File | What It Does | Usage |
|--------|------|--------------|-------|
| import-all-tasks.ts | scripts/ | Manual full import with retry | `npm run import:tasks` |
| test-active-imports.ts | scripts/ | Tests active task/project import | Verification |
| verify-notion-sync.ts | scripts/ | Verifies active imports work | Verification |
| import-tasks-direct.ts | scripts/ | Direct import bypass | Legacy |
| inspect-local-tasks.ts | scripts/ | View local SQLite data | Debugging |

### 🎨 Utility Scripts (Non-Sync)
| Script | File | What It Does |
|--------|------|--------------|
| build-main.js | scripts/ | Compiles main process |
| generate-icons.js | scripts/ | Generates app icons |
| create-backup-db.ts | scripts/ | Manual backup creation |
| check-schema.ts | scripts/ | Validates database schema |
| setup-autostart.ps1 | scripts/ | Windows startup script |
| create-release.ps1 | scripts/ | Build release package |

---

## 🐛 HIDDEN PROBLEMS DISCOVERED

### Problem 1: Triple Sync on Startup! 🚨
```
App Launches
  ├─> syncEngine.start()
  │     └─> syncActiveTasksOnStartup() [BACKGROUND]
  │           └─> Fetches active tasks from Notion
  │
  ├─> startDatabaseBackupRoutine()
  │     └─> Immediate backup + timer every 5 min
  │
  └─> tick() called immediately
        └─> Full sync cycle (push + pull)
```
**Result:** 3 operations hitting Notion API within seconds!

---

### Problem 2: Window Focus = Force Sync! 🚨
```
User clicks on widget window
  └─> window 'focus' event fires
        └─> widgetAPI.forceSync()
              └─> Full sync cycle triggered!
```
**Result:** Every time you interact with the widget, it syncs!  
**Hidden:** No visual indication this is happening  
**Impact:** Can cause many unnecessary sync operations

---

### Problem 3: Parallel 5-Minute Timers! 🚨
```
Timer 1: Sync Engine (every 5 min)
  └─> Push local changes + Pull remote updates

Timer 2: Database Backup (every 5 min)  
  └─> Create SQLite backup file

Timer 3: UI Auto-Refresh (every 5 min, if enabled)
  └─> Re-query local database

All running at slightly different times!
```
**Result:** Competing operations, disk I/O conflicts, unpredictable timing

---

### Problem 4: Rate Limiting in notion.ts 🚨
```javascript
// File: src/main/services/notion.ts
// Lines: 1827, 1868, 1941, 1974, 2133, 2174

await new Promise(r => setTimeout(r, 350)); // Rate limit
```
**Found:** 6 hardcoded 350ms delays scattered throughout notion.ts  
**Why:** Try to avoid Notion API rate limits  
**Problem:** Inconsistent - some operations have delays, others don't  
**Better approach:** Centralized rate limiter

---

### Problem 5: PostgreSQL "Ghost" System 🚨
```
Files found:
  - src/main/db/postgres.ts (91 lines)
  - src/main/db/repositories/taskRepositoryPostgres.ts (254 lines)
  - scripts/setup-postgres.ts (229 lines)
  - scripts/sync-tasks-postgres.ts (311 lines)
```
**What is it?** Alternative storage backend using PostgreSQL instead of SQLite  
**Is it running?** 🔴 NO - Code exists but never used  
**Why dangerous?** If accidentally enabled, would create duplicate sync system!  
**Action:** 🗑️ DELETE ALL - You use SQLite, not PostgreSQL

---

### Problem 6: Updater Auto-Check 🚨
```javascript
// File: src/main/services/updater.ts
// Auto-check for updates (happens automatically)
autoUpdater.on('checking-for-update', ...);
autoUpdater.on('update-available', ...);
```
**When:** Runs automatically on app launch (maybe?)  
**Impact:** 🟢 LOW - Just HTTP calls to GitHub  
**Note:** Not sync-related but adds to startup load

---

## 📋 COMPLETE AUTOMATION INVENTORY

### On App Startup (Immediate)
1. ✅ Initialize SQLite database
2. ✅ Create initial database backup
3. ✅ Clear stuck sync entries (>5 failures)
4. ✅ Clear all timeLog sync entries
5. ✅ Clear all task sync entries
6. ⚠️ **Start background sync of active tasks**
7. ✅ Register global shortcuts (Ctrl+F for fullscreen)
8. ⚠️ **Check for app updates (maybe)**
9. ✅ Clean up trashed tasks >30 days old

### Running Continuously (Timers)
1. 🔴 **Sync Engine Loop** - Every 5 min
2. 🔴 **Database Backup** - Every 5 min
3. 🟡 **UI Auto-Refresh** - Every 5 min (if `autoRefreshTasks` enabled)
4. 🟢 **Timer Updates** - Every 1 second (when timer active)
5. 🟢 **Countdown Updates** - Every 1 second
6. 🟢 **Relative Time Updates** - Every 1 minute ("5 min ago")

### On User Actions (Triggered)
1. 🔴 **Window Focus** → forceSync() ← HIDDEN!
2. ✅ Create Task → pushImmediate()
3. ✅ Update Task → pushImmediate()
4. ✅ Create Time Log → pushImmediate()
5. ✅ Update Time Log → pushImmediate()
6. ✅ Delete Time Log → pushImmediate()
7. ✅ Create Project → pushImmediate()
8. ✅ Update Project → pushImmediate()
9. ✅ Delete Project → pushImmediate()
10. ✅ Create Writing Entry → pushImmediate()

### On System Events (Electron)
1. ✅ `app.whenReady()` → Initialize everything
2. ✅ `app.on('before-quit')` → Stop backup routine
3. ✅ `app.on('will-quit')` → Unregister shortcuts
4. ✅ `app.on('window-all-closed')` → Quit app (Windows/Linux)
5. ✅ `app.on('activate')` → Recreate window (macOS)

---

## 🎛️ CONFIGURATION FLAGS

### Command-Line Flags
```javascript
// File: src/main/main.ts:951
if (process.argv.includes('--reset-import')) {
  syncEngine.resetImport();
}
```
**Usage:** `npm run start:reset` or manually add flag  
**Does:** Clears import state on startup  
**Hidden:** Not documented in README

### Environment Variables That Affect Sync
```javascript
// From env.example and configStore.ts
WIDGET_AUTO_REFRESH_TASKS=false       // UI auto-refresh
WIDGET_LAUNCH_ON_STARTUP=false        // Auto-launch on login
NOTION_WIDGET_BACKUP_PATH=...         // Backup location
PG_HOST=localhost                     // PostgreSQL (unused!)
PG_DATABASE=notion_tasks              // PostgreSQL (unused!)
```

---

## 🎯 SYNC TRIGGERS - COMPLETE MAP

### Automatic (Can't Control)
```
✗ Sync Engine Timer (5 min) → syncEngine.tick()
✗ Database Backup (5 min) → createBackupSnapshot()
✗ Startup Active Sync → syncActiveTasksOnStartup()
```

### User-Controlled (Preferences)
```
□ Auto-Refresh Tasks (5 min) → fetchTasks()
□ Launch on Startup → app starts automatically
```

### Event-Based (Hidden)
```
⚠️ Window Focus → forceSync() + fetchTasks()
✓ Task Created → pushImmediate()
✓ Task Updated → pushImmediate()
✓ Time Log Created → pushImmediate()
```

### Manual (Button Clicks)
```
✓ Import Tasks button
✓ Import Projects button
✓ Import Time Logs button
✓ Refresh Active Tasks button
✓ Force Sync button (in Control Center)
```

---

## 💣 DISCOVERED VULNERABILITIES

### 1. Focus Event Spam 🔴
**If user:** Clicks on widget 10 times in 1 minute  
**Result:** Triggers 10 full sync cycles!  
**Fix:** Debounce the focus handler (only sync once per 30 seconds)

### 2. Simultaneous 5-Minute Timers 🔴
**At 5-minute mark:**
- Sync engine ticks
- Database backs up
- UI refreshes (if enabled)

**Result:** Three operations compete for resources  
**Fix:** Stagger timers (sync at :00, backup at :02, refresh at :04)

### 3. Startup Sync Cascade 🔴
**Within first 10 seconds:**
1. Active tasks sync (background)
2. Initial database backup
3. First tick() sync cycle
4. Window gains focus → another sync!

**Result:** 4 sync operations before you even interact!  
**Fix:** Delay non-critical operations, debounce focus handler

### 4. PostgreSQL Ghost Code 🟡
**Risk:** If accidentally enabled via env vars, entire parallel storage system activates  
**Files:** 4 files, ~880 lines of code  
**Fix:** DELETE ALL - Not using PostgreSQL

---

## 🔒 RATE LIMITING DISCOVERED

### Notion API Rate Limits (notion.ts)
- 6 hardcoded `setTimeout(350ms)` delays
- Scattered throughout different functions
- Inconsistent application

### Missing Rate Limits
- ❌ No global rate limiter
- ❌ No request queue
- ❌ No backpressure handling
- ⚠️ Each sync operation manages its own timing

---

## 🧹 CLEANUP RECOMMENDATIONS

### 🔴 HIGH PRIORITY - Delete Immediately
1. **PostgreSQL system** (880 lines, unused)
   - `src/main/db/postgres.ts`
   - `src/main/db/repositories/taskRepositoryPostgres.ts`
   - `scripts/setup-postgres.ts`
   - `scripts/sync-tasks-postgres.ts`

2. **Empty/Dead files**
   - `src/main/services/schemaSyncService.ts` (0 bytes)

3. **Hidden duplicate scripts**
   - `scripts/import-tasks-direct.ts` (use import-all-tasks.ts instead)

### 🟡 MEDIUM PRIORITY - Fix Hidden Triggers
1. **Debounce window focus sync** (App.tsx:712)
   ```javascript
   // Only sync once per 30 seconds on focus
   const lastFocusSync = useRef(0);
   if (Date.now() - lastFocusSync.current > 30000) {
     widgetAPI.forceSync();
     lastFocusSync.current = Date.now();
   }
   ```

2. **Stagger timers** to avoid conflicts
   - Sync: every 5 min at :00
   - Backup: every 5 min at :30 (offset by 30 sec)
   - This prevents simultaneous operations

3. **Make backup smarter**
   - Only backup if data actually changed
   - Check last_modified before creating backup

### 🟢 LOW PRIORITY - Code Quality
1. Consolidate rate limiting into single utility
2. Remove duplicate fetchTasks methods
3. Document all timers in one place
4. Add timer registry/manager

---

## 📊 SUMMARY: AUTOMATIC OPERATIONS COUNT

### Current State (Too Many!)
- **7 timers** running continuously
- **3 event listeners** that trigger syncs
- **4 immediate syncs** on startup
- **1 hidden focus trigger** causing surprise syncs
- **880 lines** of PostgreSQL code (unused!)

### Target State (Simplified)
- **1 timer:** Sync engine (tasks only)
- **1 timer:** Smart backup (only when data changed)
- **0 hidden triggers** (remove focus sync)
- **1 sync** on startup (active tasks only)
- **0 lines** of unused database code

---

## 🎯 IMMEDIATE ACTION ITEMS

### Kill Hidden Triggers
- [ ] Remove window focus sync handler (App.tsx:712)
- [ ] Remove window focus sync handler (FullScreenApp.tsx:1740)
- [ ] Debounce or remove auto-sync on window events

### Delete Dead Code
- [ ] Delete entire PostgreSQL system (880 lines)
- [ ] Delete schemaSyncService.ts (empty)
- [ ] Delete duplicate import scripts

### Fix Timer Conflicts
- [ ] Stagger sync and backup timers
- [ ] Make backup conditional (only if data changed)
- [ ] Document timer schedule

### Verify Defaults
- [ ] Ensure `autoRefreshTasks` defaults to FALSE ✓
- [ ] Ensure `launchOnStartup` defaults to FALSE ✓
- [ ] Ensure `autoImportEnabled` defaults to FALSE ✓

---

**Ready to kill these hidden triggers?** The window focus sync is particularly sneaky - it makes the app sync every time you click on it! 🐛

