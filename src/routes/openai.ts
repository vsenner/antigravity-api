import express from "express";
import { MAX_ACCOUNT_ATTEMPTS } from "../config.js";
import type { AccountRuntime } from "../accounts/types.js";
import type { UpstreamFailure } from "../proxy/errors.js";
import type { CompletionResult, Credentials } from "../proxy/client.js";
import { RETIRED_MODELS, resolveModel, type ModelInfo } from "../proxy/models.js";
import type { Services } from "../services/container.js";

/** Bare 429s on this many accounts in a row stop the search: they fail alike and each one risks the account. */
const MAX_REJECTED = 2;

function openAIError(res: express.Response, status: number, message: string, extra: Record<string, unknown> = {}) {
  return res.status(status).json({ error: { message, type: extra.type ?? "upstream_error", ...extra } });
}

export function openAIRouter(svc: Services) {
  const router = express.Router();

  router.get("/models", async (_req, res, next) => {
    try {
      const accounts = await svc.store.listRuntimeAccounts();
      const credsList: { accountId: string; token: string; projectId: string }[] = [];
      for (const a of accounts) {
        if (!a.enabled || a.banned || a.verificationRequired || a.authFailed) continue;
        try {
          const c = await svc.credentials(a.id);
          credsList.push({ accountId: a.id, ...c });
        } catch { /* skip */ }
      }
      const upstream = await svc.catalog.upstreamPool(credsList, (accountId, modelIds) => {
        svc.store.setSupportedModels(accountId, modelIds);
      });
      res.json({ object: "list", data: svc.catalog.list(upstream) });
    } catch (e) { next(e); }
  });

  router.post("/chat/completions", async (req, res, next) => {
    const model = resolveModel(req.body?.model);
    const successor = RETIRED_MODELS.get(model.upstream);
    if (successor) return openAIError(res, 410, `Model ${model.id} was retired upstream; use ${successor}.`, { type: "model_retired", code: "retired", param: "model" });

    const stream = Boolean(req.body?.stream);
    const abort = new AbortController();
    res.on("close", () => { if (!res.writableFinished) abort.abort(); });

    const tried = new Set<string>();
    const failures: UpstreamFailure[] = [];
    try {
      for (let attempt = 0; attempt < MAX_ACCOUNT_ATTEMPTS; attempt++) {
        const account = svc.rotation.pick(await svc.store.listRuntimeAccounts(), model.id, tried, model.upstream);
        if (!account) break;
        tried.add(account.id);
        svc.store.recordRequest(account, model.id);

        const result = await attemptAccount(svc, account, model, req.body, stream, abort.signal);
        if (abort.signal.aborted) return;
        if (result.ok) return sendSuccess(svc, res, account, model, result);

        failures.push(result.failure);
        await applyFailure(svc, account, model, result.failure);
        if (!result.failure.tryNextAccount) return sendFailure(res, result.failure);
        if (failures.filter((f) => f.kind === "rejected").length >= MAX_REJECTED) break;
      }
      return sendExhausted(svc, res, model, failures);
    } catch (e) {
      if (abort.signal.aborted) return;
      return next(e);
    }
  });

  return router;
}

async function attemptAccount(svc: Services, account: AccountRuntime, model: ModelInfo, body: any, stream: boolean, signal: AbortSignal): Promise<CompletionResult> {
  const run = async (force: boolean) => {
    let creds: Credentials;
    try { creds = await svc.credentials(account.id, { force }); }
    catch (e) { return { ok: false as const, failure: { kind: "auth" as const, status: 401, message: e instanceof Error ? e.message : String(e), tryNextBase: false, tryNextAccount: true, body: {} } }; }
    try { return await svc.client.complete(body, model, creds, { stream, signal }); }
    catch (e) {
      if (signal.aborted) throw e;
      return { ok: false as const, failure: { kind: "server" as const, status: 502, message: `upstream fetch failed: ${e instanceof Error ? e.message : String(e)}`, cooldownMs: 5_000, tryNextBase: false, tryNextAccount: true, body: {} } };
    }
  };
  const first = await run(false);
  // An expired or revoked access token: refresh once and retry the same account.
  if (!first.ok && first.failure.kind === "auth" && first.failure.status === 401) return run(true);
  return first;
}

