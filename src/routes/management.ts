import express from "express";
import { refreshAccessToken } from "../accounts/tokens.js";
import type { AccountStore } from "../accounts/store.js";
import { ANTIGRAVITY_VERSION, USER_AGENT } from "../config.js";
import { GoogleDeviceOAuthService } from "../oauth/device.js";
import { GoogleOAuthService } from "../oauth/google.js";
import { GoogleManualOAuthService } from "../oauth/manual.js";
import type { Services } from "../services/container.js";
import { accountsStatus, formatOverview, summary } from "../services/overview.js";

type Handler = (req: express.Request, res: express.Response) => Promise<unknown>;
const wrap = (fn: Handler): express.RequestHandler => (req, res, next) => { fn(req, res).catch(next); };

/** /api/* (management token) plus the OAuth callback. */
export function managementRouter(svc: Services, auth: { management: express.RequestHandler; any: express.RequestHandler }) {
  const router = express.Router();
  const { store } = svc;
  const oauth = new GoogleOAuthService(store, { clientFile: process.env.GOOGLE_OAUTH_CLIENT_FILE, redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI || "https://antigravity.vadym.live/auth/google/callback" });
  const deviceOAuth = new GoogleDeviceOAuthService(store);
  const manualOAuth = new GoogleManualOAuthService(store);
  const status = () => accountsStatus(store, svc.tokens, svc.quota);

  router.get("/api/accounts/overview", auth.any, wrap(async (_req, res) => res.json(formatOverview(await status()))));
  router.get("/api/public/status", auth.management, wrap(async (_req, res) => res.json(await status())));
  router.get("/api/accounts/status", auth.management, wrap(async (_req, res) => res.json(await status())));
  router.get("/api/accounts", auth.management, wrap(async (_req, res) => res.json({ accounts: await store.listPublicAccounts() })));
  router.post("/api/accounts", auth.management, wrap(async (req, res) => {
    const account = await store.createOrUpdateAuthFile(String(req.body.fileName || req.body.id || `account-${Date.now()}.json`), req.body.auth || req.body);
    res.status(201).json({ account });
  }));
  router.post("/api/accounts/import", auth.management, wrap(async (req, res) => res.json(await importAccounts(req.body, store))));
  router.delete("/api/accounts/:id", auth.management, wrap(async (req, res) => { const ok = await store.deleteAuthFile(String(req.params.id)); res.status(ok ? 200 : 404).json({ ok }); }));
  router.post("/api/accounts/:id/enable", auth.management, wrap(async (req, res) => { const account = await store.setEnabled(String(req.params.id), true); return account ? res.json({ account }) : res.status(404).json({ error: "not_found" }); }));
  router.post("/api/accounts/:id/disable", auth.management, wrap(async (req, res) => { const account = await store.setEnabled(String(req.params.id), false); return account ? res.json({ account }) : res.status(404).json({ error: "not_found" }); }));
  router.get("/api/stats/summary", auth.management, wrap(async (_req, res) => res.json(await summary(store))));

  // What Google currently offers this client version (raw fetchAvailableModels, refreshed on demand).
  router.get("/api/models/upstream", auth.management, wrap(async (req, res) => {
    const upstream = await svc.catalog.upstream(() => svc.anyCredentials(), req.query.refresh === "1");
    res.json({ clientVersion: ANTIGRAVITY_VERSION, userAgent: USER_AGENT, upstream, listed: svc.catalog.list(upstream) });
  }));

  router.post("/api/oauth/google/start", auth.management, wrap(async (_req, res) => res.json({ url: await oauth.startUrl() })));
  router.post("/api/oauth/device/start", auth.management, wrap(async (_req, res) => res.json(await deviceOAuth.start())));
  router.get("/api/oauth/device/:id", auth.management, wrap(async (req, res) => res.json(await deviceOAuth.status(String(req.params.id)))));
  router.post("/api/oauth/manual/start", auth.management, wrap(async (_req, res) => res.json(manualOAuth.start())));
  router.post("/api/oauth/manual/complete", auth.management, wrap(async (req, res) => res.json(await manualOAuth.complete(req.body))));
  router.get("/auth/google/callback", async (req, res) => {
    const finish = (payload: unknown) => `<script>localStorage.setItem('antigravityOauthResult', ${JSON.stringify(JSON.stringify(payload))}); location.href='/'</script>`;
    try {
      const result = await oauth.callback(String(req.query.code || ""), String(req.query.state || ""));
      res.type("html").send(finish({ ok: true, email: result.account.email }));
    } catch (e) {
      res.status(400).type("html").send(finish({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    }
  });
  return router;
}

/** Accepts an array of auth records or a Cockpit-style export with platforms.antigravity.exported_data. */
function extractImportRecords(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.accounts)) return extractImportRecords(payload.accounts);
  const platforms = payload?.accounts?.platforms || payload?.platforms;
  const exported = platforms?.antigravity?.exported_data || platforms?.antigravity_ide?.exported_data;
  if (Array.isArray(exported)) return exported;
  if (Array.isArray(payload?.exported_data)) return payload.exported_data;
  return [];
}

async function importAccounts(payload: any, store: AccountStore) {
  const imported: any[] = [];
  const skipped: any[] = [];
  for (const rec of extractImportRecords(payload)) {
    const email = String(rec.email || rec.account_email || rec.accountEmail || rec.id || "").trim();
    const refresh = String(rec.refresh_token || rec.refreshToken || "").trim();
    if (!refresh) { skipped.push({ email, reason: "missing refresh_token" }); continue; }
    const safe = (email || `antigravity-${Date.now()}-${imported.length}`).toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/-+/g, "-");
    const authFile: any = { ...rec, email: email || safe, refresh_token: refresh, provider: "antigravity", type: "antigravity", disabled: rec.disabled === true };
    const refreshed = await refreshAccessToken(refresh);
    if (refreshed.access_token) {
      authFile.access_token = refreshed.access_token;
      authFile.expires_in = refreshed.expires_in;
      authFile.expired = new Date(Date.now() + Number(refreshed.expires_in || 3600) * 1000).toISOString();
    } else {
      skipped.push({ email, reason: refreshed.error_description || refreshed.error || "refresh failed" });
    }
    const account = await store.createOrUpdateAuthFile(`${safe}.json`, authFile);
    const raw = await store.getRawAuth(account.id);
    imported.push({ id: account.id, email: account.email, refreshed: Boolean(refreshed.access_token), projectId: raw?.project_id || raw?.projectId });
  }
  return { imported: imported.length, skipped: skipped.length, accounts: imported, skippedRecords: skipped };
}
