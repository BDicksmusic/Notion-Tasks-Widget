import { defineConfig, mergeConfig, type UserConfig, type UserConfigFn, loadEnv } from 'vite';
import baseConfig from './vite.config';
import path from 'node:path';

const mobileOutDir = path.resolve(__dirname, 'dist/mobile');

export default defineConfig((env) => {
  // Load environment variables from .env file
  const envVars = loadEnv(env.mode, process.cwd(), '');
  
  // Build dev defaults object from environment variables
  const devDefaults = {
    apiKey: envVars.NOTION_API_KEY || '',
    databaseId: envVars.NOTION_DATABASE_ID || '',
    dataSourceId: envVars.NOTION_DATA_SOURCE_ID || '',
    titleProperty: envVars.NOTION_TASK_TITLE_PROP || 'Name',
    statusProperty: envVars.NOTION_TASK_STATUS_PROP || 'Status',
    dateProperty: envVars.NOTION_TASK_DATE_PROP || 'Date',
    deadlineProperty: envVars.NOTION_TASK_DEADLINE_PROP || 'Hard Deadline?',
    deadlineHardValue: envVars.NOTION_TASK_DEADLINE_HARD || '⭕Hard',
    deadlineSoftValue: envVars.NOTION_TASK_DEADLINE_SOFT || '🔵Soft',
    urgentProperty: envVars.NOTION_TASK_URGENT_PROP || 'Urgent',
    urgentStatusActive: envVars.NOTION_TASK_URGENT_ACTIVE || '‼',
    urgentStatusInactive: envVars.NOTION_TASK_URGENT_INACTIVE || '○',
    importantProperty: envVars.NOTION_TASK_IMPORTANT_PROP || 'Important',
    importantStatusActive: envVars.NOTION_TASK_IMPORTANT_ACTIVE || '◉',
    importantStatusInactive: envVars.NOTION_TASK_IMPORTANT_INACTIVE || '○',
    completedStatus: envVars.NOTION_COMPLETED_STATUS || '✅',
    mainEntryProperty: envVars.NOTION_TASK_MAIN_ENTRY_PROP || 'Main Entry'
  };

  const resolved: UserConfig | Promise<UserConfig> = typeof baseConfig === 'function' 
    ? (baseConfig as UserConfigFn)(env) 
    : (baseConfig as UserConfig);
  return mergeConfig(resolved, {
    define: {
      // Inject dev defaults into the mobile build
      '__MOBILE_DEV_DEFAULTS__': JSON.stringify(devDefaults),
      '__DEV_MODE__': JSON.stringify(env.mode === 'development')
    },
    build: {
      outDir: mobileOutDir,
      emptyOutDir: false
    }
  });
});


