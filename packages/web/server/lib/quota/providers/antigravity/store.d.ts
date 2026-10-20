export interface AntigravityStoreAccount {
  accountId: string | null;
  refreshToken: string;
  projectId: string | null;
  email: string | null;
  label: string | null;
}

export function readAntigravityStoreAccount(configDir: string): AntigravityStoreAccount | null;
