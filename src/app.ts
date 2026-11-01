import express from "express";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { AccountStore } from "./accounts/store.js";
import { RotationEngine } from "./accounts/rotation.js";
import { requireBearer } from "./auth.js";
import { AntigravityClient } from "./proxy/antigravity-client.js";
import { refreshAntigravityToken } from "./proxy/token-refresh.js";
import { AntigravityQuotaClient, type AccountQuotaStatus } from "./proxy/quota-client.js";
import { DEFAULT_MODEL, MODELS } from "./proxy/models.js";
import { GoogleOAuthService } from "./oauth/google.js";
import { GoogleDeviceOAuthService } from "./oauth/device.js";
import { GoogleManualOAuthService } from "./oauth/manual.js";

export interface AppOptions {
  authDir: string;
  managementToken: string;
  apiKeys: string[];
  estimatedLimitTokens?: number;
}

export function createApp(options: AppOptions) {
  const app = express();
  const store = new AccountStore({ authDir: options.authDir, estimatedLimitTokens: options.estimatedLimitTokens });
  const rotation = new RotationEngine();
  const client = new AntigravityClient();
  const quotaClient = new AntigravityQuotaClient();
  const oauth = new GoogleOAuthService(store, { clientFile: process.env.GOOGLE_OAUTH_CLIENT_FILE, redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI || "https://antigravity.vadym.live/auth/google/callback" });
  const deviceOAuth = new GoogleDeviceOAuthService(store);
  const manualOAuth = new GoogleManualOAuthService(store);

  app.use((pinoHttp as unknown as () => express.RequestHandler)());
  app.use(express.json({ limit: "25mb" }));
  app.use(cookieParser());

  const managementAuth = requireBearer([options.managementToken]);
  const apiAuth = requireBearer(options.apiKeys);
  const anyAuth = requireBearer([...options.apiKeys, options.managementToken]);

  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  app.get("/api/accounts/overview", anyAuth, async (_req, res, next) => {
    try {
      const status = await accountsStatus(store, quotaClient);
      const overview = formatOverview(status);
      res.json(overview);
    } catch (e) { next(e); }
  });
  app.get("/api/public/status", managementAuth, async (_req, res, next) => { try { res.json(await accountsStatus(store, quotaClient)); } catch (e) { next(e); } });
  app.get("/api/accounts", managementAuth, async (_req, res, next) => { try { res.json({ accounts: await store.listPublicAccounts() }); } catch (e) { next(e); } });
  app.get("/api/accounts/status", managementAuth, async (_req, res, next) => { try { res.json(await accountsStatus(store, quotaClient)); } catch (e) { next(e); } });
  app.post("/api/accounts/import", managementAuth, async (req, res, next) => { try { res.json(await importAccounts(req.body, store)); } catch (e) { next(e); } });
  app.delete("/api/accounts/:id", managementAuth, async (req, res, next) => { try { const ok = await store.deleteAuthFile(String(req.params.id)); res.status(ok ? 200 : 404).json({ ok }); } catch (e) { next(e); } });
  app.post("/api/oauth/google/start", managementAuth, async (_req, res, next) => { try { res.json({ url: await oauth.startUrl() }); } catch (e) { next(e); } });
  app.post("/api/oauth/device/start", managementAuth, async (_req, res, next) => { try { res.json(await deviceOAuth.start()); } catch (e) { next(e); } });
  app.get("/api/oauth/device/:id", managementAuth, async (req, res, next) => { try { res.json(await deviceOAuth.status(String(req.params.id))); } catch (e) { next(e); } });
  app.post("/api/oauth/manual/start", managementAuth, async (_req, res, next) => { try { res.json(manualOAuth.start()); } catch (e) { next(e); } });
  app.post("/api/oauth/manual/complete", managementAuth, async (req, res, next) => { try { res.json(await manualOAuth.complete(req.body)); } catch (e) { next(e); } });
  app.get("/auth/google/callback", async (req, res) => {
    try {
      const result = await oauth.callback(String(req.query.code || ""), String(req.query.state || ""));
      res.type("html").send(`<script>localStorage.setItem('antigravityOauthResult', ${JSON.stringify(JSON.stringify({ ok: true, email: result.account.email }))}); location.href='/'</script>`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      res.status(400).type("html").send(`<script>localStorage.setItem('antigravityOauthResult', ${JSON.stringify(JSON.stringify({ ok: false, error: message }))}); location.href='/'</script>`);
    }
  });
  app.post("/api/accounts", managementAuth, async (req, res, next) => { try { const account = await store.createOrUpdateAuthFile(String(req.body.fileName || req.body.id || `account-${Date.now()}.json`), req.body.auth || req.body); res.status(201).json({ account }); } catch (e) { next(e); } });
  app.post("/api/accounts/:id/enable", managementAuth, async (req, res) => { const account = await store.setEnabled(String(req.params.id), true); return account ? res.json({ account }) : res.status(404).json({ error: "not_found" }); });
  app.post("/api/accounts/:id/disable", managementAuth, async (req, res) => { const account = await store.setEnabled(String(req.params.id), false); return account ? res.json({ account }) : res.status(404).json({ error: "not_found" }); });

  app.get("/api/stats/summary", managementAuth, async (_req, res) => res.json(await summary(store)));
  app.get("/v1/models", apiAuth, async (_req, res, next) => { try { res.json(await client.listModels()); } catch (e) { next(e); } });

  app.post("/v1/chat/completions", apiAuth, async (req, res, next) => {
    const model = String(req.body?.model || DEFAULT_MODEL);
    const stream = Boolean(req.body?.stream);
    const tried = new Set<string>();
    let last: any;
    try {
      for (let attempt = 0; attempt < Math.max(1, Number(process.env.MAX_ACCOUNT_ATTEMPTS || 12)); attempt++) {
        const account = rotation.pick(await store.listRuntimeAccounts(), model, tried);
        if (!account) break;
        tried.add(account.id);
        store.recordRequest(account, model);
        const rawAuth = await store.getRawAuth(account.id);
        if (!rawAuth) continue;
        let upstream = stream
          ? await client.chatCompletionsStream(req.body, rawAuth)
          : await client.chatCompletions(req.body, rawAuth);
        if ((upstream as any).status === 401 && !tried.has(account.id + ":refresh")) {
          tried.add(account.id + ":refresh");
          const { refreshAntigravityToken } = await import("./proxy/token-refresh.js");
          try {
            const r = await refreshAntigravityToken(rawAuth);
            if (!r.error && r.access_token) {
              rawAuth.access_token = r.access_token;
              if (r.expires_in) rawAuth.expired = new Date(Date.now() + r.expires_in * 1000).toISOString();
              try {
                const fs = await import("node:fs/promises");
                const path = await import("node:path");
                const dir = process.env.AUTH_DIR || "/app/config/auth";
                await fs.writeFile(path.join(dir, `${account.id}.json`), JSON.stringify(rawAuth, null, 2));
              } catch (_) {}
              upstream = stream
                ? await client.chatCompletionsStream(req.body, rawAuth)
                : await client.chatCompletions(req.body, rawAuth);
            }
          } catch (_) {}
        }
        if (upstream.status >= 200 && upstream.status < 300) {
          if (!stream) store.recordSuccess(account, model, upstream.usage ?? {});
          for (const [k, v] of Object.entries(upstream.headers)) res.setHeader(k, v);
          if (stream && "stream" in upstream && upstream.stream) return pipeReadable(upstream.stream as ReadableStream<Uint8Array>, res);
          return res.status(upstream.status).send(upstream.body);
        }
        last = upstream.body;
        // A rejected model says nothing about the account, so answer the caller
        // instead of replaying the same rejection against every account left.
        if ((upstream as any).reason === "model") return res.status(upstream.status).json(upstream.body);
        store.recordFailure(account, model, last);
        if (upstream.retryable) rotation.recordFailure(account, model, last, { cooldownOverrideMs: upstream.cooldownMs });
        else if ((upstream as any).reason === "auth") rotation.recordFailure(account, model, last, { authFailed: true });
      }
      return res.status(503).json({ error: { message: "No healthy account succeeded", type: "routing_error", last } });
    } catch (e) { return next(e); }
  });

  const webDir = join(process.cwd(), "dist-web");
  if (existsSync(webDir)) app.use(express.static(webDir));
  app.get("/", async (req, res) => {
    if (existsSync(join(webDir, "index.html"))) return res.sendFile(join(webDir, "index.html"));
    return res.type("html").send(renderDashboard(await accountsStatus(store, quotaClient), String(req.query.account || ""), String(req.query.model || "")));
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: { message, type: "server_error" } });
  });

  return app;
}

