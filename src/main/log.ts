import log from 'electron-log/main';

log.initialize();

// 防止 stdout/stderr 管道断开导致 EPIPE 崩溃
// 当父进程（npm/concurrently）关闭时，管道写入会抛出 EPIPE
function ignoreEpipe(stream: NodeJS.WriteStream) {
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') return;
  });
}
ignoreEpipe(process.stdout);
ignoreEpipe(process.stderr);

export function getLogger() {
  return log;
}
