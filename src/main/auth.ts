import bcrypt from 'bcryptjs';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(password, hash);
}

export function isInitialized(hash: string): boolean {
  return !!hash;
}
