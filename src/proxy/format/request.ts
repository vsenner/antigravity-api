import crypto from "node:crypto";
import { familyOf } from "../models.js";

export interface AntigravityPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  inlineData?: { mimeType?: string; mime_type?: string; data: string };
  functionCall?: { id?: string; name: string; args: any };
  functionResponse?: { id?: string; name: string; response: { result: any } };
}
export interface AntigravityContent { role: "user" | "model"; parts: AntigravityPart[] }

/** Lets replayed function calls through without the original thought signature. */
const THOUGHT_SIGNATURE = "skip_thought_signature_validator";
const AUDIO_MIME: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac", aac: "audio/aac", webm: "audio/webm", pcm16: "audio/pcm", g711_ulaw: "audio/basic", g711_alaw: "audio/basic" };
const FILE_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav", pdf: "application/pdf", txt: "text/plain", json: "application/json" };

function dataUrlPart(url: string): AntigravityPart | undefined {
  const match = /^data:([^;]+);base64,(.+)$/.exec(url);
  return match ? { inlineData: { mimeType: match[1], data: match[2] }, thoughtSignature: THOUGHT_SIGNATURE } : undefined;
}

function videoDataUrlPart(url: string): AntigravityPart | undefined {
  const part = dataUrlPart(url);
  if (part?.inlineData && !(part.inlineData.mimeType || "").toLowerCase().startsWith("video/")) part.inlineData.mimeType = "video/mp4";
  return part;
}

function mimeFromFilename(filename = "file.bin") {
  return FILE_MIME[filename.split(".").pop()?.toLowerCase() || ""] || "application/octet-stream";
}

function contentPart(item: Record<string, any>): AntigravityPart | undefined {
  switch (item.type) {
    case "text": return typeof item.text === "string" ? { text: item.text } : undefined;
    case "image_url": return typeof item.image_url?.url === "string" ? dataUrlPart(item.image_url.url) : undefined;
    case "video_url": return typeof item.video_url?.url === "string" ? videoDataUrlPart(item.video_url.url) : undefined;
    case "file": return typeof item.file?.file_data === "string" ? { inlineData: { mimeType: mimeFromFilename(item.file.filename), data: item.file.file_data } } : undefined;
    case "input_audio": return typeof item.input_audio?.data === "string" ? { inlineData: { mime_type: AUDIO_MIME[item.input_audio.format] || `audio/${item.input_audio.format || "wav"}`, data: item.input_audio.data } } : undefined;
    case "video":
    case "input_video": return typeof item.video?.data === "string" ? { inlineData: { mimeType: item.video.mime_type || item.video.mimeType || "video/mp4", data: item.video.data } } : undefined;
    default: return undefined;
  }
}

function contentParts(content: unknown): AntigravityPart[] {
  if (typeof content === "string") return [{ text: content }];
  if (Array.isArray(content)) {
    const parts = content.filter((i) => i && typeof i === "object").map((i) => contentPart(i)).filter((p): p is AntigravityPart => Boolean(p));
    return parts.length ? parts : [{ text: JSON.stringify(content) }];
  }
  return [{ text: content == null ? "" : typeof content === "object" ? JSON.stringify(content) : String(content) }];
}

function stableSessionId(contents: AntigravityContent[]): string {
  const first = contents.find((c) => c.role === "user")?.parts?.[0]?.text || JSON.stringify(contents);
  const n = crypto.createHash("sha256").update(first).digest().readBigUInt64BE(0) & 0x7fffffffffffffffn;
  return `-${n.toString()}`;
}

const BLOCKED_PHRASES = [
  /You run on Hermes Agent \(by Nous Research\)\.\s*/gi,
  /https?:\/\/hermes-agent\.nousresearch\.com\S*/gi,
  /\bHermes Agent\b/gi,
];
function stripBlockedPhrases(parts: AntigravityPart[]): AntigravityPart[] {
  return parts.map((p) => {
    if (typeof p.text !== "string") return p;
    let t = p.text;
    for (const re of BLOCKED_PHRASES) t = t.replace(re, "");
    return t === p.text ? p : { ...p, text: t };
  }).filter((p) => p.text !== "");
}

const sanitizeName = (name: string) => (name || "tool").replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 63);
function jsonOrString(raw: string) { try { return JSON.parse(raw); } catch { return raw; } }

/** Tool results that look like JSON Schema ($ref) confuse the backend; send them as text. */
function looksLikeJsonSchema(node: any): boolean {
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some(looksLikeJsonSchema);
  return Object.entries(node).some(([k, v]) => (k === "$ref" && typeof v === "string" && v.startsWith("#/")) || looksLikeJsonSchema(v));
}
const sanitizeToolResult = (val: any) => looksLikeJsonSchema(val) ? { output: typeof val === "string" ? val : JSON.stringify(val) } : val;

