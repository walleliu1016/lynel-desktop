// node:sqlite 的 vitest 适配层。
// vitest 2.1.9 内置的 vite-node 把 node 内置模块白名单写死成 node:test，
// 不认识 node:sqlite，会把裸 id "sqlite" 丢给 Vite 解析并失败
// （Failed to load url sqlite / Cannot find package 'sqlite'）。
// vitest.config.ts 用 alias 把 specifier "node:sqlite" 指向本文件，
// 再由 Node 原生 require 加载真实内置模块。
// 生产代码（src/main/tasks/db.ts）不受影响，仍然是直接 import。
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

export { DatabaseSync };
