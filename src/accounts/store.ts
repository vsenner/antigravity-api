import { readdir, readFile, writeFile, mkdir, unlink, rename } from "node:fs/promises";
import { basename, join } from "node:path";
import type { AccountRuntime, ModelStats, PublicAccount, RawAuthFile } from "./types.js";

export interface AccountStoreOptions {
  authDir: string;
  estimatedLimitTokens?: number;
}

export type Usage = { promptTokens?: number; completionTokens?: number; totalTokens?: number };

/**
 * Auth files on disk are the source of truth for credentials and the ban flag;
 * counters, health and cooldowns live in memory and survive file reloads.
 */
export class AccountStore {
  private readonly runtime = new Map<string, AccountRuntime>();
  private readonly raw = new Map<string, RawAuthFile>();

  constructor(private readonly options: AccountStoreOptions) {}

  get authDir() { return this.options.authDir; }

  async listPublicAccounts(): Promise<PublicAccount[]> {
    await this.refresh();
    return [...this.runtime.values()].map((account) => {
      const raw = this.raw.get(account.id) ?? {};
      const { consecutiveErrors: _hidden, ...rest } = account;
      const limit = account.estimatedLimitTokens;
      return {
        ...rest,
        hasAccessToken: Boolean(raw.access_token || raw.accessToken),
        hasRefreshToken: Boolean(raw.refresh_token || raw.refreshToken),
        usagePercent: limit && limit > 0 ? Math.min(100, (account.totalTokens / limit) * 100) : null,
        supportedModels: account.supportedModels ? [...account.supportedModels] : undefined,
        unsupportedModels: account.unsupportedModels ? [...account.unsupportedModels] : undefined,
        modelCooldowns: account.modelCooldowns ? Object.fromEntries(account.modelCooldowns) : undefined,
        modelCooldownsByModel: account.modelCooldownsByModel ? Object.fromEntries(account.modelCooldownsByModel) : undefined,
      };
    });
  }

  async listRuntimeAccounts(): Promise<AccountRuntime[]> {
    await this.refresh();
    return [...this.runtime.values()];
  }

  async getRawAuth(accountId: string): Promise<RawAuthFile | undefined> {
    await this.refresh();
    return this.raw.get(accountId);
  }

