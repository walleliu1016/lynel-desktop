import ElectronStore from 'electron-store';

const instances = new Map<string, ElectronStore>();

export type Store = ElectronStore;

export function getStore(name: string = 'default'): Store {
  if (!instances.has(name)) {
    instances.set(name, new ElectronStore({ name, projectName: 'ease-ui' }));
  }
  return instances.get(name)!;
}
