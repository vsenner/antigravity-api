import type { RawAuthFile } from "../accounts/types.js";
import { antigravityChunkToOpenAI, antigravityToOpenAI, extractUsage, getAccessToken, getProjectId, openAIToAntigravity, usesClaudeStyle } from "./antigravity-format.js";
import { MODELS, resolveModel } from "./models.js";

export interface ProxyResult {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  retryable?: boolean;
  retryBaseUrl?: boolean;
  cooldownMs?: number;
  reason?: string;
}

export interface StreamProxyResult {
  status: number;
  headers: Record<string, string>;
  body?: unknown;
  stream?: ReadableStream<Uint8Array>;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  retryable?: boolean;
  retryBaseUrl?: boolean;
  cooldownMs?: number;
  reason?: string;
}

const BASE_URLS = (process.env.ANTIGRAVITY_BASE_URLS || "https://daily-cloudcode-pa.googleapis.com,https://cloudcode-pa.googleapis.com")
  .split(",").map((u) => u.trim().replace(/\/$/, "")).filter(Boolean);

const SHORT_UA = process.env.ANTIGRAVITY_USER_AGENT || "antigravity/2.0.0 darwin/arm64";
const LONG_UA = process.env.ANTIGRAVITY_LOAD_USER_AGENT || `${SHORT_UA} google-api-nodejs-client/10.3.0`;

export class AntigravityClient {
  async listModels() {
    return { object: "list" as const, data: MODELS.map((m) => ({ id: m.id, object: "model" as const, owned_by: "antigravity", display_name: m.displayName, upstream: m.upstream, aliases: m.aliases, style: usesClaudeStyle(m.id) ? "claude" : "gemini" })) };
  }

  async chatCompletions(body: any, auth: RawAuthFile): Promise<ProxyResult> {
    const token = getAccessToken(auth);
    if (!token) throw new Error("Selected account has no access token/api key");
    const requested = resolveModel(String(body.model || "gemini-3-flash"));
    const model = requested.id;
    const projectId = getProjectId(auth) || "total-particle-kcz5z";

    const payload = openAIToAntigravity({ ...body, model: requested.upstream }, projectId);
    for (const base of BASE_URLS) {
      const response = await fetch(`${base}/v1internal:generateContent`, this.requestInit(token, payload, requested.id));
      const text = await response.text();
      const parsed = parseJson(text);
      if (!response.ok) {
        const cls = classifyUpstreamError(response.status, parsed, text);
        if (cls.retryBaseUrl) continue;
        return { status: response.status, headers: { "content-type": "application/json" }, body: parsed, retryable: cls.retryable, retryBaseUrl: cls.retryBaseUrl, cooldownMs: cls.cooldownMs, reason: cls.reason };
      }
      const converted = antigravityToOpenAI(parsed, model);
      return { status: 200, headers: { "content-type": "application/json" }, body: converted, usage: extractUsage(parsed) };
    }
    return { status: 503, headers: { "content-type": "application/json" }, body: { error: { message: "all Antigravity base URLs failed", type: "upstream_error" } }, retryable: true };
  }

  async chatCompletionsStream(body: any, auth: RawAuthFile): Promise<StreamProxyResult> {
    const token = getAccessToken(auth);
    if (!token) throw new Error("Selected account has no access token/api key");
    const requested = resolveModel(String(body.model || "gemini-3-flash"));
    const projectId = getProjectId(auth) || "total-particle-kcz5z";
    const payload = openAIToAntigravity({ ...body, model: requested.upstream }, projectId);

    for (const base of BASE_URLS) {
      const response = await fetch(`${base}/v1internal:streamGenerateContent?alt=sse`, this.requestInit(token, payload, requested.id));
      if (!response.ok || !response.body) {
        const text = await response.text();
        const parsed = parseJson(text);
        const cls = classifyUpstreamError(response.status, parsed, text);
        if (cls.retryBaseUrl) continue;
        return { status: response.status, headers: { "content-type": "application/json" }, body: parsed, retryable: cls.retryable, retryBaseUrl: cls.retryBaseUrl, cooldownMs: cls.cooldownMs, reason: cls.reason };
      }
      return { status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache", "connection": "keep-alive" }, stream: this.convertStream(response.body, requested.id) };
    }
    return { status: 503, headers: { "content-type": "application/json" }, body: { error: { message: "all Antigravity stream base URLs failed", type: "upstream_error" } }, retryable: true };
  }

  private requestInit(token: string, payload: unknown, modelId: string): RequestInit {
    const userAgent = usesClaudeStyle(modelId) ? LONG_UA : SHORT_UA;
    return {
      method: "POST",
      headers: {
        "authorization": `Bearer ${token}`,
        "content-type": "application/json",
        "user-agent": userAgent,
        "connection": "close",
      },
      body: JSON.stringify(payload),
    };
  }

  private convertStream(body: ReadableStream<Uint8Array>, model: string): ReadableStream<Uint8Array> {
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = "";
    return new ReadableStream({
      async start(controller) {
        const reader = body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || "";
            for (const line of lines) {
              if (!line.startsWith("data:")) continue;
              const data = line.slice(5).trim();
              if (!data || data === "[DONE]") continue;
              const parsed = parseJson(data);
              for (const chunk of antigravityChunkToOpenAI(parsed, model)) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
              }
            }
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (error) {
          controller.error(error);
        } finally {
          reader.releaseLock();
        }
      },
    });
  }
}

function parseJson(text: string): any {
  try { return text ? JSON.parse(text) : {}; } catch { return { text }; }
}

export function classifyUpstreamError(status: number, parsed: any, text: string): { retryable: boolean; retryBaseUrl: boolean; cooldownMs?: number; reason?: string } {
  const lower = `${JSON.stringify(parsed)} ${text}`.toLowerCase();
  if (status === 401) return { retryable: false, retryBaseUrl: false, reason: "auth" };
  if (status === 503 && lower.includes("no capacity available")) return { retryable: true, retryBaseUrl: true, cooldownMs: 2_000, reason: "capacity" };
  if (status >= 500) return { retryable: true, retryBaseUrl: true, cooldownMs: 2_000, reason: "server" };
  if (status !== 429) return { retryable: false, retryBaseUrl: false };
  const maxCooldown = Math.max(1_000, Number(process.env.MAX_COOLDOWN_MS || 0) || 6 * 60 * 60_000);
  const retryMs = retryDelayMs(parsed) ?? (lower.includes("quota_exhausted") || lower.includes("quota exhausted") ? maxCooldown : 60_000);
  return { retryable: true, retryBaseUrl: false, cooldownMs: retryMs, reason: lower.includes("quota") ? "quota" : "rate_limit" };
}

function retryDelayMs(parsed: any): number | undefined {
  const details = parsed?.error?.details;
  if (Array.isArray(details)) {
    for (const detail of details) {
      const raw = detail?.retryDelay;
      if (typeof raw === "string") {
        const seconds = Number(raw.replace(/s$/, ""));
        if (Number.isFinite(seconds)) return Math.max(1_000, Math.min(seconds * 1000, 24 * 60 * 60_000));
      }
    }
  }
  return undefined;
}
