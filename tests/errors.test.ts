import { describe, expect, it } from "vitest";
import { classifyUpstreamError, deprecationNotice, resetsInMs } from "../src/proxy/errors.js";

const err = (code: number, message: string, details?: unknown[]) => ({ error: { code, message, ...(details ? { details } : {}) } });

describe("classifyUpstreamError", () => {
  it("recognises a Terms of Service ban", () => {
    const f = classifyUpstreamError(403, err(403, "This service has been disabled in this account for violation of Terms of Service. Please submit an appeal to continue using this product."));
    expect(f).toMatchObject({ kind: "banned", tryNextAccount: true, tryNextBase: false });
  });

  it("treats a bare 429 as a refusal, not a quota, and unwraps stream error arrays", () => {
    const f = classifyUpstreamError(429, [err(429, "Resource has been exhausted (e.g. check quota).")]);
    expect(f.kind).toBe("rejected");
    expect(f.cooldownMs).toBeLessThanOrEqual(15_000);
  });

  it("reads quota resets from RetryInfo and from the message", () => {
    expect(classifyUpstreamError(429, err(429, "Quota exceeded", [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "42s" }])).cooldownMs).toBe(42_000);
    const f = classifyUpstreamError(429, err(429, "Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 1h2m3s."));
    expect(f.kind).toBe("quota");
    expect(f.cooldownMs).toBe(3_723_000);
    expect(resetsInMs("Resets in 74h35m53s")).toBe((74 * 3600 + 35 * 60 + 53) * 1000);
  });

  it("lets other accounts try a model one account does not have", () => {
    expect(classifyUpstreamError(404, err(404, "Requested entity was not found."))).toMatchObject({ kind: "not_found", tryNextBase: true, tryNextAccount: true });
  });

  it("answers a bad request at once and retries capacity on the sibling base", () => {
    expect(classifyUpstreamError(400, err(400, "Invalid argument"))).toMatchObject({ kind: "bad_request", tryNextAccount: false });
    expect(classifyUpstreamError(503, err(503, "No capacity available for model gemini-2.5-pro on the server"))).toMatchObject({ kind: "capacity", tryNextBase: true });
  });
});

describe("deprecationNotice", () => {
  it("catches the short retirement notice only", () => {
    expect(deprecationNotice("Claude Sonnet 4.6 is no longer available. Please switch to Claude Sonnet 5.5.")).toBeTruthy();
    expect(deprecationNotice("Python 2 is no longer available on this server.")).toBeUndefined();
  });
});
