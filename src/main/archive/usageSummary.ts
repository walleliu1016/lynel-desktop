// usageSummary: 增量更新全局 usage.json
import fs from 'node:fs';
import path from 'node:path';
import { summarizeUsage, type RawExchange } from '../cost/usage.js';

export interface UsageSummaryConfig {
  root: string;             // e.g. ~/.lynel-desktop
  filename?: string;        // default usage.json
}

export class UsageSummaryWriter {
  private filePath: string;

  constructor(root: string, filename = 'usage.json') {
    this.filePath = path.join(root, filename);
  }

  // 从已存在的 raw archive 全量重建（启动/迁移时）
  rebuild(allRecords: RawExchange[]): void {
    const summary = summarizeUsage(allRecords);
    this.write(summary);
  }

  // 增量：读取旧文件，追加一条记录，重写
  append(record: RawExchange): void {
    const existing = this.readRecords();
    existing.push(record);
    const summary = summarizeUsage(existing);
    this.write(summary);
  }

  readRecords(): RawExchange[] {
    if (!fs.existsSync(this.filePath)) return [];
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      return data.__records || [];
    } catch {
      return [];
    }
  }

  private write(summary: ReturnType<typeof summarizeUsage>): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const data = {
      ...summary,
      __records: summary.bySession.flatMap((s) => Array.from({ length: s.entries }, (_, i) => ({ session: s.session, seq: i + 1 }))),
    };
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, this.filePath);
  }
}
