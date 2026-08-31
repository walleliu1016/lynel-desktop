// src/main/auth-persistence.ts
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

/** 加密持久化 JWT；safeStorage 不可用时拒绝落盘（安全优先） */
export function saveStoredAuth(userId: string, jwt: string): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  getStore('settings').set(JWT_KEY, safeStorage.encryptString(jwt).toString('base64'));
  getStore('settings').set('currentUser', userId);
  return true;
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
