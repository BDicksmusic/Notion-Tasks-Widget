import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.notiontasks.widget.mobile',
  appName: 'Notion Tasks Widget',
  webDir: 'dist/mobile',
  android: {
    path: 'mobile/android'
  },
  server: {
    androidScheme: 'https'
  }
};

export default config;

