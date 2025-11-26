const esbuild = require('esbuild');
const path = require('path');

async function build() {
  // Bundle main.ts
  await esbuild.build({
    entryPoints: ['src/main/main.ts'],
    bundle: true,
    platform: 'node',
    target: 'node20',
    outfile: 'dist/main/main/main.js',
    external: [
      'electron',
      'better-sqlite3',
      // Keep native modules external
    ],
    format: 'cjs',
    sourcemap: false,
    minify: true,
    treeShaking: true,
    // Handle .node files
    loader: {
      '.node': 'copy',
    },
    define: {
      'import.meta.url': 'importMetaUrl',
    },
    banner: {
      js: `
const importMetaUrl = require('url').pathToFileURL(__filename).href;
`,
    },
    alias: {
      '@shared': path.resolve(__dirname, '../src/shared'),
      '@common': path.resolve(__dirname, '../src/common'),
    },
  });

  // Bundle preload.ts
  await esbuild.build({
    entryPoints: ['src/main/preload.ts'],
    bundle: true,
    platform: 'node',
    target: 'node20',
    outfile: 'dist/main/main/preload.js',
    external: ['electron'],
    format: 'cjs',
    sourcemap: false,
    minify: false,
    alias: {
      '@shared': path.resolve(__dirname, '../src/shared'),
      '@common': path.resolve(__dirname, '../src/common'),
    },
  });

  console.log('Main process bundled successfully!');
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});

