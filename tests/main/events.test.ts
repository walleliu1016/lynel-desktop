import { describe, it, expect, vi } from 'vitest';
import { getBus } from '../../src/main/events.js';

describe('events bus', () => {
  it('emits and listens', () => {
    const bus = getBus();
    const handler = vi.fn();
    bus.on('test', handler);
    bus.emit('test', 'payload');
    expect(handler).toHaveBeenCalledWith('payload');
  });
});