  /** Persist changed credentials (refreshed token, resolved project) for one account. */
  async saveRawAuth(accountId: string, raw: RawAuthFile): Promise<void> {
    const account = this.runtime.get(accountId);
    const file = join(this.options.authDir, account?.authFile ?? `${accountId}.json`);
    const tmp = `${file}.tmp-${process.pid}`;
    await writeFile(tmp, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    await rename(tmp, file);
    this.raw.set(accountId, raw);
  }

  async setEnabled(accountId: string, enabled: boolean): Promise<AccountRuntime | undefined> {
    await this.refresh();
    const account = this.runtime.get(accountId);
    const raw = this.raw.get(accountId);
    if (!account || !raw) return undefined;
    account.enabled = enabled;
    if (enabled) {
      // Re-enabling is also how an operator clears a ban or verification flag after resolving it.
      account.healthy = true;
      account.authFailed = false;
      account.banned = undefined;
      account.verificationRequired = undefined;
      account.cooldownUntil = undefined;
      account.consecutiveErrors = 0;
      account.modelCooldowns?.clear();
      account.modelCooldownsByModel?.clear();
      account.unsupportedModels?.clear();
    }
    const { banned: _banned, verification_required: _ver, ...rest } = raw;
    await this.saveRawAuth(accountId, { ...(enabled ? rest : raw), disabled: !enabled });
    return account;
  }

  async markBanned(account: AccountRuntime, message: string): Promise<void> {
    const banned = { at: new Date().toISOString(), message };
    account.banned = banned;
    account.healthy = false;
    const raw = this.raw.get(account.id);
    if (raw && !raw.banned) await this.saveRawAuth(account.id, { ...raw, banned });
  }

  async markVerificationRequired(account: AccountRuntime, message: string): Promise<void> {
    const verificationRequired = { at: new Date().toISOString(), message };
    account.verificationRequired = verificationRequired;
    account.healthy = false;
    const raw = this.raw.get(account.id);
    if (raw && !raw.verification_required) await this.saveRawAuth(account.id, { ...raw, verification_required: verificationRequired });
  }

  async clearVerificationRequired(accountId: string): Promise<void> {
    const account = this.runtime.get(accountId);
    if (account) {
      account.verificationRequired = undefined;
      account.healthy = !account.banned && !account.authFailed;
    }
    const raw = this.raw.get(accountId);
    if (raw?.verification_required) {
      const { verification_required: _ver, ...rest } = raw;
      await this.saveRawAuth(accountId, rest);
    }
  }

  setSupportedModels(accountId: string, models: Iterable<string>): void {
    const account = this.runtime.get(accountId);
    if (!account) return;
    account.supportedModels = new Set(models);
  }

  markModelUnsupported(account: AccountRuntime, model: string): void {
    account.unsupportedModels ??= new Set();
    account.unsupportedModels.add(model);
  }

  recordSuccess(account: AccountRuntime, model: string, usage: Usage): void {
    account.successCount += 1;
    account.consecutiveErrors = 0;
    account.healthy = true;
    account.lastSuccessAt = Date.now();
    const promptTokens = usage.promptTokens ?? 0;
    const completionTokens = usage.completionTokens ?? 0;
    const totalTokens = usage.totalTokens || promptTokens + completionTokens;
    account.promptTokens += promptTokens;
    account.completionTokens += completionTokens;
    account.totalTokens += totalTokens;
    const stats = this.modelStats(account, model);
    stats.successes += 1;
    stats.promptTokens += promptTokens;
    stats.completionTokens += completionTokens;
    stats.totalTokens += totalTokens;
  }

  recordFailure(account: AccountRuntime, model: string, message: string): void {
    account.errorCount += 1;
    account.lastErrorAt = Date.now();
    account.lastError = message;
    this.modelStats(account, model).errors += 1;
  }

  recordRequest(account: AccountRuntime, model: string): void {
    account.requestCount += 1;
    account.lastUsedAt = Date.now();
    this.modelStats(account, model).requests += 1;
  }

  async createOrUpdateAuthFile(fileName: string, content: RawAuthFile): Promise<AccountRuntime> {
    await mkdir(this.options.authDir, { recursive: true });
    const safeName = basename(fileName).endsWith(".json") ? basename(fileName) : `${basename(fileName)}.json`;
    await writeFile(join(this.options.authDir, safeName), `${JSON.stringify(content, null, 2)}\n`, "utf8");
    await this.refresh();
    const id = safeName.replace(/\.json$/i, "");
    const account = this.runtime.get(id);
    if (!account) throw new Error(`Failed to load written account ${id}`);
    return account;
  }

  async deleteAuthFile(accountId: string): Promise<boolean> {
    await this.refresh();
    const account = this.runtime.get(accountId);
    if (!account) return false;
    await unlink(join(this.options.authDir, account.authFile));
    this.runtime.delete(accountId);
    this.raw.delete(accountId);
    return true;
  }

  private modelStats(account: AccountRuntime, model: string): ModelStats {
    const key = model || "unknown";
    account.modelStats[key] ??= { model: key, requests: 0, successes: 0, errors: 0, totalTokens: 0, promptTokens: 0, completionTokens: 0 };
    return account.modelStats[key];
  }

  private async refresh(): Promise<void> {
    await mkdir(this.options.authDir, { recursive: true });
    const entries = await readdir(this.options.authDir, { withFileTypes: true });
    const seen = new Set<string>();

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const authFile = entry.name;
      const id = authFile.replace(/\.json$/i, "");
      let raw: RawAuthFile;
      try { raw = JSON.parse(await readFile(join(this.options.authDir, authFile), "utf8")) as RawAuthFile; } catch { continue; }
      seen.add(id);
      this.raw.set(id, raw);
      const previous = this.runtime.get(id);
      if (previous) {
        previous.email = String(raw.email || raw.account_email || raw.accountEmail || id);
        previous.projectId = String(raw.project_id || raw.projectId || "") || undefined;
        previous.banned = raw.banned; // the file decides: a fresh sign-in writes a file without the flag
        previous.verificationRequired = raw.verification_required;
        previous.healthy = !raw.banned && !raw.verification_required && !previous.authFailed;
        continue;
      }
      this.runtime.set(id, {
        id,
        authFile,
        email: String(raw.email || raw.account_email || raw.accountEmail || id),
        provider: "antigravity",
        projectId: String(raw.project_id || raw.projectId || "") || undefined,
        enabled: raw.disabled !== true,
        healthy: !raw.banned && !raw.verification_required,
        banned: raw.banned,
        verificationRequired: raw.verification_required,
        requestCount: 0,
        successCount: 0,
        errorCount: 0,
        totalTokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        consecutiveErrors: 0,
        estimatedLimitTokens: this.options.estimatedLimitTokens,
        modelStats: {},
      });
    }

    for (const id of [...this.runtime.keys()]) {
      if (!seen.has(id)) {
        this.runtime.delete(id);
        this.raw.delete(id);
      }
    }
  }
}
