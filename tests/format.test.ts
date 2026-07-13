import { describe, expect, it } from "vitest";
import { antigravityToOpenAI, openAIToAntigravity } from "../src/proxy/antigravity-format.js";

describe("Antigravity format adapter", () => {
  it("converts OpenAI chat messages into Antigravity generateContent payload", () => {
    const payload = openAIToAntigravity({
      model: "gemini-pro-agent",
      temperature: 0.2,
      messages: [
        { role: "system", content: "You are concise" },
        { role: "user", content: "Hello" },
      ],
    }, "project-123");

    expect(payload).toMatchObject({
      project: "project-123",
      model: "gemini-pro-agent",
      request: {
        systemInstruction: { role: "user", parts: [{ text: "You are concise" }] },
        contents: [{ role: "user", parts: [{ text: "Hello" }] }],
        generationConfig: { temperature: 0.2 },
      },
    });
  });

  it("supports images, audio, video, files and tools", () => {
    const payload = openAIToAntigravity({
      model: "gemini-3-flash",
      messages: [{ role: "user", content: [
        { type: "text", text: "describe" },
        { type: "image_url", image_url: { url: "data:image/png;base64,aW1n" } },
        { type: "input_audio", input_audio: { format: "mp3", data: "YXVkaW8=" } },
        { type: "video", video: { mime_type: "video/mp4", data: "dmlkZW8=" } },
        { type: "file", file: { filename: "a.pdf", file_data: "cGRm" } },
      ]}],
      tools: [{ type: "function", function: { name: "lookup.weather", parameters: { type: "object", properties: { city: { type: "string" } } } } }],
    }, "project-123");
    const parts = payload.request.contents[0].parts;
    expect(parts.some((p: any) => p.inlineData?.mimeType === "image/png")).toBe(true);
    expect(parts.some((p: any) => p.inlineData?.mime_type === "audio/mpeg")).toBe(true);
    expect(parts.some((p: any) => p.inlineData?.mimeType === "video/mp4")).toBe(true);
    expect(payload.request.tools[0].functionDeclarations[0].parametersJsonSchema).toBeTruthy();
  });

  it("uses responseModalities for claude-style models", () => {
    const payload = openAIToAntigravity({ model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hi" }], max_tokens: 32 }, "project-123");
    expect(payload.model).toBe("claude-sonnet-4-6");
    expect(payload.request.generationConfig.responseModalities).toEqual(["TEXT"]);
  });

  it("converts Antigravity candidates into OpenAI chat completion", () => {
    const converted = antigravityToOpenAI({ response: { candidates: [{ content: { parts: [{ text: "Hi" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3 } } }, "gemini-pro-agent");

    expect(converted.choices[0].message.content).toBe("Hi");
    expect(converted.usage.total_tokens).toBe(3);
  });
});
