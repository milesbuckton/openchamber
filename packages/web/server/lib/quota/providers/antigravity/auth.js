/**
 * Antigravity Provider - Auth
 *
 * Authentication resolution logic for Antigravity quota provider.
 * @module quota/providers/antigravity/auth
 */

import {
  ANTIGRAVITY_ACCOUNTS_PATHS,
  readJsonFile,
  asNonEmptyString,
  toNumber
} from '../../utils/index.js';
import { parseAntigravityRefreshToken } from './token.js';
import { readAntigravityStoreAccount } from './store.js';
import { OPENCODE_CONFIG_DIR } from '../../../opencode/shared.js';

export const DEFAULT_PROJECT_ID = 'rising-fact-p41fc';

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
    const data = readJsonFile(filePath);
    const accounts = data?.accounts;
    if (Array.isArray(accounts) && accounts.length > 0) {
      const parsedIndex = toNumber(data.activeIndex);
      const index = parsedIndex !== null ? parsedIndex : 0;
      const account = accounts[index] ?? accounts[0];
      if (account?.refreshToken) {
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
