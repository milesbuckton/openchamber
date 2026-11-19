import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readAntigravityStoreAccount } from './store.js';

const tempDirs = [];

const makeConfigDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-ag-store-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

/**
 * A store generation directory the way the auth plugin writes it: `config.json`
 * lists the accounts, `state.json` holds their tokens and metadata.
 */
const writeStore = (configDir, dirName, accounts, { pointer = true } = {}) => {
  const storeDir = path.join(configDir, dirName);
  fs.mkdirSync(storeDir, { recursive: true });
  fs.writeFileSync(path.join(storeDir, 'config.json'), JSON.stringify({
    version: 1,
    accounts: accounts.map((account) => ({ id: account.id, type: 'oauth', addedAt: account.addedAt }))
  }));
  fs.writeFileSync(path.join(storeDir, 'state.json'), JSON.stringify({
    version: 1,
    accounts: Object.fromEntries(accounts.map((account) => [account.id, {
      refresh: account.refresh,
      commonAuthProviderState: {
        metadata: {
          email: account.email,
          label: account.label,
          projectId: account.projectId,
          addedAt: account.addedAt
        }
      }
    }]))
  }));
  if (pointer) {
    fs.writeFileSync(path.join(configDir, 'antigravity-accounts.json.store.pointer.json'), JSON.stringify({
      schemaVersion: 1,
      id: dirName,
      directoryBasename: dirName
    }));
  }
  return storeDir;
};

describe('Antigravity account store', () => {
  it('reads the account the pointer names', () => {
    const configDir = makeConfigDir();
    writeStore(configDir, 'antigravity-accounts.json.store.abc.generation', [{
      id: 'account-1',
      addedAt: 1000,
      refresh: '1//03vtoken',
      email: 'user@example.com',
      label: 'User',
      projectId: 'aicode-consumers'
    }]);

    expect(readAntigravityStoreAccount(configDir)).toEqual({
      accountId: 'account-1',
      refreshToken: '1//03vtoken',
      projectId: 'aicode-consumers',
      email: 'user@example.com',
      label: 'User'
    });
  });

  it('uses the newest generation directory when the pointer is missing', () => {
    const configDir = makeConfigDir();
    const older = writeStore(configDir, 'antigravity-accounts.json.store.old.generation', [{
      id: 'old',
      addedAt: 1000,
      refresh: 'old-token'
    }], { pointer: false });
    const newer = writeStore(configDir, 'antigravity-accounts.json.store.new.generation', [{
      id: 'new',
      addedAt: 1000,
      refresh: 'new-token'
    }], { pointer: false });
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(older, past, past);

    expect(readAntigravityStoreAccount(configDir)?.refreshToken).toBe('new-token');
    expect(newer).toContain('new.generation');
  });

  it('prefers the most recently added account', () => {
    const configDir = makeConfigDir();
    writeStore(configDir, 'antigravity-accounts.json.store.abc.generation', [
      { id: 'older', addedAt: 1000, refresh: 'older-token' },
      { id: 'newer', addedAt: 2000, refresh: 'newer-token' }
    ]);

    expect(readAntigravityStoreAccount(configDir)?.refreshToken).toBe('newer-token');
  });

  it('honors the active account the plugin recorded', () => {
    const configDir = makeConfigDir();
    const storeDir = writeStore(configDir, 'antigravity-accounts.json.store.abc.generation', [
      { id: 'older', addedAt: 1000, refresh: 'older-token' },
      { id: 'newer', addedAt: 2000, refresh: 'newer-token' }
    ]);
    const config = JSON.parse(fs.readFileSync(path.join(storeDir, 'config.json'), 'utf8'));
    config.activeAccountId = 'older';
    fs.writeFileSync(path.join(storeDir, 'config.json'), JSON.stringify(config));

    expect(readAntigravityStoreAccount(configDir)?.refreshToken).toBe('older-token');
  });

  it('splits a refresh token that carries the project context', () => {
    const configDir = makeConfigDir();
    writeStore(configDir, 'antigravity-accounts.json.store.abc.generation', [{
      id: 'account-1',
      addedAt: 1000,
      refresh: '1//03vtoken|project-id|managed-project'
    }]);

    const account = readAntigravityStoreAccount(configDir);
    expect(account?.refreshToken).toBe('1//03vtoken');
    expect(account?.projectId).toBe('project-id');
  });

  it('returns null when the plugin never wrote a store', () => {
    expect(readAntigravityStoreAccount(makeConfigDir())).toBeNull();
    expect(readAntigravityStoreAccount(null)).toBeNull();
  });
});
