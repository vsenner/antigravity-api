import type { Usage } from "../../accounts/store.js";

const FINISH: Record<string, string> = { STOP: "stop", MAX_TOKENS: "length", SAFETY: "content_filter", RECITATION: "content_filter", PROHIBITED_CONTENT: "content_filter", BLOCKLIST: "content_filter", SPII: "content_filter", MALFORMED_FUNCTION_CALL: "stop" };

function candidatesOf(data: any): any[] {
  if (Array.isArray(data?.response?.candidates)) return data.response.candidates;
  if (Array.isArray(data?.candidates)) return data.candidates;
  return [];
}

function partsOf(candidate: any): any[] {
  return Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
}

/** Visible answer text; `thought` parts are reasoning and go to reasoning_content instead. */
export function candidateText(candidate: any): string {
  return partsOf(candidate).filter((p) => !p?.thought).map((p) => p?.text || "").join("");
}

export function candidateReasoning(candidate: any): string {
  return partsOf(candidate).filter((p) => p?.thought).map((p) => p?.text || "").join("");
}

export function candidateImages(candidate: any): string[] {
  return partsOf(candidate).filter((p) => p?.inlineData?.data).map((p) => `data:${p.inlineData.mimeType || p.inlineData.mime_type || "image/png"};base64,${p.inlineData.data}`);
}

/** Stream state: unique tool-call ids across chunks, and whether any call was sent. */
export interface StreamState { n: number; calls: number; sawToolCall: boolean }
export const newStreamState = (): StreamState => ({ n: 0, calls: 0, sawToolCall: false });

function toolCalls(candidate: any, seq: StreamState = newStreamState(), withIndex = false) {
  const calls = partsOf(candidate).filter((p) => p?.functionCall).map((p) => {
    const call: any = { id: p.functionCall.id || `call_${seq.n++}`, type: "function", function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) } };
    if (withIndex) call.index = seq.calls++;
    return call;
  });
  if (calls.length) seq.sawToolCall = true;
  return calls.length ? calls : undefined;
}

function finishReason(candidate: any, hasToolCalls: boolean): string | null {
  if (!candidate?.finishReason) return null;
  if (hasToolCalls) return "tool_calls";
  return FINISH[String(candidate.finishReason).toUpperCase()] ?? "stop";
}

export function extractUsage(data: any): Usage {
  const u = data?.response?.usageMetadata || data?.usageMetadata || {};
  const promptTokens = Number(u.promptTokenCount || 0);
  const completionTokens = Number(u.candidatesTokenCount || 0) + Number(u.thoughtsTokenCount || 0);
  return { promptTokens, completionTokens, totalTokens: Number(u.totalTokenCount || 0) || promptTokens + completionTokens };
}

function openAIUsage(usage: Usage) {
  return { prompt_tokens: usage.promptTokens ?? 0, completion_tokens: usage.completionTokens ?? 0, total_tokens: usage.totalTokens ?? 0 };
}

const chunkId = () => `chatcmpl-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function antigravityToOpenAI(data: any, model: string) {
  const candidates = candidatesOf(data);
  const choices = (candidates.length ? candidates : [{}]).map((candidate: any, index: number) => {
    const calls = toolCalls(candidate);
    const message: any = { role: "assistant", content: candidateText(candidate) };
    const reasoning = candidateReasoning(candidate);
    if (reasoning) message.reasoning_content = reasoning;
    if (calls) message.tool_calls = calls;
    const images = candidateImages(candidate);
    if (images.length) message.images = images.map((url) => ({ type: "image_url", image_url: { url } }));
    return { index, message, finish_reason: finishReason(candidate, Boolean(calls)) ?? "stop" };
  });
  return { id: chunkId(), object: "chat.completion", created: Math.floor(Date.now() / 1000), model, choices, usage: openAIUsage(extractUsage(data)) };
}

/** One upstream SSE event → zero or more OpenAI chunks. */
export function antigravityChunkToOpenAI(data: any, model: string, seq: StreamState = newStreamState()) {
  const id = chunkId();
  return candidatesOf(data).map((candidate: any, index: number) => {
    const calls = toolCalls(candidate, seq, true);
    const delta: any = {};
    const text = candidateText(candidate);
    const reasoning = candidateReasoning(candidate);
    if (text) delta.content = text;
    if (reasoning) delta.reasoning_content = reasoning;
    if (calls) delta.tool_calls = calls;
    return { id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [{ index, delta, finish_reason: finishReason(candidate, seq.sawToolCall) }] };
  });
}

export function usageChunk(model: string, usage: Usage) {
  return { id: chunkId(), object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [], usage: openAIUsage(usage) };
}

export function firstText(data: any): string {
  return candidateText(candidatesOf(data)[0]);
}
