import { EventEmitter } from 'node:events';

const bus = new EventEmitter();

export function getBus(): EventEmitter {
  return bus;
}
