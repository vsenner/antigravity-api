import { startApp } from "./app.js";

const port = Number(process.env.PORT || 3000);
const managementToken = process.env.MANAGEMENT_TOKEN || process.env.ADMIN_TOKEN || "change-me-management-token";
const apiKeys = (process.env.API_KEYS || process.env.API_KEY || "change-me-api-key")
  .split(",")
  .map((key) => key.trim())
  .filter(Boolean);
const authDir = process.env.AUTH_DIR || "/app/config/auth";

const estimatedLimitTokens = Number(process.env.ESTIMATED_LIMIT_TOKENS || 0) || undefined;

const { url } = await startApp({ authDir, managementToken, apiKeys, port, estimatedLimitTokens });
console.log(`antigravity-api listening on ${url}`);
