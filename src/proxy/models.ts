export interface ModelInfo {
  id: string;
  upstream: string;
  displayName: string;
  aliases: string[];
  style?: "claude" | "gemini";
}

/** Used when a request omits the model or names one we cannot resolve. */
export const DEFAULT_MODEL = "gemini-3.8-flash-high";

/**
 * Catalogue of models confirmed against the Antigravity upstream on 2026-11-01.
 */
export const MODELS: ModelInfo[] = [
  // Gemini 3.8 Family
  { id: "gemini-3.8-flash-high", upstream: "gemini-3.8-flash-high", displayName: "Gemini 3.8 Flash (High)", aliases: ["gemini-3.8-flash", "gemini-flash"], style: "gemini" },
  { id: "gemini-3.8-flash-medium", upstream: "gemini-3.8-flash-medium", displayName: "Gemini 3.8 Flash (Medium)", aliases: [], style: "gemini" },
  { id: "gemini-3.8-flash-low", upstream: "gemini-3.8-flash-low", displayName: "Gemini 3.8 Flash (Low)", aliases: [], style: "gemini" },
  { id: "gemini-3.8-flash-tiered", upstream: "gemini-3.8-flash-tiered", displayName: "Gemini 3.8 Flash (Tiered)", aliases: [], style: "gemini" },

  // Gemini 3.5 & 3.1 & 3 Flash
  { id: "gemini-3.5-flash-lite", upstream: "gemini-3.5-flash-lite", displayName: "Gemini 3.5 Flash Lite", aliases: ["gemini-3.5-flash"], style: "gemini" },
  { id: "gemini-3.1-flash-lite", upstream: "gemini-3.1-flash-lite", displayName: "Gemini 3.1 Flash Lite", aliases: [], style: "gemini" },
  { id: "gemini-3.1-flash-image", upstream: "gemini-3.1-flash-image", displayName: "Gemini 3.1 Flash Image", aliases: [], style: "gemini" },
  { id: "gemini-3-flash", upstream: "gemini-3-flash", displayName: "Gemini 3 Flash", aliases: ["gemini-3-flash-agent"], style: "gemini" },

  // Gemini Pro
  { id: "gemini-2.5-pro", upstream: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro", aliases: ["gemini-pro-agent", "gemini-pro"], style: "gemini" },

  // Legacy mappings that upstream resolves to 3.5 Flash Lite
  { id: "gemini-2.5-flash", upstream: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash", aliases: [], style: "gemini" },
  { id: "gemini-2.5-flash-lite", upstream: "gemini-2.5-flash-lite", displayName: "Gemini 2.5 Flash Lite", aliases: [], style: "gemini" },
  { id: "gemini-2.5-flash-thinking", upstream: "gemini-2.5-flash-thinking", displayName: "Gemini 2.5 Flash Thinking", aliases: [], style: "gemini" },

  // Claude 4.6 (Thinking)
  { id: "claude-opus-4-6-thinking", upstream: "claude-opus-4-6-thinking", displayName: "Claude Opus 4.6 (Thinking)", aliases: ["claude-opus-4-6", "claude-opus"], style: "claude" },
  { id: "claude-sonnet-4-6", upstream: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6 (Thinking)", aliases: ["claude-sonnet-4-6-thinking", "claude-sonnet"], style: "claude" },

  // Open-weights / GPT
  { id: "gpt-oss-120b-medium", upstream: "gpt-oss-120b-medium", displayName: "GPT-OSS 120B (Medium)", aliases: ["gpt-oss-120b"], style: "gemini" },
];

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

const ALIASES = new Map<string, ModelInfo>();
for (const m of MODELS) for (const v of [m.id, m.upstream]) ALIASES.set(norm(v), m);
for (const m of MODELS) for (const v of [m.displayName, ...m.aliases]) if (!ALIASES.has(norm(v))) ALIASES.set(norm(v), m);

export function resolveModel(input: string): ModelInfo {
  const key = norm(input || "");
  const hit = ALIASES.get(key) ?? (key ? undefined : ALIASES.get(norm(DEFAULT_MODEL)));
  return hit ?? { id: input, upstream: input, displayName: input, aliases: [], style: "gemini" };
}
