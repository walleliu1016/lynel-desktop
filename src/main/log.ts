import log from 'electron-log/main';

log.initialize();

export function getLogger() {
  return log;
}