async function pipeReadable(stream: ReadableStream<Uint8Array>, res: express.Response) {
  const reader = stream.getReader();
  res.status(200);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (e) { res.destroy(e instanceof Error ? e : new Error(String(e))); }
}


async function importAccounts(payload: any, store: AccountStore) {
  const records = extractImportRecords(payload);
  const imported: any[] = [];
  const skipped: any[] = [];
  for (const rec of records) {
    const email = String(rec.email || rec.account_email || rec.accountEmail || rec.id || "").trim();
    const refresh = String(rec.refresh_token || rec.refreshToken || "").trim();
    if (!refresh) { skipped.push({ email, reason: "missing refresh_token" }); continue; }
    const safe = (email || `antigravity-${Date.now()}-${imported.length}`).toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/-+/g, "-");
    const auth: any = { ...rec, email: email || safe, refresh_token: refresh, provider: "antigravity", type: "antigravity", disabled: rec.disabled === true ? true : false };
    const refreshed = await refreshAntigravityToken(auth);
    if (refreshed.access_token) {
      auth.access_token = refreshed.access_token;
      auth.expires_in = refreshed.expires_in;
      auth.expired = new Date(Date.now() + Number(refreshed.expires_in || 3600) * 1000).toISOString();
    } else {
      skipped.push({ email, reason: refreshed.error || "refresh failed" });
    }
    const account = await store.createOrUpdateAuthFile(`${safe}.json`, auth);
    const raw = await store.getRawAuth(account.id);
    imported.push({ id: account.id, email: account.email, refreshed: Boolean(refreshed.access_token), projectId: raw?.project_id || raw?.projectId });
  }
  return { imported: imported.length, skipped: skipped.length, accounts: imported, skippedRecords: skipped };
}

