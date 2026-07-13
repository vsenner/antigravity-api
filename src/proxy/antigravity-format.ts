import crypto from "node:crypto";
import type { RawAuthFile } from "../accounts/types.js";
import { MODELS, resolveModel } from "./models.js";

export interface AntigravityPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  inlineData?: { mimeType?: string; mime_type?: string; data: string };
  functionCall?: { id?: string; name: string; args: any };
  functionResponse?: { id?: string; name: string; response: { result: any } };
}
export interface AntigravityContent { role: "user" | "model"; parts: AntigravityPart[] }

const THOUGHT_SIGNATURE = "skip_thought_signature_validator";
const audioMime: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac", aac: "audio/aac", webm: "audio/webm", pcm16: "audio/pcm", g711_ulaw: "audio/basic", g711_alaw: "audio/basic" };

function dataUrlPart(url: string): AntigravityPart | undefined {
  const match = /^data:([^;]+);base64,(.+)$/.exec(url);
  if (!match) return undefined;
  return { inlineData: { mimeType: match[1], data: match[2] }, thoughtSignature: THOUGHT_SIGNATURE };
}

function contentParts(content: unknown): AntigravityPart[] {
  if (typeof content === "string") return [{ text: content }];
  if (Array.isArray(content)) {
    const parts: AntigravityPart[] = [];
    for (const item of content) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, any>;
      if (obj.type === "text" && typeof obj.text === "string") parts.push({ text: obj.text });
      if (obj.type === "image_url" && typeof obj.image_url?.url === "string") { const p = dataUrlPart(obj.image_url.url); if (p) parts.push(p); }
      if (obj.type === "file" && typeof obj.file?.file_data === "string") parts.push({ inlineData: { mimeType: mimeFromFilename(obj.file.filename), data: obj.file.file_data } });
      if (obj.type === "input_audio" && typeof obj.input_audio?.data === "string") parts.push({ inlineData: { mime_type: audioMime[obj.input_audio.format] || `audio/${obj.input_audio.format || "wav"}`, data: obj.input_audio.data } });
      if ((obj.type === "video" || obj.type === "input_video") && typeof obj.video?.data === "string") parts.push({ inlineData: { mimeType: obj.video.mime_type || obj.video.mimeType || "video/mp4", data: obj.video.data } });
    }
    return parts.length ? parts : [{ text: JSON.stringify(content) }];
  }
  return [{ text: content == null ? "" : typeof content === "object" ? JSON.stringify(content) : String(content) }];
}

function mimeFromFilename(filename = "file.bin") {
  const ext = filename.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav", pdf: "application/pdf", txt: "text/plain", json: "application/json" };
  return map[ext || ""] || "application/octet-stream";
}

function stableSessionId(payload: any): string {
  const first = payload?.request?.contents?.find?.((c: any) => c.role === "user")?.parts?.[0]?.text || JSON.stringify(payload?.request?.contents || []);
  const hash = crypto.createHash("sha256").update(first).digest();
  const n = hash.readBigUInt64BE(0) & 0x7fffffffffffffffn;
  return `-${n.toString()}`;
}

function sanitizeName(name: string) { return (name || "tool").replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 63); }
function jsonOrString(raw: string) { try { return JSON.parse(raw); } catch { return raw; } }

export function usesClaudeStyle(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (id.includes("claude")) return true;
  if (id.startsWith("gemini-3") || id.startsWith("gemini-3.")) return true;
  return false;
}

