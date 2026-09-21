// 用户自建的任务模板。存成一个 JSON 文件而不是新开一张表：
// 模板是纯展示/预填数据，不参与调度与状态机，跟着用户目录走就够了；
// 放进 tasks.db 就得为它做迁移，而它没有任何需要事务保证的不变量。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Schedule } from './schedule.js';

export interface TaskTemplate {
  id: string;
  name: string;
  icon: string;
  blurb: string;
  prompt: string;
  /** 模板自带的调度；应用模板时按它预填表单（用户随后可改） */
  schedule: Schedule;
  createdAt: number;
}

export function templatesFile(): string {
  return path.join(os.homedir(), '.lynel-desktop', 'task-templates.json');
}

function isTemplate(v: unknown): v is TaskTemplate {
  const t = v as Partial<TaskTemplate> | null;
  return !!t && typeof t.id === 'string' && typeof t.name === 'string'
    && typeof t.prompt === 'string' && !!t.schedule && typeof t.schedule === 'object';
}

/** 文件缺失 / 损坏 / 手改坏一律当空列表：模板没了只是少几个快捷入口，
 *  不该让任务面板整个打不开（这个函数在 IPC 与面板初始化里都会走到）。 */
export function listTemplates(): TaskTemplate[] {
  try {
    const raw = JSON.parse(fs.readFileSync(templatesFile(), 'utf8'));
    return Array.isArray(raw) ? raw.filter(isTemplate) : [];
  } catch {
    return [];
  }
}

function write(list: TaskTemplate[]): void {
  const file = templatesFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // 先写临时文件再 rename：中途崩了也不会留下半个 JSON 把已有模板全读没
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

export function saveTemplate(input: Omit<TaskTemplate, 'id' | 'createdAt'>): TaskTemplate {
  const t: TaskTemplate = {
    id: randomUUID(),
    createdAt: Date.now(),
    ...input,
    // icon / blurb 由调用方给；缺了就用中性默认值，不因为少个图标丢整条模板
    icon: input.icon || 'bookmark',
    blurb: input.blurb || '我保存的模板',
  };
  const list = [t, ...listTemplates()];
  write(list);
  return t;
}

export function deleteTemplate(id: string): void {
  write(listTemplates().filter((t) => t.id !== id));
}
