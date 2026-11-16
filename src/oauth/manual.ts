import crypto from "node:crypto";
import type { AccountStore } from "../accounts/store.js";
import { OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, TOKEN_URL } from "../config.js";
import { postForm, saveOAuthAccount } from "./common.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const REDIRECT_URI = process.env.ANTIGRAVITY_MANUAL_REDIRECT_URI || "http://localhost:61135/oauth-callback";
const SCOPE = "openid https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/cclog https://www.googleapis.com/auth/experimentsandconfigs";

type ManualFlow = { state: string; createdAt: number; redirectUri: string };

/** Sign-in with the IDE's client: the operator pastes the localhost callback URL back. */
export class GoogleManualOAuthService {
  private flows = new Map<string, ManualFlow>();
  constructor(private readonly store: AccountStore) {}

  start() {
    const state = crypto.randomUUID();
    this.flows.set(state, { state, createdAt: Date.now(), redirectUri: REDIRECT_URI });
    const params = new URLSearchParams({ client_id: OAUTH_CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: "code", scope: SCOPE, access_type: "offline", prompt: "consent", state });
    return { state, redirectUri: REDIRECT_URI, url: `${AUTH_URL}?${params.toString()}` };
  }

  async complete(input: { callbackUrl?: string; code?: string; state?: string }) {
    const parsed = parseCallback(input);
    const flow = this.flows.get(parsed.state);
    if (!flow || Date.now() - flow.createdAt > 15 * 60_000) throw new Error("Invalid or expired OAuth state");
    this.flows.delete(parsed.state);
    const token = await postForm(TOKEN_URL, { code: parsed.code, client_id: OAUTH_CLIENT_ID, client_secret: OAUTH_CLIENT_SECRET, redirect_uri: flow.redirectUri, grant_type: "authorization_code" });
    const { account, project } = await saveOAuthAccount(this.store, token);
    return { account: { id: account.id, email: account.email, projectId: project.project_id, projectError: project.error } };
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
