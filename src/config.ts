/**
 * Everything the proxy reports about itself to Google lives here.
 *
 * Upstream gates model families on the client version in the User-Agent: a stale
 * version makes current models answer 404 "Requested entity was not found".
 * Keep ANTIGRAVITY_VERSION in step with a released Antigravity build, then
 * check GET /api/models/upstream?refresh=1 (management token) for the live catalogue.
 */
export const ANTIGRAVITY_VERSION = process.env.ANTIGRAVITY_VERSION || "2.32.0";
export const ANTIGRAVITY_PLATFORM = process.env.ANTIGRAVITY_PLATFORM || "darwin/arm64";

/** User-Agent sent on generate, quota and catalogue calls (the IDE's Node client). */
export const USER_AGENT = process.env.ANTIGRAVITY_USER_AGENT
  || `antigravity/${ANTIGRAVITY_VERSION} ${ANTIGRAVITY_PLATFORM} google-api-nodejs-client/10.3.0`;

/** Short form the IDE uses for retrieveUserQuotaSummary. */
export const SHORT_USER_AGENT = `antigravity/${ANTIGRAVITY_VERSION} ${ANTIGRAVITY_PLATFORM}`;

/** Metadata block loadCodeAssist expects from the IDE. */
export const IDE_METADATA = { ideName: "antigravity", ideType: "ANTIGRAVITY", ideVersion: ANTIGRAVITY_VERSION, platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" } as const;

/**
 * The daily endpoint answers first; the production one is a fallback for 404/5xx only
 * (it rate-limits these accounts with 429 even on trivial prompts, measured 16.11.2026).
 */
export const BASE_URLS = (process.env.ANTIGRAVITY_BASE_URLS || "https://daily-cloudcode-pa.googleapis.com,https://cloudcode-pa.googleapis.com")
  .split(",").map((u) => u.trim().replace(/\/$/, "")).filter(Boolean);

export const QUOTA_BASE_URL = process.env.ANTIGRAVITY_QUOTA_BASE_URL || BASE_URLS[0];

export const OAUTH_CLIENT_ID = process.env.ANTIGRAVITY_REFRESH_CLIENT_ID || "";
export const OAUTH_CLIENT_SECRET = process.env.ANTIGRAVITY_REFRESH_CLIENT_SECRET || "";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Longest cooldown a quota answer may put on one account+model. */
export const MAX_COOLDOWN_MS = Math.max(1_000, Number(process.env.MAX_COOLDOWN_MS || 0) || 6 * 60 * 60_000);
export const MAX_ACCOUNT_ATTEMPTS = Math.max(1, Number(process.env.MAX_ACCOUNT_ATTEMPTS || 12));
/** How long a fetched upstream model catalogue is reused. */
export const CATALOG_TTL_MS = Number(process.env.CATALOG_TTL_MS || 10 * 60_000);
