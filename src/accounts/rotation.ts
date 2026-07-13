import type { AccountRuntime } from "./types.js";

export interface RotationOptions {
  maxConsecutiveErrors?: number;
  cooldownMs?: number;
}

export class RotationEngine {
  private readonly maxConsecutiveErrors: number;
  private readonly cooldownMs: number;

  constructor(options: RotationOptions = {}) {
    this.maxConsecutiveErrors = options.maxConsecutiveErrors ?? 2;
    this.cooldownMs = options.cooldownMs ?? 10 * 60_000;
  }

  pick(accounts: AccountRuntime[], model = "unknown", exclude = new Set<string>()): AccountRuntime | undefined {
    const now = Date.now();
    const available = accounts.filter((account) => {
      if (exclude.has(account.id)) return false;
      if (!account.enabled) return false;
      if (account.authFailed) return false;
      const modelKey = this.cooldownKey(account.id, model);
      const until = account.modelCooldowns?.get(modelKey);
      if (until && until <= now) {
        account.modelCooldowns?.delete(modelKey);
      } else if (until && until > now) {
        return false;
      }
      return account.healthy;
    });
    if (available.length === 0) return undefined;

    // Least-used selection keeps spending even globally and per model.
    available.sort((a, b) => {
      const aModel = a.modelStats?.[model]?.totalTokens ?? 0;
      const bModel = b.modelStats?.[model]?.totalTokens ?? 0;
      if (aModel !== bModel) return aModel - bModel;
      if (a.totalTokens !== b.totalTokens) return a.totalTokens - b.totalTokens;
      return (a.lastUsedAt ?? 0) - (b.lastUsedAt ?? 0);
    });
    return available[0];
  }

  recordFailure(account: AccountRuntime, model: string, error: unknown, opts: { cooldownOverrideMs?: number; authFailed?: boolean } = {}): void {
    const key = this.cooldownKey(account.id, model);
    account.consecutiveErrors = (account.consecutiveErrors ?? 0) + 1;
    account.lastErrorAt = Date.now();
    account.lastError = error instanceof Error ? error.message : String(error);
    if (opts.authFailed) {
      account.authFailed = true;
      account.healthy = false;
      return;
    }
    if (account.consecutiveErrors >= this.maxConsecutiveErrors || opts.cooldownOverrideMs) {
      account.modelCooldowns ??= new Map<string, number>();
      account.modelCooldowns.set(key, Date.now() + (opts.cooldownOverrideMs ?? this.cooldownMs));
      account.modelCooldownsByModel ??= new Map<string, { until: number; reason: string }>();
      account.modelCooldownsByModel.set(model, { until: Date.now() + (opts.cooldownOverrideMs ?? this.cooldownMs), reason: account.lastError });
      if (opts.cooldownOverrideMs && opts.cooldownOverrideMs > this.cooldownMs) {
        account.healthy = false;
        account.cooldownUntil = Date.now() + opts.cooldownOverrideMs;
      }
    }
  }

  private cooldownKey(accountId: string, model: string): string { return `${accountId}|${model}`; }
}
