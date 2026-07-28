// 补齐缺失架构的 @napi-rs/canvas 原生绑定。
//
// npm 只安装当前架构（os.arch()）的可选依赖；跨架构 dmg 需要把对应子包
// 也放进 node_modules。这是 napi-rs family 的已知问题。
//
// 核心要点：
// 1. 必须按主包 @napi-rs/canvas 的版本号 pin 子包版本，否则会装到 1.x.y
//    与主包 0.x.y 不匹配，运行时 js-binding.js 找不到导出符号；
// 2. 必须加 --force 让 npm 跳过 EBADPLATFORM（跨 CPU 校验），否则在
//    macos-latest (arm64) runner 上装 darwin-x64 子包直接被拒；
// 3. 不写 package-lock / package.json 项（--no-save），仅在本次打包
//    临时补齐，不动 lockfile。

import { execSync } from 'node:child_process';
import { arch, platform } from 'node:os';
import { readFileSync } from 'node:fs';
import path from 'node:path';

if (platform() !== 'darwin') {
  console.log('pre-dist-mac: skip (not darwin)');
  process.exit(0);
}

const current = arch();
const opposite = current === 'arm64' ? 'x64' : 'arm64';

// 从主包 package.json 读版本号（与 package-lock 中 optionalDependencies 一致）
const mainPkgPath = path.join('node_modules', '@napi-rs', 'canvas', 'package.json');
let mainVersion = '';
try {
  const pkg = JSON.parse(readFileSync(mainPkgPath, 'utf-8'));
  mainVersion = pkg.version || '';
} catch (err) {
  console.error(`pre-dist-mac: cannot read ${mainPkgPath}:`, err?.message || err);
  process.exit(1);
}
if (!mainVersion) {
  console.error('pre-dist-mac: missing version in @napi-rs/canvas/package.json');
  process.exit(1);
}

const pkg = `@napi-rs/canvas-darwin-${opposite}`;
const spec = `${pkg}@${mainVersion}`;
console.log(`pre-dist-mac: main @napi-rs/canvas=${mainVersion}, current arch=${current}, target=${opposite}`);

// 已装则跳过
try {
  require.resolve(pkg);
  const installed = JSON.parse(readFileSync(path.join('node_modules', pkg, 'package.json'), 'utf-8'));
  if (installed.version === mainVersion) {
    console.log(`pre-dist-mac: ${pkg}@${installed.version} already installed, skip`);
    process.exit(0);
  }
  console.log(`pre-dist-mac: version mismatch (${installed.version} != ${mainVersion}), reinstalling`);
} catch {
  // not yet installed
}

// --force: 跳过 EBADPLATFORM（架构校验）
// --no-save: 不改 package.json / package-lock.json
console.log(`pre-dist-mac: npm install ${spec} --force --no-save`);
execSync(`npm install --no-save --force ${spec}`, { stdio: 'inherit' });

// 验证
try {
  const installed = JSON.parse(readFileSync(path.join('node_modules', pkg, 'package.json'), 'utf-8'));
  if (installed.version !== mainVersion) {
    console.error(`pre-dist-mac: installed ${pkg}@${installed.version}, expected ${mainVersion}`);
    process.exit(1);
  }
  console.log(`pre-dist-mac: OK, ${pkg}@${installed.version} installed`);
} catch (err) {
  console.error(`pre-dist-mac: verify failed:`, err?.message || err);
  process.exit(1);
}