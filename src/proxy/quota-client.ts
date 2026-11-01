import type { RawAuthFile } from "../accounts/types.js";
import { getAccessToken, getProjectId } from "./antigravity-format.js";
import { refreshAntigravityToken } from "./token-refresh.js";

const BASE = process.env.ANTIGRAVITY_QUOTA_BASE_URL || "https://daily-cloudcode-pa.googleapis.com";
const UA = process.env.ANTIGRAVITY_LOAD_USER_AGENT || "antigravity/1.20.5 linux/amd64 google-api-nodejs-client/10.3.0";
const CLOUD_UA = process.env.ANTIGRAVITY_USER_AGENT || "antigravity/1.20.5 linux/amd64";

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
      const [models, summary] = await Promise.all([
        postJson(`${BASE}/v1internal:fetchAvailableModels`, token, payload, CLOUD_UA),
        postJson(`${BASE}/v1internal:retrieveUserQuotaSummary`, token, payload, CLOUD_UA),
      ]);
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
      if (models.ok) {
        for (const [name, info] of Object.entries<any>(models.json?.models || {})) {
          const qi = info?.quotaInfo;
          if (!qi) continue;
          if (!/gemini|claude|gpt/i.test(name)) continue;
          // Only add model-level metric if not already provided by summary
          metrics.push({
            name,
            displayName: info.displayName,
            remainingPercent: pct(qi.remainingFraction),
            resetTime: qi.resetTime,
            source: "models"
          });
        }
      }
      const error = !models.ok ? `fetchAvailableModels ${models.status}: ${models.message}` : !summary.ok ? `retrieveUserQuotaSummary ${summary.status}: ${summary.message}` : undefined;
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
