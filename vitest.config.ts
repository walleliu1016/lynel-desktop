import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      // 见 tests/helpers/node-sqlite.ts：vitest 2.1.9 的 vite-node 不认识
      // node:sqlite，会把裸 id sqlite 交给 Vite 解析并失败。
      {
        find: /^node:sqlite$/,
        replacement: fileURLToPath(new URL('./tests/helpers/node-sqlite.ts', import.meta.url)),
      },
    ],
  },
});
