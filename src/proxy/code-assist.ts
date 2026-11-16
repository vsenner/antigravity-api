import { IDE_METADATA, QUOTA_BASE_URL, USER_AGENT } from "../config.js";

export interface PostResult { ok: boolean; status: number; json: any; message: string }

/** POST to a v1internal method with the IDE's identity. */
export async function postInternal(method: string, token: string, payload: unknown, userAgent = USER_AGENT, base = QUOTA_BASE_URL): Promise<PostResult> {
  const res = await fetch(`${base}/v1internal:${method}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "user-agent": userAgent, accept: "*/*" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { text }; }
  return { ok: res.ok, status: res.status, json, message: String(json?.error?.message || json?.error?.status || text.slice(0, 200)) };
}

export interface CodeAssistInfo { projectId?: string; tier?: string; error?: string }

/** The account's Cloud Code project and subscription tier, as the IDE learns them at sign-in. */
export async function loadCodeAssist(token: string): Promise<CodeAssistInfo> {
  const res = await postInternal("loadCodeAssist", token, { metadata: IDE_METADATA, mode: "FULL_ELIGIBILITY_CHECK" });
  if (!res.ok) return { error: `loadCodeAssist ${res.status}: ${res.message}` };
  const project = res.json.cloudaicompanionProject;
  const projectId = typeof project === "string" ? project : project?.id || project?.projectId;
  return { projectId: projectId || undefined, tier: res.json.paidTier?.id || res.json.currentTier?.id };
}

export async function fetchAvailableModels(token: string, projectId: string): Promise<PostResult> {
  return postInternal("fetchAvailableModels", token, { project: projectId });
}
