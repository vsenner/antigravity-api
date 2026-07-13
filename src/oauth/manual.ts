import crypto from "node:crypto";
import type { AccountStore } from "../accounts/store.js";

const CLIENT_ID = process.env.ANTIGRAVITY_REFRESH_CLIENT_ID || "";
const CLIENT_SECRET = process.env.ANTIGRAVITY_REFRESH_CLIENT_SECRET || "";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REDIRECT_URI = process.env.ANTIGRAVITY_MANUAL_REDIRECT_URI || "http://localhost:61135/oauth-callback";
const SCOPE = "openid https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/cclog https://www.googleapis.com/auth/experimentsandconfigs";

type ManualFlow = { state: string; createdAt: number; redirectUri: string };

export class GoogleManualOAuthService {
  private flows = new Map<string, ManualFlow>();
  constructor(private readonly store: AccountStore) {}

  start() {
    const state = crypto.randomUUID();
    this.flows.set(state, { state, createdAt: Date.now(), redirectUri: REDIRECT_URI });
    const params = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: "code", scope: SCOPE, access_type: "offline", prompt: "consent", state });
    return { state, redirectUri: REDIRECT_URI, url: `${AUTH_URL}?${params.toString()}` };
  }

  async complete(input: { callbackUrl?: string; code?: string; state?: string }) {
    const parsed = parseCallback(input);
    const flow = this.flows.get(parsed.state);
    if (!flow || Date.now() - flow.createdAt > 15 * 60_000) throw new Error("Invalid or expired OAuth state");
    this.flows.delete(parsed.state);
    const token = await postForm(TOKEN_URL, { code: parsed.code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: flow.redirectUri, grant_type: "authorization_code" });
    if (!token.refresh_token) throw new Error("Google did not return refresh_token; retry with prompt=consent or revoke previous consent");
    const email = await userEmail(token.access_token, token.id_token);
    const project: { project_id?: string; tier?: string; error?: string } = await loadProject(token.access_token).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
    const auth: any = { email, provider: "antigravity", type: "antigravity", refresh_token: token.refresh_token, access_token: token.access_token, expires_in: token.expires_in, expired: new Date(Date.now() + Number(token.expires_in || 3600) * 1000).toISOString(), disabled: false };
    
    // Fallback project ID if none returned by Google
    let projectId = project.project_id;
    if (!projectId) {
      // default fallback
      projectId = "total-particle-kcz5z";
      auth.project_fallback = true;
    }
    auth.project_id = projectId;

    if (project.tier) auth.tier = project.tier;
    if (project.error && !project.error.includes("Verify your account")) {
      auth.project_error = project.error;
    }
    const safe = email.toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/-+/g, "-");
    const account = await this.store.createOrUpdateAuthFile(`${safe}.json`, auth);
    return { account: { id: account.id, email: account.email, projectId: auth.project_id, projectError: auth.project_error } };
  }
}

function parseCallback(input: { callbackUrl?: string; code?: string; state?: string }) {
  if (input.callbackUrl) {
    const url = new URL(input.callbackUrl);
    const code = url.searchParams.get("code") || "";
    const state = url.searchParams.get("state") || "";
    if (!code || !state) throw new Error("callback URL must contain code and state");
    return { code, state };
  }
  if (!input.code || !input.state) throw new Error("code and state are required");
  return { code: input.code, state: input.state };
}
async function postForm(url: string, params: Record<string, string>) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(json.error_description || json.error || text);
  return json;
}
async function userEmail(accessToken: string, idToken?: string) {
  if (idToken) { try { const payload = JSON.parse(Buffer.from(idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")); if (payload.email) return String(payload.email); } catch {} }
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
  return { project_id: typeof p === "string" ? p : p?.id || p?.projectId, tier: json.paidTier?.id || json.currentTier?.id };
}
