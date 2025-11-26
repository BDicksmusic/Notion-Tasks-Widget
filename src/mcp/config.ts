import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { WidgetConfig } from '@shared/types';

const CONFIG_FILENAME = 'notion-widget.config.json';

function platformAppDataDir() {
  if (process.env.APPDATA) return process.env.APPDATA;
  switch (process.platform) {
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support');
    case 'linux':
      return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    default:
      return path.join(os.homedir(), 'AppData', 'Roaming');
  }
}

export function resolveConfigPath(): string {
  if (process.env.NOTION_WIDGET_CONFIG_PATH) {
    return path.resolve(process.env.NOTION_WIDGET_CONFIG_PATH);
  }

  const userDataRoot = process.env.NOTION_WIDGET_USER_DATA
    ? path.resolve(process.env.NOTION_WIDGET_USER_DATA)
    : path.join(platformAppDataDir(), 'NotionTasksWidget');

  return path.join(userDataRoot, CONFIG_FILENAME);
}

export function loadWidgetConfig(): WidgetConfig | null {
  const configPath = resolveConfigPath();

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as WidgetConfig;
  } catch {
    return null;
  }
}





