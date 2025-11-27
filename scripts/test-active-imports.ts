import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { register } from 'tsconfig-paths';

const workspaceRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
register({
  baseUrl: workspaceRoot,
  paths: {
    '@shared/*': ['src/shared/*'],
    '@common/*': ['src/common/*']
  }
});

const configStorePromise = import('../src/main/configStore');
const notionModulePromise = import('../src/main/services/notion');

function resolveUserDataPath(): string {
  const appData =
    process.env.APPDATA ||
    (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : path.join(os.homedir(), 'AppData', 'Roaming'));
  return path.join(appData, 'NotionTasksWidget');
}

async function bootstrapSettings() {
  const userDataPath = resolveUserDataPath();
  const { initConfigStore, getTaskSettings, getProjectsSettings } = await configStorePromise;
  await initConfigStore(userDataPath);

  const taskSettings = getTaskSettings();
  const projectSettings = getProjectsSettings();

  if (!taskSettings?.apiKey || !taskSettings?.databaseId) {
    throw new Error(
      'Tasks API key/database ID missing. Configure them in the app before running this script.'
    );
  }

  const { setNotionSettings, setProjectsSettings } = await notionModulePromise;
  setNotionSettings(taskSettings);
  if (projectSettings?.databaseId) {
    setProjectsSettings(projectSettings);
  }
}

async function run() {
  console.log('[verify] Loading configuration...');
  await bootstrapSettings();

  console.log('[verify] Fetching active tasks from Notion...');
  const taskStart = Date.now();
  const { importActiveTasks, importActiveProjects } = await notionModulePromise;
  const tasks = await importActiveTasks(undefined, (count, message) => {
    console.log(`[verify][tasks] ${count} → ${message}`);
  });
  console.log(
    `[verify][tasks] Retrieved ${tasks.length} active tasks in ${Date.now() - taskStart}ms`
  );

  console.log('[verify] Fetching active projects from Notion...');
  const projectStart = Date.now();
  const projects = await importActiveProjects(undefined, (count, message) => {
    console.log(`[verify][projects] ${count} → ${message}`);
  });
  console.log(
    `[verify][projects] Retrieved ${projects.length} active projects in ${Date.now() - projectStart}ms`
  );

  console.log('[verify] Active import test complete.');
}

run().catch((error) => {
  console.error('[verify] Active import test failed:', error);
  process.exitCode = 1;
});

