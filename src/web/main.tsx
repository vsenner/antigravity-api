import React from "react";
import { createRoot } from "react-dom/client";
import { Activity, AlertTriangle, Clock, Database, RefreshCcw, Server, Upload, Zap } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Pie, PieChart, XAxis, YAxis } from "recharts";
import "./index.css";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

type QuotaMetric = { name: string; displayName?: string; remainingPercent: number; resetTime?: string; source: "models" | "summary" };
type Account = { id: string; email: string; projectId?: string; enabled: boolean; healthy: boolean; requestCount: number; successCount: number; errorCount: number; totalTokens: number; lastError?: string; quota?: { tier?: string; projectId?: string; fetchedAt: number; metrics: QuotaMetric[]; error?: string } };
type Status = { accounts: Account[]; stats: any; models: { id: string; displayName: string }[] };

const quotaConfig = { remaining: { label: "Remaining", color: "var(--chart-2)" } } satisfies ChartConfig;
const pieConfig = { value: { label: "Accounts" }, healthy: { label: "Healthy", color: "var(--chart-2)" }, warning: { label: "Warning", color: "var(--chart-4)" }, exhausted: { label: "Exhausted", color: "var(--chart-5)" } } satisfies ChartConfig;

function App() {
  const [token, setToken] = React.useState(() => localStorage.getItem("antigravityAdminToken") || "");
  const [data, setData] = React.useState<Status | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [account, setAccount] = React.useState("all");
  const [model, setModel] = React.useState("all");

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!token) throw new Error("ADMIN token required");
      const res = await fetch("/api/public/status", { cache: "no-store", headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, [token]);
  React.useEffect(() => { if (token) void load(); }, [load, token]);

  const accounts = React.useMemo(() => (data?.accounts || []).filter(a => account === "all" || a.id === account), [data, account]);
  const relevantMetrics = React.useMemo(() => accounts.flatMap(a => quotaMetricsForModel(a.quota?.metrics || [], model).map(m => ({ ...m, account: a.email || a.id }))), [accounts, model]);
  const avgRemaining = relevantMetrics.length ? relevantMetrics.reduce((s, m) => s + m.remainingPercent, 0) / relevantMetrics.length : 0;
  const critical = relevantMetrics.filter(m => m.remainingPercent <= 10).length;
  const pieRows = React.useMemo(() => {
    let healthy = 0, warning = 0, exhausted = 0;
    for (const a of data?.accounts || []) {
      const metrics = quotaMetricsForModel(a.quota?.metrics || [], model);
      const min = metrics.length ? Math.min(...metrics.map(m => m.remainingPercent)) : 100;
      if (min <= 10) exhausted++; else if (min <= 35) warning++; else healthy++;
    }
    return [{ name: "healthy", value: healthy, fill: "var(--color-healthy)" }, { name: "warning", value: warning, fill: "var(--color-warning)" }, { name: "exhausted", value: exhausted, fill: "var(--color-exhausted)" }];
  }, [data, model]);

  if (!token) return <Shell><Login onLogin={(v) => { localStorage.setItem("antigravityAdminToken", v); setToken(v); }} /></Shell>;
  if (loading && !data) return <Shell><SkeletonGrid /></Shell>;
  if (error) return <Shell><Card className="border-destructive"><CardHeader><CardTitle>Failed to load dashboard</CardTitle><CardDescription>{error}</CardDescription></CardHeader><CardContent><Button onClick={load}>Retry</Button></CardContent></Card></Shell>;

  return <Shell>
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2"><Badge variant="secondary">Live</Badge><Badge variant="outline">Antigravity API</Badge></div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">Operational dashboard</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">Per-account quotas, 5h/weekly reset windows, model availability, and runtime usage for antigravity.vadym.live.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={account} onValueChange={setAccount}><SelectTrigger className="w-full sm:w-[240px]"><SelectValue placeholder="Account" /></SelectTrigger><SelectContent><SelectItem value="all">All accounts</SelectItem>{data?.accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.email || a.id}</SelectItem>)}</SelectContent></Select>
          <Select value={model} onValueChange={setModel}><SelectTrigger className="w-full sm:w-[260px]"><SelectValue placeholder="Model" /></SelectTrigger><SelectContent><SelectItem value="all">All quotas</SelectItem>{data?.models.map(m => <SelectItem key={m.id} value={m.id}>{m.displayName}</SelectItem>)}</SelectContent></Select>
          <AddGoogleButton token={token} onDone={load} /><ImportButton token={token} onDone={load} /><Button variant="outline" onClick={load}><RefreshCcw className="mr-2 size-4" />Refresh</Button><Button variant="ghost" onClick={() => { localStorage.removeItem("antigravityAdminToken"); setToken(""); }}>Logout</Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Server} label="Accounts" value={String(data?.stats?.accountsTotal ?? 0)} sub={`${data?.stats?.accountsHealthy ?? 0} healthy`} />
        <MetricCard icon={Activity} label="Avg remaining" value={`${avgRemaining.toFixed(1)}%`} sub={`${critical} critical quota rows`} />
        <MetricCard icon={Zap} label="Requests" value={String(data?.stats?.requestsTotal ?? 0)} sub={`${data?.stats?.successesTotal ?? 0} success`} />
        <MetricCard icon={Database} label="Tokens" value={String(data?.stats?.tokensTotal ?? 0)} sub={`${data?.stats?.errorsTotal ?? 0} errors`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_.8fr]">
        <Card><CardHeader><CardTitle>Quota by account</CardTitle><CardDescription>Remaining percentage for selected model/group.</CardDescription></CardHeader><CardContent><ChartContainer config={quotaConfig} className="h-[320px] w-full"><BarChart data={chartRows(accounts, model)} margin={{ top: 24, right: 12, left: 0, bottom: 54 }}><CartesianGrid vertical={false} /><XAxis dataKey="account" angle={-35} textAnchor="end" height={70} interval={0} /><YAxis domain={[0, 100]} /><ChartTooltip content={<ChartTooltipContent />} /><Bar dataKey="remaining" fill="var(--color-remaining)" radius={8}><LabelList dataKey="remaining" position="top" formatter={(v: any) => `${Number(v).toFixed(0)}%`} /></Bar></BarChart></ChartContainer></CardContent></Card>
        <Card><CardHeader><CardTitle>Account health</CardTitle><CardDescription>Based on lowest visible quota row.</CardDescription></CardHeader><CardContent><ChartContainer config={pieConfig} className="mx-auto h-[320px]"><PieChart><ChartTooltip content={<ChartTooltipContent nameKey="name" />} /><Pie data={pieRows} dataKey="value" nameKey="name" innerRadius={70} outerRadius={115} paddingAngle={4}>{pieRows.map((r) => <Cell key={r.name} fill={r.fill} />)}</Pie></PieChart></ChartContainer></CardContent></Card>
      </div>

      <Tabs defaultValue="accounts"><TabsList><TabsTrigger value="accounts">Accounts</TabsTrigger><TabsTrigger value="models">Runtime models</TabsTrigger></TabsList>
        <TabsContent value="accounts" className="mt-4"><div className="grid gap-4 xl:grid-cols-2">{accounts.map(a => <AccountCard key={a.id} account={a} model={model} token={token} onDone={load} />)}</div></TabsContent>
        <TabsContent value="models" className="mt-4"><ModelsTable rows={data?.stats?.models || []} /></TabsContent>
      </Tabs>
    </div>
  </Shell>;
}


