import { describe, expect, test } from 'bun:test';

import {
  ANTIGRAVITY_MODEL_PREFIX,
  antigravityOwnedProviderIds,
  isAntigravityCredential,
  isAntigravityModelId,
  isUsableModel,
  usableModels,
} from './antigravity';

// The plugin stores one OAuth credential per provider it takes over. The
// method id names the plugin's own browser login.

const pluginCredential = (integrationID: string, active = true) => ({
  integrationID,
  active,
  value: { type: 'oauth', methodID: 'antigravity-auth-pool-browser' },
});

const apiKeyCredential = (integrationID: string, active = true) => ({
  integrationID,
  active,
  value: { type: 'api', key: 'secret' },
});

describe('isAntigravityModelId', () => {
  test('names the models the plugin registers', () => {
    expect(isAntigravityModelId(`${ANTIGRAVITY_MODEL_PREFIX}gemini-3.8-flash`)).toBe(true);
  });

  test('leaves the provider\'s own models alone', () => {
    expect(isAntigravityModelId('gemini-3.8-flash')).toBe(false);
  });
});

describe('isAntigravityCredential', () => {
  test('knows the plugin\'s own OAuth credential', () => {
    expect(isAntigravityCredential(pluginCredential('google'))).toBe(true);
  });

  test('leaves an API key alone', () => {
    expect(isAntigravityCredential(apiKeyCredential('google'))).toBe(false);
  });

  test('leaves another OAuth integration alone', () => {
    expect(isAntigravityCredential({
      integrationID: 'google',
      active: true,
      value: { type: 'oauth', methodID: 'google-auth' },
    })).toBe(false);
  });
});

describe('antigravityOwnedProviderIds', () => {
  test('claims the provider the plugin holds the credential for', () => {
    const owned = antigravityOwnedProviderIds([pluginCredential('google')]);

    expect([...owned]).toEqual(['google']);
  });

  test('leaves a provider with a real key to OpenCode', () => {
    const owned = antigravityOwnedProviderIds([apiKeyCredential('google')]);

    expect(owned.size).toBe(0);
  });

  test('the active credential decides for a provider with several', () => {
    const owned = antigravityOwnedProviderIds([
      pluginCredential('google', false),
      apiKeyCredential('google', true),
    ]);

    expect(owned.size).toBe(0);
  });

  test('claims the provider when the plugin\'s credential is the active one', () => {
    const owned = antigravityOwnedProviderIds([
      apiKeyCredential('google', false),
      pluginCredential('google', true),
    ]);

    expect([...owned]).toEqual(['google']);
  });

  test('claims a provider whose credentials are all the plugin\'s', () => {
    const owned = antigravityOwnedProviderIds([
      pluginCredential('google', false),
      pluginCredential('google', false),
    ]);

    expect([...owned]).toEqual(['google']);
  });

  test('claims nothing without a credential', () => {
    expect(antigravityOwnedProviderIds([]).size).toBe(0);
    expect(antigravityOwnedProviderIds(null).size).toBe(0);
  });
});

describe('usableModels', () => {
  const models = [
    { id: 'gemini-3.8-flash', providerID: 'google' },
    { id: 'antigravity-gemini-3.8-flash', providerID: 'google' },
    { id: 'antigravity-claude-opus-5-5', providerID: 'google' },
    { id: 'claude-opus-5-5', providerID: 'anthropic' },
  ];

  test('keeps the plugin\'s models for a provider it owns', () => {
    const usable = usableModels(models, new Set(['google']));

    expect(usable.map((model) => model.id)).toEqual([
      'antigravity-gemini-3.8-flash',
      'antigravity-claude-opus-5-5',
      'claude-opus-5-5',
    ]);
  });

  test('keeps the provider\'s own models for a provider it does not own', () => {
    const usable = usableModels(models, new Set<string>());

    expect(usable.map((model) => model.id)).toEqual(models.map((model) => model.id));
  });

  test('keeps the plugin\'s models out of a provider it does not own', () => {
    const usable = usableModels(models, new Set(['anthropic']));

    // google is not owned: its own model stays, the plugin\'s does not.
    // anthropic is owned: its own model goes, the plugin\'s stays.
    expect(usable.map((model) => model.id)).toEqual([
      'gemini-3.8-flash',
    ]);
  });
});

describe('isUsableModel', () => {
  test('reads a model reference the same way', () => {
    const owned = new Set(['google']);

    expect(isUsableModel({ id: 'antigravity-gemini-3.8-flash', providerID: 'google' }, owned)).toBe(true);
    expect(isUsableModel({ id: 'gemini-3.8-flash', providerID: 'google' }, owned)).toBe(false);
    expect(isUsableModel({ id: 'gemini-3.8-flash', providerID: 'anthropic' }, owned)).toBe(true);
  });
});
