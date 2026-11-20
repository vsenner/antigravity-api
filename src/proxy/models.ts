export interface ModelInfo {
  /** Id callers send. */
  id: string;
  /** Id sent upstream. */
  upstream: string;
  displayName: string;
  aliases: string[];
  family: "gemini" | "claude" | "gpt";
  /** Not in fetchAvailableModels, but answers on accounts that carry the entitlement. */
  unlisted?: boolean;
}

export const DEFAULT_MODEL = "gemini-4-hydrogen-sonar";

/**
 * Models verified against the daily endpoint on 19.11.2026 with client 2.33.0.
 * The live catalogue from fetchAvailableModels is merged on top at runtime.
 */
export const MODELS: ModelInfo[] = [
  // Gemini 3.8 Flash
  { id: "gemini-3.8-flash-high", upstream: "gemini-3.8-flash-high", displayName: "Gemini 3.8 Flash (High)", aliases: ["gemini-3.8-flash", "gemini-flash"], family: "gemini" },
  { id: "gemini-3.8-flash-medium", upstream: "gemini-3.8-flash-medium", displayName: "Gemini 3.8 Flash (Medium)", aliases: [], family: "gemini" },
  { id: "gemini-3.8-flash-low", upstream: "gemini-3.8-flash-low", displayName: "Gemini 3.8 Flash (Low)", aliases: [], family: "gemini" },
  { id: "gemini-3.8-flash-tiered", upstream: "gemini-3.8-flash-tiered", displayName: "Gemini 3.8 Flash (Tiered)", aliases: [], family: "gemini" },
  // Gemini 3.x older
  { id: "gemini-3.5-flash-lite", upstream: "gemini-3.5-flash-lite", displayName: "Gemini 3.5 Flash Lite", aliases: ["gemini-flash-lite"], family: "gemini" },
  { id: "gemini-3.1-flash-lite", upstream: "gemini-3.1-flash-lite", displayName: "Gemini 3.1 Flash Lite", aliases: [], family: "gemini" },
  { id: "gemini-3-flash", upstream: "gemini-3-flash", displayName: "Gemini 3 Flash", aliases: [], family: "gemini" },
  { id: "gemini-3.1-flash-image", upstream: "gemini-3.1-flash-image", displayName: "Gemini 3.1 Flash Image", aliases: [], family: "gemini" },
  { id: "gemini-2.5-pro", upstream: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro", aliases: [], family: "gemini" },
  // Gemini 4 Carbon (requires verified account)
  { id: "gemini-4-carbon-high", upstream: "gemini-4-carbon-high", displayName: "Gemini 4 Carbon (High)", aliases: ["gemini-4-carbon", "gemini-carbon"], family: "gemini", unlisted: true },
  { id: "gemini-4-carbon-medium", upstream: "gemini-4-carbon-medium", displayName: "Gemini 4 Carbon (Medium)", aliases: [], family: "gemini", unlisted: true },
  { id: "gemini-4-carbon-low", upstream: "gemini-4-carbon-low", displayName: "Gemini 4 Carbon (Low)", aliases: [], family: "gemini", unlisted: true },
  // Gemini 4 Argon (requires verified account)
  { id: "gemini-4-argon-high", upstream: "gemini-4-argon-high", displayName: "Gemini 4 Argon (High)", aliases: ["gemini-4-argon", "gemini-argon"], family: "gemini", unlisted: true },
  { id: "gemini-4-argon-medium", upstream: "gemini-4-argon-medium", displayName: "Gemini 4 Argon (Medium)", aliases: [], family: "gemini", unlisted: true },
  { id: "gemini-4-argon-low", upstream: "gemini-4-argon-low", displayName: "Gemini 4 Argon (Low)", aliases: [], family: "gemini", unlisted: true },
  // Gemini 4 Hydrogen
  { id: "gemini-4-hydrogen-xhigh", upstream: "gemini-4-hydrogen-xhigh", displayName: "Gemini 4 Hydrogen (XHigh)", aliases: ["gemini-4-hydrogen", "gemini-hydrogen"], family: "gemini", unlisted: true },
  { id: "gemini-4-hydrogen-high", upstream: "gemini-4-hydrogen-high", displayName: "Gemini 4 Hydrogen (High)", aliases: [], family: "gemini", unlisted: true },
  { id: "gemini-4-hydrogen-medium", upstream: "gemini-4-hydrogen-medium", displayName: "Gemini 4 Hydrogen (Medium)", aliases: [], family: "gemini", unlisted: true },
  { id: "gemini-4-hydrogen-low", upstream: "gemini-4-hydrogen-low", displayName: "Gemini 4 Hydrogen (Low)", aliases: [], family: "gemini", unlisted: true },
  { id: "gemini-4-hydrogen-sonar", upstream: "gemini-4-hydrogen-sonar", displayName: "Gemini 4 Hydrogen (Sonar)", aliases: [], family: "gemini" },
  // GPT-OSS
  { id: "gpt-oss-120b-medium", upstream: "gpt-oss-120b-medium", displayName: "GPT-OSS 120B (Medium)", aliases: ["gpt-oss-120b"], family: "gpt" },
  // Claude 5.5
  { id: "claude-sonnet-5-5", upstream: "claude-sonnet-5-5-medium", displayName: "Claude Sonnet 5.5 (Thinking)", aliases: ["claude-sonnet-5-5-medium", "claude-sonnet"], family: "claude", unlisted: true },
  { id: "claude-opus-5-5", upstream: "claude-opus-5-5-medium", displayName: "Claude Opus 5.5 (Thinking)", aliases: ["claude-opus-5-5-medium", "claude-opus"], family: "claude", unlisted: true },
];

/** Upstream still lists these, but they only answer with a retirement notice. */
export const RETIRED_MODELS = new Map<string, string>([
  ["claude-sonnet-4-6", "claude-sonnet-5-5"],
  ["claude-sonnet-4-6-thinking", "claude-sonnet-5-5"],
  ["claude-opus-4-6-thinking", "claude-opus-5-5"],
  ["claude-opus-4-6", "claude-opus-5-5"],
]);

/** Upstream catalogue entries that are not chat models for agents. */
export function isAgentModel(id: string, info: { isInternal?: boolean } = {}): boolean {
  return !/^(chat_|tab_)/.test(id) && !info.isInternal;
}

/** Legacy upstream ids that the backend serves with another model (display name says so). */
export const HIDDEN_ALIASES = new Set(["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-flash-thinking"]);

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
const BY_KEY = new Map<string, ModelInfo>();
for (const m of MODELS) for (const v of [m.id, m.upstream]) BY_KEY.set(norm(v), m);
for (const m of MODELS) for (const v of [m.displayName, ...m.aliases]) if (!BY_KEY.has(norm(v))) BY_KEY.set(norm(v), m);

export function familyOf(id: string): ModelInfo["family"] {
  const lower = id.toLowerCase();
  if (lower.includes("claude")) return "claude";
  if (lower.startsWith("gpt")) return "gpt";
  return "gemini";
}

/**
 * Known id or alias → catalogue entry. Anything else passes through unchanged so the
 * caller gets upstream's own answer (404) instead of a silent swap to another model.
 */
export function resolveModel(input: string | undefined): ModelInfo {
  const requested = String(input || "").trim() || DEFAULT_MODEL;
  const hit = BY_KEY.get(norm(requested));
  if (hit) return hit;
  return { id: requested, upstream: requested, displayName: requested, aliases: [], family: familyOf(requested) };
}