function Login({ onLogin }: { onLogin: (token: string) => void }) { const [v,setV]=React.useState(""); return <Card className="mx-auto mt-20 max-w-md"><CardHeader><CardTitle>Admin login</CardTitle><CardDescription>Enter MANAGEMENT_TOKEN / ADMIN token. It is stored only in this browser localStorage and sent as Bearer header.</CardDescription></CardHeader><CardContent className="space-y-3"><input className="w-full rounded-md border bg-background px-3 py-2" type="password" value={v} onChange={e=>setV(e.target.value)} placeholder="ADMIN token" onKeyDown={e=>{if(e.key==='Enter'&&v.trim())onLogin(v.trim())}}/><Button className="w-full" onClick={()=>v.trim()&&onLogin(v.trim())}>Login</Button></CardContent></Card>; }
function AddGoogleButton({ token, onDone }: { token: string; onDone: () => void }) {
  const [flow, setFlow] = React.useState<any>(null);
  const [callbackUrl, setCallbackUrl] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  async function start(){ setBusy(true); try{ const r=await fetch("/api/oauth/manual/start",{method:"POST",headers:{authorization:`Bearer ${token}`}}); if(!r.ok) throw new Error(await r.text()); setFlow(await r.json()); }catch(e){ alert(e instanceof Error?e.message:String(e)); } finally{ setBusy(false); } }
  async function complete(){ setBusy(true); try{ const r=await fetch("/api/oauth/manual/complete",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${token}`},body:JSON.stringify({callbackUrl})}); if(!r.ok) throw new Error(await r.text()); const j=await r.json(); alert(`Added ${j.account?.email || "account"}`); setFlow(null); setCallbackUrl(""); onDone(); }catch(e){ alert(e instanceof Error?e.message:String(e)); } finally{ setBusy(false); } }
  return <div className="flex flex-col gap-2 sm:flex-row">
    <Button onClick={start} disabled={busy}><Upload className="mr-2 size-4" />{busy ? "Starting..." : "Add Google account"}</Button>
    {flow && <Card className="fixed inset-x-4 top-16 z-50 mx-auto max-w-2xl border-primary shadow-2xl"><CardHeader><CardTitle>Authorize Google account</CardTitle><CardDescription>Open the generated Cockpit-style Google URL. After login, browser will fail to open localhost; copy the full localhost URL from address bar and paste it here.</CardDescription></CardHeader><CardContent className="space-y-4"><Button className="w-full" onClick={()=>window.open(flow.url,"_blank")}>Open Google authorization</Button><div className="rounded-xl border bg-muted/30 p-3 text-xs break-all">{flow.url}</div><input className="w-full rounded-md border bg-background px-3 py-2" value={callbackUrl} onChange={e=>setCallbackUrl(e.target.value)} placeholder="Paste http://localhost:61135/oauth-callback?code=...&state=..."/><div className="flex gap-2"><Button disabled={!callbackUrl || busy} onClick={complete}>Complete import</Button><Button variant="outline" onClick={()=>setFlow(null)}>Cancel</Button></div></CardContent></Card>}
  </div>;
}
function ImportButton({ token, onDone }: { token: string; onDone: () => void }) { const ref=React.useRef<HTMLInputElement>(null); const [busy,setBusy]=React.useState(false); async function file(f: File){ setBusy(true); try{ const json=JSON.parse(await f.text()); const r=await fetch('/api/accounts/import',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify(json)}); if(!r.ok) throw new Error(await r.text()); alert('Imported: '+JSON.stringify(await r.json())); onDone(); }catch(e){ alert(e instanceof Error?e.message:String(e)); } finally{ setBusy(false); if(ref.current) ref.current.value=''; }} return <><input ref={ref} type="file" accept="application/json,.json" className="hidden" onChange={e=>e.target.files?.[0]&&file(e.target.files[0])}/><Button variant="outline" disabled={busy} onClick={()=>ref.current?.click()}><Upload className="mr-2 size-4" />{busy?'Importing...':'Import accounts'}</Button></>; }

function Shell({ children }: { children: React.ReactNode }) { return <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,.18),transparent_35%),radial-gradient(circle_at_top_right,rgba(168,85,247,.14),transparent_30%)] p-4 text-foreground sm:p-6 lg:p-8"><div className="mx-auto max-w-7xl">{children}</div></main>; }
function MetricCard({ icon: Icon, label, value, sub }: any) { return <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle><Icon className="size-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-3xl font-bold">{value}</div><p className="text-xs text-muted-foreground">{sub}</p></CardContent></Card>; }
function AccountCard({ account, model, token, onDone }: { account: Account; model: string; token: string; onDone: () => void }) {
  const metrics = quotaMetricsForModel(account.quota?.metrics || [], model);
  const summary = quotaSummary(metrics);
  const min = summary.all.length ? Math.min(...summary.all.map(m => m.remainingPercent)) : 100;
  return <Card className="overflow-hidden">
    <CardHeader className="pb-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="truncate text-base sm:text-lg">{account.email || account.id}</CardTitle>
          <CardDescription className="truncate">{account.quota?.projectId || account.projectId || "No project"} · {account.quota?.tier || "unknown tier"}</CardDescription>
        </div>
        <div className="flex flex-col gap-2"><Badge className={badgeClass(min)}>{min.toFixed(0)}%</Badge><Button size="sm" variant="destructive" onClick={async()=>{ if(!confirm(`Delete ${account.email || account.id}?`)) return; const r=await fetch(`/api/accounts/${encodeURIComponent(account.id)}`,{method:"DELETE",headers:{authorization:`Bearer ${token}`}}); if(!r.ok) alert(await r.text()); onDone(); }}>Delete</Button></div>
      </div>
    </CardHeader>
    <CardContent className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <SummaryQuota title="Gemini 5h" metric={summary.gemini5h} />
        <SummaryQuota title="Gemini week" metric={summary.geminiWeekly} />
        <SummaryQuota title="Claude 5h" metric={summary.claude5h} />
        <SummaryQuota title="Claude week" metric={summary.claudeWeekly} />
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs"><Mini label="Req" value={account.requestCount} /><Mini label="OK" value={account.successCount} /><Mini label="Err" value={account.errorCount} /></div>
      {account.quota?.error && <div className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs"><AlertTriangle className="size-4 text-destructive" />{account.quota.error}</div>}
      <Accordion type="single" collapsible className="w-full"><AccordionItem value="details"><AccordionTrigger className="text-sm">Detailed model quotas ({metrics.length})</AccordionTrigger><AccordionContent><div className="space-y-2 pt-2">{metrics.map(m => <QuotaRow key={`${m.source}-${m.name}-${m.resetTime}`} metric={m} />)}</div>{!metrics.length && <p className="text-sm text-muted-foreground">No quota rows for selected filter.</p>}</AccordionContent></AccordionItem></Accordion>
    </CardContent>
  </Card>;
}
function SummaryQuota({ title, metric }: { title: string; metric?: QuotaMetric }) { const p = metric?.remainingPercent ?? null; return <div className="rounded-xl border bg-muted/20 p-3"><div className="flex items-center justify-between gap-2"><div className="text-xs text-muted-foreground">{title}</div>{p == null ? <Badge variant="outline">—</Badge> : <Badge className={badgeClass(p)}>{p.toFixed(0)}%</Badge>}</div><Progress value={p ?? 0} className="mt-2 h-1.5" /><div className="mt-1 truncate text-[11px] text-muted-foreground">{metric?.resetTime ? timeLeft(metric.resetTime) : "no reset"}</div></div>; }
function Mini({ label, value }: any) { return <div className="rounded-xl border bg-muted/20 p-2"><div className="text-muted-foreground">{label}</div><div className="font-semibold">{value}</div></div>; }
function QuotaRow({ metric }: { metric: QuotaMetric }) { return <div className="space-y-2 rounded-xl border bg-card/60 p-3"><div className="flex items-center justify-between gap-3"><div><div className="font-medium">{canonicalModelLabel(metric)}</div><div className="text-xs text-muted-foreground">{metric.name} · {metric.source}</div></div><Badge variant="outline" className={badgeClass(metric.remainingPercent)}>{metric.remainingPercent.toFixed(1)}%</Badge></div><Progress value={metric.remainingPercent} /><div className="flex items-center gap-2 text-xs text-muted-foreground"><Clock className="size-3" />{metric.resetTime ? `resets in ${timeLeft(metric.resetTime)} · ${new Date(metric.resetTime).toLocaleString()}` : "No reset time"}</div></div>; }
function quotaSummary(metrics: QuotaMetric[]) { const byName = (id: string) => metrics.find(m => m.name === id); const byText = (...parts: string[]) => metrics.find(m => parts.every(part => `${m.name} ${m.displayName || ""}`.toLowerCase().includes(part))); const gemini5h = byName("gemini-5h") || byText("gemini", "five") || byText("gemini", "5h"); const geminiWeekly = byName("gemini-weekly") || byText("gemini", "weekly"); const claude5h = byName("3p-5h") || byName("claude:5h") || byText("claude", "five") || byText("3p", "five"); const claudeWeekly = byName("3p-weekly") || byName("claude:weekly") || byText("claude", "weekly") || byText("3p", "weekly"); return { all: metrics, gemini5h, geminiWeekly, claude5h, claudeWeekly }; }
function canonicalModelLabel(metric: QuotaMetric) { const id = metric.name; const map: Record<string, string> = { "gemini-2.5-flash-lite": "Gemini 2.5 Flash Lite", "gemini-2.5-flash": "Gemini 2.5 Flash", "gemini-2.5-flash-thinking": "Gemini 2.5 Flash Thinking", "gemini-2.5-pro": "Gemini 2.5 Pro", "gemini-3-flash": "Gemini 3 Flash", "gemini-3-flash-agent": "Gemini 3 Flash Agent", "gemini-pro-agent": "Gemini Pro Agent", "gemini-3.1-flash-lite": "Gemini 3.1 Flash Lite", "gemini-3.1-flash-image": "Gemini 3.1 Flash Image", "gemini-3.1-pro-high": "Gemini 3.1 Pro High", "gemini-3.1-pro-low": "Gemini 3.1 Pro Low", "gemini-3.5-flash-low": "Gemini 3.5 Flash Medium", "gemini-3.5-flash-extra-low": "Gemini 3.5 Flash Low", "claude-sonnet-4-6": "Claude Sonnet 4.6 Thinking", "claude-opus-4-6-thinking": "Claude Opus 4.6 Thinking", "gpt-oss-120b-medium": "GPT-OSS 120B Medium", "gemini-weekly": "Gemini weekly limit", "gemini-5h": "Gemini 5h limit", "3p-weekly": "Claude/3P weekly limit", "3p-5h": "Claude/3P 5h limit" }; return map[id] || metric.displayName || id; }
function ModelsTable({ rows }: { rows: any[] }) { return <Card><CardHeader><CardTitle>Runtime model usage</CardTitle><CardDescription>Requests and token accounting since service start.</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Model</TableHead><TableHead>Req</TableHead><TableHead>OK</TableHead><TableHead>Err</TableHead><TableHead>Tokens</TableHead><TableHead>Prompt</TableHead><TableHead>Completion</TableHead></TableRow></TableHeader><TableBody>{rows.map(r => <TableRow key={r.model}><TableCell className="font-medium">{r.model}</TableCell><TableCell>{r.requests}</TableCell><TableCell>{r.successes}</TableCell><TableCell>{r.errors}</TableCell><TableCell>{r.totalTokens}</TableCell><TableCell>{r.promptTokens}</TableCell><TableCell>{r.completionTokens}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>; }
function SkeletonGrid() { return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div>; }
function quotaMetricsForModel(metrics: QuotaMetric[], model: string) { if (model === "all") return metrics; return metrics.filter(m => matchMetric(m, model)); }
function matchMetric(metric: QuotaMetric, model: string) { const hay = `${metric.name} ${metric.displayName || ""}`.toLowerCase(); const m = model.toLowerCase(); if (m.includes("opus")) return hay.includes("opus") || hay.includes("3p"); if (m.includes("sonnet")) return hay.includes("sonnet") || hay.includes("3p"); if (m.includes("gemini")) return hay.includes("gemini"); return hay.includes(m); }
function chartRows(accounts: Account[], model: string) { return accounts.map(a => { const ms = quotaMetricsForModel(a.quota?.metrics || [], model); const remaining = ms.length ? Math.min(...ms.map(m => m.remainingPercent)) : 0; return { account: a.email || a.id, remaining }; }); }
function badgeClass(p: number) { return p <= 10 ? "border-red-500/40 bg-red-500/15 text-red-200" : p <= 35 ? "border-amber-500/40 bg-amber-500/15 text-amber-100" : "border-emerald-500/40 bg-emerald-500/15 text-emerald-100"; }
function timeLeft(iso: string) { const ms = new Date(iso).getTime() - Date.now(); if (!Number.isFinite(ms)) return "unknown"; if (ms <= 0) return "now"; const h = Math.floor(ms / 3600000); const m = Math.floor((ms % 3600000) / 60000); const d = Math.floor(h / 24); const rh = h % 24; return d ? `${d}d ${rh}h` : `${h}h ${m}m`; }

createRoot(document.getElementById("root")!).render(<App />);
