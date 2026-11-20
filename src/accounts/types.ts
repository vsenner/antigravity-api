export interface ModelStats {
  model: string;
  requests: number;
  successes: number;
  errors: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
}

export type Provider = "antigravity";

export interface RawAuthFile {
  email?: string;
  account_email?: string;
  accountEmail?: string;
  id?: string;
  project_id?: string;
  projectId?: string;
  access_token?: string;
  accessToken?: string;
  refresh_token?: string;
  refreshToken?: string;
  disabled?: boolean;
  /** Set when Google answered 403 "disabled … for violation of Terms of Service". */
  banned?: { at: string; message: string };
  /** Set when Google answered 403 "Verify your account to continue". */
  verification_required?: { at: string; message: string };
  expired?: string;
  expires_in?: number;
  [key: string]: unknown;
}

export interface AccountRuntime {
  id: string;
  authFile: string;
  email: string;
  provider: Provider;
  projectId?: string;
  enabled: boolean;
  healthy: boolean;
  authFailed?: boolean;
  /** Google requires account verification (403 "Verify your account to continue"); excluded until re-enabled/verified. */
  verificationRequired?: { at: string; message: string };
  /** Google disabled Antigravity for this account; excluded from routing until re-enabled. */
  banned?: { at: string; message: string };
  /** Upstream models available on this account (from fetchAvailableModels), if known. */
  supportedModels?: Set<string>;
  /** Upstream models explicitly rejected for this account (404/not_found or model-level 403). */
  unsupportedModels?: Set<string>;
  requestCount: number;
  successCount: number;
  errorCount: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  consecutiveErrors?: number;
  lastUsedAt?: number;
  lastSuccessAt?: number;
  lastErrorAt?: number;
  lastError?: string;
  cooldownUntil?: number;
  modelCooldowns?: Map<string, number>;
  modelCooldownsByModel?: Map<string, { until: number; reason: string }>;
  estimatedLimitTokens?: number;
  modelStats: Record<string, ModelStats>;
}

export type PublicAccount = Omit<AccountRuntime, "consecutiveErrors" | "supportedModels" | "unsupportedModels" | "modelCooldowns" | "modelCooldownsByModel"> & {
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  usagePercent: number | null;
  supportedModels?: string[];
  unsupportedModels?: string[];
  modelCooldowns?: Record<string, number>;
  modelCooldownsByModel?: Record<string, { until: number; reason: string }>;
};
