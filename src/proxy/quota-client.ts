import { SHORT_USER_AGENT } from "../config.js";
import { fetchAvailableModels, loadCodeAssist, postInternal } from "./code-assist.js";

export interface QuotaMetric { name: string; displayName?: string; remainingPercent: number; resetTime?: string; source: "models" | "summary" }
export interface AccountQuotaStatus { fetchedAt: number; tier?: string; projectId?: string; metrics: QuotaMetric[]; error?: string }

const pct = (f: unknown) => Math.max(0, Math.min(100, Math.round(Number(f || 0) * 1000) / 10));

/**
 * Quota windows per account: Claude/GPT buckets (3p-5h, 3p-weekly) come from
 * retrieveUserQuotaSummary, the Gemini window from fetchAvailableModels.
 * Cached per account for a minute.
 */
export class AntigravityQuotaClient {
  private cache = new Map<string, { expires: number; status: AccountQuotaStatus }>();

  async getStatus(accountId: string, token: () => Promise<string>, projectId: string | undefined, maxAgeMs = 60_000): Promise<AccountQuotaStatus> {
    const cached = this.cache.get(accountId);
    if (cached && cached.expires > Date.now()) return cached.status;
    const status = await this.fetchStatus(token, projectId).catch((e) => ({ fetchedAt: Date.now(), metrics: [], error: e instanceof Error ? e.message : String(e) }));
    this.cache.set(accountId, { expires: Date.now() + maxAgeMs, status });
    return status;
  }

  private async fetchStatus(getToken: () => Promise<string>, knownProject?: string): Promise<AccountQuotaStatus> {
    const token = await getToken();
    if (!token) return { fetchedAt: Date.now(), metrics: [], error: "no access token" };
    const info = await loadCodeAssist(token);
    const projectId = info.projectId || knownProject;
    const tier = info.tier;
    if (!projectId) return { fetchedAt: Date.now(), metrics: [], tier, error: info.error || "no project_id" };

    const [summary, models] = await Promise.all([
      postInternal("retrieveUserQuotaSummary", token, { project: projectId }, SHORT_USER_AGENT),
      fetchAvailableModels(token, projectId),
    ]);
    const metrics: QuotaMetric[] = [];
    if (summary.ok) {
      for (const group of summary.json?.groups || []) for (const bucket of group?.buckets || []) {
        if (typeof bucket?.remainingFraction !== "number") continue;
        metrics.push({ name: String(bucket.bucketId || group.groupId || bucket.displayName || "quota"), displayName: bucket.displayName || group.displayName, remainingPercent: pct(bucket.remainingFraction), resetTime: bucket.resetTime, source: "summary" });
      }
    }
    if (models.ok) {
      const all = models.json?.models || {};
      const tieredId = models.json?.tieredModelIds?.flash?.[0] || "gemini-3.8-flash-tiered";
      const gemini = all[tieredId]?.quotaInfo || all["gemini-3.8-flash-high"]?.quotaInfo;
      if (gemini) {
        // A missing remainingFraction means the window is used up.
        const remaining = pct(typeof gemini.remainingFraction === "number" ? gemini.remainingFraction : 0);
        const pro = tier === "g1-pro-tier" || tier === "g1-ultra-tier";
        metrics.push(pro
          ? { name: "gemini-5h", displayName: "Gemini 5-Hour Limit", remainingPercent: remaining, resetTime: gemini.resetTime, source: "models" }
          : { name: "gemini-weekly", displayName: "Gemini Weekly Limit", remainingPercent: remaining, resetTime: gemini.resetTime, source: "models" });
      }
    }
    const error = !summary.ok ? `retrieveUserQuotaSummary ${summary.status}: ${summary.message}` : !models.ok ? `fetchAvailableModels ${models.status}: ${models.message}` : undefined;
    const seen = new Set<string>();
    return { fetchedAt: Date.now(), projectId, tier, metrics: metrics.filter((m) => { const k = `${m.name}|${m.resetTime || ""}`; if (seen.has(k)) return false; seen.add(k); return true; }), error };
  }
}
