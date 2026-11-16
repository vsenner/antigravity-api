import type { AccountRuntime } from "./types.js";

export interface RotationOptions {
  maxConsecutiveErrors?: number;
  cooldownMs?: number;
}

/** Picks the least-used routable account and keeps per-model cooldowns. */
export class RotationEngine {
  private readonly maxConsecutiveErrors: number;
  private readonly cooldownMs: number;

  constructor(options: RotationOptions = {}) {
    this.maxConsecutiveErrors = options.maxConsecutiveErrors ?? 2;
    this.cooldownMs = options.cooldownMs ?? 10 * 60_000;
  }

  routable(account: AccountRuntime, model: string, now = Date.now()): boolean {
    if (!account.enabled || account.banned || account.authFailed) return false;
    if (account.cooldownUntil && account.cooldownUntil > now) return false;
    const until = account.modelCooldowns?.get(model);
    if (until && until > now) return false;
    if (until) {
      account.modelCooldowns?.delete(model);
      account.modelCooldownsByModel?.delete(model);
    }
    return true;
  }

  pick(accounts: AccountRuntime[], model = "unknown", exclude = new Set<string>()): AccountRuntime | undefined {
    const now = Date.now();
    const available = accounts.filter((account) => !exclude.has(account.id) && this.routable(account, model, now));
    // Least-used first keeps spending even per model and overall.
    available.sort((a, b) =>
      (a.modelStats?.[model]?.totalTokens ?? 0) - (b.modelStats?.[model]?.totalTokens ?? 0)
      || a.totalTokens - b.totalTokens
      || (a.lastUsedAt ?? 0) - (b.lastUsedAt ?? 0));
    return available[0];
  }

  /** Earliest moment any of these accounts can serve the model again (for Retry-After). */
  nextAvailableAt(accounts: AccountRuntime[], model: string): number | undefined {
    const times = accounts
      .filter((a) => a.enabled && !a.banned && !a.authFailed)
      .map((a) => Math.max(a.modelCooldowns?.get(model) ?? 0, a.cooldownUntil ?? 0));
    return times.length ? Math.min(...times) : undefined;
  }

  recordFailure(account: AccountRuntime, model: string, message: string, opts: { cooldownMs?: number; authFailed?: boolean } = {}): void {
    account.consecutiveErrors = (account.consecutiveErrors ?? 0) + 1;
    account.lastErrorAt = Date.now();
    account.lastError = message;
    if (opts.authFailed) {
      account.authFailed = true;
      account.healthy = false;
      return;
    }
    if (!opts.cooldownMs && account.consecutiveErrors < this.maxConsecutiveErrors) return;
    const until = Date.now() + (opts.cooldownMs ?? this.cooldownMs);
    account.modelCooldowns ??= new Map();
    account.modelCooldowns.set(model, until);
    account.modelCooldownsByModel ??= new Map();
    account.modelCooldownsByModel.set(model, { until, reason: message });
  }

  recordSuccess(account: AccountRuntime, model: string): void {
    account.consecutiveErrors = 0;
    account.modelCooldowns?.delete(model);
    account.modelCooldownsByModel?.delete(model);
  }
}
