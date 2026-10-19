/**
 * M0 build: three Node bundles (main, preload, bridge) via esbuild and the
 * renderer via Vite. No packaging/installer step in M0.
 */
import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const nodeCommon = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: false,
  minify: false,
  logLevel: 'info',
};

await Promise.all([
  build({
    ...nodeCommon,
    entryPoints: [path.join(root, 'src/main/index.ts')],
    outfile: path.join(root, 'dist/main/index.cjs'),
    external: ['electron'],
  }),
  build({
    ...nodeCommon,
    entryPoints: [path.join(root, 'src/preload/index.ts')],
    outfile: path.join(root, 'dist/preload/index.cjs'),
    external: ['electron'],
  }),
  build({
    ...nodeCommon,
    entryPoints: [path.join(root, 'src/bridge/index.ts')],
    outfile: path.join(root, 'dist/bridge/index.cjs'),
  }),
]);

await viteBuild({
  configFile: false,
  root: path.join(root, 'src/renderer'),
  base: './',
  plugins: [react()],
  build: {
    outDir: path.join(root, 'dist/renderer'),
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
});

console.log('build: dist/main, dist/preload, dist/bridge, dist/renderer ready');