function extractImportRecords(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.accounts)) return extractImportRecords(payload.accounts);
  const platforms = payload?.accounts?.platforms || payload?.platforms;
  const ag = platforms?.antigravity?.exported_data || platforms?.antigravity_ide?.exported_data;
  if (Array.isArray(ag)) return ag;
  if (Array.isArray(payload?.exported_data)) return payload.exported_data;
  return [];
}

async function accountsStatus(store: AccountStore, quotaClient: AntigravityQuotaClient) {
  const accounts = await store.listPublicAccounts();
  const enriched = await Promise.all(accounts.map(async (account) => {
    const raw = await store.getRawAuth(account.id);
    const quota = raw ? await quotaClient.getStatus(account.id, raw) : { fetchedAt: Date.now(), metrics: [], error: "no auth file" } as AccountQuotaStatus;
    return { ...account, quota };
  }));
  const stats = await summaryFromAccounts(enriched);
  return { accounts: enriched, stats, models: MODELS.map(m => ({ id: m.id, displayName: m.displayName, aliases: m.aliases })) };
}

function formatOverview(status: { accounts: any[]; stats: any; models: any[] }) {
  const accounts = status.accounts || [];
  const now = Date.now();

  const accountOverviews = accounts.map(a => {
    const metrics: any[] = a.quota?.metrics || [];
    const getMetric = (pattern: RegExp) => metrics.find(m => pattern.test(m.name || ""));
    const gemini5h = getMetric(/^gemini-5h$/i) || getMetric(/gemini.*5h/i);
    const geminiWeekly = getMetric(/^gemini-weekly$/i) || getMetric(/gemini.*week/i);
    const claude5h = getMetric(/^3p-5h$/i) || getMetric(/(3p-5h|claude.*5h)/i);
    const claudeWeekly = getMetric(/^3p-weekly$/i) || getMetric(/(3p-weekly|claude.*week)/i);

    const flashModelMetric = metrics.find(m => /gemini-(3\.8-flash|3\.5-flash|3-flash)/i.test(m.name));
    const effectiveGeminiWeekly = geminiWeekly || (flashModelMetric ? { remainingPercent: flashModelMetric.remainingPercent, resetTime: flashModelMetric.resetTime } : null);

    // Calculate nearest reset time across all metrics that are below 98%
    const expiringMetrics = metrics.filter(m => typeof m.remainingPercent === "number" && m.remainingPercent < 98 && m.resetTime);
    let nextReset: { metric: string; resetTime: string; secondsLeft: number } | null = null;
    if (expiringMetrics.length > 0) {
      expiringMetrics.sort((x, y) => new Date(x.resetTime).getTime() - new Date(y.resetTime).getTime());
      const first = expiringMetrics[0];
      const diffSec = Math.max(0, Math.round((new Date(first.resetTime).getTime() - now) / 1000));
      nextReset = { metric: first.name, resetTime: first.resetTime, secondsLeft: diffSec };
    }

    return {
      id: a.id,
      email: a.email,
      healthy: a.healthy,
      enabled: a.enabled,
      hasAuthError: Boolean(a.quota?.error && /401|auth/i.test(a.quota.error)),
      quotaError: a.quota?.error,
      tier: a.quota?.tier || "unknown",
      gemini: {
        fiveHourPercent: gemini5h ? gemini5h.remainingPercent : null,
        fiveHourReset: gemini5h?.resetTime || null,
        weeklyPercent: effectiveGeminiWeekly ? effectiveGeminiWeekly.remainingPercent : null,
        weeklyReset: effectiveGeminiWeekly?.resetTime || null,
      },
      claude: {
        fiveHourPercent: claude5h ? claude5h.remainingPercent : null,
        fiveHourReset: claude5h?.resetTime || null,
        weeklyPercent: claudeWeekly ? claudeWeekly.remainingPercent : null,
        weeklyReset: claudeWeekly?.resetTime || null,
      },
      nextReset,
      requestCount: a.requestCount,
      totalTokens: a.totalTokens,
    };
  });

  const healthyAccounts = accountOverviews.filter(a => a.healthy && !a.hasAuthError);
  const geminiAvailable = healthyAccounts.filter(a => (a.gemini.weeklyPercent ?? 100) > 2);
  const claudeAvailable = healthyAccounts.filter(a => (a.claude.weeklyPercent ?? 100) > 2);

  // Calculate total pool percentages
  const totalAccounts = Math.max(1, accounts.length);
  const geminiPoolWeekly = accountOverviews.reduce((acc, a) => acc + (a.gemini.weeklyPercent ?? 100), 0) / totalAccounts;
  const claudePoolWeekly = accountOverviews.reduce((acc, a) => acc + (a.claude.weeklyPercent ?? 100), 0) / totalAccounts;

  // Pool upcoming resets
  const allResets = accountOverviews
    .map(a => a.nextReset)
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => a.secondsLeft - b.secondsLeft);

  return {
    timestamp: new Date(now).toISOString(),
    summary: {
      totalAccounts: accounts.length,
      healthyAccounts: healthyAccounts.length,
      geminiReadyAccounts: geminiAvailable.length,
      claudeReadyAccounts: claudeAvailable.length,
      geminiPoolWeeklyPercent: Math.round(geminiPoolWeekly * 10) / 10,
      claudePoolWeeklyPercent: Math.round(claudePoolWeekly * 10) / 10,
      nearestReset: allResets[0] || null,
      upcomingResets: allResets.slice(0, 5),
    },
    accounts: accountOverviews,
  };
}

