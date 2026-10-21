import { readOpenCodeCredentials } from '../../opencode/auth.js';
import {
  asNonEmptyString,
  asObject,
  buildResult,
  formatMoney,
  getAuthEntry,
  normalizeAuthEntry,
  toNumber,
  toTimestamp,
  toUsageWindow,
} from '../utils/index.js';

/**
 * OpenCode Zen is the Console workspace behind the shared `opencode`
 * integration: the free models plus pay-as-you-go spend on the credits the
 * account holds. Zen has no request meters, so the workspace exposes request
 * counters per range, the spend of the current billing cycle, and the models
 * that served those requests.
 *
 * A workspace with an OpenCode Go subscription is reported by the
 * `opencode-go` provider, which reads the Go meters.
 */
export const providerId = 'opencode';
export const providerName = 'OpenCode Zen';

const CONSOLE_API_BASE = 'https://opencode.ai/console/api';
const CONSOLE_SERVER = 'https://opencode.ai/console';
const CONSOLE_INTEGRATION_ID = 'opencode';
const ORGANIZATION_ID_PATTERN = /^(?:org|wrk)_[A-Za-z0-9]+$/;
const REQUEST_TIMEOUT_MS = 15_000;
// The Console counts one cent as 1_000_000 micro-cents, so a dollar is 100_000_000.
const MICRO_CENTS_PER_DOLLAR = 100_000_000;

const formatCount = (value) => new Intl.NumberFormat('en-US').format(value);

const clampPercent = (value) => Math.min(100, Math.max(0, value));

const readKey = (entry) => asNonEmptyString(entry?.key) ?? asNonEmptyString(entry?.token);

/**
 * The Console API key of the shared `opencode` integration. OpenCode stores
 * the workspace key there, so it is the credential the Console API answers for.
 */
const getApiKey = (auth) => {
  const entry = normalizeAuthEntry(getAuthEntry(auth, [CONSOLE_INTEGRATION_ID]));
  if (!entry || entry.type === 'oauth') return null;
  const key = readKey(entry);
  return key ? { key } : null;
};

/**
 * The active OpenCode Console OAuth credential, only when it is a Console
 * sign-in (`server` is the Console origin and an organization is selected).
 */
const getConsoleCredential = (auth) => {
  const entry = normalizeAuthEntry(getAuthEntry(auth, [CONSOLE_INTEGRATION_ID]));
  if (!entry || entry.type !== 'oauth') return null;
  const access = asNonEmptyString(entry.access);
  const orgID = asNonEmptyString(entry.orgID);
  if (!access || entry.server !== CONSOLE_SERVER || !orgID || !ORGANIZATION_ID_PATTERN.test(orgID)) return null;
  const expires = toNumber(entry.expires);
  return { access, orgID, expires };
};

export const isConfigured = (auth) => Boolean(getConsoleCredential(auth) || getApiKey(auth));

