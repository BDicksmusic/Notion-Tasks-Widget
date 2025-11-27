# Complete Sync Functions Inventory
**Generated:** November 27, 2025  
**Purpose:** Track every single sync function/mechanism in the system

---

## 📡 AUTOMATIC SYNC FUNCTIONS (Run Without User Action)

### 🔄 Startup Sync (Runs When App Launches)
| Function | File | Line | What It Does | Status | Notes |
|----------|------|------|--------------|--------|-------|
| `syncActiveTasksOnStartup()` | syncEngine.ts | 290 | Syncs active (non-completed) tasks on app launch | ✅ ACTIVE | Just simplified - tasks only now |
| `start()` | syncEngine.ts | 213 | Initializes sync engine, clears stuck entries, starts timer | ✅ ACTIVE | Runs on app launch |

### 🔁 Background Sync Loop (Runs Every 5 Minutes)
| Function | File | Line | What It Does | Status | Notes |
|----------|------|------|--------------|--------|-------|
| `tick()` | syncEngine.ts | 888 | Main sync loop - pushes local changes, pulls remote | ✅ ACTIVE | Runs every 5 min |
| `pullRemote()` | syncEngine.ts | 1004 | Pulls updates from Notion | ✅ ACTIVE | Just simplified - tasks only |
| `pullTasks()` | syncEngine.ts | 1120 | Fetches task pages from Notion | ✅ ACTIVE | Core sync function |
| `pushPending()` | syncEngine.ts | 960 | Pushes local changes to Notion | ✅ ACTIVE | Processes sync queue |

### 🚫 DISABLED Automatic Syncs
| Function | File | Line | What It Does | Status | Notes |
|----------|------|------|--------------|--------|-------|
| `pullTimeLogs()` | syncEngine.ts | 1201 | Pull time logs from Notion | 🔴 DISABLED | Causes 504 timeouts! |
| `pullProjects()` | syncEngine.ts | 1254 | Pull projects from Notion | 🟡 REMOVED | Was in auto-sync, now manual-only |

---

## 🎯 MANUAL IMPORT FUNCTIONS (User Triggers via UI)

### Primary Imports (Full Database Fetch)
| Function | IPC Channel | File | Line | What It Does | Keep? |
|----------|-------------|------|------|--------------|-------|
| `startManualImport()` | `sync:importTasks` | syncEngine.ts | 268 | Full task import (all tasks) | ✅ YES |
| `performInitialImport()` | `sync:performInitialImport` | syncEngine.ts | 488 | Initial task import (first-time setup) | ✅ YES |
| `importProjects()` | `sync:importProjects` | syncEngine.ts | 1309 | Import all projects from Notion | 🤔 OPTIONAL |
| `importTimeLogs()` | `sync:importTimeLogs` | syncEngine.ts | 1341 | Import time logs from Notion | ⚠️ CAUSES ISSUES |
| `importContacts()` | `sync:importContacts` | syncEngine.ts | 1370 | Import contacts from Notion | 🤔 RARELY USED |

### Quick Refresh Imports (Active Items Only)
| Function | IPC Channel | File | Line | What It Does | Keep? |
|----------|-------------|------|------|--------------|-------|
| `importActiveTasksOnly()` | `sync:importActiveTasksOnly` | syncEngine.ts | 398 | Refresh only non-completed tasks | ✅ YES |
| `importActiveProjectsOnly()` | `sync:importActiveProjectsOnly` | syncEngine.ts | 412 | Refresh only non-completed projects | 🤔 OPTIONAL |

### Special Import Functions
| Function | IPC Channel | File | Line | What It Does | Keep? |
|----------|-------------|------|------|--------------|-------|
| `importTaskById()` | `sync:importTaskById` | syncEngine.ts | 856 | Import single specific task | 🤔 OPTIONAL |
| `resetImport()` | `sync:resetImport` | syncEngine.ts | 831 | Clear import state to start fresh | ✅ YES |

---

## 📥 NOTION API FETCH FUNCTIONS (Low-Level)

