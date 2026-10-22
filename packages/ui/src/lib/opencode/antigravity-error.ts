/**
 * The failures the Antigravity auth plugin reports, read from what OpenCode
 * reported about the failed turn.
 *
 * The plugin answers a model it cannot serve with a plain message, and an
 * exhausted quota with an HTTP 412 whose body names the wait until the account
 * may serve again. The notice turns both into something a person can act on
 * instead of passing the raw text on.
 */

import type { StructuredError } from '@/lib/opencode/model';

/** What the plugin could not do. */
type AntigravityErrorKind =
  /** The model asked for is not one the plugin serves. */
  | 'unsupported-model'
  /** The account's quota for the model is used up. */
  | 'quota'
  /** No account in the pool can serve the request right now. */
  | 'pool-unavailable'
  /** The plugin has no access token for the account. */
  | 'not-authenticated';

type AntigravityError = {
  kind: AntigravityErrorKind;
  /**
   * The moment the account may serve again, when the failure named a wait.
   * Null when the failure said nothing about it.
   */
  resetAt: number | null;
};

/** The shape of an error as far as these rules care about it. */
type AntigravityErrorLike = {
  message?: string | null;
  body?: string | null;
  status?: number | null;
  retryAfterMs?: number | null;
};

const UNSUPPORTED_MODEL_MARKER = 'cannot use Antigravity';
const POOL_UNAVAILABLE_MARKER = 'no account available within the configured wait limit';
const NOT_AUTHENTICATED_MARKER = 'Missing access token';
const QUOTA_MARKERS = [
  'Quota resets in',
  'quota protection policy',
  'operator quota policy',
  'rate limit exceeded',
];

/** The wait the plugin wrote: "113h 34m 26s", "45m", "12s". */
const RESET_WAIT = /resets in ((?:\d+h)?(?:\s*\d+m)?(?:\s*\d+s)?)/i;

const parseWaitSeconds = (text: string): number | null => {
  const match = RESET_WAIT.exec(text);
  if (!match) return null;
  const parts = match[1].trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  let seconds = 0;
  for (const part of parts) {
    const value = Number.parseInt(part, 10);
    if (!Number.isFinite(value)) return null;
    if (part.endsWith('h')) seconds += value * 3600;
    else if (part.endsWith('m')) seconds += value * 60;
    else seconds += value;
  }
  return seconds > 0 ? seconds : null;
};

/**
 * The Antigravity failure behind an error, or null when the error is not one.
 *
 * The wait comes from OpenCode's own retry-after first — it counts from the
 * failure — and from the wait the plugin wrote in the message otherwise.
 */
export const classifyAntigravityError = (
  error: AntigravityErrorLike | null | undefined,
  now: number = Date.now(),
): AntigravityError | null => {
  const message = error?.message?.trim() ?? '';
  const body = error?.body?.trim() ?? '';
  const text = `${message}\n${body}`;
  if (!text.trim()) return null;

  const waitSeconds = parseWaitSeconds(text);
  const resetAt = error?.retryAfterMs && error.retryAfterMs > 0
    ? now + error.retryAfterMs
    : waitSeconds !== null
      ? now + waitSeconds * 1000
      : null;

  if (text.includes(UNSUPPORTED_MODEL_MARKER)) {
    return { kind: 'unsupported-model', resetAt: null };
  }
  if (text.includes(NOT_AUTHENTICATED_MARKER)) {
    return { kind: 'not-authenticated', resetAt: null };
  }
  if (text.includes(POOL_UNAVAILABLE_MARKER)) {
    return { kind: 'pool-unavailable', resetAt };
  }
  if (QUOTA_MARKERS.some((marker) => text.includes(marker))) {
    return { kind: 'quota', resetAt };
  }
  return null;
};

/** The error behind a failed turn, in the shape these rules read. */
export const antigravityErrorFrom = (
  error: StructuredError | null | undefined,
): AntigravityErrorLike | null => {
  if (!error) return null;
  return {
    message: error.message,
    body: error.response?.body ?? null,
    status: error.status ?? null,
    retryAfterMs: error.retryAfterMs ?? null,
  };
};