async function summaryFromAccounts(accounts: any[]) {
  const modelMap = new Map<string, any>();
  for (const account of accounts) for (const stat of Object.values<any>(account.modelStats || {})) {
    const cur = modelMap.get(stat.model) ?? { model: stat.model, requests: 0, successes: 0, errors: 0, totalTokens: 0, promptTokens: 0, completionTokens: 0 };
    cur.requests += stat.requests; cur.successes += stat.successes; cur.errors += stat.errors; cur.totalTokens += stat.totalTokens; cur.promptTokens += stat.promptTokens; cur.completionTokens += stat.completionTokens;
    modelMap.set(stat.model, cur);
  }
  const avgUsagePercent = accounts.filter(a => a.usagePercent != null).reduce((s, a) => s + (a.usagePercent ?? 0), 0) / Math.max(1, accounts.filter(a => a.usagePercent != null).length);
  return { accountsTotal: accounts.length, accountsEnabled: accounts.filter(a => a.enabled).length, accountsHealthy: accounts.filter(a => a.healthy).length, avgUsagePercent, requestsTotal: accounts.reduce((s, a) => s + a.requestCount, 0), successesTotal: accounts.reduce((s, a) => s + a.successCount, 0), errorsTotal: accounts.reduce((s, a) => s + a.errorCount, 0), tokensTotal: accounts.reduce((s, a) => s + a.totalTokens, 0), models: [...modelMap.values()] };
}