### Task Fetching (notion.ts)
| Function | Line | What It Does | Called By | Keep? |
|----------|------|--------------|-----------|-------|
| `getTasksPage()` | 204 | Fetch one page of tasks from Notion | syncEngine | ✅ YES |
| `getTasks()` | 290 | Fetch all tasks (wrapper) | Legacy code | 🤔 MAYBE |
| `getTasksBatchReliably()` | 1727 | Batch fetch with retry logic | Import functions | ✅ YES |
| `importTasksWithDateChunks()` | 1634 | Import tasks by date ranges | performInitialImport | ✅ YES |
| `importActiveTasks()` | 1753 | Fetch only active tasks | syncActiveTasksOnStartup | ✅ YES |
| `importActiveTasksFirst()` | 1665 | Priority: active before completed | Legacy? | 🤔 MAYBE |

### Project Fetching (notion.ts)
| Function | Line | What It Does | Called By | Keep? |
|----------|------|--------------|-----------|-------|
| `getProjects()` | 1100 | Fetch all projects from Notion | Manual import | 🤔 OPTIONAL |
| `importProjectsWithDateChunks()` | 1715 | Import projects by date ranges | importProjects | 🤔 OPTIONAL |
| `importActiveProjects()` | 2064 | Fetch only active projects | Was in auto-sync | 🟡 REMOVE |
| `syncActiveProjectsOnly()` | 2204 | Sync active projects | Legacy? | 🟡 REMOVE |

### Time Log Fetching (notion.ts)
| Function | Line | What It Does | Called By | Keep? |
|----------|------|--------------|-----------|-------|
| `getAllTimeLogs()` | 789 | Fetch all time logs | pullTimeLogs | ⚠️ CAUSES 504 |
| `importTimeLogsWithDateChunks()` | 1704 | Import time logs by date ranges | importTimeLogs | ⚠️ PROBLEMATIC |
| `getActiveTimeLogEntry()` | 538 | Get active timer for task | UI query | ✅ YES |
| `getTotalLoggedTime()` | 626 | Get total time logged for task | UI query | ✅ YES |
| `getAllTimeLogEntries()` | 697 | Get all logs for one task | UI query | ✅ YES |

### Other Fetching (notion.ts)
| Function | Line | What It Does | Called By | Keep? |
|----------|------|--------------|-----------|-------|
| `getContacts()` | 1686 | Fetch contacts from Notion | Manual import | 🤔 RARELY USED |
| `refreshContacts()` | 1690 | Refresh contacts | Manual import | 🤔 RARELY USED |
| `getStatusOptions()` | 1337 | Fetch task statuses | UI initialization | ✅ YES |
| `getOrderOptions()` | 1370 | Fetch order options | UI initialization | ✅ YES |
| `getProjectStatusOptions()` | 1695 | Fetch project statuses | UI initialization | 🤔 OPTIONAL |
| `fetchProjectStatusOptionsFromNotion()` | 1699 | Fetch project statuses fresh | Manual refresh | 🤔 OPTIONAL |

---

## 📤 NOTION API PUSH FUNCTIONS (Write to Notion)

### Task Operations
| Function | File | Line | What It Does | Triggered By | Keep? |
|----------|------|------|--------------|--------------|-------|
| `addTask()` | notion.ts | 311 | Create new task in Notion | User creates task | ✅ YES |
| `updateTask()` | notion.ts | 396 | Update existing task in Notion | User edits task | ✅ YES |

### Time Log Operations
| Function | File | Line | What It Does | Triggered By | Keep? |
|----------|------|------|--------------|--------------|-------|
| `createTimeLogEntry()` | notion.ts | 1396 | Create time log in Notion | User logs time | ✅ YES |
| `updateTimeLogEntry()` | notion.ts | 922 | Update time log in Notion | User edits log | ✅ YES |
| `deleteTimeLogEntry()` | notion.ts | 1044 | Delete time log from Notion | User deletes log | ✅ YES |

### Writing Operations
| Function | File | Line | What It Does | Triggered By | Keep? |
|----------|------|------|--------------|--------------|-------|
| `createWritingEntry()` | notion.ts | 103 | Create writing entry in Notion | User writes notes | 🤔 OPTIONAL |

---

## 🔧 SYNC ENGINE INTERNAL FUNCTIONS

