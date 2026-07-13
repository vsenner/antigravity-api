export interface ModelInfo { id: string; upstream: string; displayName: string; aliases: string[]; style?: "claude" | "gemini" }

export const MODELS: ModelInfo[] = [
  { id: "claude-opus-4-6-thinking", upstream: "claude-opus-4-6-thinking", displayName: "Claude Opus 4.6 (Thinking)", aliases: ["claude-opus-4-6", "claude-opus-4-5-thinking"], style: "claude" },
  { id: "claude-sonnet-4-6", upstream: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6 (Thinking)", aliases: ["claude-sonnet-4-6-thinking", "claude-sonnet-4-5", "claude-sonnet-4-5-thinking"], style: "claude" },
  { id: "gemini-2.5-flash", upstream: "gemini-2.5-flash", displayName: "Gemini 3.1 Flash Lite", aliases: ["gemini-2.5-flash-legacy"], style: "gemini" },
  { id: "gemini-2.5-flash-lite", upstream: "gemini-2.5-flash-lite", displayName: "Gemini 3.1 Flash Lite", aliases: [], style: "gemini" },
  { id: "gemini-2.5-flash-thinking", upstream: "gemini-2.5-flash-thinking", displayName: "Gemini 3.1 Flash Lite", aliases: [], style: "gemini" },
  { id: "gemini-2.5-pro", upstream: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro", aliases: [], style: "gemini" },
  { id: "gemini-3-flash", upstream: "gemini-3-flash", displayName: "Gemini 3 Flash", aliases: ["gemini-3-flash-lite"], style: "gemini" },
  { id: "gemini-3-flash-agent", upstream: "gemini-3-flash-agent", displayName: "Gemini 3.5 Flash (High)", aliases: [], style: "gemini" },
  { id: "gemini-3.1-flash-image", upstream: "gemini-3.1-flash-image", displayName: "Gemini 3.1 Flash Image", aliases: [], style: "gemini" },
  { id: "gemini-3.1-flash-lite", upstream: "gemini-3.1-flash-lite", displayName: "Gemini 3.1 Flash Lite", aliases: [], style: "gemini" },
  { id: "gemini-3.1-pro-high", upstream: "gemini-3.1-pro-high", displayName: "Gemini 3.1 Pro (High)", aliases: ["gemini-pro-agent"], style: "gemini" },
  { id: "gemini-3.1-pro-low", upstream: "gemini-3.1-pro-low", displayName: "Gemini 3.1 Pro (Low)", aliases: [], style: "gemini" },
  { id: "gemini-3.5-flash-extra-low", upstream: "gemini-3.5-flash-extra-low", displayName: "Gemini 3.5 Flash (Low)", aliases: [], style: "gemini" },
  { id: "gemini-3.5-flash-low", upstream: "gemini-3.5-flash-low", displayName: "Gemini 3.5 Flash (Medium)", aliases: ["gemini-3.5-flash"], style: "gemini" },
  { id: "gemini-pro-agent", upstream: "gemini-pro-agent", displayName: "Gemini 3.1 Pro (High)", aliases: [], style: "gemini" },
  { id: "gpt-oss-120b-medium", upstream: "gpt-oss-120b-medium", displayName: "GPT-OSS 120B (Medium)", aliases: [], style: "gemini" },
];

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
const ALIASES = new Map<string, ModelInfo>();
for (const m of MODELS) for (const v of [m.id, m.upstream, m.displayName, ...m.aliases]) ALIASES.set(norm(v), m);

export function resolveModel(input: string): ModelInfo {
  return ALIASES.get(norm(input)) ?? { id: input, upstream: input, displayName: input, aliases: [], style: "gemini" };
}
