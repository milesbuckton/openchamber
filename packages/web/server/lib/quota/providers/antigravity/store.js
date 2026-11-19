/**
 * Antigravity Provider - Plugin account store
 *
 * The Antigravity auth plugin keeps its accounts in a store directory inside
 * the OpenCode config dir instead of the legacy `antigravity-accounts.json`
 * file: `antigravity-accounts.json.store.pointer.json` names the current
 * generation directory, which holds `config.json` (the account list) and
 * `state.json` (the OAuth refresh token and the account metadata).
 *
 * The store files are read through schemas, so a file the plugin wrote in
 * another shape yields no account instead of a half-read one. Only node
 * builtins and zod are used here so the VS Code extension can import this
 * module without pulling the web server tree into its bundle.
 *
 * @module quota/providers/antigravity/store
 */

import fs from 'fs';
import path from 'path';
import { z } from 'zod';

const ANTIGRAVITY_STORE_POINTER_FILE = 'antigravity-accounts.json.store.pointer.json';

const STORE_DIRECTORY_PREFIX = 'antigravity-accounts.json.store.';
const STORE_DIRECTORY_SUFFIX = '.generation';

// The plugin writes plain text and plain numbers. A field it wrote in another
// shape is read as missing rather than as a broken value.
const optionalText = z.string().trim().min(1).nullish().catch(undefined);
const optionalNumber = z.number().finite().nullish().catch(undefined);

const pointerSchema = z.object({
  directoryBasename: optionalText,
});

const accountMetadataSchema = z.object({
  projectId: optionalText,
  email: optionalText,
  label: optionalText,
  addedAt: optionalNumber,
}).catch(undefined);

const storedAccountSchema = z.object({
  refresh: z.string().trim().min(1),
  commonAuthProviderState: z.object({
    metadata: accountMetadataSchema,
  }).catch(undefined),
}).catch(undefined);

const storeConfigSchema = z.object({
  accounts: z.array(z.object({
    id: optionalText,
    addedAt: optionalNumber,
  }).catch(undefined)).optional(),
  activeIndex: optionalNumber,
  activeAccountId: optionalText,
}).catch(undefined);

const storeStateSchema = z.object({
  accounts: z.record(z.string(), storedAccountSchema).optional(),
  activeAccountId: optionalText,
}).catch(undefined);

const readJsonFile = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return undefined;
  }
};

/**
 * The content of a store file, read through the schema that owns it. A file
 * that is missing or unreadable is read as no file at all.
 */
const readStoreFile = (filePath, schema) => {
  const parsed = schema.safeParse(readJsonFile(filePath));
  return parsed.success ? parsed.data : undefined;
};

/**
 * The store directory that holds the current accounts. The pointer names it;
 * when the pointer is missing (an interrupted migration, a store written by a
 * plugin version that never wrote one) the newest generation directory in the
 * config dir is used instead.
 */
const resolveStoreDirectory = (configDir) => {
  const pointer = readStoreFile(path.join(configDir, ANTIGRAVITY_STORE_POINTER_FILE), pointerSchema);
  const pointed = pointer?.directoryBasename;
  if (pointed) {
    const pointedDir = path.join(configDir, pointed);
    if (fs.existsSync(pointedDir)) {
      return pointedDir;
    }
  }

  let entries = [];
  try {
    entries = fs.readdirSync(configDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const generations = entries
    .filter((entry) => entry.isDirectory()
      && entry.name.startsWith(STORE_DIRECTORY_PREFIX)
      && entry.name.endsWith(STORE_DIRECTORY_SUFFIX))
    .map((entry) => {
      const dir = path.join(configDir, entry.name);
      let modified = 0;
      try {
        modified = fs.statSync(dir).mtimeMs;
      } catch {
        modified = 0;
      }
      return { dir, modified };
    })
    .sort((left, right) => right.modified - left.modified);

  return generations[0]?.dir ?? null;
};

/**
 * The account the store is signed in with: the one the plugin marked active,
 * otherwise the most recently added account that still holds a token.
 */
const selectStoreAccount = (config, state) => {
  const stateAccounts = state?.accounts ?? {};
  const listed = (config?.accounts ?? []).filter((entry) => entry !== undefined);

  const entries = listed.length
    ? listed.map((entry) => ({
        id: entry.id ?? null,
        addedAt: entry.addedAt ?? 0,
        account: stateAccounts[entry.id ?? ''] ?? null
      }))
    : Object.entries(stateAccounts)
      .filter(([, account]) => account !== undefined)
      .map(([id, account]) => ({
        id,
        addedAt: account?.commonAuthProviderState?.metadata?.addedAt ?? 0,
        account: account ?? null
      }));

  const usable = entries.filter((entry) => entry.account && entry.account.refresh);
  if (!usable.length) {
    return null;
  }

  const activeIndex = config?.activeIndex;
  if (activeIndex !== null && activeIndex !== undefined) {
    const active = entries[activeIndex];
    if (active && active.account?.refresh) {
      return active;
    }
  }

  const activeId = config?.activeAccountId ?? state?.activeAccountId;
  if (activeId) {
    const active = usable.find((entry) => entry.id === activeId);
    if (active) {
      return active;
    }
  }

  return usable.reduce((latest, entry) => (entry.addedAt > latest.addedAt ? entry : latest), usable[0]);
};

/**
 * The Antigravity account stored by the plugin, or null when the plugin has
 * never written a store. The refresh token may carry the project context in
 * the same pipe-packed shape the Google provider parses, so both parts are
 * read here.
 */
export const readAntigravityStoreAccount = (configDir) => {
  if (!configDir) {
    return null;
  }

  const storeDir = resolveStoreDirectory(configDir);
  if (!storeDir) {
    return null;
  }

  const config = readStoreFile(path.join(storeDir, 'config.json'), storeConfigSchema);
  const state = readStoreFile(path.join(storeDir, 'state.json'), storeStateSchema);
  const entry = selectStoreAccount(config, state);
  if (!entry) {
    return null;
  }

  const metadata = entry.account?.commonAuthProviderState?.metadata ?? {};
  const [rawToken = '', rawProject = '', rawManagedProject = ''] = entry.account.refresh.split('|');
  const refreshToken = rawToken.trim() || null;
  if (!refreshToken) {
    return null;
  }

  const packedProject = rawProject.trim() || rawManagedProject.trim() || null;

  return {
    accountId: entry.id,
    refreshToken,
    projectId: metadata.projectId ?? packedProject,
    email: metadata.email ?? null,
    label: metadata.label ?? null
  };
};
