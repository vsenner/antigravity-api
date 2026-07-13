import { request as httpsRequest } from "node:https";
import { URLSearchParams } from "node:url";
import type { RawAuthFile } from "../accounts/types.js";

const CLIENT_ID = process.env.ANTIGRAVITY_REFRESH_CLIENT_ID || "";
const CLIENT_SECRET = process.env.ANTIGRAVITY_REFRESH_CLIENT_SECRET || "";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface RefreshResult {
  access_token?: string;
  expires_in?: number;
  error?: string;
}

export async function refreshAntigravityToken(auth: RawAuthFile): Promise<RefreshResult> {
  const refresh = String(auth.refresh_token || auth.refreshToken || "");
  if (!refresh) return { error: "no refresh_token" };
  return new Promise((resolve) => {
    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refresh,
      grant_type: "refresh_token",
    }).toString();
    const req = httpsRequest(TOKEN_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": Buffer.byteLength(body).toString(),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString());
          resolve(json);
        } catch (e) {
          resolve({ error: String(e) });
        }
      });
    });
    req.on("error", (e) => resolve({ error: String(e) }));
    req.setTimeout(15_000, () => { req.destroy(new Error("timeout")); });
    req.write(body);
    req.end();
  });
}
