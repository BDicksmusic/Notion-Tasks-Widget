# Notion Sync Architecture

## Overview

Three-layer system: **Import → Startup Sync → Real-time Push/Fetch**

No timers. No polling. Event-driven only.

---

## 1. IMPORT (Full Database Pull)

**When:** Manual trigger, first setup, or data recovery

**What it does:**
- Pulls ALL data from Notion
- Compares with local SQLite
- Uses `INSERT OR IGNORE` - no duplicates
- Captures relations (task-project links)

**Scripts:**
- `import-all.ts` - Everything (~108s for 1700+ items)
- `import-active.ts` - Only active items (~9s for ~70 items)

**Flow:**
```
NOTION                          SQLITE
───────                         ──────
All Projects  ──────────────►  projects table
All Tasks     ──────────────►  tasks table
Relations     ──────────────►  task_project_links table
```

---

## 2. STARTUP SYNC (Delta Import)

**When:** App opens

**What it does:**
- Reads `last_app_close` timestamp from SQLite
- Fetches from Notion sorted by `last_edited_time DESC`
- Stops when it hits items older than `last_app_close`
- Updates existing entries with `INSERT OR REPLACE`

**Scripts:**
- `mark-app-close.ts` - Called when app closes
- `import-since-close.ts` - Called when app opens

**Flow:**
```
APP CLOSES                      APP OPENS
──────────                      ─────────
Save timestamp ──────┐    ┌──── Read timestamp
                     │    │
                     ▼    ▼
              ┌─────────────────┐
              │   app_state     │
              │ last_app_close  │
              └─────────────────┘
                     │
                     ▼
              Fetch only items where
              last_edited > last_app_close
                     │
                     ▼
              Stop at cutoff (fast!)
```

---

## 3. REAL-TIME PUSH/FETCH (Event-Driven)

**When:** While app is running

### PUSH (Local → Notion)
**Trigger:** User creates/updates/deletes in app
**Action:** Immediately call Notion API

```
USER ACTION          LOCAL              NOTION
───────────          ─────              ──────
Create task    ───►  Save to SQLite  ───►  POST /pages
Update task    ───►  Update SQLite   ───►  PATCH /pages/{id}
Delete task    ───►  Mark deleted    ───►  PATCH /pages/{id} (archive)
```

### FETCH (Notion → Local)
**Trigger:** User clicks refresh / webhook (future)
**Action:** Query Notion, update SQLite

```
USER ACTION          NOTION             LOCAL
───────────          ──────             ─────
Click refresh  ───►  GET changes   ───►  Update SQLite
```

---

## What We DON'T Need

❌ **Timer-based sync** - Causes race conditions, hidden bugs
❌ **Polling intervals** - Wastes API calls, unpredictable
❌ **Background sync threads** - Complex, hard to debug
❌ **Sync queues** - Overkill for this use case

---

## Database Tables

### Core Data
| Table | Purpose |
|-------|---------|
| `projects` | Project entries |
| `tasks` | Task entries (payload JSON) |
| `task_project_links` | Many-to-many relations |

### Sync State
| Table | Purpose |
|-------|---------|
| `app_state` | Stores `last_app_close` timestamp |

### Future (if needed)
| Table | Purpose |
|-------|---------|
| `time_logs` | Time tracking entries |
| `contacts` | Contact entries |
| `contact_project_links` | Contact-project relations |

---

## Implementation Status

### ✅ Complete
- [x] Import all projects (296 entries)
- [x] Import all tasks (1476 entries)
- [x] Task-project links (512 relations)
- [x] Startup sync (delta import)
- [x] App close timestamp tracking

### 🔲 Not Complete
- [ ] Push: Create task → Notion
- [ ] Push: Update task → Notion
- [ ] Push: Create project → Notion
- [ ] Push: Update project → Notion
- [ ] Integrate into Electron app
- [ ] Time logs import (simple, no formulas)
- [ ] Contacts import (linked to projects)

---

## Speed Benchmarks

