import { AccountStore } from "../accounts/store.js";
import { RotationEngine } from "../accounts/rotation.js";
import { TokenManager, getProjectId } from "../accounts/tokens.js";
import { ModelCatalog } from "../proxy/catalog.js";
import { AntigravityClient, type Credentials } from "../proxy/client.js";
import { loadCodeAssist } from "../proxy/code-assist.js";
import { AntigravityQuotaClient } from "../proxy/quota-client.js";

export interface ServiceOptions { authDir: string; estimatedLimitTokens?: number }

/** One instance of each collaborator, shared by the routes. */
export class Services {
  readonly store: AccountStore;
  readonly rotation = new RotationEngine();
  readonly tokens: TokenManager;
  readonly client = new AntigravityClient();
  readonly catalog = new ModelCatalog();
  readonly quota = new AntigravityQuotaClient();

  constructor(options: ServiceOptions) {
    this.store = new AccountStore(options);
    this.tokens = new TokenManager(this.store);
  }

  /** Token plus Cloud Code project; a missing project is looked up once and saved. */
  async credentials(accountId: string, opts: { force?: boolean } = {}): Promise<Credentials> {
    const token = await this.tokens.get(accountId, opts);
    if (!token) throw new Error("account has no access token or refresh token");
    const raw = await this.store.getRawAuth(accountId);
    let projectId = raw ? getProjectId(raw) : "";
    if (!projectId && raw) {
      const info = await loadCodeAssist(token);
      if (!info.projectId) throw new Error(`account has no Cloud Code project (${info.error ?? "loadCodeAssist returned none"}); sign in again`);
      projectId = info.projectId;
      await this.store.saveRawAuth(accountId, { ...raw, project_id: projectId, ...(info.tier ? { tier: info.tier } : {}) });
    }
    return { token, projectId };
  }

  /** Credentials of any account that can still serve requests (for catalogue calls). */
  async anyCredentials(): Promise<Credentials | undefined> {
    const accounts = (await this.store.listRuntimeAccounts()).filter((a) => a.enabled && !a.banned && !a.authFailed);
    for (const account of accounts) {
      try { return await this.credentials(account.id); } catch { /* next */ }
    }
    return undefined;
  }
}
