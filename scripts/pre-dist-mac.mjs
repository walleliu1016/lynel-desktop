// 通用二进制构建前置脚本：
// 补齐缺失架构的 @napi-rs/canvas 原生绑定。
// npm 只安装当前架构的可选依赖，构建通用二进制需要两种架构都存在。
import { execSync } from 'node:child_process';
import { arch, platform } from 'node:os';

if (platform() !== 'darwin') {
  console.log('pre-dist-mac: skip (not darwin)');
  process.exit(0);
}

const opposite = arch() === 'arm64' ? 'x64' : 'arm64';
const pkg = `@napi-rs/canvas-darwin-${opposite}`;

try {
  require.resolve(pkg);
  console.log(`pre-dist-mac: ${pkg} already installed`);
} catch {
  console.log(`pre-dist-mac: installing ${pkg} for universal build...`);
  execSync(`npm install --no-save ${pkg}`, { stdio: 'inherit' });
  console.log(`pre-dist-mac: ${pkg} installed`);
}
