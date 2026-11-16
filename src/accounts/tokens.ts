import { OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, TOKEN_URL } from "../config.js";
import type { AccountStore } from "./store.js";
import type { RawAuthFile } from "./types.js";

export const getAccessToken = (auth: RawAuthFile) => String(auth.access_token || auth.accessToken || auth.api_key || auth.apiKey || "");
export const getRefreshToken = (auth: RawAuthFile) => String(auth.refresh_token || auth.refreshToken || "");
export const getProjectId = (auth: RawAuthFile) => String(auth.project_id || auth.projectId || auth.quota_project_id || "");

export interface RefreshResult { access_token?: string; expires_in?: number; error?: string; error_description?: string }

export async function refreshAccessToken(refreshToken: string): Promise<RefreshResult> {
  if (!refreshToken) return { error: "no refresh_token" };
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: OAUTH_CLIENT_ID, client_secret: OAUTH_CLIENT_SECRET, refresh_token: refreshToken, grant_type: "refresh_token" }),
      signal: AbortSignal.timeout(15_000),
    });
    return await res.json() as RefreshResult;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Expiry with a two-minute margin, read from whichever field the auth file carries. */
function expiresSoon(auth: RawAuthFile): boolean {
  const raw = auth.expired ?? (auth as any).expires_at ?? (auth as any).expiresAt;
  const at = Date.parse(String(raw ?? ""));
  return !Number.isFinite(at) || at <= Date.now() + 120_000;
}

/**
 * Hands out a valid access token per account, refreshing (once at a time per
 * account) when it is missing or about to expire, and writes it back to disk.
 */
export class TokenManager {
  private inflight = new Map<string, Promise<string>>();

  constructor(private readonly store: AccountStore) {}

  async get(accountId: string, opts: { force?: boolean } = {}): Promise<string> {
    const raw = await this.store.getRawAuth(accountId);
    if (!raw) throw new Error(`unknown account ${accountId}`);
    const current = getAccessToken(raw);
    if (current && !opts.force && !expiresSoon(raw)) return current;
    if (!getRefreshToken(raw)) return current;
    const pending = this.inflight.get(accountId);
    if (pending) return pending;
    const job = this.refresh(accountId, raw).finally(() => this.inflight.delete(accountId));
    this.inflight.set(accountId, job);
    return job;
  }

  private async refresh(accountId: string, raw: RawAuthFile): Promise<string> {
    const result = await refreshAccessToken(getRefreshToken(raw));
    if (!result.access_token) throw new Error(`token refresh failed: ${result.error_description || result.error || "no access_token"}`);
    const expiresIn = Number(result.expires_in || 3600);
    await this.store.saveRawAuth(accountId, {
      ...raw,
      access_token: result.access_token,
      expires_in: expiresIn,
      expired: new Date(Date.now() + expiresIn * 1000).toISOString(),
    });
    return result.access_token;
  }
}
