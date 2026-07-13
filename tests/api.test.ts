import { describe, expect, it } from "vitest";
import request from "supertest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";

describe("management API", () => {
  it("returns accounts with bearer management token", async () => {
    const authDir = mkdtempSync(join(tmpdir(), "ag-auth-"));
    writeFileSync(join(authDir, "google-account-2.json"), JSON.stringify({ email: "two@example.com" }));
    const app = createApp({ authDir, managementToken: "admin-secret", apiKeys: ["client-key"] });

    const res = await request(app)
      .get("/api/accounts")
      .set("Authorization", "Bearer admin-secret")
      .expect(200);

    expect(res.body.accounts).toHaveLength(1);
    expect(res.body.accounts[0].email).toBe("two@example.com");
  });

  it("rejects management API without token", async () => {
    const app = createApp({ authDir: mkdtempSync(join(tmpdir(), "ag-auth-")), managementToken: "admin-secret", apiKeys: ["client-key"] });
    await request(app).get("/api/accounts").expect(401);
  });
});
