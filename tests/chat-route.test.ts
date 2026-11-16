import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";

const future = new Date(Date.now() + 3600_000).toISOString();
const TOS = "This service has been disabled in this account for violation of Terms of Service. Please submit an appeal to continue using this product.";

function setup(tokens: string[]) {
  const authDir = mkdtempSync(join(tmpdir(), "ag-chat-"));
  for (const t of tokens) writeFileSync(join(authDir, `${t}.json`), JSON.stringify({ email: `${t}@example.com`, access_token: t, refresh_token: "r", expired: future, project_id: `proj-${t}` }));
  return { authDir, app: createApp({ authDir, managementToken: "admin", apiKeys: ["key"] }) };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const sse = (events: unknown[]) => new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
const answer = (text: string) => ({ response: { candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1, totalTokenCount: 4 } } });

let calls: { token: string; url: string }[];
function mockUpstream(byToken: (token: string, url: string) => Response) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const token = String((init.headers as Record<string, string>).authorization).replace("Bearer ", "");
    calls.push({ token, url: String(url) });
    return byToken(token, String(url));
  }));
}

describe("POST /v1/chat/completions", () => {
  beforeEach(() => { calls = []; });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("skips a banned account, remembers the ban on disk and answers from a working one", async () => {
    const { app, authDir } = setup(["banned", "ok"]);
    mockUpstream((token) => token === "banned" ? json(403, { error: { code: 403, message: TOS } }) : json(200, answer("OK")));
    for (let i = 0; i < 2; i++) {
      const res = await request(app).post("/v1/chat/completions").set("Authorization", "Bearer key").send({ model: "gemini-3.8-flash-medium", messages: [{ role: "user", content: "hi" }] }).expect(200);
      expect(res.body.choices[0].message.content).toBe("OK");
    }
    expect(JSON.parse(readFileSync(join(authDir, "banned.json"), "utf8")).banned.message).toContain("Terms of Service");
    const before = calls.filter((c) => c.token === "banned").length;
    await request(app).post("/v1/chat/completions").set("Authorization", "Bearer key").send({ messages: [{ role: "user", content: "hi" }] }).expect(200);
    expect(calls.filter((c) => c.token === "banned").length).toBe(before);
  });

  it("stops after two bare 429s and says it is not a quota problem", async () => {
    const { app } = setup(["a", "b", "c"]);
    mockUpstream(() => json(429, { error: { code: 429, message: "Resource has been exhausted (e.g. check quota).", status: "RESOURCE_EXHAUSTED" } }));
    const res = await request(app).post("/v1/chat/completions").set("Authorization", "Bearer key").send({ messages: [{ role: "system", content: "x" }, { role: "user", content: "hi" }] }).expect(429);
    expect(res.body.error.type).toBe("upstream_rejected");
    expect(res.body.error.message).toContain("not a quota problem");
    expect(res.headers["retry-after"]).toBe("60");
    expect(calls).toHaveLength(2);
  });

  it("turns a streamed retirement notice into 410 before any byte is streamed", async () => {
    const { app } = setup(["ok"]);
    mockUpstream(() => sse([answer("Claude Sonnet 4.6 is no longer available. Please switch to Claude Sonnet 5.5.")]));
    const res = await request(app).post("/v1/chat/completions").set("Authorization", "Bearer key").send({ model: "some-old-model", stream: true, messages: [{ role: "user", content: "hi" }] }).expect(410);
    expect(res.body.error.type).toBe("model_retired");
  });

  it("refuses a model known to be retired without calling upstream", async () => {
    const { app } = setup(["ok"]);
    mockUpstream(() => json(200, answer("unused")));
    const res = await request(app).post("/v1/chat/completions").set("Authorization", "Bearer key").send({ model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hi" }] }).expect(410);
    expect(res.body.error.message).toContain("claude-sonnet-5-5");
    expect(calls).toHaveLength(0);
  });

  it("streams SSE chunks, usage and [DONE]", async () => {
    const { app } = setup(["ok"]);
    mockUpstream(() => sse([answer("Hel"), answer("lo")]));
    const res = await request(app).post("/v1/chat/completions").set("Authorization", "Bearer key")
      .send({ stream: true, stream_options: { include_usage: true }, messages: [{ role: "user", content: "hi" }] }).expect(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const events = res.text.split("\n\n").filter(Boolean).map((l) => l.replace(/^data: /, ""));
    expect(events.at(-1)).toBe("[DONE]");
    const chunks = events.slice(0, -1).map((e) => JSON.parse(e));
    expect(chunks.map((c) => c.choices[0]?.delta?.content).filter(Boolean).join("")).toBe("Hello");
    expect(chunks.at(-1).usage.total_tokens).toBe(4);
    expect(calls[0].url).toContain("streamGenerateContent?alt=sse");
  });

  it("asks the caller to wait when every account is cooling down", async () => {
    const { app } = setup(["a"]);
    mockUpstream(() => json(429, { error: { code: 429, message: "Quota exceeded", details: [{ retryDelay: "30s" }] } }));
    await request(app).post("/v1/chat/completions").set("Authorization", "Bearer key").send({ messages: [{ role: "user", content: "hi" }] }).expect(429);
    const res = await request(app).post("/v1/chat/completions").set("Authorization", "Bearer key").send({ messages: [{ role: "user", content: "hi" }] }).expect(429);
    expect(res.body.error.code).toBe("cooldown");
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    expect(calls).toHaveLength(1);
  });
});
