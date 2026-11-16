import crypto from "node:crypto";
import type { AccountStore } from "../accounts/store.js";
import { OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, TOKEN_URL } from "../config.js";
import { saveOAuthAccount } from "./common.js";

const DEVICE_URL = "https://oauth2.googleapis.com/device/code";
const SCOPE = "openid email profile https://www.googleapis.com/auth/cloud-platform";

type Flow = { id: string; device_code: string; user_code: string; verification_url: string; verification_url_complete?: string; expiresAt: number; interval: number; status: "pending" | "success" | "error"; message?: string; account?: any; nextPollAt: number };

/** Device-code sign-in: the operator enters a code on google.com/device. */
export class GoogleDeviceOAuthService {
  private flows = new Map<string, Flow>();
  constructor(private readonly store: AccountStore) {}

  async start() {
    const res = await fetch(DEVICE_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: OAUTH_CLIENT_ID, scope: SCOPE }) });
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
    const res = await fetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: OAUTH_CLIENT_ID, client_secret: OAUTH_CLIENT_SECRET, device_code: flow.device_code, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }) });
    const json: any = await res.json();
    if (!res.ok) {
      if (json.error === "authorization_pending") return;
      if (json.error === "slow_down") { flow.interval += 5; return; }
      flow.status = "error"; flow.message = json.error_description || json.error || "token error"; return;
    }
    try {
      const { account, project } = await saveOAuthAccount(this.store, json);
      flow.status = "success";
      flow.account = { id: account.id, email: account.email, projectId: project.project_id, projectError: project.error };
    } catch (e) {
      flow.status = "error"; flow.message = e instanceof Error ? e.message : String(e);
    }
  }

  private public(flow: Flow) { return { id: flow.id, user_code: flow.user_code, verification_url: flow.verification_url, verification_url_complete: flow.verification_url_complete, expiresAt: flow.expiresAt, interval: flow.interval, status: flow.status, message: flow.message, account: flow.account }; }
}