const requestHeaders = (credential) => {
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${credential.key ?? credential.access}`,
    'x-opencode-session': 'openchamber-usage',
    'User-Agent': 'OpenChamber quota provider',
  };
  if (credential.orgID) {
    headers['x-org-id'] = credential.orgID;
  }
  return headers;
};

/**
 * The request counters of one range. The Console reports every count as a
 * decimal string, so each one is read once here.
 */
export const parseConsoleSummary = (payload) => {
  const summary = asObject(payload);
  if (!summary) return null;
  const requests = toNumber(summary.totalRequests);
  if (requests === null || requests < 0) return null;
  return { requests };
};

/**
 * The service-account budget. The limit is null while the account has no
 * spend cap, and the cycle resets on the first of the month.
 */
export const parseConsoleBudget = (payload) => {
  const rows = Array.isArray(payload) ? payload : [];
  for (const row of rows) {
    const budget = asObject(row);
    if (!budget) continue;
    const spentMicroCents = toNumber(budget.spentMicroCents);
    const limitMicroCents = toNumber(budget.limitMicroCents);
    const resetAt = toTimestamp(budget.resetsAt);
    if (spentMicroCents === null || spentMicroCents < 0) continue;
    return {
      spent: spentMicroCents / MICRO_CENTS_PER_DOLLAR,
      limit: limitMicroCents === null || limitMicroCents <= 0 ? null : limitMicroCents / MICRO_CENTS_PER_DOLLAR,
      resetAt,
      exceeded: budget.exceeded === true,
    };
  }
  return null;
};

/**
 * The per-model request counters of the last 30 days, one row per model.
 */
export const parseConsoleModelUsage = (payload) => {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const models = {};
  for (const item of items) {
    const entry = asObject(item);
    if (!entry) continue;
    const model = asNonEmptyString(entry.model);
    const requests = toNumber(entry.totalRequests);
    if (!model || requests === null || requests < 0) continue;
    models[model] = { requests };
  }
  return models;
};

/**
 * A window that reports a count rather than a share of a limit. Zen has no
 * request meters, so the counters are all the workspace exposes.
 */
const requestWindow = (requests) =>
  toUsageWindow({
    usedPercent: null,
    windowSeconds: null,
    resetAt: null,
    valueLabel: `${formatCount(requests)} requests`,
  });

/**
 * The spend window of the budget. A capped account reports the share it used,
 * an uncapped one the amount it spent, because there is no share to report.
 */
const budgetWindow = (budget) => {
  if (budget.limit === null) {
    return toUsageWindow({
      usedPercent: null,
      windowSeconds: null,
      resetAt: budget.resetAt,
      valueLabel: `$${formatMoney(budget.spent)} spent`,
    });
  }
  return toUsageWindow({
    usedPercent: clampPercent((budget.spent / budget.limit) * 100),
    windowSeconds: null,
    resetAt: budget.resetAt,
    valueLabel: `$${formatMoney(budget.spent)} of $${formatMoney(budget.limit)}`,
  });
};

const fetchConsoleJson = async (path, credential, fetchImpl = fetch) => {
  const response = await fetchImpl(`${CONSOLE_API_BASE}${path}`, {
    headers: requestHeaders(credential),
    // The bearer token belongs to opencode.ai; never follow a redirect that
    // would forward it to another origin.
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = await response.json().catch(() => null);
  if (response.status === 401 || response.status === 403) throw new Error('OpenCode Zen authentication failed');
  if (!response.ok) throw new Error(`OpenCode Zen usage API returned HTTP ${response.status}`);
  if (!asObject(payload)) throw new Error('OpenCode Zen usage data could not be parsed');
  return payload;
};

/**
 * The Zen view of a workspace: the requests of the last day and week, the
 * spend of the current cycle, and the models that served those requests.
 */
const fetchZenUsage = async (credential, fetchImpl) => {
  const [dailyPayload, weeklyPayload, monthlyPayload, modelsPayload, budgetPayload] = await Promise.all([
    fetchConsoleJson('/usage/summary?range=24h', credential, fetchImpl),
    fetchConsoleJson('/usage/summary?range=7d', credential, fetchImpl),
    fetchConsoleJson('/usage/summary?range=30d', credential, fetchImpl),
    fetchConsoleJson('/usage/models?range=30d&page=1&pageSize=50', credential, fetchImpl),
    // A workspace without a service account has no budget; that is not an error.
    fetchConsoleJson('/budgets/service-accounts/status', credential, fetchImpl).catch(() => null),
  ]);

  const daily = parseConsoleSummary(dailyPayload);
  const weekly = parseConsoleSummary(weeklyPayload);
  const monthly = parseConsoleSummary(monthlyPayload);
  const budget = parseConsoleBudget(budgetPayload);
  const modelUsage = parseConsoleModelUsage(modelsPayload);

  const windows = {};
  if (daily) windows.daily = requestWindow(daily.requests);
  if (weekly) windows.weekly = requestWindow(weekly.requests);
  if (budget) windows.monthly = budgetWindow(budget);
  else if (monthly) windows.monthly = requestWindow(monthly.requests);

  const models = {};
  for (const [model, usage] of Object.entries(modelUsage)) {
    models[model] = {
      windows: {
        monthly: requestWindow(usage.requests),
      },
    };
  }

  return { windows, models };
};

export const fetchQuota = async ({ readAuth = readOpenCodeCredentials, fetchImpl = fetch } = {}) => {
  try {
    const auth = await readAuth();
    const credential = getConsoleCredential(auth) ?? getApiKey(auth);
    if (!credential) {
      return buildResult({ providerId, providerName, ok: false, configured: false, error: 'Not configured' });
    }

    const { windows, models } = await fetchZenUsage(credential, fetchImpl);
    if (Object.keys(windows).length === 0 && Object.keys(models).length === 0) {
      throw new Error('OpenCode Zen usage data could not be parsed');
    }

    return buildResult({
      providerId,
      providerName,
      ok: true,
      configured: true,
      usage: { windows, models: Object.keys(models).length ? models : undefined },
    });
  } catch (error) {
    return buildResult({
      providerId,
      providerName,
      ok: false,
      configured: true,
      error: error instanceof Error ? error.message : 'Request failed',
    });
  }
};