async function applyFailure(svc: Services, account: AccountRuntime, model: ModelInfo, failure: UpstreamFailure) {
  svc.store.recordFailure(account, model.id, `${failure.status} ${failure.kind}: ${failure.message}`);
  if (failure.kind === "banned") return svc.store.markBanned(account, failure.message);
  if (failure.kind === "verification_required") return svc.store.markVerificationRequired(account, failure.message);
  if (failure.kind === "not_found") {
    svc.store.markModelUnsupported(account, model.id);
    return svc.rotation.recordFailure(account, model.id, failure.message, { cooldownMs: failure.cooldownMs });
  }
  if (failure.kind === "auth") return svc.rotation.recordFailure(account, model.id, failure.message, { authFailed: true });
  if (failure.cooldownMs) svc.rotation.recordFailure(account, model.id, failure.message, { cooldownMs: failure.cooldownMs });
}

async function sendSuccess(svc: Services, res: express.Response, account: AccountRuntime, model: ModelInfo, result: Extract<CompletionResult, { ok: true }>) {
  svc.rotation.recordSuccess(account, model.id);
  if ("body" in result) {
    svc.store.recordSuccess(account, model.id, result.usage);
    return res.status(200).json(result.body);
  }
  void result.usage.then((usage) => svc.store.recordSuccess(account, model.id, usage));
  res.status(200).set({ "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "x-accel-buffering": "no" });
  res.flushHeaders();
  const reader = result.stream.getReader();
  res.on("close", () => { void reader.cancel().catch(() => undefined); });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (e) {
    res.destroy(e instanceof Error ? e : new Error(String(e)));
  }
}

const STATUS_FOR: Partial<Record<UpstreamFailure["kind"], number>> = { retired: 410, not_found: 404, bad_request: 400, capacity: 503, server: 502, quota: 429, rejected: 429 };

function sendFailure(res: express.Response, failure: UpstreamFailure) {
  const status = STATUS_FOR[failure.kind] ?? (failure.status >= 400 ? failure.status : 502);
  return openAIError(res, status, failure.message, { type: failure.kind === "retired" ? "model_retired" : "upstream_error", code: failure.kind, upstream_status: failure.status });
}

function sendExhausted(svc: Services, res: express.Response, model: ModelInfo, failures: UpstreamFailure[]) {
  const kinds = failures.reduce<Record<string, number>>((acc, f) => { acc[f.kind] = (acc[f.kind] ?? 0) + 1; return acc; }, {});
  if (failures.length && failures.every((f) => f.kind === "rejected" || f.kind === "banned")) {
    res.set("retry-after", "60");
    return openAIError(res, 429,
      "Antigravity refused this request on every account it was tried on with a bare 429 \"Resource has been exhausted\" although quota is available. "
      + "This is not a quota problem: Antigravity rejects some requests outright (for example a third-party agent identity in the system prompt). Retrying will not help.",
      { type: "upstream_rejected", code: "rejected", accounts: kinds });
  }
  const quota = failures.filter((f) => f.kind === "quota");
  if (quota.length) {
    const wait = Math.min(...quota.map((f) => f.cooldownMs ?? 60_000));
    res.set("retry-after", String(Math.ceil(wait / 1000)));
    return openAIError(res, 429, `All accounts are out of quota for ${model.id}: ${quota[0].message}`, { type: "quota_exceeded", code: "quota", accounts: kinds });
  }
  const last = failures.at(-1);
  if (last && last.kind !== "banned" && last.kind !== "verification_required" && last.kind !== "auth") return sendFailure(res, last);

  // Nothing was sent upstream, or only to accounts that turned out unusable.
  return (async () => {
    const accounts = await svc.store.listRuntimeAccounts();
    const next = svc.rotation.nextAvailableAt(accounts, model.id);
    if (next && next > Date.now()) {
      res.set("retry-after", String(Math.ceil((next - Date.now()) / 1000)));
      return openAIError(res, 429, `Every account is cooling down for ${model.id}; next one frees up in ${Math.ceil((next - Date.now()) / 1000)}s.`, { type: "rate_limited", code: "cooldown", accounts: kinds });
    }
    const banned = accounts.filter((a) => a.banned).length;
    const verify = accounts.filter((a) => a.verificationRequired).length;
    return openAIError(res, 503, `No usable Antigravity account for ${model.id}: ${accounts.length} total, ${banned} banned, ${verify} need verification, ${accounts.filter((a) => !a.enabled).length} disabled, ${accounts.filter((a) => a.authFailed).length} auth failed.`, { type: "routing_error", code: "no_account", accounts: kinds });
  })();
}