| Operation | Time | Items |
|-----------|------|-------|
| Import All | 108s | 1772 |
| Import Active | 9s | 74 |
| Startup Sync (no changes) | 23s | 0 |
| Startup Sync (few changes) | ~5-10s | varies |

---

---

## Time Log Calculations

### Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│                     ALL CYCLES (Lifetime)                   │
│   Total time across all completed cycles of a recurring     │
│   task. "I've practiced trumpet for 50 hours total"         │
├─────────────────────────────────────────────────────────────┤
│                    COMPLETED CYCLE                          │
│   All sessions for ONE occurrence before task resets.       │
│   "Monday's practice: 35 min across 2 sessions"             │
├─────────────────────────────────────────────────────────────┤
│                       SESSION                               │
│   Single time log entry (start → end).                      │
│   "15 min practice session"                                 │
└─────────────────────────────────────────────────────────────┘
```

### Data Model

| Field | Description | Example |
|-------|-------------|---------|
| `session_minutes` | Single entry duration | 15 min |
| `cycle_minutes` | Sum of sessions in current cycle | 35 min |
| `cycle_session_count` | Sessions in current cycle | 2 sessions |
| `total_cycles` | Completed cycles count | 5 cycles |
| `total_minutes` | All time across all cycles | 300 min |
| `goal_minutes` | Target per cycle | 30 min |
| `goal_progress` | cycle_minutes / goal_minutes | 116% |

### Example: Trumpet Practice (Daily Recurring)

```
Monday (Cycle 1):
  Session 1: 15 min
  Session 2: 20 min
  ─────────────────
  Cycle Total: 35 min (2 sessions) ✅ Goal: 30 min → 116%

Tuesday (Cycle 2):
  Session 1: 25 min
  ─────────────────
  Cycle Total: 25 min (1 session) ✅ Goal: 30 min → 83%

Wednesday (Cycle 3):
  Session 1: 10 min
  Session 2: 15 min
  Session 3: 10 min
  ─────────────────
  Cycle Total: 35 min (3 sessions) ✅ Goal: 30 min → 116%

═══════════════════════════════════════════════════════════
LIFETIME TOTAL: 95 min across 3 cycles (avg 31.7 min/cycle)
```

### Calculations Needed

| Calculation | SQL/Logic |
|-------------|-----------|
| Session duration | `end_time - start_time` |
| Cycle total | `SUM(duration) WHERE task_id = ? AND cycle_id = ?` |
| Sessions per cycle | `COUNT(*) WHERE task_id = ? AND cycle_id = ?` |
| All cycles total | `SUM(duration) WHERE task_id = ?` |
| Completed cycles | `COUNT(DISTINCT cycle_id) WHERE task_id = ?` |
| Goal progress | `cycle_minutes / goal_minutes * 100` |
| Avg per cycle | `total_minutes / total_cycles` |

### Long-Term Goal Tracking

```
┌─────────────────────────────────────────────────────────────┐
│  GOAL: Practice 100 hours by March 1st (60 days away)       │
├─────────────────────────────────────────────────────────────┤
│  Current Progress: 25 hours (25%)                           │
│  Remaining: 75 hours                                        │
│  Days Left: 60 days                                         │
│                                                             │
│  Required Pace: 75 min/day to meet goal                     │
│  Current Pace: 50 min/day (avg last 7 days)                 │
│                                                             │
│  ⚠️ BEHIND PACE - Need +25 min/day to catch up              │
│  📅 At current pace: Goal met by April 15th (45 days late)  │
└─────────────────────────────────────────────────────────────┘
```

### Goal Calculations

| Calculation | Formula |
|-------------|---------|
| **Daily goal progress** | `today_minutes / daily_goal * 100` |
| **Long-term progress** | `total_minutes / long_term_goal * 100` |
| **Days remaining** | `goal_deadline - today` |
| **Required pace** | `(goal - total) / days_remaining` |
| **Current pace** | `SUM(last 7 days) / 7` |
| **Pace difference** | `required_pace - current_pace` |
| **Projected completion** | `today + (goal - total) / current_pace` |
| **On track?** | `projected_completion <= goal_deadline` |

### Example: 100 Hour Practice Goal

```
Goal: 6000 minutes (100 hours) by 2025-03-01
Today: 2025-01-15
Started: 2025-01-01