async function summary(store: AccountStore) {
  return summaryFromAccounts(await store.listPublicAccounts());
}

function renderDashboard(data: any, selectedAccount: string, selectedModel: string) {
  const accounts = data.accounts || [];
  const stats = data.stats || {};
  const models = data.models || [];
  const accountOptions = [`<option value="">All accounts</option>`, ...accounts.map((a: any) => `<option value="${esc(a.id)}" ${selectedAccount === a.id ? "selected" : ""}>${esc(a.email || a.id)}</option>`)].join("");
  const modelOptions = [`<option value="">All models/quotas</option>`, ...models.map((m: any) => `<option value="${esc(m.id)}" ${selectedModel === m.id ? "selected" : ""}>${esc(m.displayName || m.id)}</option>`)].join("");
  const visible = accounts.filter((a: any) => !selectedAccount || a.id === selectedAccount);
  const accountCards = visible.map((a: any) => renderAccountCard(a, selectedModel)).join("");
  const modelRows = (stats.models || []).map((m: any) => `<tr><td>${esc(m.model)}</td><td>${m.totalTokens}</td><td>${m.promptTokens}</td><td>${m.completionTokens}</td><td>${m.requests}</td><td>${m.successes}</td><td>${m.errors}</td></tr>`).join("");
  return `<!doctype html><html><head><title>Antigravity API</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  :root{color-scheme:dark}body{font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;margin:0;background:#08101f;color:#e8ecff}main{padding:20px;max-width:1400px;margin:auto}.top{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:16px 0}.card,.account,table,select{background:#121a33;border:1px solid #26304f;border-radius:16px}.card{padding:16px}.muted{color:#9aa6d6;font-size:13px}.big{font-size:24px;font-weight:800}.filters{display:flex;gap:10px;flex-wrap:wrap}select{color:#e8ecff;padding:10px 12px}.accounts{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px}.account{padding:16px}.acctHead{display:flex;justify-content:space-between;gap:10px}.badge{padding:4px 8px;border-radius:999px;background:#22345f;font-size:12px}.ok{background:#123d2a;color:#8af0b2}.warn{background:#4a3414;color:#ffd18a}.bad{background:#4a1820;color:#ff9baa}.quota{margin-top:12px;display:grid;gap:8px}.qrow{display:grid;grid-template-columns:1.25fr 68px 1fr;gap:8px;align-items:center}.bar{height:10px;background:#26304f;border-radius:999px;overflow:hidden}.fill{height:100%;background:linear-gradient(90deg,#ff5f7a,#ffd166,#6ee7b7)}table{border-collapse:collapse;width:100%;overflow:hidden;margin-top:16px}td,th{padding:10px;border-bottom:1px solid #26304f;text-align:left;font-size:13px}a{color:#9cc7ff}@media(max-width:560px){main{padding:12px}.accounts{grid-template-columns:1fr}.qrow{grid-template-columns:1fr}.top{align-items:flex-start}}
  </style></head><body><main><div class=top><div><h1>Antigravity API</h1><div class=muted>Live account/model quota dashboard. Updated on page load; quota cache TTL 60s.</div></div><form class=filters method=get><select name=account>${accountOptions}</select><select name=model>${modelOptions}</select><button class=badge type=submit>Apply</button><a class=badge href="/">Reset</a></form></div><div class=cards><div class=card><div class=muted>Accounts</div><div class=big>${stats.accountsTotal ?? 0}</div></div><div class=card><div class=muted>Healthy</div><div class=big>${stats.accountsHealthy ?? 0}</div></div><div class=card><div class=muted>Tokens</div><div class=big>${stats.tokensTotal ?? 0}</div></div><div class=card><div class=muted>Errors</div><div class=big>${stats.errorsTotal ?? 0}</div></div></div><section class=accounts>${accountCards}</section><h2>Runtime model stats</h2><table><thead><tr><th>Model</th><th>Tokens</th><th>Prompt</th><th>Completion</th><th>Req</th><th>OK</th><th>Err</th></tr></thead><tbody>${modelRows}</tbody></table></main></body></html>`;
}

