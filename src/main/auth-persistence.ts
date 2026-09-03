// src/main/auth-persistence.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { safeStorage } from 'electron';
import { getStore } from './store.js';

const JWT_KEY = 'auth_jwt_enc';

export interface StoredAuth {
  userId: string;
  jwt: string;
}

export type RestoreDecision = 'home' | 'pending' | 'form';

/** 启动分流决策：云关闭+已记住用户名 → 直接进首页；云开启+有可用 JWT → 自动登录；否则 → 表单 */
export function decideRestore(
  cloudEnabled: boolean,
  hasStoredJwt: boolean,
  username: string,
): RestoreDecision {
  if (!cloudEnabled && username) return 'home';
  if (cloudEnabled && hasStoredJwt) return 'pending';
  return 'form';
}

/** 加密持久化 JWT；safeStorage 不可用或加密/落盘抛错时返回 false（安全优先） */
export function saveStoredAuth(userId: string, jwt: string): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  try {
    getStore('settings').set(JWT_KEY, safeStorage.encryptString(jwt).toString('base64'));
    getStore('settings').set('currentUser', userId);
    return true;
  } catch {
    return false;
  }
}

/** 读取并解密 JWT；解密失败或 currentUser 缺失时清理并返回 null */
export function loadStoredAuth(): StoredAuth | null {
  const raw = getStore('settings').get(JWT_KEY) as string | undefined;
  if (!raw) return null;
  if (!safeStorage.isEncryptionAvailable()) {
    clearStoredAuth();
    return null;
  }
  let jwt: string;
  try {
    jwt = safeStorage.decryptString(Buffer.from(raw, 'base64'));
  } catch {
    clearStoredAuth();
    return null;
  }
  const userId = getStore('settings').get('currentUser') as string | undefined;
  if (!userId) {
    clearStoredAuth();
    return null;
  }
  return { userId, jwt };
}

/** 清除持久化 JWT */
export function clearStoredAuth(): void {
  getStore('settings').delete(JWT_KEY);
}

/** 明文凭据文件（供本机其他应用读取当前云登录态），默认 ~/.lynel-desktop/credential.json */
const CRED_FILE = path.join(os.homedir(), '.lynel-desktop', 'credential.json');

/** 明文写当前云凭据；原子写（临时文件 + rename），写失败静默不影响主流程 */
export function writeCredentialFile(userId: string, jwt: string, filePath?: string): void {
  const target = filePath ?? CRED_FILE;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ userId, jwt }), 'utf8');
    fs.renameSync(tmp, target);
  } catch {
    /* 凭据文件仅作辅助，写失败不阻断 */
  }
}

/** 删除明文凭据文件（退出登录 / 凭据失效时） */
export function clearCredentialFile(filePath?: string): void {
  try {
    fs.rmSync(filePath ?? CRED_FILE, { force: true });
  } catch {
    /* 忽略 */
  }
}