Progress so far:
  - Total logged: 1500 min (25 hours)
  - Days elapsed: 14 days
  - Current pace: 107 min/day

Remaining:
  - Minutes left: 4500 min (75 hours)
  - Days left: 45 days
  - Required pace: 100 min/day

Status: ✅ AHEAD OF PACE (+7 min/day buffer)
Projected completion: Feb 25th (4 days early)
```

### Schema Changes Needed

```sql
-- Add to time_logs table
ALTER TABLE time_logs ADD COLUMN cycle_id TEXT;  -- Links sessions to cycle
ALTER TABLE time_logs ADD COLUMN cycle_number INTEGER;  -- Which cycle (1, 2, 3...)

-- Add to tasks table (or new time_goals table)
ALTER TABLE tasks ADD COLUMN daily_goal_minutes INTEGER;  -- Goal per day/cycle
ALTER TABLE tasks ADD COLUMN long_term_goal_minutes INTEGER;  -- Total goal (e.g., 6000 = 100 hours)
ALTER TABLE tasks ADD COLUMN goal_deadline TEXT;  -- ISO date for long-term goal

-- Or create separate goals table for flexibility
CREATE TABLE time_goals (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  goal_type TEXT NOT NULL,  -- 'daily' | 'weekly' | 'long_term'
  target_minutes INTEGER NOT NULL,
  deadline TEXT,  -- ISO date (for long_term goals)
  created_at INTEGER,
  FOREIGN KEY (task_id) REFERENCES tasks(client_id)
);
```

---

---

## Error Handling & Edge Cases

### Network Failures
| Scenario | Behavior |
|----------|----------|
| Notion API 504/503 | Retry 3x with 3s delay, then skip |
| Notion API 429 (rate limit) | Wait and retry (3 req/sec limit) |
| No internet on startup | Use cached SQLite data, skip sync |
| No internet on push | Save locally, mark `sync_status: pending` |

### Conflict Resolution
```
LOCAL CHANGE              NOTION CHANGE
────────────              ─────────────
last_modified: 10:00      last_edited: 10:05
     │                          │
     └──────────┬───────────────┘
                ▼
        NOTION WINS (newer timestamp)
        
Rule: Most recent `last_edited_time` wins
Exception: User explicitly clicks "Push to Notion"
```

### Data States
| `sync_status` | Meaning |
|---------------|---------|
| `synced` | Matches Notion |
| `pending` | Local changes not yet pushed |
| `conflict` | Both changed, needs resolution |
| `local_only` | Never synced (new local item) |

---

## Recurring Tasks & Sub-tasks

### Recurring Task Flow
```
TASK COMPLETED (recurring)
         │
         ▼
  Calculate next occurrence
         │
         ▼
  Reset task status to initial
         │
         ▼
  Reset ALL subtasks to initial
         │
         ▼
  Increment cycle_number
         │
         ▼
  Start new time log cycle
```

### Sub-task Hierarchy
```
PARENT TASK
├── subtaskIds: [id1, id2, id3]
├── subtaskProgress: { completed: 2, total: 3 }
│
├── SUBTASK 1 (parentTaskId: parent)
├── SUBTASK 2 (parentTaskId: parent) ✅
└── SUBTASK 3 (parentTaskId: parent) ✅
```

### Time Aggregation with Sub-tasks
```sql
-- Parent task time = own time + all subtask time
SELECT 
  (SELECT SUM(duration_minutes) FROM time_logs WHERE task_id = ?) +
  (SELECT SUM(duration_minutes) FROM time_logs WHERE task_id IN 
    (SELECT client_id FROM tasks WHERE parent_task_id = ?))
