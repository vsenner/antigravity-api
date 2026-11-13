import type { RawAuthFile } from "../accounts/types.js";
import { getAccessToken, getProjectId } from "./antigravity-format.js";
import { refreshAntigravityToken } from "./token-refresh.js";

const BASE = process.env.ANTIGRAVITY_QUOTA_BASE_URL || "https://daily-cloudcode-pa.googleapis.com";
const UA = process.env.ANTIGRAVITY_LOAD_USER_AGENT || "antigravity/2.30.0 darwin/arm64 google-api-nodejs-client/10.3.0";
const CLOUD_UA = process.env.ANTIGRAVITY_USER_AGENT || "antigravity/2.30.0 darwin/arm64";

export interface QuotaMetric { name: string; displayName?: string; remainingPercent: number; resetTime?: string; source: "models" | "summary" }
export interface AccountQuotaStatus { fetchedAt: number; tier?: string; projectId?: string; metrics: QuotaMetric[]; error?: string }

export class AntigravityQuotaClient {
  private cache = new Map<string, { expires: number; status: AccountQuotaStatus }>();

  async getStatus(accountId: string, auth: RawAuthFile, maxAgeMs = 60_000): Promise<AccountQuotaStatus> {
    const cached = this.cache.get(accountId);
    if (cached && cached.expires > Date.now()) return cached.status;
    const status = await this.fetchStatus(auth);
    this.cache.set(accountId, { expires: Date.now() + maxAgeMs, status });
    return status;
  }

  private async fetchStatus(auth: RawAuthFile): Promise<AccountQuotaStatus> {
    let token = getAccessToken(auth);
    const expiresAt = Date.parse(String((auth as any).expired || (auth as any).expires_at || (auth as any).expiresAt || ""));
    if (!token || (Number.isFinite(expiresAt) && expiresAt <= Date.now() + 60_000)) {
      const refreshed = await refreshAntigravityToken(auth);
      if (refreshed.access_token) {
        token = refreshed.access_token;
        auth.access_token = refreshed.access_token;
        (auth as any).expires_in = refreshed.expires_in;
        (auth as any).expired = new Date(Date.now() + Number(refreshed.expires_in || 3600) * 1000).toISOString();
      }
    }
    if (!token) return { fetchedAt: Date.now(), metrics: [], error: "no access token" };
    let projectId = getProjectId(auth);
    if (!projectId) {
      projectId = "total-particle-kcz5z";
    }
    let tier: string | undefined;
    try {
      const load = await postJson(`${BASE}/v1internal:loadCodeAssist`, token, {
        metadata: { ideName: "antigravity", ideType: "ANTIGRAVITY", ideVersion: "1.20.5", platform: "LINUX_AMD64", pluginType: "GEMINI" },
        mode: "FULL_ELIGIBILITY_CHECK",
      }, UA);
      if (load.ok) {
        const data: any = load.json;
        const project = data.cloudaicompanionProject;
        if (typeof project === "string" && project) projectId = project;
        else if (project && typeof project === "object") projectId = String(project.id || project.projectId || projectId || "");
        tier = data.paidTier?.id || data.currentTier?.id;
      }
      if (!projectId) return { fetchedAt: Date.now(), metrics: [], tier, error: "no project_id" };

      const payload = { project: projectId };
      // 1. Fetch retrieveUserQuotaSummary (Claude/GPT 3p-5h and 3p-weekly buckets)
      const summaryPromise = postJson(`${BASE}/v1internal:retrieveUserQuotaSummary`, token, payload, CLOUD_UA);
      // 2. Fetch fetchAvailableModels (Gemini model quotaInfo: 5h rolling window for Pro, weekly window for Free)
      const modelsPromise = postJson(`${BASE}/v1internal:fetchAvailableModels`, token, payload, UA);

      const [summary, modelsRes] = await Promise.all([summaryPromise, modelsPromise]);
      const metrics: QuotaMetric[] = [];

      if (summary.ok) {
        for (const group of summary.json?.groups || []) {
          for (const bucket of group?.buckets || []) {
            if (typeof bucket?.remainingFraction !== "number") continue;
            metrics.push({
              name: String(bucket.bucketId || group.groupId || bucket.displayName || "quota"),
              displayName: bucket.displayName || group.displayName,
              remainingPercent: pct(bucket.remainingFraction),
              resetTime: bucket.resetTime,
              source: "summary"
            });
          }
        }
      }

      if (modelsRes.ok) {
        const models = modelsRes.json?.models || {};
        // Representative Gemini model is gemini-3.8-flash-tiered
        const geminiTiered = models["gemini-3.8-flash-tiered"]?.quotaInfo
          || models["gemini-3.1-flash-image"]?.quotaInfo
          || models["gemini-2.5-flash"]?.quotaInfo;

        if (geminiTiered) {
          // If the account has a resetTime, remainingFraction indicates available quota.
          // Note: when remainingFraction is undefined/omitted by upstream, it indicates 0% available (exhausted).
          const frac = typeof geminiTiered.remainingFraction === "number" ? geminiTiered.remainingFraction : 0;
          const isPro = tier === "g1-pro-tier";
          
          if (isPro) {
            // On Pro, Gemini models track the 5-hour rolling replenishment window
            metrics.push({
              name: "gemini-5h",
              displayName: "Gemini 5-Hour Limit",
              remainingPercent: pct(frac),
              resetTime: geminiTiered.resetTime,
              source: "models"
            });
          } else {
            // On Free-tier, Gemini models track the Weekly reset cap (no 5h replenishment)
            metrics.push({
              name: "gemini-weekly",
              displayName: "Gemini Weekly Limit",
              remainingPercent: pct(frac),
              resetTime: geminiTiered.resetTime,
              source: "models"
            });
          }
        }
      }

      const error = !summary.ok ? `retrieveUserQuotaSummary ${summary.status}: ${summary.message}` : (!modelsRes.ok ? `fetchAvailableModels ${modelsRes.status}: ${modelsRes.message}` : undefined);
      return { fetchedAt: Date.now(), projectId, tier, metrics: dedupe(metrics), error };
    } catch (e) {
      return { fetchedAt: Date.now(), projectId, tier, metrics: [], error: e instanceof Error ? e.message : String(e) };
    }
  }
}

function pct(f: unknown): number { return Math.max(0, Math.min(100, Math.round(Number(f || 0) * 1000) / 10)); }
function dedupe(rows: QuotaMetric[]) {
  const seen = new Set<string>();
  return rows.filter(r => {
    // Prefer summary metrics over models metrics when names collide or map to buckets
    const k = `${r.name}|${r.resetTime || ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
async function postJson(url: string, token: string, payload: unknown, ua: string): Promise<{ ok: boolean; status: number; json: any; message?: string }> {
  const res = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "user-agent": ua, accept: "*/*" }, body: JSON.stringify(payload) });
  const text = await res.text();
  let json: any = {}; try { json = text ? JSON.parse(text) : {}; } catch { json = { text }; }
  const message = json?.error?.message || json?.error?.status || text.slice(0, 200);
  return { ok: res.ok, status: res.status, json, message };
}