### Processing Functions
| Function | File | Line | What It Does | Called By | Keep? |
|----------|------|------|--------------|-----------|-------|
| `processTaskEntry()` | syncEngine.ts | ~1497 | Process one task from sync queue | pushPending | ✅ YES |
| `processTimeLogEntry()` | syncEngine.ts | ~1568 | Process one time log from sync queue | pushPending | ⚠️ IF KEEPING TIMELOGS |
| `processWritingEntry()` | syncEngine.ts | ~1616 | Process one writing entry from sync queue | pushPending | 🤔 OPTIONAL |

### Helper Functions
| Function | File | Line | What It Does | Called By | Keep? |
|----------|------|------|--------------|-----------|-------|
| `pullTasksWithCountDirect()` | syncEngine.ts | 1092 | Pull tasks with explicit cursor | Legacy | 🤔 MAYBE UNUSED |
| `pullTasksWithCount()` | syncEngine.ts | 1129 | Pull tasks and return count | Legacy | 🤔 MAYBE UNUSED |
| `pullTasksWithPartition()` | syncEngine.ts | 797 | Pull tasks with date filters | Legacy partition system | 🟡 OLD APPROACH |
| `performTasksImportInternal()` | syncEngine.ts | 573 | Internal task import logic | performInitialImport | ✅ YES |
| `ensureTaskCacheMatchesFilter()` | syncEngine.ts | 947 | Reset cursor if filter changed | tick | ✅ YES |
| `withAbortAndTimeout()` | syncEngine.ts | 513 | Wrap promise with timeout/abort | Import functions | ✅ YES |

---

## 🎛️ IPC HANDLERS (UI → Main Process Commands)

### Sync Control
| IPC Channel | Handler | File | Line | What It Does | Keep? |
|-------------|---------|------|------|--------------|-------|
| `sync:status` | `getStatus()` | main.ts | 1559 | Get current sync state | ✅ YES |
| `sync:force` | `forceSync()` | main.ts | 1560 | Force immediate sync | ✅ YES |
| `sync:timestamps` | `getSyncTimestamps()` | main.ts | 1564 | Get last sync times | ✅ YES |
| `sync:isInitialImportDone` | `isInitialImportDone()` | main.ts | 1592 | Check if first import done | ✅ YES |
| `sync:getImportProgress` | `getImportProgress()` | main.ts | 1614 | Get import progress % | ✅ YES |
| `sync:resetImport` | `resetImport()` | main.ts | 1617 | Reset import state | ✅ YES |
| `sync:testConnection` | `testConnection()` | main.ts | 1589 | Test Notion API connection | ✅ YES |

### Manual Imports
| IPC Channel | Handler | File | Line | What It Does | Keep? |
|-------------|---------|------|------|--------------|-------|
| `sync:importTasks` | `startManualImport()` | main.ts | 1565 | Import all tasks | ✅ YES |
| `sync:importProjects` | `importProjects()` | main.ts | 1569 | Import all projects | 🤔 OPTIONAL |
| `sync:importTimeLogs` | `importTimeLogs()` | main.ts | 1573 | Import all time logs | ⚠️ CAUSES ISSUES |
| `sync:importContacts` | `importContacts()` | main.ts | 1577 | Import all contacts | 🤔 RARELY USED |
| `sync:importActiveTasksOnly` | `importActiveTasksOnly()` | main.ts | 1581 | Refresh active tasks only | ✅ YES |
| `sync:importActiveProjectsOnly` | `importActiveProjectsOnly()` | main.ts | 1585 | Refresh active projects only | 🤔 OPTIONAL |
| `sync:importTaskById` | `importTaskById()` | main.ts | 1620 | Import one specific task | 🤔 RARELY USED |
| `sync:performInitialImport` | `performInitialImport()` | main.ts | 1610 | Do first-time full import | ✅ YES |

### Import Queue Control
| IPC Channel | Handler | File | Line | What It Does | Keep? |
|-------------|---------|------|------|--------------|-------|
| `importQueue:getStatus` | `getImportQueueStatus()` | main.ts | 1628 | Get queue status | ✅ YES |
| `importQueue:cancel` | `cancelImport()` | main.ts | 1632 | Cancel specific import | ✅ YES |
| `importQueue:cancelAll` | `cancelAllImports()` | main.ts | 1636 | Cancel all imports | ✅ YES |
| `importQueue:getCurrentImport` | `getCurrentImport()` | main.ts | 1640 | Get current import type | ✅ YES |

