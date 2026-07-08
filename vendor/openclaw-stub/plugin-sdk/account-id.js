export const DEFAULT_ACCOUNT_ID = 'default';

export function normalizeAccountId(id) {
  return id && typeof id === 'string' ? id : DEFAULT_ACCOUNT_ID;
}
