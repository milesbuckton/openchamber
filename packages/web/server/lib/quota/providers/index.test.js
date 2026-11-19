import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const { readOpenCodeCredentials } = vi.hoisted(() => ({ readOpenCodeCredentials: vi.fn(async () => ({})) }));
vi.mock('../../opencode/auth.js', () => ({ readOpenCodeCredentials }));

import * as antigravity from './antigravity/index.js';
import { fetchQuotaForProvider, listConfiguredQuotaProviders } from './index.js';

describe('quota provider registry', () => {
  it('exposes antigravity provider configuration helpers through the provider module', () => {
    expect(antigravity.providerId).toBe('antigravity');
    expect(antigravity.providerName).toBe('Antigravity');
    expect(typeof antigravity.isConfigured).toBe('function');
    expect(typeof antigravity.fetchQuota).toBe('function');
  });

  it('lists ZenMux from its managed credential, whatever the OpenCode auth holds', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'quota-list-'));
    vi.stubEnv('OPENCHAMBER_DATA_DIR', dataDir);
    try {
      await expect(listConfiguredQuotaProviders()).resolves.not.toContain('zenmux');
      mkdirSync(join(dataDir, 'quota'), { recursive: true });
      writeFileSync(join(dataDir, 'quota', 'zenmux.json'), JSON.stringify({ platformApiKey: 'key' }));
      await expect(listConfiguredQuotaProviders()).resolves.toContain('zenmux');
    } finally {
      vi.unstubAllEnvs();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('coalesces concurrent refreshes by provider ID', async () => {
    const first = fetchQuotaForProvider('unsupported-test-provider');
    const second = fetchQuotaForProvider('unsupported-test-provider');

    expect(first).toBe(second);
    await first;
    expect(fetchQuotaForProvider('unsupported-test-provider')).not.toBe(first);
  });

  it.each(['constructor', 'toString', '__proto__', 'null', null])('rejects unsupported registry key %s', async (providerId) => {
    await expect(fetchQuotaForProvider(providerId)).resolves.toMatchObject({
      providerId,
      providerName: providerId,
      ok: false,
      configured: false,
      usage: null,
      error: 'Unsupported provider',
    });
  });
});
