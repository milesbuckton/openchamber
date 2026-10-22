import { describe, expect, test } from 'bun:test';

import { antigravityErrorFrom, classifyAntigravityError } from './antigravity-error';

// What the plugin answers with. The model it cannot serve is a plain error;
// an exhausted quota is an HTTP 412 whose body names the wait.

const UNSUPPORTED_MODEL = 'This request cannot use Antigravity. Choose a supported Antigravity model.';

const QUOTA_BODY = JSON.stringify({
  error: {
    code: 412,
    status: 'FAILED_PRECONDITION',
    message: 'Antigravity account pool is unavailable under the quota protection policy. Add accounts, wait for quota reset, or disable soft quota protection. Quota resets in 113h 34m 26s.',
  },
});

describe('classifyAntigravityError', () => {
  test('leaves an error of another provider alone', () => {
    expect(classifyAntigravityError({ message: 'Rate limit reached for model gpt-5' })).toBeNull();
  });

  test('leaves an empty error alone', () => {
    expect(classifyAntigravityError(null)).toBeNull();
    expect(classifyAntigravityError({ message: '  ' })).toBeNull();
  });

  test('names the model the plugin cannot serve', () => {
    const error = classifyAntigravityError({ message: UNSUPPORTED_MODEL });

    expect(error?.kind).toBe('unsupported-model');
    expect(error?.resetAt).toBeNull();
  });

  test('names the exhausted quota', () => {
    const error = classifyAntigravityError({ message: 'Request failed', body: QUOTA_BODY });

    expect(error?.kind).toBe('quota');
  });

  test('reads the wait the plugin wrote', () => {
    const now = 1_700_000_000_000;
    const error = classifyAntigravityError({ message: 'Request failed', body: QUOTA_BODY }, now);

    // 113h 34m 26s
    expect(error?.resetAt).toBe(now + ((113 * 3600 + 34 * 60 + 26) * 1000));
  });

  test('prefers the retry-after OpenCode took from the provider', () => {
    const now = 1_700_000_000_000;
    const error = classifyAntigravityError({
      message: 'Request failed',
      body: QUOTA_BODY,
      retryAfterMs: 60_000,
    }, now);

    expect(error?.resetAt).toBe(now + 60_000);
  });

  test('names a pool without an account to serve with', () => {
    const error = classifyAntigravityError({
      message: 'Antigravity account pool has no account available within the configured wait limit.',
    });

    expect(error?.kind).toBe('pool-unavailable');
  });

  test('names a missing access token', () => {
    const error = classifyAntigravityError({
      message: 'Missing access token. Run `opencode auth login` to reauthenticate.',
    });

    expect(error?.kind).toBe('not-authenticated');
  });
});

describe('antigravityErrorFrom', () => {
  test('reads the body and the retry-after of a recorded error', () => {
    const error = antigravityErrorFrom({
      type: 'provider.quota',
      message: 'Request failed',
      status: 412,
      response: { body: QUOTA_BODY },
      retryAfterMs: 1_000,
    });

    expect(error?.body).toBe(QUOTA_BODY);
    expect(error?.status).toBe(412);
    expect(error?.retryAfterMs).toBe(1_000);
  });

  test('has nothing to read without an error', () => {
    expect(antigravityErrorFrom(null)).toBeNull();
  });
});
