import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { getStore, Store } from '../../src/main/store.js';

describe('store', () => {
  let store: Store;
  let configPath: string;

  beforeEach(() => {
    store = getStore(`test-${Date.now()}`);
    configPath = store.path;
  });

  afterEach(async () => {
    try {
      await fs.unlink(configPath);
    } catch {
      // ignore
    }
  });

  it('sets and gets nested settings', () => {
    store.set('channels.wecom.enabled', true);
    expect(store.get('channels.wecom.enabled')).toBe(true);
  });

  it('returns default when key missing', () => {
    expect(store.get('missing', 'default')).toBe('default');
  });
});