---

## 📊 DATABASE REPOSITORIES (Local Storage)

### Active Repositories
| Repository | File | Lines | Data Type | Sync Status | Keep? |
|------------|------|-------|-----------|-------------|-------|
| `taskRepository` | taskRepository.ts | ~800 | Tasks | ✅ Syncs to Notion | ✅ YES |
| `projectRepository` | projectRepository.ts | ~400 | Projects | 🟡 Manual sync only | 🤔 OPTIONAL |
| `timeLogRepository` | timeLogRepository.ts | ~500 | Time Logs | ⚠️ Sync disabled (504s) | ⚠️ LOCAL ONLY? |
| `writingRepository` | writingRepository.ts | ~300 | Writing/Notes | ✅ Syncs to Notion | 🤔 OPTIONAL |
| `chatSummaryRepository` | chatSummaryRepository.ts | ~200 | AI Chat History | 🟡 Optional sync | 🤔 OPTIONAL |
| `syncQueueRepository` | syncQueueRepository.ts | ~300 | Pending sync items | ✅ Core infrastructure | ✅ YES |
| `syncStateRepository` | syncStateRepository.ts | ~200 | Sync timestamps/cursors | ✅ Core infrastructure | ✅ YES |
| `localStatusRepository` | localStatusRepository.ts | ~400 | Custom statuses | ❌ Local-only | ✅ YES |
| `schemaRepository` | schemaRepository.ts | ??? | Database schemas | ❓ Unknown | ❓ INVESTIGATE |

### UNUSED Repositories
| Repository | File | Lines | Data Type | Status | Action |
|------------|------|-------|-----------|--------|--------|
| `taskRepositoryPostgres` | taskRepositoryPostgres.ts | 254 | Tasks (PostgreSQL) | 🔴 NOT USED | 🗑️ DELETE |

---

## 🌊 SYNC FLOW ANALYSIS

### Current Automatic Flow (Every 5 Minutes)
```
┌─────────────────────────────────────────────┐
│ Timer Triggers (every 5 min)                │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│ tick() - Main Sync Cycle                    │
│  1. ensureTaskCacheMatchesFilter()         │
│  2. pushPending() - Send local changes     │
│  3. pullRemote() - Fetch updates           │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│ pushPending() - Process Sync Queue          │
│  • Reads syncQueueRepository                │
│  • For each pending change:                 │
│    - processTaskEntry() → addTask()         │
│    - processTimeLogEntry() → createTimeLog()│
│    - processWritingEntry() → createWriting()│
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│ pullRemote() - Fetch from Notion            │
│  SIMPLIFIED (as of today):                  │
│  • pullTasks() ONLY                         │
│  • Projects: REMOVED from auto-sync         │
│  • TimeLogs: DISABLED (causes 504s)        │
└─────────────────────────────────────────────┘
```

### Startup Flow
```
App Launches
    │
    ▼
start() in syncEngine
    │
    ├─> clearStuckEntries(5)
    ├─> clearEntriesByType('timeLog')
    ├─> clearEntriesByType('task')
    │
    ▼
syncActiveTasksOnStartup() [BACKGROUND]
    │
    ├─> importActiveTasks() [from notion.ts]
    │       └─> Fetches non-completed tasks
    │
    ▼
Timer starts (tick every 5 min)
```

### Manual Import Flow (Full Import)
```
User clicks "Import Tasks" in UI
    │
    ▼
IPC: sync:importTasks
    │
    ▼
startManualImport()
    │
    ▼
performInitialImport()
    │
    ├─> importQueueManager.requestImport('tasks', ...)
    │       │
    │       ├─> CANCELS any running import!
    │       │
    │       ▼
    │   performTasksImportInternal()
    │       │
    │       ├─> Phase 1: importActiveTasks() [Priority!]
    │       │       └─> Save to taskRepository
    │       │
    │       └─> Phase 2: importTasksWithDateChunks() [Completed tasks]
    │               └─> Save to taskRepository
    │
    └─> Update sync state (timestamps, cursors)
```

---

## 🚨 IDENTIFIED REDUNDANCIES

