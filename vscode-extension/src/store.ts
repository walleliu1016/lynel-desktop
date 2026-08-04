import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

// VS Code 扩展独立存储目录，不与 Lynel Desktop 混用
const STORE_DIR = path.join(os.homedir(), '.lynel-vscode');

class JsonStore {
  private data: Record<string, any> = {};
  private filePath: string;

  constructor(name: string) {
    this.filePath = path.join(STORE_DIR, `${name}.json`);
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      }
    } catch { this.data = {}; }
  }

  private save(): void {
    try {
      fs.mkdirSync(STORE_DIR, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch { /* 静默失败 */ }
  }

  get(key: string): any {
    const parts = key.split('.');
    let current: any = this.data;
    for (const p of parts) {
      if (current === undefined || current === null) return undefined;
      current = current[p];
    }
    return current;
  }

  set(key: string, value: any): void {
    const parts = key.split('.');
    let current: any = this.data;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in current) || typeof current[parts[i]] !== 'object') {
        current[parts[i]] = {};
      }
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
    this.save();
  }

  delete(key: string): void {
    const parts = key.split('.');
    let current: any = this.data;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in current)) return;
      current = current[parts[i]];
    }
    delete current[parts[parts.length - 1]];
    this.save();
  }

  get store(): any {
    return this.data;
  }
}

const instances = new Map<string, JsonStore>();

export function getStore(name: string = 'default'): JsonStore {
  if (!instances.has(name)) {
    instances.set(name, new JsonStore(name));
  }
  return instances.get(name)!;
}
