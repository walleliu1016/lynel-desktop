import os from 'node:os';
import path from 'node:path';
import ElectronStore from 'electron-store';

const instances = new Map<string, ElectronStore>();

export type Store = ElectronStore;

const STORE_DIR = path.join(os.homedir(), '.lynel-desktop');

export function getStore(name: string = 'default'): Store {
  if (!instances.has(name)) {
    instances.set(name, new ElectronStore({ name, cwd: STORE_DIR } as any));
  }
  return instances.get(name)!;
}
