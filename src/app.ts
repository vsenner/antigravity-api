import express from "express";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { requireBearer } from "./auth.js";
import { managementRouter } from "./routes/management.js";
import { openAIRouter } from "./routes/openai.js";
import { Services } from "./services/container.js";

export interface AppOptions {
  authDir: string;
  managementToken: string;
  apiKeys: string[];
  estimatedLimitTokens?: number;
}

export function createApp(options: AppOptions, services = new Services({ authDir: options.authDir, estimatedLimitTokens: options.estimatedLimitTokens })) {
  const app = express();
  // Request logs without headers: they carry bearer tokens.
  app.use((pinoHttp as unknown as (opts: object) => express.RequestHandler)({
    enabled: process.env.NODE_ENV !== "test",
    serializers: { req: (req: any) => ({ method: req.method, url: req.url, ua: req.headers?.["user-agent"] }), res: (res: any) => ({ statusCode: res.statusCode }) },
  }));
  app.use(express.json({ limit: "25mb" }));
  app.use(cookieParser());

  const management = requireBearer([options.managementToken]);
  const api = requireBearer(options.apiKeys);
  const any = requireBearer([...options.apiKeys, options.managementToken]);

  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  app.use("/v1", api, openAIRouter(services));
  app.use(managementRouter(services, { management, any }));

  const webDir = join(process.cwd(), "dist-web");
  if (existsSync(webDir)) app.use(express.static(webDir));
  app.get("/", (_req, res) => existsSync(join(webDir, "index.html"))
    ? res.sendFile(join(webDir, "index.html"))
    : res.type("text").send("antigravity-api: dashboard not built (npm run build)"));

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: { message, type: "server_error" } });
  });

  return app;
}

export async function startApp(options: AppOptions & { port: number; host?: string }): Promise<{ server: Server; url: string }> {
  const server = createServer(createApp(options));
  const host = options.host ?? "0.0.0.0";
  await new Promise<void>((resolve) => server.listen(options.port, host, resolve));
  const address = server.address() as AddressInfo;
  return { server, url: `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${address.port}` };
}
