import { describe, expect, it } from "vitest";
import { openAIToAntigravity } from "../src/proxy/format/request.js";
import { antigravityChunkToOpenAI, antigravityToOpenAI, newStreamState } from "../src/proxy/format/response.js";
import { resolveModel } from "../src/proxy/models.js";

describe("request adapter", () => {
  it("converts OpenAI chat messages into a generateContent payload", () => {
    const payload = openAIToAntigravity({
      temperature: 0.2,
      max_completion_tokens: 500,
      stop: "END",
      messages: [{ role: "system", content: "You are concise" }, { role: "user", content: "Hello" }],
    }, "gemini-3.8-flash-high", "project-123");

    expect(payload).toMatchObject({
      project: "project-123",
      model: "gemini-3.8-flash-high",
      requestType: "agent",
      request: {
        systemInstruction: { role: "user", parts: [{ text: "You are concise" }] },
        contents: [{ role: "user", parts: [{ text: "Hello" }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 500, stopSequences: ["END"], responseModalities: ["TEXT"] },
      },
    });
    expect(payload.request.sessionId).toMatch(/^-\d+$/);
  });

  it("supports images, audio, video, files and tools", () => {
    const payload = openAIToAntigravity({
      messages: [{ role: "user", content: [
        { type: "text", text: "describe" },
        { type: "image_url", image_url: { url: "data:image/png;base64,aW1n" } },
        { type: "input_audio", input_audio: { format: "mp3", data: "YXVkaW8=" } },
        { type: "video", video: { mime_type: "video/mp4", data: "dmlkZW8=" } },
        { type: "file", file: { filename: "a.pdf", file_data: "cGRm" } },
      ] }],
      tools: [{ type: "function", function: { name: "lookup.weather", strict: true, parameters: { type: "object", properties: { city: { type: "string" } } } } }],
      tool_choice: "required",
    }, "gemini-3-flash", "project-123");
    const parts = payload.request.contents[0].parts;
    expect(parts.some((p: any) => p.inlineData?.mimeType === "image/png")).toBe(true);
    expect(parts.some((p: any) => p.inlineData?.mime_type === "audio/mpeg")).toBe(true);
    expect(parts.some((p: any) => p.inlineData?.mimeType === "video/mp4")).toBe(true);
    const fn = payload.request.tools[0].functionDeclarations[0];
    expect(fn.parametersJsonSchema).toBeTruthy();
    expect(fn.strict).toBeUndefined();
    expect(payload.request.toolConfig).toEqual({ functionCallingConfig: { mode: "ANY" } });
  });

  it("normalizes video_url data URLs", () => {
    const payload = openAIToAntigravity({ messages: [{ role: "user", content: [
      { type: "video_url", video_url: { url: "data:video/mp4;base64,dmlkZW8=" } },
      { type: "video_url", video_url: { url: "data:video/quicktime;base64,bW92" } },
      { type: "video_url", video_url: { url: "data:application/octet-stream;base64,YmluCg==" } },
      { type: "video_url", video_url: { url: "https://example.com/not-inline.mp4" } },
    ] }] }, "gemini-3.8-flash-high", "p");
    const inline = payload.request.contents[0].parts.filter((p: any) => p.inlineData);
    expect(inline.map((p: any) => p.inlineData.mimeType)).toEqual(["video/mp4", "video/quicktime", "video/mp4"]);
  });

  it("replays tool calls and folds tool results into the next user turn", () => {
    const payload = openAIToAntigravity({ messages: [
      { role: "user", content: "weather?" },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "get weather", arguments: "{\"city\":\"Kyiv\"}" } }] },
      { role: "tool", tool_call_id: "c1", content: "{\"t\":3}" },
    ] }, "claude-sonnet-5-5-medium", "p");
    expect(payload.request.contents).toEqual([
      { role: "user", parts: [{ text: "weather?" }] },
      { role: "model", parts: [{ functionCall: { id: "c1", name: "get_weather", args: { city: "Kyiv" } }, thoughtSignature: "skip_thought_signature_validator" }] },
      { role: "user", parts: [{ functionResponse: { id: "c1", name: "get_weather", response: { result: { t: 3 } } } }] },
    ]);
  });

  it("raises tiny output budgets for Claude", () => {
    const payload = openAIToAntigravity({ messages: [{ role: "user", content: "hi" }], max_tokens: 32 }, "claude-opus-5-5-medium", "p");
    expect(payload.request.generationConfig).toMatchObject({ responseModalities: ["TEXT"], maxOutputTokens: 256 });
  });
});

describe("model resolution", () => {
  it("resolves aliases and passes unknown ids through unchanged", () => {
    expect(resolveModel("gemini-flash").upstream).toBe("gemini-3.8-flash-high");
    expect(resolveModel("claude-sonnet-5-5").upstream).toBe("claude-sonnet-5-5-medium");
    expect(resolveModel("gemini-3.5-flash-lite").upstream).toBe("gemini-3.5-flash-lite");
    expect(resolveModel("gemini-9-ultra").upstream).toBe("gemini-9-ultra");
    expect(resolveModel(undefined).id).toBe("gemini-3.8-flash-high");
  });
});

describe("response adapter", () => {
  it("separates reasoning from the answer and maps usage", () => {
    const converted = antigravityToOpenAI({ response: {
      candidates: [{ content: { parts: [{ text: "thinking…", thought: true }, { text: "Hi" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2, thoughtsTokenCount: 4, totalTokenCount: 7 },
    } }, "m");
    expect(converted.choices[0].message).toEqual({ role: "assistant", content: "Hi", reasoning_content: "thinking…" });
    expect(converted.choices[0].finish_reason).toBe("stop");
    expect(converted.usage).toEqual({ prompt_tokens: 1, completion_tokens: 6, total_tokens: 7 });
  });

  it("reports tool calls with finish_reason tool_calls", () => {
    const converted = antigravityToOpenAI({ response: { candidates: [{ content: { parts: [{ functionCall: { name: "f", args: { a: 1 } } }] }, finishReason: "STOP" }] } }, "m");
    expect(converted.choices[0].finish_reason).toBe("tool_calls");
    expect(converted.choices[0].message.tool_calls[0]).toMatchObject({ type: "function", function: { name: "f", arguments: "{\"a\":1}" } });
  });

  it("numbers streamed tool calls across chunks and ends with tool_calls", () => {
    const state = newStreamState();
    const a = antigravityChunkToOpenAI({ response: { candidates: [{ content: { parts: [{ functionCall: { name: "f", args: {} } }] } }] } }, "m", state);
    const b = antigravityChunkToOpenAI({ response: { candidates: [{ content: { parts: [{ functionCall: { name: "g", args: {} } }] } }] } }, "m", state);
    const end = antigravityChunkToOpenAI({ response: { candidates: [{ content: { parts: [{ text: "" }] }, finishReason: "STOP" }] } }, "m", state);
    expect(a[0].choices[0].delta.tool_calls[0].index).toBe(0);
    expect(b[0].choices[0].delta.tool_calls[0].index).toBe(1);
    expect(a[0].choices[0].delta.tool_calls[0].id).not.toBe(b[0].choices[0].delta.tool_calls[0].id);
    expect(end[0].choices[0].finish_reason).toBe("tool_calls");
  });
});
