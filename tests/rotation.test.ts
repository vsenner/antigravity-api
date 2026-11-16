import { describe, expect, it } from "vitest";
import { RotationEngine } from "../src/accounts/rotation.js";
import type { AccountRuntime } from "../src/accounts/types.js";

function account(id: string, patch: Partial<AccountRuntime> = {}): AccountRuntime {
  return {
    id,
    authFile: `${id}.json`,
    email: `${id}@example.com`,
    provider: "antigravity",
    enabled: true,
    healthy: true,
    requestCount: 0,
    successCount: 0,
    errorCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    modelStats: {},
    ...patch,
  };
}

describe("RotationEngine", () => {
  it("selects the least-used healthy account for even spend", () => {
    const engine = new RotationEngine();
    const accounts = [account("a", { totalTokens: 10 }), account("b", { totalTokens: 0 }), account("c", { enabled: false })];

    expect(engine.pick(accounts)?.id).toBe("b");
  });

  it("puts an account on cooldown after repeated failures", () => {
    const engine = new RotationEngine({ maxConsecutiveErrors: 2, cooldownMs: 60_000 });
    const a = account("a");

    engine.recordFailure(a, "any-model", "boom");
    expect(a.healthy).toBe(true);
    engine.recordFailure(a, "any-model", "boom again");

    expect(a.modelCooldowns?.get("any-model")).toBeGreaterThan(Date.now());
    expect(engine.pick([a], "any-model")).toBeUndefined();
    expect(engine.pick([a], "other-model")?.id).toBe("a");
  });

  it("never picks banned or auth-failed accounts", () => {
    const engine = new RotationEngine();
    const accounts = [account("banned", { banned: { at: "now", message: "ToS" } }), account("auth", { authFailed: true }), account("ok", { totalTokens: 999 })];
    expect(engine.pick(accounts)?.id).toBe("ok");
  });
});
