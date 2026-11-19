/**
 * The Antigravity auth plugin (`@cortexkit/opencode-antigravity-auth`) takes a
 * provider over when it is the credential behind that provider: it registers
 * its own models next to the provider's own and answers every other model id
 * with "This request cannot use Antigravity. Choose a supported Antigravity
 * model."
 *
 * So for one provider only one of the two sets works, and the credential
 * decides which one: the plugin's own OAuth credential means the plugin owns
 * the requests and only the models it registered work; a real API key leaves
 * the provider to OpenCode, and the plugin's model ids are the ones that fail.
 *
 * The model picker offers the set that works, never both. The server keeps a
 * copy of these rules in packages/web/server/lib/opencode/antigravity-models.js
 * for the agent's own model search; the two must agree.
 */

/** Every model the plugin registers carries this prefix. */
export const ANTIGRAVITY_MODEL_PREFIX = 'antigravity-';

/** Whether a model id is one the Antigravity plugin registered. */
export const isAntigravityModelId = (modelId: string | null | undefined): boolean =>
  typeof modelId === 'string' && modelId.startsWith(ANTIGRAVITY_MODEL_PREFIX);

/** The shape of a credential as far as these rules care about it. */
type CredentialLike = {
  integrationID?: string | null;
  active?: boolean | null;
  value?: { type?: string | null; methodID?: string | null } | null;
};

/**
 * The OAuth credential the Antigravity plugin stores for a provider. Its
 * method id names the plugin's own browser login, which no other integration
 * uses.
 */
export const isAntigravityCredential = (credential: CredentialLike | null | undefined): boolean => {
  const value = credential?.value;
  if (!value || value.type !== 'oauth') return false;
  const methodId = typeof value.methodID === 'string' ? value.methodID.toLowerCase() : '';
  return methodId.includes('antigravity');
};

/**
 * The providers the Antigravity plugin owns, by the credential in use for
 * them. A provider can hold several credentials — the plugin keeps a pool of
 * accounts for one — and the active one is the credential OpenCode serves
 * requests with. Without an active credential the plugin only owns the
 * provider when every credential for it is one of the plugin's.
 */
export const antigravityOwnedProviderIds = (
  credentials: readonly CredentialLike[] | null | undefined,
): Set<string> => {
  const byProvider = new Map<string, CredentialLike[]>();
  for (const credential of Array.isArray(credentials) ? credentials : []) {
    const providerId = credential.integrationID;
    if (!providerId) continue;
    const bucket = byProvider.get(providerId);
    if (bucket) bucket.push(credential);
    else byProvider.set(providerId, [credential]);
  }

  const owned = new Set<string>();
  for (const [providerId, bucket] of byProvider) {
    const active = bucket.find((credential) => credential.active === true);
    if (active) {
      if (isAntigravityCredential(active)) owned.add(providerId);
      continue;
    }
    if (bucket.length > 0 && bucket.every((credential) => isAntigravityCredential(credential))) {
      owned.add(providerId);
    }
  }
  return owned;
};

/**
 * The models that can actually be used.
 *
 * An owned provider keeps the plugin's models, any other provider keeps its
 * own. A provider nobody has a credential for keeps its own models too: the
 * plugin only takes a provider over once it stores a credential for it.
 */
export const usableModels = <T extends { id: string; modelID?: string; providerID: string }>(
  models: readonly T[],
  ownedProviderIds: ReadonlySet<string>,
): T[] => {
  if (ownedProviderIds.size === 0) return [...models];
  return models.filter((model) => {
    const owned = ownedProviderIds.has(model.providerID);
    const antigravity = isAntigravityModelId(model.id) || isAntigravityModelId(model.modelID);
    return owned ? antigravity : !antigravity;
  });
};

/**
 * Whether a model is one the plugin serves. Used for the default model of a
 * directory, which is a reference rather than a catalog entry.
 */
export const isUsableModel = (
  model: { id: string; providerID: string },
  ownedProviderIds: ReadonlySet<string>,
): boolean => {
  if (ownedProviderIds.size === 0) return true;
  const owned = ownedProviderIds.has(model.providerID);
  return owned === isAntigravityModelId(model.id);
};
