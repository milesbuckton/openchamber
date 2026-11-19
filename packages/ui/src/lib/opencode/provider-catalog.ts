import { compact, type Model, type ModelRef, type Provider } from "./model"
import { withZenName } from "./providerDisplayName"

export type ProviderCatalog = {
  providers: Provider[]
  models: Model[]
  default?: ModelRef
  /**
   * The providers the Antigravity plugin holds the credential for. It serves
   * only the models it registered for them, so the other models of those
   * providers are left out of `models`.
   */
  antigravityProviderIds: string[]
}

export const projectProviderCatalog = (
  models: readonly Model[],
  fallback: { modelID: string; providerID: string } | null | undefined,
  providers: readonly Provider[],
): ProviderCatalog => compact({
  providers: providers.map(withZenName),
  models: models.map((model) => (Array.isArray(model.variants) ? model : { ...model, variants: [] })),
  default: fallback ? { id: fallback.modelID, providerID: fallback.providerID } : undefined,
  antigravityProviderIds: [],
})
