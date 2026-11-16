import type { AccountStore } from "../accounts/store.js";
import type { TokenManager } from "../accounts/tokens.js";
import type { AntigravityQuotaClient, AccountQuotaStatus } from "../proxy/quota-client.js";
import { MODELS, RETIRED_MODELS } from "../proxy/models.js";

const PAID_TIERS = new Set(["g1-pro-tier", "g1-ultra-tier"]);

/** Accounts with live quota windows, run stats and the model list, for the dashboard. */
export async function accountsStatus(store: AccountStore, tokens: TokenManager, quotaClient: AntigravityQuotaClient) {
  const accounts = await store.listPublicAccounts();
  const enriched = await Promise.all(accounts.map(async (account) => {
    const quota: AccountQuotaStatus = await quotaClient.getStatus(account.id, () => tokens.get(account.id), account.projectId);
    return { ...account, quota };
  }));
  const stats = await summaryFromAccounts(enriched);
  return { accounts: enriched, stats, models: MODELS.map(m => ({ id: m.id, displayName: m.displayName, aliases: m.aliases })) };
}

/* Dashboard overview: pool capacity, refill schedule and per-account windows (shape consumed by src/web). */
export function formatOverview(status: { accounts: any[]; stats: any; models: any[] }) {
  const accounts = status.accounts || [];
  const now = Date.now();

  const accountOverviews = accounts.map(a => {
    const metrics: any[] = a.quota?.metrics || [];
    const getMetric = (pattern: RegExp) => metrics.find(m => pattern.test(m.name || ""));
    const gemini5h = getMetric(/^gemini-5h$/i);
    const geminiWeekly = getMetric(/^gemini-weekly$/i);
    const claude5h = getMetric(/^3p-5h$/i) || getMetric(/(3p-5h|claude.*5h)/i);
    const claudeWeekly = getMetric(/^3p-weekly$/i) || getMetric(/(3p-weekly|claude.*week)/i);

    const isPro = PAID_TIERS.has(a.quota?.tier) || PAID_TIERS.has(a.tier);

    // Effective Gemini Available Quota:
    // Pro has rolling 5h window (falls back to weekly if 5h not present, but Pro has 5h).
    // Free has NO 5h window — its available executable quota is its weekly quota.
    const effectiveGemini = isPro
      ? (gemini5h ? gemini5h.remainingPercent : (geminiWeekly ? geminiWeekly.remainingPercent : 100))
      : (geminiWeekly ? geminiWeekly.remainingPercent : 0);

    const effectiveClaude = isPro
      ? (claude5h ? claude5h.remainingPercent : (claudeWeekly ? claudeWeekly.remainingPercent : 100))
      : (claudeWeekly ? claudeWeekly.remainingPercent : 0);

    // Find nearest reset for metrics that are depleted (< 98%)
    const expiringMetrics = metrics.filter(m => typeof m.remainingPercent === "number" && m.remainingPercent < 98 && m.resetTime);
    let nextReset: { metric: string; displayName?: string; resetTime: string; secondsLeft: number; percentAdded: number } | null = null;
    if (expiringMetrics.length > 0) {
      expiringMetrics.sort((x, y) => new Date(x.resetTime).getTime() - new Date(y.resetTime).getTime());
      const first = expiringMetrics[0];
      const diffSec = Math.max(0, Math.round((new Date(first.resetTime).getTime() - now) / 1000));
      const percentAdded = Math.round((100 - (first.remainingPercent ?? 0)) * 10) / 10;
      nextReset = {
        metric: first.name,
        displayName: first.displayName,
        resetTime: first.resetTime,
        secondsLeft: diffSec,
        percentAdded
      };
    }

    return {
      id: a.id,
      email: a.email,
      healthy: a.healthy && !a.banned,
      enabled: a.enabled,
      banned: Boolean(a.banned),
      banReason: a.banned?.message,
      bannedAt: a.banned?.at,
      hasAuthError: Boolean(a.quota?.error && /401|auth/i.test(a.quota.error)),
      quotaError: a.quota?.error,
      tier: a.quota?.tier || (isPro ? "g1-pro-tier" : "free-tier"),
      isPro,
      effectiveGeminiPercent: Math.round(effectiveGemini * 10) / 10,
      effectiveClaudePercent: Math.round(effectiveClaude * 10) / 10,
      gemini: {
        fiveHourPercent: gemini5h ? gemini5h.remainingPercent : null,
        fiveHourReset: gemini5h?.resetTime || null,
        weeklyPercent: geminiWeekly ? geminiWeekly.remainingPercent : null,
        weeklyReset: geminiWeekly?.resetTime || null,
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
  const proAccounts = healthyAccounts.filter(a => a.isPro);
  const freeAccounts = healthyAccounts.filter(a => !a.isPro);

  // Pro accounts can sustain ongoing work every 5 hours (33.6 rolling windows per week = 33.6x throughput)
  // Free accounts have only one weekly bucket (1x per week, 0 when exhausted).
  // Realistic capacity weights: Pro weight = 33.6 (or conservative 30), Free weight = 1.
  const PRO_WEIGHT = 33.6;
  const FREE_WEIGHT = 1.0;

  const totalPossibleGemini = (proAccounts.length * PRO_WEIGHT * 100) + (freeAccounts.length * FREE_WEIGHT * 100);
  const currentGeminiCapacity = proAccounts.reduce((sum, a) => sum + (a.effectiveGeminiPercent * PRO_WEIGHT), 0)
    + freeAccounts.reduce((sum, a) => sum + (a.effectiveGeminiPercent * FREE_WEIGHT), 0);
  const geminiPoolCapacityPercent = totalPossibleGemini > 0 ? (currentGeminiCapacity / totalPossibleGemini) * 100 : 0;

  const totalPossibleClaude = (proAccounts.length * PRO_WEIGHT * 100) + (freeAccounts.length * FREE_WEIGHT * 100);
  const currentClaudeCapacity = proAccounts.reduce((sum, a) => sum + (a.effectiveClaudePercent * PRO_WEIGHT), 0)
    + freeAccounts.reduce((sum, a) => sum + (a.effectiveClaudePercent * FREE_WEIGHT), 0);
  const claudePoolCapacityPercent = totalPossibleClaude > 0 ? (currentClaudeCapacity / totalPossibleClaude) * 100 : 0;

  const geminiProAvg = proAccounts.length > 0 ? proAccounts.reduce((sum, a) => sum + a.effectiveGeminiPercent, 0) / proAccounts.length : 0;
  const geminiFreeAvg = freeAccounts.length > 0 ? freeAccounts.reduce((sum, a) => sum + a.effectiveGeminiPercent, 0) / freeAccounts.length : 0;

  // Deduplicate upcoming resets: only distinct accounts and their specific window
  const seenSchedules = new Set<string>();
  const scheduleList: any[] = [];
  for (const a of accountOverviews) {
    const metrics: any[] = (status.accounts.find(orig => orig.id === a.id)?.quota?.metrics || [])
      .filter((m: any) => typeof m.remainingPercent === "number" && m.remainingPercent < 98 && m.resetTime);

    for (const m of metrics) {
      const key = `${a.id}:${m.name}`;
      if (seenSchedules.has(key)) continue;
      seenSchedules.add(key);

      const msLeft = new Date(m.resetTime).getTime() - now;
      if (msLeft <= 0) continue;

      const windowName = m.name === "gemini-5h" ? "Gemini 5h Window"
        : m.name === "gemini-weekly" ? "Gemini Weekly Cap"
        : m.name === "3p-5h" ? "Claude 5h Window"
        : m.name === "3p-weekly" ? "Claude Weekly Cap"
        : (m.displayName || m.name);

      // Boost calculation: what % does this refill add to the whole pool?
      const acctWeight = a.isPro ? PRO_WEIGHT : FREE_WEIGHT;
      const pctRecovered = 100 - m.remainingPercent;
      const boostToPool = totalPossibleGemini > 0 ? (pctRecovered * acctWeight / totalPossibleGemini) * 100 : 0;

      scheduleList.push({
        accountId: a.id,
        email: a.email,
        window: windowName,
        metric: m.name,
        remainingPercent: m.remainingPercent,
        resetTime: m.resetTime,
        secondsLeft: Math.round(msLeft / 1000),
        boostToPool: Math.round(boostToPool * 10) / 10,
        isPro: a.isPro
      });
    }
  }

  scheduleList.sort((x, y) => x.secondsLeft - y.secondsLeft);

  // Target 95% Refill ETA:
  // When will cumulative refills bring the pool capacity to >= 95%?
  let target95Eta: string | null = null;
  let target95SecondsLeft: number | null = null;
  if (geminiPoolCapacityPercent >= 95) {
    target95Eta = "Already at 95%+";
    target95SecondsLeft = 0;
  } else {
    let accumulatedCapacity = currentGeminiCapacity;
    const targetCapacity = totalPossibleGemini * 0.95;
    for (const sched of scheduleList) {
      if (sched.metric.includes("gemini")) {
        const addedCap = (100 - sched.remainingPercent) * (sched.isPro ? PRO_WEIGHT : FREE_WEIGHT);
        accumulatedCapacity += addedCap;
        if (accumulatedCapacity >= targetCapacity) {
          target95SecondsLeft = sched.secondsLeft;
          target95Eta = formatTimeLeftSec(sched.secondsLeft);
          break;
        }
      }
    }
    if (!target95Eta && scheduleList.length > 0) {
      const nearest = scheduleList[0];
      target95SecondsLeft = nearest.secondsLeft;
      target95Eta = `~${formatTimeLeftSec(nearest.secondsLeft)} (Next refill)`;
    }
  }

  return {
    timestamp: new Date(now).toISOString(),
    summary: {
      totalAccounts: accounts.length,
      healthyAccounts: healthyAccounts.length,
      bannedAccounts: accountOverviews.filter(a => a.banned).length,
      proCount: proAccounts.length,
      freeCount: freeAccounts.length,
      geminiPoolCapacityPercent: Math.round(geminiPoolCapacityPercent * 10) / 10,
      claudePoolCapacityPercent: Math.round(claudePoolCapacityPercent * 10) / 10,
      geminiProAvgPercent: Math.round(geminiProAvg * 10) / 10,
      geminiFreeAvgPercent: Math.round(geminiFreeAvg * 10) / 10,
      target95Eta: target95Eta || "N/A",
      target95SecondsLeft,
      nearestRefill: scheduleList[0] || null,
      upcomingRefills: scheduleList.slice(0, 8),
    },
    accounts: accountOverviews,
  };
}

function formatTimeLeftSec(sec: number) {
  if (sec <= 0) return "now";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return d ? `${d}d ${rh}h` : `${h}h ${m}m`;
}

export async function summaryFromAccounts(accounts: any[]) {
  const modelMap = new Map<string, any>();
  for (const account of accounts) for (const stat of Object.values<any>(account.modelStats || {})) {
    if (RETIRED_MODELS.has(stat.model)) continue;
    const cur = modelMap.get(stat.model) ?? { model: stat.model, requests: 0, successes: 0, errors: 0, totalTokens: 0, promptTokens: 0, completionTokens: 0 };
    cur.requests += stat.requests; cur.successes += stat.successes; cur.errors += stat.errors; cur.totalTokens += stat.totalTokens; cur.promptTokens += stat.promptTokens; cur.completionTokens += stat.completionTokens;
    modelMap.set(stat.model, cur);
  }
  const avgUsagePercent = accounts.filter(a => a.usagePercent != null).reduce((s, a) => s + (a.usagePercent ?? 0), 0) / Math.max(1, accounts.filter(a => a.usagePercent != null).length);
  return { accountsTotal: accounts.length, accountsEnabled: accounts.filter(a => a.enabled).length, accountsHealthy: accounts.filter(a => a.healthy && !a.banned).length, accountsBanned: accounts.filter(a => a.banned).length, avgUsagePercent, requestsTotal: accounts.reduce((s, a) => s + a.requestCount, 0), successesTotal: accounts.reduce((s, a) => s + a.successCount, 0), errorsTotal: accounts.reduce((s, a) => s + a.errorCount, 0), tokensTotal: accounts.reduce((s, a) => s + a.totalTokens, 0), models: [...modelMap.values()] };
}

export async function summary(store: AccountStore) {
  return summaryFromAccounts(await store.listPublicAccounts());
}

