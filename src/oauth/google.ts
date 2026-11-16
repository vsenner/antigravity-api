import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { URLSearchParams } from "node:url";
import type { AccountStore } from "../accounts/store.js";
import { postForm, saveOAuthAccount } from "./common.js";

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
    return saveOAuthAccount(this.store, token);
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
