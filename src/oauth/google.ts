import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { URLSearchParams } from "node:url";
import type { AccountStore } from "../accounts/store.js";
import { refreshAntigravityToken } from "../proxy/token-refresh.js";

export interface OAuthState { createdAt: number; nonce: string }

export class GoogleOAuthService {
  private states = new Map<string, OAuthState>();
  private client: any | null = null;
  constructor(private readonly store: AccountStore, private readonly options: { clientFile?: string; redirectUri: string }) {}

  async startUrl(): Promise<string> {
    const cfg = await this.config();
    const state = crypto.randomBytes(24).toString("base64url");
    this.states.set(state, { createdAt: Date.now(), nonce: crypto.randomBytes(8).toString("hex") });
    const params = new URLSearchParams({
      client_id: cfg.client_id,
      redirect_uri: this.options.redirectUri,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      scope: "openid email profile https://www.googleapis.com/auth/cloud-platform",
      state,
    });
    return `${cfg.auth_uri || "https://accounts.google.com/o/oauth2/v2/auth"}?${params.toString()}`;
  }

  async callback(code: string, state: string) {
    const known = this.states.get(state);
    this.states.delete(state);
    if (!known || Date.now() - known.createdAt > 15 * 60_000) throw new Error("Invalid or expired OAuth state");
    const cfg = await this.config();
    const token = await postForm(cfg.token_uri || "https://oauth2.googleapis.com/token", {
      code,
      client_id: cfg.client_id,
      client_secret: cfg.client_secret,
      redirect_uri: this.options.redirectUri,
      grant_type: "authorization_code",
    });
    if (!token.refresh_token) throw new Error("Google did not return refresh_token; remove prior consent or use prompt=consent again");
    const email = await userEmail(token.access_token, token.id_token);
    const auth: any = { email, provider: "antigravity", type: "antigravity", refresh_token: token.refresh_token, access_token: token.access_token, expires_in: token.expires_in, expired: new Date(Date.now() + Number(token.expires_in || 3600) * 1000).toISOString(), disabled: false };
    const project: { project_id?: string; tier?: string; error?: string } = await loadProject(token.access_token).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
    if (project.project_id) auth.project_id = project.project_id;
    if (project.tier) auth.tier = project.tier;
    if (project.error) auth.project_error = project.error;
    const safe = email.toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/-+/g, "-");
    const account = await this.store.createOrUpdateAuthFile(`${safe}.json`, auth);
    return { account, project };
  }

  private async config() {
    if (this.client) return this.client;
    const file = this.options.clientFile || process.env.GOOGLE_OAUTH_CLIENT_FILE || "data/oauth/google-client-secret.json";
    const data = JSON.parse(await readFile(file, "utf8"));
    this.client = data.web || data.installed;
    if (!this.client?.client_id || !this.client?.client_secret) throw new Error("Invalid Google OAuth client file");
    return this.client;
  }
}

async function postForm(url: string, params: Record<string, string>) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(json.error_description || json.error || text);
  return json;
}
async function userEmail(accessToken: string, idToken?: string) {
  if (idToken) {
    try { const payload = JSON.parse(Buffer.from(idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")); if (payload.email) return String(payload.email); } catch {}
  }
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { authorization: `Bearer ${accessToken}` } });
  const json: any = await res.json();
  if (!res.ok || !json.email) throw new Error("Unable to resolve Google email");
  return String(json.email);
}
async function loadProject(accessToken: string): Promise<{ project_id?: string; tier?: string; error?: string }> {
  const res = await fetch("https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist", { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", "user-agent": "antigravity/1.20.5 linux/amd64 google-api-nodejs-client/10.3.0" }, body: JSON.stringify({ metadata: { ideName: "antigravity", ideType: "ANTIGRAVITY", ideVersion: "1.20.5", platform: "LINUX_AMD64", pluginType: "GEMINI" }, mode: "FULL_ELIGIBILITY_CHECK" }) });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) return { error: json?.error?.message || `loadCodeAssist ${res.status}` };
  const p = json.cloudaicompanionProject;
  const project_id = typeof p === "string" ? p : p?.id || p?.projectId;
  const tier = json.paidTier?.id || json.currentTier?.id;
  return { project_id, tier };
}
