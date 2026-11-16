import { MAX_COOLDOWN_MS } from "../config.js";

/**
 * What an upstream failure means for routing.
 * - banned:    Google disabled Antigravity on this account (ToS). Never route to it again until re-enabled.
 * - auth:      token rejected; refresh once, then mark the account auth-failed.
 * - forbidden: other 403 (project, location); try another account.
 * - not_found: model not available for this account/client version; other accounts may have it.
 * - retired:   the model answers only with a "no longer available" notice.
 * - quota:     a 429 that names a quota or carries a retry delay; cool the account down for that long.
 * - rejected:  a bare 429 ("Resource has been exhausted (e.g. check quota).") with no quota details.
 *              Seen when Antigravity refuses the request itself (e.g. a third-party agent identity in the
 *              system prompt) while quota is available; retrying other accounts usually fails the same way.
 * - capacity:  503 "No capacity available"; the model is overloaded upstream.
 * - server:    other 5xx.
 * - bad_request: 400; the request is wrong the same way on every account.
 */
export type FailureKind = "banned" | "auth" | "forbidden" | "not_found" | "retired" | "quota" | "rejected" | "capacity" | "server" | "bad_request" | "unknown";

export interface UpstreamFailure {
  kind: FailureKind;
  status: number;
  message: string;
  /** Cooldown for this account+model, when the failure says how long. */
  cooldownMs?: number;
  /** Try the sibling base URL with the same account. */
  tryNextBase: boolean;
  /** Try another account. */
  tryNextAccount: boolean;
  body: unknown;
}

const BARE_429 = /^resource has been exhausted \(e\.g\. check quota\)\.?$/i;
const TOS_BAN = /violation of terms of service|disabled in this account/i;

/** Streaming endpoints wrap errors in a one-element array; unwrap to `{ error }`. */
export function errorPayload(body: unknown): { code?: number; message?: string; status?: string; details?: any[] } {
  const first = Array.isArray(body) ? body[0] : body;
  const error = (first as any)?.error;
  return error && typeof error === "object" ? error : {};
}

export function classifyUpstreamError(status: number, body: unknown): UpstreamFailure {
  const error = errorPayload(body);
  const message = String(error.message || (body as any)?.text || `HTTP ${status}`).trim();
  const base = { status, message, body };

  if (status === 401) return { ...base, kind: "auth", tryNextBase: false, tryNextAccount: true };
  if (status === 403 && TOS_BAN.test(message)) return { ...base, kind: "banned", tryNextBase: false, tryNextAccount: true };
  if (status === 403) return { ...base, kind: "forbidden", cooldownMs: 10 * 60_000, tryNextBase: false, tryNextAccount: true };
  if (status === 404) return { ...base, kind: "not_found", cooldownMs: 60 * 60_000, tryNextBase: true, tryNextAccount: true };
  if (status === 400) return { ...base, kind: "bad_request", tryNextBase: false, tryNextAccount: false };
  if (status === 429) {
    const cooldownMs = retryDelayMs(error.details) ?? resetsInMs(message);
    if (cooldownMs !== undefined) return { ...base, kind: "quota", cooldownMs: Math.min(cooldownMs, MAX_COOLDOWN_MS), tryNextBase: false, tryNextAccount: true };
    if (BARE_429.test(message)) return { ...base, kind: "rejected", cooldownMs: 15_000, tryNextBase: false, tryNextAccount: true };
    const quotaWords = /quota/i.test(message) && !BARE_429.test(message);
    return { ...base, kind: "quota", cooldownMs: quotaWords ? Math.min(60 * 60_000, MAX_COOLDOWN_MS) : 60_000, tryNextBase: false, tryNextAccount: true };
  }
  if (status === 503 && /no capacity available/i.test(message)) return { ...base, kind: "capacity", cooldownMs: 5_000, tryNextBase: true, tryNextAccount: true };
  if (status >= 500) return { ...base, kind: "server", cooldownMs: 5_000, tryNextBase: true, tryNextAccount: true };
  return { ...base, kind: "unknown", tryNextBase: false, tryNextAccount: false };
}

/** google.rpc.RetryInfo `retryDelay: "12.5s"`. */
function retryDelayMs(details: unknown): number | undefined {
  if (!Array.isArray(details)) return undefined;
  for (const detail of details) {
    const raw = detail?.retryDelay;
    if (typeof raw !== "string") continue;
    const seconds = Number(raw.replace(/s$/, ""));
    if (Number.isFinite(seconds)) return Math.max(1_000, seconds * 1000);
  }
  return undefined;
}

/** "Individual quota reached. … Resets in 74h35m53s." */
export function resetsInMs(message: string): number | undefined {
  const match = /resets in\s+((?:\d+\s*[dhms]\s*)+)/i.exec(message);
  if (!match) return undefined;
  const units: Record<string, number> = { d: 86_400_000, h: 3_600_000, m: 60_000, s: 1_000 };
  let total = 0;
  for (const [, n, unit] of match[1].matchAll(/(\d+)\s*([dhms])/gi)) total += Number(n) * units[unit.toLowerCase()];
  return total > 0 ? total : undefined;
}

/**
 * A retired model answers with HTTP 200 whose whole content is a short lifecycle notice
 * ("Claude Sonnet 4.6 is no longer available. Please switch to Claude Sonnet 5.5.").
 * Requiring both markers within a short body keeps genuine answers about model
 * availability from tripping this.
 */
export function deprecationNotice(content: unknown): string | undefined {
  const text = typeof content === "string" ? content.trim() : "";
  if (!text || text.length > 240) return undefined;
  if (!/\bis no longer available\b/i.test(text)) return undefined;
  if (!/\b(please switch to|latest version of antigravity)\b/i.test(text)) return undefined;
  return text;
}
