
import {
  ANTIGRAVITY_ACCOUNTS_PATHS,
  readJsonFile,
  asNonEmptyString,
  toNumber
} from '../../utils/index.js';
import { parseAntigravityRefreshToken } from './token.js';
import { readAntigravityStoreAccount } from './store.js';
import { OPENCODE_CONFIG_DIR } from '../../../opencode/config-files.js';

export const DEFAULT_PROJECT_ID = 'rising-fact-p41fc';

interface AccountsFile {
  accounts?: unknown;
  activeIndex?: unknown;
}

interface Account {
  refreshToken?: unknown;
  projectId?: unknown;
  managedProjectId?: unknown;
  email?: unknown;
}

const isAccountsFile = (value: unknown): value is AccountsFile =>
  value !== null && typeof value === 'object';

const isAccount = (value: unknown): value is Account =>
  value !== null && typeof value === 'object';

export const resolveAntigravityAuth = () => {
  // The auth plugin stores its accounts in a store directory; the legacy
  // accounts file is what older plugin versions wrote. The store wins because
  // the plugin migrates the file into the store and keeps the store current.
  const storeAccount = readAntigravityStoreAccount(OPENCODE_CONFIG_DIR);
  if (storeAccount) {
    return {
      sourceId: 'antigravity',
      sourceLabel: 'Antigravity',
      refreshToken: storeAccount.refreshToken,
      projectId: storeAccount.projectId,
      email: storeAccount.email
    };
  }

  for (const filePath of ANTIGRAVITY_ACCOUNTS_PATHS) {
    const input: unknown = readJsonFile(filePath);
    const data = isAccountsFile(input) ? input : null;
    const accounts = data?.accounts;
    if (Array.isArray(accounts) && accounts.length > 0) {
      const parsedIndex = toNumber(data?.activeIndex);
      const index = parsedIndex !== null ? parsedIndex : 0;
      const account: unknown = accounts[index] ?? accounts[0];
      if (isAccount(account) && typeof account.refreshToken === 'string') {
        const refreshParts = parseAntigravityRefreshToken(account.refreshToken);
        return {
          sourceId: 'antigravity',
          sourceLabel: 'Antigravity',
          refreshToken: refreshParts.refreshToken,
          projectId: asNonEmptyString(account.projectId)
            ?? asNonEmptyString(account.managedProjectId)
            ?? refreshParts.projectId
            ?? refreshParts.managedProjectId,
          email: account.email
        };
      }
    }
  }

  return null;
};

export const isConfigured = () => resolveAntigravityAuth() !== null;