export function openAIToAntigravity(input: any, projectId: string) {
  const model = String(input.model || "gemini-3-flash");
  const useClaude = usesClaudeStyle(model);
  const request: any = { contents: [] as AntigravityContent[] };
  const systemParts: AntigravityPart[] = [];
  const toolCallNames = new Map<string, string>();
  const toolResponses = new Map<string, any>();
  for (const m of input.messages ?? []) {
    if (m.role === "assistant" && Array.isArray(m.tool_calls)) for (const tc of m.tool_calls) if (tc.type === "function") toolCallNames.set(tc.id, sanitizeName(tc.function?.name));
    if (m.role === "tool" && m.tool_call_id) toolResponses.set(m.tool_call_id, jsonOrString(typeof m.content === "string" ? m.content : JSON.stringify(m.content)));
  }

  for (const message of input.messages ?? []) {
    const role = String(message.role || "user");
    if (role === "system" || role === "developer") {
      systemParts.push(...contentParts(message.content));
    } else if (role === "assistant") {
      const parts = contentParts(message.content).filter(p => p.text !== "");
      if (Array.isArray(message.tool_calls)) for (const tc of message.tool_calls) if (tc.type === "function") parts.push({ functionCall: { id: tc.id, name: sanitizeName(tc.function?.name), args: jsonOrString(tc.function?.arguments || "{}") }, thoughtSignature: THOUGHT_SIGNATURE });
      if (parts.length) request.contents.push({ role: "model", parts });
      const responses: AntigravityPart[] = [];
      if (Array.isArray(message.tool_calls)) for (const tc of message.tool_calls) if (toolResponses.has(tc.id)) responses.push({ functionResponse: { id: tc.id, name: toolCallNames.get(tc.id) || sanitizeName(tc.function?.name), response: { result: toolResponses.get(tc.id) } } });
      if (responses.length) request.contents.push({ role: "user", parts: responses });
    } else if (role === "tool") {
      continue;
    } else {
      request.contents.push({ role: "user", parts: contentParts(message.content) });
    }
  }

  if (systemParts.length) request.systemInstruction = { role: "user", parts: systemParts };
  const generationConfig: any = {};
  if (typeof input.temperature === "number") generationConfig.temperature = input.temperature;
  if (typeof input.top_p === "number") generationConfig.topP = input.top_p;
  if (typeof input.top_k === "number") generationConfig.topK = input.top_k;
  if (typeof input.max_tokens === "number") generationConfig.maxOutputTokens = input.max_tokens;
  if (Array.isArray(input.modalities)) generationConfig.responseModalities = input.modalities.map((m: string) => m.toUpperCase());
  if (input.image_config) generationConfig.imageConfig = { aspectRatio: input.image_config.aspect_ratio, imageSize: input.image_config.image_size };

  if (useClaude) {
    if (!generationConfig.responseModalities) generationConfig.responseModalities = ["TEXT"];
    if (typeof generationConfig.maxOutputTokens === "number" && generationConfig.maxOutputTokens < 256) generationConfig.maxOutputTokens = 256;
  }
  if (Object.keys(generationConfig).length) request.generationConfig = generationConfig;

  const tools = buildTools(input.tools);
  if (tools?.length) request.tools = tools;

  const requested = resolveModel(model);
  const payload: any = { project: projectId, request, model: requested.upstream, userAgent: "antigravity", requestType: model.includes("image") ? "image_gen" : "agent", requestId: model.includes("image") ? `image_gen/${Date.now()}/${crypto.randomUUID()}/12` : `agent-${crypto.randomUUID()}` };
  if (!model.includes("image")) payload.request.sessionId = stableSessionId(payload);
  return payload;
}

function buildTools(tools: any[] | undefined) {
  if (!Array.isArray(tools) || !tools.length) return undefined;
  const out: any[] = [];
  const functionDeclarations: any[] = [];
  for (const t of tools) {
    if (t.type === "function" && t.function) {
      const fn = { ...t.function, name: sanitizeName(t.function.name) };
      if (fn.parameters) { fn.parametersJsonSchema = fn.parameters; delete fn.parameters; }
      if (!fn.parametersJsonSchema) fn.parametersJsonSchema = { type: "object", properties: {} };
      delete fn.strict;
      functionDeclarations.push(fn);
    }
    if (t.google_search) out.push({ googleSearch: t.google_search });
    if (t.code_execution) out.push({ codeExecution: t.code_execution });
    if (t.url_context) out.push({ urlContext: t.url_context });
  }
  if (functionDeclarations.length) out.unshift({ functionDeclarations });
  return out;
}

function candidateText(candidate: any): string { return Array.isArray(candidate?.content?.parts) ? candidate.content.parts.map((p: any) => p?.text || "").join("") : ""; }
function candidateToolCalls(candidate: any) {
  const calls = (candidate?.content?.parts || []).filter((p: any) => p.functionCall).map((p: any, i: number) => ({ id: p.functionCall.id || `call_${i}`, type: "function", function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) } }));
  return calls.length ? calls : undefined;
}
export function extractUsage(data: any) { const u = data?.response?.usageMetadata || data?.usageMetadata || {}; return { promptTokens: Number(u.promptTokenCount || 0), completionTokens: Number(u.candidatesTokenCount || 0), totalTokens: Number(u.totalTokenCount || 0) }; }
export function antigravityToOpenAI(data: any, model: string) {
  const candidates = Array.isArray(data?.response?.candidates) ? data.response.candidates : Array.isArray(data?.candidates) ? data.candidates : [];
  const usage = extractUsage(data);
  return { id: `chatcmpl-${Date.now().toString(36)}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model, choices: candidates.length ? candidates.map((candidate: any, index: number) => ({ index, message: { role: "assistant", content: candidateText(candidate), tool_calls: candidateToolCalls(candidate) }, finish_reason: String(candidate?.finishReason || "stop").toLowerCase() })) : [{ index: 0, message: { role: "assistant", content: candidateText(data) }, finish_reason: "stop" }], usage: { prompt_tokens: usage.promptTokens, completion_tokens: usage.completionTokens, total_tokens: usage.totalTokens } };
}
export function antigravityChunkToOpenAI(data: any, model: string) {
  const candidates = Array.isArray(data?.response?.candidates) ? data.response.candidates : Array.isArray(data?.candidates) ? data.candidates : [];
  return candidates.map((candidate: any, index: number) => ({ id: `chatcmpl-${Date.now().toString(36)}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [{ index, delta: { content: candidateText(candidate), tool_calls: candidateToolCalls(candidate) }, finish_reason: candidate?.finishReason ? String(candidate.finishReason).toLowerCase() : null }] }));
}
export const getAccessToken = (auth: RawAuthFile) => String(auth.access_token || auth.accessToken || auth.api_key || auth.apiKey || "");
export const getRefreshToken = (auth: RawAuthFile) => String(auth.refresh_token || auth.refreshToken || "");
export const getProjectId = (auth: RawAuthFile) => String(auth.project_id || auth.projectId || auth.quota_project_id || "");
