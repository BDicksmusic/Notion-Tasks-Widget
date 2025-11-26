import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import os from 'node:os';

const rendererRoot = path.resolve(__dirname, 'src/renderer');

// Use a cache directory outside Dropbox to avoid file locking issues
// Store in temp directory to avoid Dropbox sync conflicts
const cacheDir = path.join(os.tmpdir(), 'notion-tasks-widget-vite-cache');

export default defineConfig({
  root: rendererRoot,
  base: './',
  cacheDir,
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@common': path.resolve(__dirname, 'src/common'),
      // Alias lodash to lodash-es for ES module compatibility
      'lodash': 'lodash-es',
      'lodash/debounce': 'lodash-es/debounce'
    }
  },
  server: {
    port: 5174,
    host: 'localhost',
    strictPort: true
  },
  optimizeDeps: {
    /**
     * Dropbox aggressively locks newly created folders on Windows,
     * which causes Vite's dependency pre-bundling step to fail when
     * it tries to rename `deps_temp_*` ➜ `deps`. We explicitly include
     * dependencies that need pre-bundling to avoid ES module issues.
     */
    include: [
      'react',
      'react-dom',
      'slate',
      'slate-react',
      'slate-history',
      'lodash-es',
      'lodash-es/debounce',
      'unified',
      'remark-parse',
      'remark-gfm',
      'remark-rehype',
      'rehype-raw',
      'rehype-sanitize',
      'rehype-stringify',
      'is-hotkey',
      '@capacitor/preferences'
    ],
    force: true, // Force re-optimization when dependencies change
    esbuildOptions: {
      // Handle CommonJS modules that might be imported
      mainFields: ['module', 'main']
    }
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(rendererRoot, 'index.html'),
        settings: path.resolve(rendererRoot, 'settings.html'),
        task: path.resolve(rendererRoot, 'task.html'),
        widgetSettings: path.resolve(rendererRoot, 'widget-settings.html'),
        fullscreen: path.resolve(rendererRoot, 'fullscreen.html'),
        calendar: path.resolve(rendererRoot, 'calendar.html')
      }
    }
  }
});

