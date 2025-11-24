import { defineConfig, mergeConfig, type UserConfig, type UserConfigFn } from 'vite';
import baseConfig from './vite.config';
import path from 'node:path';

const mobileOutDir = path.resolve(__dirname, 'dist/mobile');

export default defineConfig((env) => {
  const resolved: UserConfig | Promise<UserConfig> = typeof baseConfig === 'function' 
    ? (baseConfig as UserConfigFn)(env) 
    : (baseConfig as UserConfig);
  return mergeConfig(resolved, {
    build: {
      outDir: mobileOutDir,
      emptyOutDir: false
    }
  });
});

