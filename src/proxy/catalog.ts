import { CATALOG_TTL_MS } from "../config.js";
import { fetchAvailableModels } from "./code-assist.js";
import { HIDDEN_ALIASES, MODELS, RETIRED_MODELS, familyOf, isAgentModel } from "./models.js";

export interface CatalogEntry {
  id: string;
  object: "model";
  owned_by: "antigravity";
  display_name: string;
  family: string;
  upstream: string;
  aliases: string[];
  context_length?: number;
  max_output_tokens?: number;
  supports_images?: boolean;
  supports_thinking?: boolean;
  /** Where the entry came from: the live catalogue, or the static list only. */
  source: "upstream" | "static";
}

export interface UpstreamCatalog { fetchedAt: number; models: Record<string, any>; defaultAgentModelId?: string; agentModelIds?: string[] }

/**
 * /v1/models = what fetchAvailableModels lists for a working account (minus tab/internal
 * entries, legacy aliases and retired models), plus static entries the catalogue omits.
 */
export class ModelCatalog {
  private cached?: UpstreamCatalog;

  async upstreamPool(
    credsList: { accountId: string; token: string; projectId: string }[],
    onAccountModels?: (accountId: string, modelIds: string[]) => void,
    force = false,
  ): Promise<UpstreamCatalog | undefined> {
    if (!force && this.cached && Date.now() - this.cached.fetchedAt < CATALOG_TTL_MS) return this.cached;
    if (!credsList.length) return this.cached;
    const results = await Promise.all(credsList.map(async (c) => {
      const res = await fetchAvailableModels(c.token, c.projectId).catch(() => undefined);
      return { accountId: c.accountId, res };
    }));
    const mergedModels: Record<string, any> = {};
    let defaultAgentModelId: string | undefined;
    const agentModelIds = new Set<string>();
    let anyOk = false;
    for (const { accountId, res } of results) {
      if (!res?.ok) continue;
      anyOk = true;
      const models = res.json.models || {};
      onAccountModels?.(accountId, Object.keys(models));
      for (const [id, info] of Object.entries<any>(models)) {
        if (!mergedModels[id]) mergedModels[id] = info;
      }
      if (!defaultAgentModelId && res.json.defaultAgentModelId) defaultAgentModelId = res.json.defaultAgentModelId;
      for (const id of res.json.agentModelSorts?.[0]?.groups?.flatMap((g: any) => g.modelIds || []) || []) {
        agentModelIds.add(id);
      }
    }
    if (!anyOk) return this.cached;
    this.cached = {
      fetchedAt: Date.now(),
      models: mergedModels,
      defaultAgentModelId,
      agentModelIds: [...agentModelIds],
    };
    return this.cached;
  }

  async upstream(creds: () => Promise<{ token: string; projectId: string } | undefined>, force = false): Promise<UpstreamCatalog | undefined> {
    if (!force && this.cached && Date.now() - this.cached.fetchedAt < CATALOG_TTL_MS) return this.cached;
    const c = await creds().catch(() => undefined);
    if (!c) return this.cached;
    const res = await fetchAvailableModels(c.token, c.projectId).catch(() => undefined);
    if (!res?.ok) return this.cached;
    this.cached = {
      fetchedAt: Date.now(),
      models: res.json.models || {},
      defaultAgentModelId: res.json.defaultAgentModelId,
      agentModelIds: res.json.agentModelSorts?.[0]?.groups?.flatMap((g: any) => g.modelIds || []),
    };
    return this.cached;
  }

  list(upstream?: UpstreamCatalog): CatalogEntry[] {
    const out = new Map<string, CatalogEntry>();
    const live = upstream?.models ?? {};
    for (const [id, info] of Object.entries<any>(live)) {
      if (!isAgentModel(id, info) || HIDDEN_ALIASES.has(id) || RETIRED_MODELS.has(id)) continue;
      const known = MODELS.find((m) => m.upstream === id);
      out.set(known?.id ?? id, {
        id: known?.id ?? id, object: "model", owned_by: "antigravity",
        display_name: info.displayName || known?.displayName || id,
        family: familyOf(id), upstream: id, aliases: known?.aliases ?? [],
        context_length: info.maxTokens, max_output_tokens: info.maxOutputTokens,
        supports_images: Boolean(info.supportsImages), supports_thinking: Boolean(info.supportsThinking),
        source: "upstream",
      });
    }
    for (const m of MODELS) {
      if (out.has(m.id)) continue;
      // Without a live catalogue every static entry is listed; with one, only those it cannot show.
      if (upstream && !m.unlisted) continue;
      out.set(m.id, { id: m.id, object: "model", owned_by: "antigravity", display_name: m.displayName, family: m.family, upstream: m.upstream, aliases: m.aliases, source: "static" });
    }
    return [...out.values()];
  }
}
