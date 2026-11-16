import type { Usage } from "../accounts/store.js";
import { BASE_URLS, USER_AGENT } from "../config.js";
import { classifyUpstreamError, deprecationNotice, type UpstreamFailure } from "./errors.js";
import { openAIToAntigravity } from "./format/request.js";
import { antigravityChunkToOpenAI, antigravityToOpenAI, extractUsage, firstText, newStreamState, usageChunk } from "./format/response.js";
import type { ModelInfo } from "./models.js";

export type CompletionResult =
  | { ok: true; body: unknown; usage: Usage }
  | { ok: true; stream: ReadableStream<Uint8Array>; usage: Promise<Usage> }
  | { ok: false; failure: UpstreamFailure };

export interface Credentials { token: string; projectId: string }

function parseJson(text: string): any {
  try { return text ? JSON.parse(text) : {}; } catch { return { text: text.slice(0, 2000) }; }
}

function retiredFailure(model: string, notice: string): UpstreamFailure {
  return { kind: "retired", status: 410, message: `Upstream retired model ${model}: ${notice}`, tryNextBase: false, tryNextAccount: false, body: { notice } };
}

/** Parsed `data:` events of an upstream SSE body. */
async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<any> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
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
        if (data && data !== "[DONE]") yield parseJson(data);
      }
    }
    const tail = buffer.trim();
    if (tail.startsWith("data:") && tail.slice(5).trim() !== "[DONE]") yield parseJson(tail.slice(5).trim());
  } finally {
    // Stops the upstream download too when the consumer leaves early.
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export class AntigravityClient {
  constructor(private readonly baseUrls: string[] = BASE_URLS) {}

  async complete(body: any, model: ModelInfo, creds: Credentials, opts: { stream: boolean; signal?: AbortSignal }): Promise<CompletionResult> {
    const payload = openAIToAntigravity(body, model.upstream, creds.projectId);
    const path = opts.stream ? "streamGenerateContent?alt=sse" : "generateContent";
    let failure: UpstreamFailure | undefined;
    for (const [i, base] of this.baseUrls.entries()) {
      const response = await fetch(`${base}/v1internal:${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${creds.token}`, "content-type": "application/json", "user-agent": USER_AGENT, accept: opts.stream ? "text/event-stream" : "application/json" },
        body: JSON.stringify(payload),
        signal: opts.signal,
      });
      if (response.ok && response.body) {
        return opts.stream
          ? this.openStream(response.body, model.id, Boolean(body.stream_options?.include_usage))
          : this.readJson(await response.text(), model.id);
      }
      failure = classifyUpstreamError(response.status, parseJson(await response.text()));
      if (!failure.tryNextBase || i === this.baseUrls.length - 1) break;
    }
    return { ok: false, failure: failure ?? classifyUpstreamError(503, { error: { message: "no Antigravity base URL configured" } }) };
  }

  private readJson(text: string, model: string): CompletionResult {
    const parsed = parseJson(text);
    const notice = deprecationNotice(firstText(parsed));
    if (notice) return { ok: false, failure: retiredFailure(model, notice) };
    return { ok: true, body: antigravityToOpenAI(parsed, model), usage: extractUsage(parsed) };
  }

  /**
   * Reads up to the first event that carries content before answering, so a
   * retirement notice or an in-band error can still become a proper HTTP error
   * instead of a 200 stream the caller has already started to consume.
   */
  private async openStream(upstream: ReadableStream<Uint8Array>, model: string, includeUsage: boolean): Promise<CompletionResult> {
    const events = sseEvents(upstream);
    const head: any[] = [];
    // Manual next(): breaking out of for-await would close the generator for the rest of the stream.
    while (true) {
      const { value: event, done } = await events.next();
      if (done) break;
      if (event?.error) { await events.return(undefined); return { ok: false, failure: classifyUpstreamError(Number(event.error.code) || 500, event) }; }
      head.push(event);
      const text = firstText(event);
      const parts = (event?.response?.candidates ?? event?.candidates ?? [])[0]?.content?.parts;
      if (text || (Array.isArray(parts) && parts.length)) {
        const notice = deprecationNotice(text);
        if (notice) { await events.return(undefined); return { ok: false, failure: retiredFailure(model, notice) }; }
        break;
      }
    }

    let resolveUsage!: (u: Usage) => void;
    const usage = new Promise<Usage>((resolve) => { resolveUsage = resolve; });
    const encoder = new TextEncoder();
    const state = newStreamState();
    let last: Usage = {};
    const send = (controller: ReadableStreamDefaultController<Uint8Array>, data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (event: any) => {
          const u = extractUsage(event);
          if (u.totalTokens) last = u;
          for (const chunk of antigravityChunkToOpenAI(event, model, state)) send(controller, chunk);
        };
        try {
          for (const event of head) emit(event);
          for await (const event of events) {
            if (event?.error) { send(controller, { error: event.error }); break; }
            emit(event);
          }
          if (includeUsage) send(controller, usageChunk(model, last));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (error) {
          controller.error(error);
        } finally {
          resolveUsage(last);
        }
      },
      async cancel() {
        await events.return(undefined);
        resolveUsage(last);
      },
    });
    return { ok: true, stream, usage };
  }
}
