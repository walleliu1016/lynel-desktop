// 补齐缺失架构的 @napi-rs/canvas 原生绑定。
// npm 只安装当前架构的可选依赖，构建其他架构时需要手动补齐。
// 截图功能在运行时懒加载，缺失时不崩溃仅降级。
import { execSync } from 'node:child_process';
import { arch, platform } from 'node:os';

if (platform() !== 'darwin') {
  console.log('pre-dist-mac: skip (not darwin)');
  process.exit(0);
}

const current = arch();
const opposite = current === 'arm64' ? 'x64' : 'arm64';
const pkgs = [`@napi-rs/canvas-darwin-${opposite}`];

// 如果当前是 arm64 构建 x64，arm64 模块已由 npm 安装；反之亦然。
// 只需要装 opposite 架构的模块。
for (const pkg of pkgs) {
  try {
    require.resolve(pkg);
    console.log(`pre-dist-mac: ${pkg} already installed`);
  } catch {
    console.log(`pre-dist-mac: installing ${pkg} (current=${current}, target=${opposite})...`);
    execSync(`npm install --no-save ${pkg}`, { stdio: 'inherit' });
    console.log(`pre-dist-mac: ${pkg} installed`);
  }
}
