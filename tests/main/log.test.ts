import { describe, it, expect } from 'vitest';
import { getLogger } from '../../src/main/log.js';

describe('log', () => {
  it('returns a logger with info/error methods', () => {
    const logger = getLogger();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
  });
});