function renderAccountCard(a: any, selectedModel: string) {
  const metrics = (a.quota?.metrics || []).filter((m: any) => !selectedModel || matchMetricToModel(m, selectedModel));
  const quotaRows = metrics.length ? metrics.map((m: any) => renderQuotaRow(m)).join("") : `<div class=muted>No quota rows${a.quota?.error ? `: ${esc(a.quota.error)}` : ""}</div>`;
  const statusClass = a.healthy ? "ok" : "warn";
  return `<article class=account><div class=acctHead><div><h3>${esc(a.email || a.id)}</h3><div class=muted>${esc(a.projectId || a.quota?.projectId || "no project")} · ${esc(a.quota?.tier || "unknown tier")}</div></div><span class="badge ${statusClass}">${a.healthy ? "healthy" : "cooldown"}</span></div><div class=cards><div><div class=muted>Req</div><b>${a.requestCount}</b></div><div><div class=muted>OK</div><b>${a.successCount}</b></div><div><div class=muted>Err</div><b>${a.errorCount}</b></div></div><div class=quota>${quotaRows}</div>${a.lastError ? `<p class="muted bad">${esc(a.lastError)}</p>` : ""}</article>`;
}
function renderQuotaRow(m: any) {
  const pctNum = Number(m.remainingPercent ?? 0);
  const cls = pctNum <= 10 ? "bad" : pctNum <= 35 ? "warn" : "ok";
  return `<div class=qrow><div><b>${esc(m.displayName || m.name)}</b><div class=muted>${esc(m.name)} · ${esc(m.source)}</div></div><span class="badge ${cls}">${pctNum.toFixed(1)}%</span><div><div class=bar><div class=fill style="width:${Math.max(0, Math.min(100, pctNum))}%"></div></div><div class=muted>${m.resetTime ? `resets ${esc(timeLeft(m.resetTime))} · ${esc(m.resetTime)}` : "no reset"}</div></div></div>`;
}
function matchMetricToModel(metric: any, model: string) {
  const hay = `${metric.name || ""} ${metric.displayName || ""}`.toLowerCase();
  const needle = model.toLowerCase();
  if (needle.includes("opus")) return hay.includes("opus") || hay.includes("3p");
  if (needle.includes("sonnet")) return hay.includes("sonnet") || hay.includes("3p");
  if (needle.includes("gemini")) return hay.includes("gemini");
  return hay.includes(needle);
}
function timeLeft(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return "unknown";
  if (ms <= 0) return "now";
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000);
  const d = Math.floor(h / 24), rh = h % 24;
  return d ? `${d}d ${rh}h` : `${h}h ${m}m`;
}
function esc(v: any) { return String(v ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]!)); }
function pct(v: number | null | undefined) { return v == null ? "—" : `${v.toFixed(1)}%`; }

export async function startApp(options: AppOptions & { port: number; host?: string }): Promise<{ server: Server; url: string }> {
  const app = createApp(options);
  const server = createServer(app);
  const host = options.host ?? "0.0.0.0";
  await new Promise<void>((resolve) => server.listen(options.port, host, resolve));
  const address = server.address() as AddressInfo;
  const publicHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  return { server, url: `http://${publicHost}:${address.port}` };
}
