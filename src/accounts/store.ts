import { readdir, readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import type { AccountRuntime, ModelStats, PublicAccount, RawAuthFile } from "./types.js";

export interface AccountStoreOptions {
  authDir: string;
  estimatedLimitTokens?: number;
}

export class AccountStore {
  private readonly authDir: string;
  private readonly estimatedLimitTokens?: number;
  private readonly runtime = new Map<string, AccountRuntime>();
  private readonly raw = new Map<string, RawAuthFile>();

  constructor(options: AccountStoreOptions) {
    this.authDir = options.authDir;
    this.estimatedLimitTokens = options.estimatedLimitTokens;
  }

  async listPublicAccounts(): Promise<PublicAccount[]> {
    await this.refresh();
    return [...this.runtime.values()].map((account) => {
      const raw = this.raw.get(account.id) ?? {};
      const estimatedLimit = account.estimatedLimitTokens;
      return {
        ...account,
        hasAccessToken: Boolean(raw.access_token || raw.accessToken),
        hasRefreshToken: Boolean(raw.refresh_token || raw.refreshToken),
        usagePercent: estimatedLimit && estimatedLimit > 0 ? Math.min(100, (account.totalTokens / estimatedLimit) * 100) : null,
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

  async setEnabled(accountId: string, enabled: boolean): Promise<AccountRuntime | undefined> {
    await this.refresh();
    const account = this.runtime.get(accountId);
    if (!account) return undefined;
    account.enabled = enabled;
    if (enabled) {
      account.healthy = true;
      account.cooldownUntil = undefined;
      account.consecutiveErrors = 0;
    }
    return account;
  }

  recordSuccess(account: AccountRuntime, model: string, usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number }): void {
    account.successCount += 1;
    account.consecutiveErrors = 0;
    account.healthy = true;
    account.lastSuccessAt = Date.now();
    this.applyUsage(account, model, usage, true);
  }

  recordFailure(account: AccountRuntime, model: string, error: unknown): void {
    account.errorCount += 1;
    account.lastErrorAt = Date.now();
    account.lastError = error instanceof Error ? error.message : String(error);
    const stats = this.modelStats(account, model);
    stats.requests += 0;
    stats.errors += 1;
  }

  recordRequest(account: AccountRuntime, model: string): void {
    account.requestCount += 1;
    account.lastUsedAt = Date.now();
    this.modelStats(account, model).requests += 1;
  }

  async createOrUpdateAuthFile(fileName: string, content: RawAuthFile): Promise<AccountRuntime> {
    await mkdir(this.authDir, { recursive: true });
    const safeName = basename(fileName).endsWith(".json") ? basename(fileName) : `${basename(fileName)}.json`;
    await writeFile(join(this.authDir, safeName), `${JSON.stringify(content, null, 2)}\n`, "utf8");
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
    await unlink(join(this.authDir, account.authFile));
    this.runtime.delete(accountId);
    this.raw.delete(accountId);
    await this.refresh();
    return true;
  }

  private applyUsage(account: AccountRuntime, model: string, usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number }, success: boolean): void {
    const promptTokens = usage.promptTokens ?? 0;
    const completionTokens = usage.completionTokens ?? 0;
    const totalTokens = usage.totalTokens ?? promptTokens + completionTokens;
    account.promptTokens += promptTokens;
    account.completionTokens += completionTokens;
    account.totalTokens += totalTokens;
    const stats = this.modelStats(account, model);
    if (success) stats.successes += 1;
    stats.promptTokens += promptTokens;
    stats.completionTokens += completionTokens;
    stats.totalTokens += totalTokens;
  }

  private modelStats(account: AccountRuntime, model: string): ModelStats {
    const key = model || "unknown";
    account.modelStats[key] ??= { model: key, requests: 0, successes: 0, errors: 0, totalTokens: 0, promptTokens: 0, completionTokens: 0 };
    return account.modelStats[key];
  }

  private async refresh(): Promise<void> {
    await mkdir(this.authDir, { recursive: true });
    const entries = await readdir(this.authDir, { withFileTypes: true });
    const seen = new Set<string>();

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const authFile = entry.name;
      const id = authFile.replace(/\.json$/i, "");
      seen.add(id);
      const raw = JSON.parse(await readFile(join(this.authDir, authFile), "utf8")) as RawAuthFile;
      this.raw.set(id, raw);
      const previous = this.runtime.get(id);
      this.runtime.set(id, {
        id,
        authFile,
        email: String(raw.email || raw.account_email || raw.accountEmail || id),
        provider: "antigravity",
        projectId: String(raw.project_id || raw.projectId || "") || undefined,
        enabled: previous?.enabled ?? raw.disabled !== true,
        healthy: previous?.healthy ?? true,
        requestCount: previous?.requestCount ?? 0,
        successCount: previous?.successCount ?? 0,
        errorCount: previous?.errorCount ?? 0,
        totalTokens: previous?.totalTokens ?? 0,
        promptTokens: previous?.promptTokens ?? 0,
        completionTokens: previous?.completionTokens ?? 0,
        consecutiveErrors: previous?.consecutiveErrors ?? 0,
        lastUsedAt: previous?.lastUsedAt,
        lastSuccessAt: previous?.lastSuccessAt,
        lastErrorAt: previous?.lastErrorAt,
        lastError: previous?.lastError,
        cooldownUntil: previous?.cooldownUntil,
        estimatedLimitTokens: this.estimatedLimitTokens,
        modelStats: previous?.modelStats ?? {},
      });
    }

    for (const id of this.runtime.keys()) {
      if (!seen.has(id)) {
        this.runtime.delete(id);
        this.raw.delete(id);
      }
    }
  }
}
