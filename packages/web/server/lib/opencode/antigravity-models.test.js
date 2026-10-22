import { describe, expect, test } from 'bun:test';

import {
  antigravityOwnedProviderIds,
  isAntigravityCredential,
  isAntigravityModelId,
  isUsableModel,
  usableModels,
} from './antigravity-models.js';

// The server copy of the rules the UI keeps in
// packages/ui/src/lib/opencode/antigravity.ts. The two must agree, so the
// same cases are checked here.

const pluginCredential = (integrationID, active = true) => ({
  integrationID,
  active,
  value: { type: 'oauth', methodID: 'antigravity-auth-pool-browser' },
});

const apiKeyCredential = (integrationID, active = true) => ({
  integrationID,
  active,
  value: { type: 'api', key: 'secret' },
});

describe('isAntigravityModelId', () => {
  test('names the models the plugin registers', () => {
    expect(isAntigravityModelId('antigravity-gemini-3.8-flash')).toBe(true);
    expect(isAntigravityModelId('gemini-3.8-flash')).toBe(false);
  });
});

describe('isAntigravityCredential', () => {
  test('knows the plugin\'s own OAuth credential', () => {
    expect(isAntigravityCredential(pluginCredential('google'))).toBe(true);
    expect(isAntigravityCredential(apiKeyCredential('google'))).toBe(false);
  });
});

describe('antigravityOwnedProviderIds', () => {
  test('claims the provider the plugin holds the credential for', () => {
    expect([...antigravityOwnedProviderIds([pluginCredential('google')])]).toEqual(['google']);
  });

  test('leaves a provider with a real key to OpenCode', () => {
    expect(antigravityOwnedProviderIds([apiKeyCredential('google')]).size).toBe(0);
  });

  test('the active credential decides for a provider with several', () => {
    const owned = antigravityOwnedProviderIds([
      pluginCredential('google', false),
      apiKeyCredential('google', true),
    ]);

    expect(owned.size).toBe(0);
  });

  test('claims a provider whose credentials are all the plugin\'s', () => {
    expect([...antigravityOwnedProviderIds([pluginCredential('google', false)])]).toEqual(['google']);
  });
});

describe('usableModels', () => {
  const models = [
    { id: 'gemini-3.8-flash', providerID: 'google' },
    { id: 'antigravity-gemini-3.8-flash', providerID: 'google' },
    { id: 'claude-opus-5-5', providerID: 'anthropic' },
  ];

  test('keeps the plugin\'s models for a provider it owns', () => {
    const usable = usableModels(models, new Set(['google']));

    expect(usable.map((model) => model.id)).toEqual([
      'antigravity-gemini-3.8-flash',
      'claude-opus-5-5',
    ]);
  });

  test('keeps every model when no provider is owned', () => {
    const usable = usableModels(models, new Set());

    expect(usable.map((model) => model.id)).toEqual(models.map((model) => model.id));
  });
});

describe('isUsableModel', () => {
  test('reads a model reference the same way', () => {
    const owned = new Set(['google']);

    expect(isUsableModel({ id: 'antigravity-gemini-3.8-flash', providerID: 'google' }, owned)).toBe(true);
    expect(isUsableModel({ id: 'gemini-3.8-flash', providerID: 'google' }, owned)).toBe(false);
  });
});
