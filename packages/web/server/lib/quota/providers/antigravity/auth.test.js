import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalConfigDir = process.env.OPENCODE_CONFIG_DIR;
const tempDirs = [];

const makeConfigDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-ag-auth-'));
  tempDirs.push(dir);
  return dir;
};

/**
 * The auth module resolves the OpenCode config dir when it loads, so the
 * module graph is reloaded for every case.
 */
const loadAuth = async (configDir) => {
  process.env.OPENCODE_CONFIG_DIR = configDir;
  vi.resetModules();
  return import('./auth.js');
};

const writeStore = (configDir, { refresh, projectId, email }) => {
  const dirName = 'antigravity-accounts.json.store.test.generation';
  const storeDir = path.join(configDir, dirName);
  fs.mkdirSync(storeDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'antigravity-accounts.json.store.pointer.json'), JSON.stringify({
    schemaVersion: 1,
    id: 'test',
    directoryBasename: dirName
  }));
  fs.writeFileSync(path.join(storeDir, 'config.json'), JSON.stringify({
    version: 1,
    accounts: [{ id: 'account-1', type: 'oauth', addedAt: 1000 }]
  }));
  fs.writeFileSync(path.join(storeDir, 'state.json'), JSON.stringify({
    version: 1,
    accounts: {
      'account-1': {
        refresh,
        commonAuthProviderState: { metadata: { email, projectId } }
      }
    }
  }));
};

afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR;
  else process.env.OPENCODE_CONFIG_DIR = originalConfigDir;
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
  vi.resetModules();
});

describe('Antigravity quota auth', () => {
  it('resolves the account the auth plugin stored', async () => {
    const configDir = makeConfigDir();
    writeStore(configDir, {
      refresh: '1//03vtoken',
      projectId: 'aicode-consumers',
      email: 'user@example.com'
    });

    const { resolveAntigravityAuth, isConfigured } = await loadAuth(configDir);

    expect(resolveAntigravityAuth()).toEqual({
      sourceId: 'antigravity',
      sourceLabel: 'Antigravity',
      refreshToken: '1//03vtoken',
      projectId: 'aicode-consumers',
      email: 'user@example.com'
    });
    expect(isConfigured()).toBe(true);
  });

  it('falls back to the legacy accounts file when there is no store', async () => {
    const configDir = makeConfigDir();
    fs.writeFileSync(path.join(configDir, 'antigravity-accounts.json'), JSON.stringify({
      accounts: [{ refreshToken: 'legacy-token', projectId: 'legacy-project', email: 'legacy@example.com' }]
    }));

    const { resolveAntigravityAuth } = await loadAuth(configDir);

    expect(resolveAntigravityAuth()).toEqual({
      sourceId: 'antigravity',
      sourceLabel: 'Antigravity',
      refreshToken: 'legacy-token',
      projectId: 'legacy-project',
      email: 'legacy@example.com'
    });
  });

  it('reports no credential when neither source exists', async () => {
    const { resolveAntigravityAuth, isConfigured } = await loadAuth(makeConfigDir());

    expect(resolveAntigravityAuth()).toBeNull();
    expect(isConfigured()).toBe(false);
  });
});
