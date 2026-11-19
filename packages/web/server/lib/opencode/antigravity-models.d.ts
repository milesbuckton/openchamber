import type { ModelInfo } from '@opencode/client';

export declare const ANTIGRAVITY_PREFIX: string;
export declare const isAntigravityModelId: (id: unknown) => boolean;
export declare const isAntigravityAuthMethod: (methodId: unknown) => boolean;
export declare const antigravityOwnedProviderIds: (credentials: unknown) => Set<string>;
export declare const usableModels: <T extends { id: string; providerID: string }>(
  models: T[],
  ownedProviderIds: Set<string>
) => T[];
