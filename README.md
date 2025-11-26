# Notion Tasks Widget

Electron widget that floats above Windows, docks to screen edges, and syncs
directly with a Notion tasks database for quick capture.

## Getting Started

1. Copy `env.example` to `.env` and provide:
   - `NOTION_API_KEY`
   - `NOTION_DATABASE_ID`
   - `NOTION_DATA_SOURCE_ID`
   - (Optional) property overrides such as:
     - `NOTION_TASK_TITLE_PROP`
     - `NOTION_TASK_STATUS_PROP`
     - `NOTION_TASK_DATE_PROP`
     - `NOTION_TASK_DEADLINE_PROP`
     - `NOTION_TASK_DEADLINE_HARD`
     - `NOTION_TASK_DEADLINE_SOFT`
     - `NOTION_TASK_URGENT_PROP`
     - `NOTION_TASK_IMPORTANT_PROP`
2. Install dependencies:

   ```bash
   npm install
   ```

3. Start the development environment:

   ```bash
   npm run dev
   ```

   - Runs `tsc` in watch mode for the main/preload process
   - Launches the Vite dev server for the renderer
   - Starts Electron pointing at `http://localhost:5173`

For a production build:

```bash
npm run build        # Electron main + renderer bundles
npm start            # Launches the packaged Electron app
```

## Notion MCP server

