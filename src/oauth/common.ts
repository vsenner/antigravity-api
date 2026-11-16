import type { AccountStore } from "../accounts/store.js";
import type { RawAuthFile } from "../accounts/types.js";
import { loadCodeAssist } from "../proxy/code-assist.js";

export async function postForm(url: string, params: Record<string, string>) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(json.error_description || json.error || text);
  return json;
}

export async function userEmail(accessToken: string, idToken?: string): Promise<string> {
  if (idToken) {
    try {
      const payload = JSON.parse(Buffer.from(idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
      if (payload.email) return String(payload.email);
    } catch { /* fall back to userinfo */ }
  }
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { authorization: `Bearer ${accessToken}` } });
  const json: any = await res.json();
  if (!res.ok || !json.email) throw new Error("Unable to resolve Google email");
  return String(json.email);
}

export interface GoogleTokenResponse { access_token: string; refresh_token?: string; expires_in?: number; id_token?: string }

/** Turns a fresh Google token into an auth file named after the account's email. */
export async function saveOAuthAccount(store: AccountStore, token: GoogleTokenResponse) {
  if (!token.refresh_token) throw new Error("Google did not return refresh_token; revoke the previous consent and sign in again");
  const email = await userEmail(token.access_token, token.id_token);
  const project = await loadCodeAssist(token.access_token).catch((e) => ({ error: e instanceof Error ? e.message : String(e), projectId: undefined, tier: undefined }));
  const auth: RawAuthFile = {
    email,
    provider: "antigravity",
    type: "antigravity",
    refresh_token: token.refresh_token,
    access_token: token.access_token,
    expires_in: token.expires_in,
    expired: new Date(Date.now() + Number(token.expires_in || 3600) * 1000).toISOString(),
    disabled: false,
  };
  if (project.projectId) auth.project_id = project.projectId;
  if (project.tier) auth.tier = project.tier;
  if (project.error && !project.error.includes("Verify your account")) auth.project_error = project.error;
  const safe = email.toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/-+/g, "-");
  const account = await store.createOrUpdateAuthFile(`${safe}.json`, auth);
  return { account, project: { project_id: project.projectId, tier: project.tier, error: project.error } };
}
