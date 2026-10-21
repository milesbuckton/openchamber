import { z } from 'zod';

// The Console workspace behind the shared `opencode` integration: the free
// models plus pay-as-you-go spend on the credits the account holds. Zen has no
// request meters, so the workspace exposes request counters per range, the
// spend of the current billing cycle, and the models that served those requests.
export type OpenCodeZenCredential = { apiKey: string } | { accessToken: string; orgID: string };

const CONSOLE_API_BASE = 'https://opencode.ai/console/api';
// The Console counts one cent as 1_000_000 micro-cents, so a dollar is 100_000_000.
const MICRO_CENTS_PER_DOLLAR = 100_000_000;
const REQUEST_TIMEOUT_MS = 15_000;

const formatCount = (value: number) => new Intl.NumberFormat('en-US').format(value);
const formatMoney = (value: number) => value.toFixed(2);

// Every count and amount arrives as a decimal string, so each one is decoded
// once at the HTTP boundary into a finite number.
const numericValue = z.union([
  z.string().transform((value) => Number(value)),
  z.number(),
]).pipe(z.number().finite());

const resetTimestamp = z.union([
  z.string().transform((value) => Date.parse(value)),
  z.number(),
]).pipe(z.number().finite().transform((value) => value < 1_000_000_000_000 ? value * 1000 : value));

type OpenCodeZenWindow = {
  usedPercent: number | null;
  remainingPercent: number | null;
  windowSeconds: number | null;
  resetAfterSeconds: number | null;
  resetAt: number | null;
  resetAtFormatted: string | null;
  resetAfterFormatted: string | null;
  valueLabel?: string;
};

type OpenCodeZenModelUsage = {
  windows: Record<string, OpenCodeZenWindow>;
};

// A count is not a share of a limit, so the window carries no percent and no
// reset: it reports how many requests the workspace made.
const toCountWindow = (requests: number): OpenCodeZenWindow => ({
  usedPercent: null,
  remainingPercent: null,
  windowSeconds: null,
  resetAfterSeconds: null,
  resetAt: null,
  resetAtFormatted: null,
  resetAfterFormatted: null,
  valueLabel: `${formatCount(requests)} requests`,
});

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

// The spend window of the budget. A capped account reports the share it used,
// an uncapped one the amount it spent, because there is no share to report.
const toBudgetWindow = (spent: number, limit: number | null, resetAt: number | null): OpenCodeZenWindow => {
  const resetAfterSeconds = resetAt === null ? null : Math.max(0, Math.floor((resetAt - Date.now()) / 1000));
  if (limit === null) {
    return {
      usedPercent: null,
      remainingPercent: null,
      windowSeconds: null,
      resetAfterSeconds,
      resetAt,
      resetAtFormatted: null,
      resetAfterFormatted: null,
      valueLabel: `$${formatMoney(spent)} spent`,
    };
  }
  const usedPercent = clampPercent((spent / limit) * 100);
  return {
    usedPercent,
    remainingPercent: Math.max(0, 100 - usedPercent),
    windowSeconds: null,
    resetAfterSeconds,
    resetAt,
    resetAtFormatted: null,
    resetAfterFormatted: null,
    valueLabel: `$${formatMoney(spent)} of $${formatMoney(limit)}`,
  };
};

const summarySchema = z.object({
  totalRequests: numericValue.optional().catch(undefined),
});

const budgetSchema = z.object({
  spentMicroCents: numericValue.optional().catch(undefined),
  limitMicroCents: numericValue.optional().catch(undefined),
  resetsAt: resetTimestamp.optional().catch(undefined),
});
const budgetsSchema = z.array(budgetSchema).catch([]);

const modelUsageSchema = z.object({
  model: z.string().optional().catch(undefined),
  totalRequests: numericValue.optional().catch(undefined),
});
const modelsSchema = z.object({
  items: z.array(modelUsageSchema).optional().catch(undefined),
});

const requestHeaders = (credential: OpenCodeZenCredential) => {
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${'apiKey' in credential ? credential.apiKey : credential.accessToken}`,
    'x-opencode-session': 'openchamber-usage',
    'User-Agent': 'OpenChamber quota provider',
  };
  if (!('orgID' in credential)) {
    return headers;
  }
  return { ...headers, 'x-org-id': credential.orgID };
};

// Every Console answer is read through the schema that owns it, so a payload
// in another shape yields no value instead of a half-read one.
const fetchConsoleJson = async <T>(
  path: string,
  credential: OpenCodeZenCredential,
  schema: z.ZodType<T>,
): Promise<T | null> => {
  const response = await fetch(`${CONSOLE_API_BASE}${path}`, {
    headers: requestHeaders(credential),
    // The bearer token belongs to opencode.ai; never follow a redirect that
    // would forward it to another origin.
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = await response.json().catch(() => null);
  if (response.status === 401 || response.status === 403) throw new Error('OpenCode Zen authentication failed');
  if (!response.ok) throw new Error(`OpenCode Zen usage API returned HTTP ${response.status}`);
  const parsed = schema.safeParse(payload);
  return parsed.success ? parsed.data : null;
};

export const fetchOpenCodeZenUsage = async (credential: OpenCodeZenCredential) => {
  const [daily, weekly, monthly, models, budgets] = await Promise.all([
    fetchConsoleJson('/usage/summary?range=24h', credential, summarySchema),
    fetchConsoleJson('/usage/summary?range=7d', credential, summarySchema),
    fetchConsoleJson('/usage/summary?range=30d', credential, summarySchema),
    fetchConsoleJson('/usage/models?range=30d&page=1&pageSize=50', credential, modelsSchema),
    // A workspace without a service account has no budget; that is not an error.
    fetchConsoleJson('/budgets/service-accounts/status', credential, budgetsSchema).catch(() => null),
  ]);

  const windows: Record<string, OpenCodeZenWindow> = {};
  if (daily?.totalRequests !== undefined) {
    windows.daily = toCountWindow(daily.totalRequests);
  }
  if (weekly?.totalRequests !== undefined) {
    windows.weekly = toCountWindow(weekly.totalRequests);
  }

  const budget = budgets?.find((row) => row.spentMicroCents !== undefined);
  if (budget?.spentMicroCents !== undefined) {
    const limit = budget.limitMicroCents === undefined || budget.limitMicroCents <= 0
      ? null
      : budget.limitMicroCents / MICRO_CENTS_PER_DOLLAR;
    windows.monthly = toBudgetWindow(budget.spentMicroCents / MICRO_CENTS_PER_DOLLAR, limit, budget.resetsAt ?? null);
  } else if (monthly?.totalRequests !== undefined) {
    windows.monthly = toCountWindow(monthly.totalRequests);
  }

  const modelUsage: Record<string, OpenCodeZenModelUsage> = {};
  for (const item of models?.items ?? []) {
    if (!item.model || item.totalRequests === undefined) continue;
    modelUsage[item.model] = { windows: { monthly: toCountWindow(item.totalRequests) } };
  }

  if (Object.keys(windows).length === 0 && Object.keys(modelUsage).length === 0) {
    throw new Error('OpenCode Zen usage data could not be parsed');
  }

  return { windows, models: modelUsage };
};