function buildContents(messages: any[]) {
  const contents: AntigravityContent[] = [];
  const systemParts: AntigravityPart[] = [];
  const toolNames = new Map<string, string>();
  const toolResults = new Map<string, any>();
  for (const m of messages) {
    if (m.role === "assistant" && Array.isArray(m.tool_calls)) for (const tc of m.tool_calls) if (tc.type === "function") toolNames.set(tc.id, sanitizeName(tc.function?.name));
    if (m.role === "tool" && m.tool_call_id) toolResults.set(m.tool_call_id, jsonOrString(typeof m.content === "string" ? m.content : JSON.stringify(m.content)));
  }
  for (const message of messages) {
    const role = String(message.role || "user");
    if (role === "system" || role === "developer") { systemParts.push(...contentParts(message.content)); continue; }
    if (role === "tool") continue; // folded in right after the assistant turn that called it
    if (role !== "assistant") { contents.push({ role: "user", parts: contentParts(message.content) }); continue; }
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls.filter((tc: any) => tc.type === "function") : [];
    const parts = message.content == null ? [] : contentParts(message.content).filter((p) => p.text !== "");
    for (const tc of calls) parts.push({ functionCall: { id: tc.id, name: sanitizeName(tc.function?.name), args: jsonOrString(tc.function?.arguments || "{}") }, thoughtSignature: THOUGHT_SIGNATURE });
    if (parts.length) contents.push({ role: "model", parts });
    const responses = calls.filter((tc: any) => toolResults.has(tc.id))
      .map((tc: any) => ({ functionResponse: { id: tc.id, name: toolNames.get(tc.id) || sanitizeName(tc.function?.name), response: { result: sanitizeToolResult(toolResults.get(tc.id)) } } }));
    if (responses.length) contents.push({ role: "user", parts: responses });
  }
  return { contents, systemParts };
}

function buildTools(tools: any[] | undefined) {
  if (!Array.isArray(tools) || !tools.length) return undefined;
  const out: any[] = [];
  const functionDeclarations: any[] = [];
  for (const t of tools) {
    if (t.type === "function" && t.function) {
      const { parameters, strict: _strict, ...fn } = t.function;
      functionDeclarations.push({ ...fn, name: sanitizeName(fn.name), parametersJsonSchema: parameters || { type: "object", properties: {} } });
    }
    if (t.google_search) out.push({ googleSearch: t.google_search });
    if (t.code_execution) out.push({ codeExecution: t.code_execution });
    if (t.url_context) out.push({ urlContext: t.url_context });
  }
  if (functionDeclarations.length) out.unshift({ functionDeclarations });
  return out;
}

function buildToolConfig(choice: unknown) {
  if (choice === "none") return { functionCallingConfig: { mode: "NONE" } };
  if (choice === "required") return { functionCallingConfig: { mode: "ANY" } };
  const name = (choice as any)?.function?.name;
  if (name) return { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [sanitizeName(name)] } };
  return undefined;
}

function buildGenerationConfig(input: any, upstreamModel: string) {
  const config: any = {};
  if (typeof input.temperature === "number") config.temperature = input.temperature;
  if (typeof input.top_p === "number") config.topP = input.top_p;
  if (typeof input.top_k === "number") config.topK = input.top_k;
  const maxTokens = input.max_completion_tokens ?? input.max_tokens;
  if (typeof maxTokens === "number") config.maxOutputTokens = maxTokens;
  if (Array.isArray(input.stop) && input.stop.length) config.stopSequences = input.stop;
  else if (typeof input.stop === "string") config.stopSequences = [input.stop];
  if (Array.isArray(input.modalities)) config.responseModalities = input.modalities.map((m: string) => m.toUpperCase());
  if (input.image_config) config.imageConfig = { aspectRatio: input.image_config.aspect_ratio, imageSize: input.image_config.image_size };
  // The IDE pins text output for Claude and Gemini 3.x agent models; Claude also rejects tiny output budgets.
  if (!upstreamModel.includes("image") && (familyOf(upstreamModel) === "claude" || upstreamModel.startsWith("gemini-3"))) {
    config.responseModalities ??= ["TEXT"];
    if (familyOf(upstreamModel) === "claude" && typeof config.maxOutputTokens === "number" && config.maxOutputTokens < 256) config.maxOutputTokens = 256;
  }
  return Object.keys(config).length ? config : undefined;
}

/** OpenAI chat-completions body → Antigravity v1internal generateContent payload. */
export function openAIToAntigravity(input: any, upstreamModel: string, projectId: string) {
  const { contents, systemParts } = buildContents(input.messages ?? []);
  const request: any = { contents };
  const cleanSystem = stripBlockedPhrases(systemParts);
  if (cleanSystem.length) request.systemInstruction = { role: "user", parts: cleanSystem };
  const generationConfig = buildGenerationConfig(input, upstreamModel);
  if (generationConfig) request.generationConfig = generationConfig;
  const tools = buildTools(input.tools);
  if (tools?.length) request.tools = tools;
  const toolConfig = tools?.length ? buildToolConfig(input.tool_choice) : undefined;
  if (toolConfig) request.toolConfig = toolConfig;

  const isImage = upstreamModel.includes("image");
  if (!isImage) request.sessionId = stableSessionId(contents);
  return {
    project: projectId,
    request,
    model: upstreamModel,
    userAgent: "antigravity",
    requestType: isImage ? "image_gen" : "agent",
    requestId: isImage ? `image_gen/${Date.now()}/${crypto.randomUUID()}/12` : `agent-${crypto.randomUUID()}`,
  };
}
