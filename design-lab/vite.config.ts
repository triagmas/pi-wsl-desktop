/**
 * Vite dev-server конфиг Design Lab (Issue #21, D1).
 * Корень — design-lab/; fs.allow открывает репозиторий, чтобы импортировать
 * ../src/renderer/** (общие presentational-компоненты). Это dev-only вход,
 * продовый сбор (scripts/build.mjs) использует src/renderer и не зависит отсюда.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const labRoot = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  root: labRoot,
  plugins: [react()],
  server: {
    port: 5199,
    strictPort: true,
    fs: { allow: [repoRoot] },
  },
});
