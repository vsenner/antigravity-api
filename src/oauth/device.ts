import crypto from "node:crypto";
import type { AccountStore } from "../accounts/store.js";

const CLIENT_ID = process.env.ANTIGRAVITY_REFRESH_CLIENT_ID || "";
const CLIENT_SECRET = process.env.ANTIGRAVITY_REFRESH_CLIENT_SECRET || "";
const DEVICE_URL = "https://oauth2.googleapis.com/device/code";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "openid email profile https://www.googleapis.com/auth/cloud-platform";

type Flow = { id: string; device_code: string; user_code: string; verification_url: string; verification_url_complete?: string; expiresAt: number; interval: number; status: "pending" | "success" | "error"; message?: string; account?: any; nextPollAt: number };

export class GoogleDeviceOAuthService {
  private flows = new Map<string, Flow>();
  constructor(private readonly store: AccountStore) {}

  async start() {
    const res = await fetch(DEVICE_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE }) });
    const json: any = await res.json();
    if (!res.ok) throw new Error(json.error_description || json.error || "device code failed");
    const id = crypto.randomBytes(16).toString("base64url");
    const flow: Flow = { id, device_code: json.device_code, user_code: json.user_code, verification_url: json.verification_url || json.verification_uri, verification_url_complete: json.verification_url_complete || json.verification_uri_complete, expiresAt: Date.now() + Number(json.expires_in || 900) * 1000, interval: Number(json.interval || 5), status: "pending", nextPollAt: 0 };
    this.flows.set(id, flow);
    return this.public(flow);
  }

  async status(id: string) {
    const flow = this.flows.get(id);
    if (!flow) throw new Error("flow not found");
    if (flow.status === "pending" && Date.now() > flow.expiresAt) { flow.status = "error"; flow.message = "Device code expired"; }
    if (flow.status === "pending" && Date.now() >= flow.nextPollAt) await this.poll(flow);
    return this.public(flow);
  }

  private async poll(flow: Flow) {
    flow.nextPollAt = Date.now() + flow.interval * 1000;
    const params: Record<string, string> = { client_id: CLIENT_ID, client_secret: CLIENT_SECRET, device_code: flow.device_code, grant_type: "urn:ietf:params:oauth:grant-type:device_code" };
    const res = await fetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
    const json: any = await res.json();
    if (!res.ok) {
      if (json.error === "authorization_pending") return;
      if (json.error === "slow_down") { flow.interval += 5; return; }
      flow.status = "error"; flow.message = json.error_description || json.error || "token error"; return;
    }
    if (!json.refresh_token) { flow.status = "error"; flow.message = "Google did not return refresh_token"; return; }
    const email = await userEmail(json.access_token, json.id_token);
    const project: { project_id?: string; tier?: string; error?: string } = await loadProject(json.access_token).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
    const auth: any = { email, provider: "antigravity", type: "antigravity", refresh_token: json.refresh_token, access_token: json.access_token, expires_in: json.expires_in, expired: new Date(Date.now() + Number(json.expires_in || 3600) * 1000).toISOString(), disabled: false };
    
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
    flow.status = "success"; flow.account = { id: account.id, email: account.email, projectId: auth.project_id, projectError: auth.project_error };
  }

  private public(flow: Flow) { return { id: flow.id, user_code: flow.user_code, verification_url: flow.verification_url, verification_url_complete: flow.verification_url_complete, expiresAt: flow.expiresAt, interval: flow.interval, status: flow.status, message: flow.message, account: flow.account }; }
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
