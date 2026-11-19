/**
 * The models that can actually be used, for the Antigravity auth plugin
 * (`@cortexkit/opencode-antigravity-auth`).
 *
 * The plugin takes a provider over when it is the credential behind that
 * provider: it registers its own models next to the provider's own and answers
 * every other model id with "This request cannot use Antigravity. Choose a
 * supported Antigravity model."
 *
 * So for one provider only one of the two sets works, and the credential
 * decides which one: the plugin's own OAuth credential means the plugin owns
 * the requests and only the models it registered work; a real API key leaves
 * the provider to OpenCode, and the plugin's model ids are the ones that fail.
 *
 * The model picker offers the set that works, never both. This is the server
 * copy of the rules the UI keeps in
 * packages/ui/src/lib/opencode/antigravity.ts; the two must agree.
 */

/** Every model the plugin registers carries this prefix. */
const ANTIGRAVITY_MODEL_PREFIX = 'antigravity-';

/** Whether a model id is one the Antigravity plugin registered. */
export const isAntigravityModelId = (modelId) =>
  typeof modelId === 'string' && modelId.startsWith(ANTIGRAVITY_MODEL_PREFIX);

/**
 * The OAuth credential the Antigravity plugin stores for a provider. Its
 * method id names the plugin's own browser login, which no other integration
 * uses.
 */
export const isAntigravityCredential = (credential) => {
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
export const antigravityOwnedProviderIds = (credentials) => {
  const byProvider = new Map();
  for (const credential of Array.isArray(credentials) ? credentials : []) {
    const providerId = credential?.integrationID;
    if (!providerId) continue;
    const bucket = byProvider.get(providerId);
    if (bucket) bucket.push(credential);
    else byProvider.set(providerId, [credential]);
  }

  const owned = new Set();
  for (const [providerId, bucket] of byProvider) {
    const active = bucket.find((credential) => credential?.active === true);
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
 * Whether a model is one the plugin serves. A provider nobody has a
 * credential for keeps its own models: the plugin only takes a provider over
 * once it stores a credential for it.
 */
export const isUsableModel = (model, ownedProviderIds) => {
  if (!ownedProviderIds || ownedProviderIds.size === 0) return true;
  const owned = ownedProviderIds.has(model?.providerID);
  return owned === isAntigravityModelId(model?.id ?? model?.modelID);
};

/**
 * The models that can actually be used.
 *
 * An owned provider keeps the plugin's models, any other provider keeps its
 * own.
 */
export const usableModels = (models, ownedProviderIds) => {
  if (!ownedProviderIds || ownedProviderIds.size === 0) return Array.isArray(models) ? models : [];
  return (Array.isArray(models) ? models : []).filter((model) => isUsableModel(model, ownedProviderIds));
};
