export interface ModelInfo {
  id: string;
  upstream: string;
  displayName: string;
  aliases: string[];
  style?: "claude" | "gemini";
}

/** Default primary fast model */
export const DEFAULT_MODEL = "gemini-3.8-flash-high";

/**
 * Curated active models catalogue for Antigravity API.
 * Obsolete, redundant, or deprecated models have been removed.
 */
export const MODELS: ModelInfo[] = [
  // Gemini 3.8 Family
  { id: "gemini-3.8-flash-high", upstream: "gemini-3.8-flash-high", displayName: "Gemini 3.8 Flash (High)", aliases: ["gemini-3.8-flash", "gemini-flash", "gemini-3-flash-agent"], style: "gemini" },
  { id: "gemini-3.8-flash-medium", upstream: "gemini-3.8-flash-medium", displayName: "Gemini 3.8 Flash (Medium)", aliases: [], style: "gemini" },
  { id: "gemini-3.8-flash-low", upstream: "gemini-3.8-flash-low", displayName: "Gemini 3.8 Flash (Low)", aliases: [], style: "gemini" },
  { id: "gemini-3.8-flash-tiered", upstream: "gemini-3.8-flash-tiered", displayName: "Gemini 3.8 Flash (Tiered)", aliases: [], style: "gemini" },

  // Multimodal Flash
  { id: "gemini-3.1-flash-image", upstream: "gemini-3.1-flash-image", displayName: "Gemini 3.1 Flash Image", aliases: [], style: "gemini" },

  // Claude 4.6 (Active Thinking Model)
  { id: "claude-sonnet-4-6", upstream: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6 (Thinking)", aliases: ["claude-sonnet-4-6-thinking", "claude-sonnet"], style: "claude" },

  // Frontier: Gemini 4 Argon (Ready for Google AI Ultra / Enterprise tier accounts)
  { id: "gemini-4-argon", upstream: "gemini-4-argon-medium", displayName: "Gemini 4 Argon (Medium)", aliases: ["gemini-4-argon-medium"], style: "gemini" },
  { id: "gemini-4-argon-high", upstream: "gemini-4-argon-high", displayName: "Gemini 4 Argon (High)", aliases: [], style: "gemini" },
  { id: "gemini-4-argon-low", upstream: "gemini-4-argon-low", displayName: "Gemini 4 Argon (Low)", aliases: [], style: "gemini" },

  // Frontier: Claude 5.5 Thinking (Ready for Enterprise / Paid Add-on accounts)
  { id: "claude-sonnet-5-5", upstream: "claude-sonnet-5-5-medium", displayName: "Claude Sonnet 5.5 (Thinking)", aliases: ["claude-sonnet-5-5-thinking"], style: "claude" },
  { id: "claude-opus-5-5", upstream: "claude-opus-5-5-medium", displayName: "Claude Opus 5.5 (Thinking)", aliases: ["claude-opus-5-5-thinking"], style: "claude" },
];

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

const ALIASES = new Map<string, ModelInfo>();
for (const m of MODELS) for (const v of [m.id, m.upstream]) ALIASES.set(norm(v), m);
for (const m of MODELS) for (const v of [m.displayName, ...m.aliases]) if (!ALIASES.has(norm(v))) ALIASES.set(norm(v), m);

// Transparent fallbacks for removed models so existing callers don't hard crash
const FALLBACKS: Record<string, string> = {
  "gemini35flashlite": "gemini-3.8-flash-high",
  "gemini31flashlite": "gemini-3.8-flash-high",
  "gemini3flash": "gemini-3.8-flash-high",
  "gemini25pro": "gemini-3.8-flash-high",
  "geminiproagent": "gemini-3.8-flash-high",
  "geminipro": "gemini-3.8-flash-high",
  "claudeopus46thinking": "claude-sonnet-4-6",
  "claudeopus": "claude-sonnet-4-6",
  "gptoss120bmedium": "gemini-3.8-flash-high",
};

export function resolveModel(input: string): ModelInfo {
  const key = norm(input || "");
  let hit = ALIASES.get(key);
  if (!hit && FALLBACKS[key]) {
    hit = ALIASES.get(norm(FALLBACKS[key]));
  }
  return hit ?? (key ? undefined : ALIASES.get(norm(DEFAULT_MODEL))) ?? {
    id: input,
    upstream: input,
    displayName: input,
    aliases: [],
    style: "gemini"
  };
}
