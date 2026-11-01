export interface ModelInfo { id: string; upstream: string; displayName: string; aliases: string[]; style?: "claude" | "gemini" }

/** Used when a request omits the model or names one we cannot resolve. */
export const DEFAULT_MODEL = "gemini-3-flash";

/**
 * Catalogue of models confirmed against the Antigravity upstream on 2026-09-07.
 *
 * Upstream hides newer families from clients that report an old version, so the
 * catalogue is only as current as ANTIGRAVITY_USER_AGENT in antigravity-client.ts.
 * Bump that version first, then re-probe before adding a family here.
 *
 * Retired ids stay reachable as aliases of their replacement so pinned configs
 * keep working instead of receiving an upstream "no longer available" notice.
 */
export const MODELS: ModelInfo[] = [
  { id: "gemini-3.8-flash-high", upstream: "gemini-3.8-flash-high", displayName: "Gemini 3.8 Flash (High)", aliases: ["gemini-3.8-flash"], style: "gemini" },
  { id: "gemini-3.8-flash-medium", upstream: "gemini-3.8-flash-medium", displayName: "Gemini 3.8 Flash (Medium)", aliases: [], style: "gemini" },
  { id: "gemini-3.8-flash-low", upstream: "gemini-3.8-flash-low", displayName: "Gemini 3.8 Flash (Low)", aliases: [], style: "gemini" },
  { id: "gemini-3.7-flash-high", upstream: "gemini-3.7-flash-high", displayName: "Gemini 3.7 Flash (High)", aliases: ["gemini-3.7-flash", "gemini-3.5-flash-high", "gemini-3-flash-agent"], style: "gemini" },
  { id: "gemini-3.7-flash-medium", upstream: "gemini-3.7-flash-medium", displayName: "Gemini 3.7 Flash (Medium)", aliases: ["gemini-3.5-flash", "gemini-3.5-flash-medium"], style: "gemini" },
  { id: "gemini-3.7-flash-low", upstream: "gemini-3.7-flash-low", displayName: "Gemini 3.7 Flash (Low)", aliases: ["gemini-3.5-flash-low", "gemini-3.5-flash-extra-low"], style: "gemini" },
  { id: "gemini-3.6-flash-high", upstream: "gemini-3.6-flash-high", displayName: "Gemini 3.6 Flash (High)", aliases: ["gemini-3.6-flash"], style: "gemini" },
  { id: "gemini-3.6-flash-medium", upstream: "gemini-3.6-flash-medium", displayName: "Gemini 3.6 Flash (Medium)", aliases: [], style: "gemini" },
  { id: "gemini-3.6-flash-low", upstream: "gemini-3.6-flash-low", displayName: "Gemini 3.6 Flash (Low)", aliases: [], style: "gemini" },
  { id: "gemini-3.1-pro-low", upstream: "gemini-3.1-pro-low", displayName: "Gemini 3.1 Pro (Low)", aliases: [], style: "gemini" },
  // Upstream rejects gemini-3.1-pro-high itself with 400 regardless of client
  // version, so the Pro (High) tier that answers is this one and the retired id
  // resolves here instead of failing.
  { id: "gemini-pro-agent", upstream: "gemini-pro-agent", displayName: "Gemini 3.1 Pro (High)", aliases: ["gemini-3.1-pro-high", "gemini-2.5-pro"], style: "gemini" },
  { id: "gemini-3.1-flash-image", upstream: "gemini-3.1-flash-image", displayName: "Gemini 3.1 Flash Image", aliases: [], style: "gemini" },
  { id: "gemini-3.5-flash-lite", upstream: "gemini-3.5-flash-lite", displayName: "Gemini 3.5 Flash Lite", aliases: [], style: "gemini" },
  { id: "gemini-3.1-flash-lite", upstream: "gemini-3.1-flash-lite", displayName: "Gemini 3.1 Flash Lite", aliases: ["gemini-2.5-flash-lite"], style: "gemini" },
  { id: "gemini-3-flash", upstream: "gemini-3-flash", displayName: "Gemini 3 Flash", aliases: ["gemini-2.5-flash", "gemini-2.5-flash-thinking"], style: "gemini" },
  { id: "claude-opus-4-6-thinking", upstream: "claude-opus-4-6-thinking", displayName: "Claude Opus 4.6 (Thinking)", aliases: ["claude-opus-4-6", "claude-opus-4-5-thinking"], style: "claude" },
  { id: "claude-sonnet-4-6", upstream: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6 (Thinking)", aliases: ["claude-sonnet-4-6-thinking", "claude-sonnet-4-5", "claude-sonnet-4-5-thinking"], style: "claude" },
  { id: "gpt-oss-120b-medium", upstream: "gpt-oss-120b-medium", displayName: "GPT-OSS 120B (Medium)", aliases: [], style: "gemini" },
];

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Canonical ids win over aliases, and the first claim on an alias wins, so a new
 * catalogue entry can never silently hijack a name another entry already owns.
 */
const ALIASES = new Map<string, ModelInfo>();
for (const m of MODELS) for (const v of [m.id, m.upstream]) ALIASES.set(norm(v), m);
for (const m of MODELS) for (const v of [m.displayName, ...m.aliases]) if (!ALIASES.has(norm(v))) ALIASES.set(norm(v), m);

export function resolveModel(input: string): ModelInfo {
  const key = norm(input || "");
  const hit = ALIASES.get(key) ?? (key ? undefined : ALIASES.get(norm(DEFAULT_MODEL)));
  return hit ?? { id: input, upstream: input, displayName: input, aliases: [], style: "gemini" };
}