The repository now ships with a lightweight [Model Context Protocol](https://modelcontextprotocol.io/)
server that exposes the configured Notion databases (tasks, time logs, and projects)
so that MCP-compatible tooling can inspect or query the same data the widget uses.

1. Ensure your `.env` (or environment) contains the API key plus any database/property IDs
   that the widget normally requires (`NOTION_DATABASE_ID`, `NOTION_TIME_LOG_DATABASE_ID`,
   `NOTION_PROJECTS_DATABASE_ID`, etc.).
2. Start the server over stdio:

   ```bash
   npm run mcp:notion
   ```

   The process will remain attached to stdio and can be consumed by any MCP client/inspector.
   The server automatically reads the latest Control Center configuration
   (`notion-widget.config.json` under `%APPDATA%/NotionTasksWidget/` on Windows,
   `~/Library/Application Support/NotionTasksWidget/` on macOS, etc.), so it always
   reflects the IDs and property names you set in the UI—no extra `.env` wrangling.

### Available tools & resources

- **Resources**
  - `notion://tasks` – JSON snapshot of the tasks database
  - `notion://time-logs` – JSON snapshot of the time log database
  - `notion://projects` – JSON snapshot of the projects database
- **Tools**
  - `list-tasks` (optional `status`, `limit`)
  - `list-time-logs` (optional `taskId`, `status`, `limit`)
  - `list-projects` (optional `status`, `limit`)
  - `describe-configured-databases`

All tool responses are returned as JSON text payloads so they can be copied into other systems.

### Mobile build quick start

The Capacitor runtime reuses the same React renderer inside an Android WebView and stores Notion credentials/preferences via the `@capacitor/preferences` plugin:

```bash
npm run build:mobile      # Produce dist/mobile for Capacitor
npx cap sync android      # Copy the bundle + update plugins
cd mobile/android
./gradlew assembleDebug   # Creates app/build/outputs/apk/debug/app-debug.apk
```

To run directly on a connected device/emulator:

```bash
npm run mobile:run        # Builds + launches via Capacitor (requires Android SDK)
```

See [Android Build](#android-build) for more detailed prerequisites.

## Features

- Always-on-top frameless window with optional toggle
- Edge docking (left/right/top) with auto-snapping based on drag position
- Hover-to-expand slide-out behavior with configurable handle
- Quick-add input that writes back to the linked Notion database
- Task list view with status and optional due date chips
- Dedicated Control Center window for managing credentials and widget settings
- Writing widget with a Notion-style rich editor (headings, lists, todos) that writes the rendered body directly into the Notion page content
- App-level preferences for Windows startup, desktop notifications, and sound cues

## Folder Structure

- `src/main`: Electron main & preload processes plus docking logic
- `src/renderer`: React UI (Vite) shared by desktop + mobile targets
- `src/shared`: Shared types/interfaces between processes
- `src/common`: Cross-platform Notion helpers reused by both runtimes
- `mobile/android`: Generated native project handled by Capacitor

## Control Center

Click the “Open Control Center” pill inside the in-widget settings drawer (or call `window.widgetAPI.openSettingsWindow()` from the DevTools console) to launch a separate frameless window that hosts all configuration screens:

- **Tasks widget** – sets the API key/database plus every property the task board uses (status, deadline, priority flags, manual fallback status list, etc.).
- **Writing widget** – links a second Notion database, lets you provide optional title/summary/content/tags/status property names, and stores draft/published status labels.
- **App preferences** – toggles Windows startup registration, desktop notifications, and sound cues. Preferences are persisted to the `notion-widget.config.json` file under `%APPDATA%/NotionTasksWidget`.

## Writing Widget

Switch between “Tasks” and “Writing” using the segmented control in the widget header. The writing surface captures:

- **Title** → mapped to the configured title property.
- **Summary** → optional rich-text summary property.
- **Tags** → comma-separated list, saved to the configured multi-select property.
- **Body** → Notion-style editor that instantly converts `#`, `##`, `###`, `-`, `[]`, and `1.` + space into headings, lists, todos, and numbered outlines while you type (with hotkeys for bold/italic/underline/strikethrough/code). `Tab` / `Shift+Tab` indents or outdents list items, matching Notion’s sublist behavior. `---` drops a divider. What you see is exactly what gets saved to the page body.
- `---` + space drops a divider block inline, matching the Notion horizontal rule shortcut.
- **Status toggle** → maps to the writing status property using the Draft/Published values defined in the Control Center.

On save the app:

1. Creates a new Notion page inside the writing database.
2. Populates properties (title/summary/content/tags/status) for filtering.
3. Converts the markdown body into Notion blocks (headings, lists, todos, quotes, dividers, code, etc.) and appends them as the actual page contents.
4. Plays the configured sound cue and/or desktop notification.

## App Preferences / Notifications

Preferences live in the new App Preferences card and are enforced by the main process:

- **Launch on startup** – registers/unregisters the widget with `app.setLoginItemSettings`, so Windows will start it automatically if enabled.
- **Desktop notifications** – gates toast previews plus writing-widget success notifications (uses `new Notification` when supported).
- **Sound cues** – toggles a system beep fallback when notifications are disabled or not supported.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Runs TypeScript (main) + Vite dev server + Electron |
| `npm run build` | Builds Electron main & renderer bundles |
| `npm run build:mobile` | Emits a Capacitor-friendly bundle under `dist/mobile` |
| `npm run mobile:sync` | Builds the mobile bundle and copies it into `mobile/android` |
| `npm run mobile:run` | Builds + deploys to the default Android target via Capacitor |
| `npm run build:app` | Full Electron builder pipeline (portable Win target) |
| `npm run typecheck` | Global TypeScript type check across renderer/shared |
| `npm run verify:sync` | CLI check that hits Notion directly, ensuring API/database access and listing the open tasks returned by the current filters |

### Verifying Notion connectivity

Run `npm run verify:sync` whenever you suspect the widget isn’t receiving new actions.  
The script:

1. Loads the Control Center credentials (or `.env`) so it’s always in sync with the app.
2. Verifies the API key and database permissions.
3. Queries Notion in 10-item pages until it finds tasks whose status does **not** match the configured “completed” value (defaults to ✅).
4. Prints each open task title + status so you can compare the CLI results with what the widget renders.

If the script lists the tasks you expect but the UI still looks wrong, the issue is in the local cache or renderer filters rather than Notion connectivity.

## Notion backup database

- The Electron main process now mirrors the live SQLite store into `backups/notion-backup.sqlite` inside this folder, so Dropbox/OneDrive can keep the Notion cache under source control.
- Set `NOTION_WIDGET_BACKUP_PATH` to override the destination (folder or explicit `.sqlite` file). By default the file lives under `<repo>/backups/notion-backup.sqlite`.
- The backup job runs immediately on launch and repeats every five minutes; it uses SQLite's native `backup` API so writes are crash safe.
- To manually create or reset the backup schema without launching the app, run `npm run db:prepare-backup` (after ensuring `better-sqlite3` has been rebuilt for your Node runtime if necessary).
- The generated database contains the same tables as the primary store (`tasks`, `time_logs`, `writing_entries`, `projects`, `sync_queue`, and `sync_state`) and can be opened with any SQLite browser as a Notion backup.

## Android Build

1. Install Android Studio or standalone command-line tools and ensure `ANDROID_HOME`/`ANDROID_SDK_ROOT` are configured.
2. Run `npm install` once to pull JavaScript dependencies plus Capacitor plugins.
3. Build the web assets and sync them into the native project:
   ```bash
   npm run build:mobile
   npx cap sync android
   ```
4. Open `mobile/android` in Android Studio **or** build from the terminal:
   ```bash
   cd mobile/android
   ./gradlew assembleDebug
   ```
   The resulting APK is written to `mobile/android/app/build/outputs/apk/debug/`.
5. Use `npm run mobile:run` (Capacitor) or Android Studio’s Run/Debug to sideload onto an emulator or physical Asus device.

> The mobile runtime includes inline fallbacks for settings/preferences and routes `widgetAPI.openSettingsWindow` to `settings.html`, so no multi-window Electron APIs are required on-device.

## Continuous Integration

A GitHub Actions workflow (`.github/workflows/multiplatform-build.yml`) now builds both targets on every push/PR:

- **desktop** job runs `npm ci`, `npm run typecheck`, and `npm run build`, then uploads `dist/main` + `dist/renderer`.
- **android** job provisions Node + Java + Android SDK, builds `dist/mobile`, runs `npx cap sync android`, assembles a debug APK with Gradle, and publishes it as an artifact.

Use the artifacts tab on each run to retrieve the packaged Electron bundle or Android APK.

## Testing & QA

Basic smoke tests before releasing:

### Desktop

1. `npm run dev` → verify Electron launches and hot reload works.
2. Quick Add a task, confirm it appears immediately and persists across restarts.
3. Toggle docking edges + hover/capture modes.
4. Open Control Center, update Notion credentials, and ensure the widget reloads.
5. Launch the Writing widget, create an entry with headings/lists/code, confirm it lands in Notion with proper formatting.

### Android (Capacitor)

1. `npm run mobile:run` on an Asus device/emulator.
2. Enter Notion API credentials via the inline Control Center (navigates to `settings.html`) and return to the widget.
3. Add/update tasks, verify the list refreshes without desktop-only affordances (no resize handles/pop-out buttons).
4. Trigger the writing widget and upload an entry.
5. Rotate the device and confirm layout + local preferences persist (stored via Capacitor Preferences).

Record any regressions or crashes as GitHub issues before shipping.