### Duplicate/Overlapping Functions
1. **Three ways to fetch tasks:**
   - `getTasks()` - Legacy wrapper
   - `getTasksPage()` - Page-by-page fetch
   - `getTasksBatchReliably()` - Batch fetch with retry
   
2. **Two active task imports:**
   - `importActiveTasks()` - Used by auto-sync
   - `importActiveTasksFirst()` - Older version?

3. **Multiple pull methods:**
   - `pullTasks()` - Main method
   - `pullTasksWithCount()` - Returns count
   - `pullTasksWithCountDirect()` - With explicit cursor
   - `pullTasksWithPartition()` - With date filters

### Unused Code
1. **schemaSyncService.ts** - 0 bytes, empty file
2. **taskRepositoryPostgres.ts** - PostgreSQL version (you use SQLite)
3. **Partition logic** - Old approach using date filters (before Search API)
4. **Chat summary Notion sync** - Unnecessary complexity

---

## 🎯 SIMPLIFIED ARCHITECTURE PROPOSAL

### Keep Only Essential Sync:
```
┌────────────────────────────────────────────────┐
│ AUTOMATIC (Every 5 min)                        │
│                                                │
│  1. Push local task changes → Notion          │
│  2. Pull task updates ← Notion                │
│                                                │
│  That's it. Nothing else automatic.            │
└────────────────────────────────────────────────┘

┌────────────────────────────────────────────────┐
│ MANUAL (User clicks button)                    │
│                                                │
│  • Import All Tasks                            │
│  • Refresh Active Tasks                        │
│  • Import Projects (if you want them)          │
│  • Test Connection                             │
│                                                │
└────────────────────────────────────────────────┘

┌────────────────────────────────────────────────┐
│ LOCAL ONLY (No sync)                           │
│                                                │
│  • Time logs (too slow to sync)                │
│  • Chat summaries (keep local)                 │
│  • Custom statuses (local-first)               │
│                                                │
└────────────────────────────────────────────────┘
```

---

## 📋 CLEANUP PLAN

### Phase 1: Delete Dead Code ✓
- [x] Empty `schemaSyncService.ts`
- [ ] Delete `taskRepositoryPostgres.ts` (PostgreSQL - unused)
- [ ] Delete or disable `chatSummarySyncService.ts`

### Phase 2: Remove from Auto-Sync ✓
- [x] Projects (done today)
- [x] Time Logs (already disabled)
- [ ] Contacts (remove auto-fetch)
- [ ] Writing (evaluate if needed)

### Phase 3: Simplify Notion Service
- [ ] Split `notion.ts` (2,211 lines) into:
  - `notionTasks.ts` (core)
  - `notionProjects.ts` (optional)
  - `notionTimeLogs.ts` (optional)
  - `notionHelpers.ts` (shared utilities)

### Phase 4: Simplify Sync Engine
- [ ] Remove old partition logic
- [ ] Remove duplicate pull methods
- [ ] Keep only: tick(), pushPending(), pullTasks()
- [ ] Remove import cancellation (let imports finish)

### Phase 5: Consolidate Repositories
- [ ] Keep: task, syncQueue, syncState
- [ ] Evaluate: project, timeLog, writing, chatSummary
- [ ] Delete: postgres version, empty files

---

## 📈 SUCCESS METRICS

### Before Simplification
- ❌ 6 data types syncing
- ❌ 2,211 line notion.ts
- ❌ 1,660 line syncEngine.ts
- ❌ Multiple sync loops competing
- ❌ 504 timeouts
- ❌ Import cancellation chaos

### After Simplification (Target)
- ✅ 1 data type auto-syncing (tasks)
- ✅ <800 line task-specific service
- ✅ <600 line sync engine
- ✅ One clear sync loop
- ✅ No timeouts
- ✅ No cancellations

---

## 🤔 DECISIONS NEEDED

1. **Keep Projects?** (Manual import only, or delete entirely?)
2. **Keep Time Logs?** (Local-only, or try to fix sync?)
3. **Keep Writing Feature?** (Lightweight, probably fine)
4. **Keep Chat Summaries Sync?** (Extra complexity, optional)
5. **Keep Contacts?** (Rarely used, probably delete)

---

**Ready to execute cleanup?** Tell me which phases to start with!