AS total_with_subtasks
```

---

## Additional Entity Types

### Writing Entries
| Field | Purpose |
|-------|---------|
| `title` | Entry title |
| `content` | Markdown body |
| `word_count` | Auto-calculated |
| `project_id` | Linked project |

### Contacts (Future)
| Field | Purpose |
|-------|---------|
| `name` | Contact name |
| `email` | Email address |
| `phone` | Phone number |
| `project_ids` | Linked projects (many-to-many) |

### Import Strategy by Entity
| Entity | Strategy |
|--------|----------|
| Projects | Full mass sync |
| Tasks | Full mass sync |
| Time Logs | Incremental only (new since last sync) |
| Contacts | Selective (only linked to synced projects) |
| Writing | On-demand (fetch when opened) |

---

## Critical Areas & Known Issues

### ⚠️ Must Address
- [ ] **Push not implemented** - Local changes don't go to Notion yet
- [ ] **Conflict resolution UI** - No way for user to resolve conflicts
- [ ] **Offline queue** - Pending changes lost if app crashes

### 🔧 Technical Debt
- [ ] Tasks use `payload` JSON column (should migrate to dedicated columns)
- [ ] Old sync engine code still in codebase (should clean up)
- [ ] Some IPC handlers reference removed modules

### 💡 Future Enhancements
- [ ] Batch push (multiple changes in one API call)
- [ ] Sync progress UI in app
- [ ] Export/import SQLite backup

---

## Monetization Model (Future)

### Free Tier (Offline App)
```
┌─────────────────────────────────────────┐
│           FREE - LOCAL ONLY             │
├─────────────────────────────────────────┤
│ ✅ Full app features                    │
│ ✅ SQLite local storage                 │
│ ✅ Manual Notion sync (user's API key)  │
│ ✅ Import/Export                        │
│ ✅ Time tracking & calculations         │
│ ✅ Goal tracking                        │
│                                         │
│ ❌ No cloud backup                      │
│ ❌ No multi-device sync                 │
│ ❌ No real-time updates                 │
└─────────────────────────────────────────┘
```

### Paid Tier (Cloud Sync)
```
┌─────────────────────────────────────────┐
│         PAID - CLOUD SYNC               │
│         $X one-time or $Y/month         │
├─────────────────────────────────────────┤
│ ✅ Everything in Free tier              │
│ ✅ Railway-hosted sync server           │
│ ✅ Real-time Notion webhooks            │
│ ✅ Multi-device sync                    │
│ ✅ Cloud backup of SQLite               │
│ ✅ Sync across Windows/Mac/Mobile       │
│ ✅ Priority support                     │
└─────────────────────────────────────────┘
```

### Cloud Sync Architecture (Paid)
```
DEVICE A                RAILWAY SERVER              DEVICE B
────────                ──────────────              ────────
    │                         │                         │
    ├──── Push change ───────►│                         │
    │                         │◄─── Notion webhook ─────┤
    │                         │                         │
    │◄─── Broadcast ──────────┼──── Broadcast ─────────►│
    │                         │                         │
    ▼                         ▼                         ▼
 SQLite                   Postgres               SQLite
 (local)                  (central)              (local)
```

### Pricing Ideas
| Model | Price | Notes |
|-------|-------|-------|
| One-time purchase | $19-29 | Lifetime access, no recurring |
| Monthly subscription | $3-5/mo | Covers server costs |
| Annual subscription | $29-39/yr | Discount for commitment |

### Infrastructure Costs (Railway)
| Component | Est. Cost |
|-----------|-----------|
| Railway Hobby plan | $5/mo |
| Postgres database | ~$5/mo |
| Bandwidth | Variable |
| **Break-even** | ~10-20 paid users |

### Revenue Potential
```
100 paid users × $29/year = $2,900/year
500 paid users × $29/year = $14,500/year
Infrastructure cost: ~$120/year
```

---

## Key Principles

1. **SQLite is primary** - Local-first, always available
2. **Notion is backup** - Cloud sync, shareable
3. **No formulas in Notion** - Calculate locally instead
4. **Event-driven only** - No timers, no polling
5. **Skip duplicates** - `INSERT OR IGNORE` everywhere
6. **Fast startup** - Delta sync, not full scan
7. **Graceful degradation** - Works offline, syncs when possible
8. **Newest wins** - Simple conflict resolution by timestamp

