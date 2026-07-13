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

export type PublicAccount = Omit<AccountRuntime, "consecutiveErrors"> & {
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  usagePercent: number | null;
};
