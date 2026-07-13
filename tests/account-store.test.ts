import { describe, expect, it } from "vitest";
import { AccountStore } from "../src/accounts/store.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("AccountStore", () => {
  it("loads auth json files and hides secrets in public view", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ag-auth-"));
    writeFileSync(join(dir, "google-account-1.json"), JSON.stringify({
      email: "user@example.com",
      access_token: "secret-token",
      refresh_token: "refresh-secret"
    }));

    const store = new AccountStore({ authDir: dir });
    const accounts = await store.listPublicAccounts();

    expect(accounts).toEqual([
      expect.objectContaining({
        id: "google-account-1",
        authFile: "google-account-1.json",
        email: "user@example.com",
        provider: "antigravity",
        enabled: true,
        healthy: true,
      })
    ]);
    expect(JSON.stringify(accounts)).not.toContain("secret-token");
    expect(JSON.stringify(accounts)).not.toContain("refresh-secret");
  });
});
