import React from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  Clock,
  Copy,
  Cpu,
  Database,
  ExternalLink,
  Layers,
  Lock,
  LogOut,
  Moon,
  RefreshCcw,
  Server,
  Sparkles,
  Sun,
  Timer,
  Upload,
  UserCheck,
  Zap,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  XAxis,
  YAxis,
} from "recharts";
import "./index.css";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

export type QuotaMetric = {
  name: string;
  displayName?: string;
  remainingPercent: number;
  resetTime?: string;
  source: "models" | "summary";
};

export type Account = {
  id: string;
  email: string;
  projectId?: string;
  enabled: boolean;
  healthy: boolean;
  banned?: { at: string; message: string };
  verificationRequired?: { at: string; message: string };
  supportedModels?: string[];
  unsupportedModels?: string[];
  requestCount: number;
  successCount: number;
  errorCount: number;
  totalTokens: number;
  lastError?: string;
  quota?: {
    tier?: string;
    projectId?: string;
    fetchedAt: number;
    metrics: QuotaMetric[];
    error?: string;
  };
};

export type Status = {
  accounts: Account[];
  stats: any;
  models: { id: string; displayName: string; aliases?: string[] }[];
};

const quotaChartConfig = {
  remaining: {
    label: "Available Quota %",
    color: "var(--primary)",
  },
} satisfies ChartConfig;

export function App() {
  const [token, setToken] = React.useState<string>(() => localStorage.getItem("antigravityAdminToken") || "");
  const [data, setData] = React.useState<Status | null>(null);
  const [overview, setOverview] = React.useState<any | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [isDark, setIsDark] = React.useState(() => {
    if (typeof window !== "undefined") {
      return document.documentElement.classList.contains("dark") || window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    return true;
  });

  React.useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDark]);

  const load = React.useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [resStatus, resOverview] = await Promise.all([
        fetch("/api/accounts/status", { credentials: "same-origin", headers: { authorization: `Bearer ${token}` } }),
        fetch("/api/accounts/overview", { credentials: "same-origin", headers: { authorization: `Bearer ${token}` } }),
      ]);

      if (resStatus.status === 401 || resOverview.status === 401) {
        setToken("");
        localStorage.removeItem("antigravityAdminToken");
        return;
      }
      if (resStatus.ok) setData(await resStatus.json());
      if (resOverview.ok) setOverview(await resOverview.json());
    } catch (e) {
      console.error("Failed to load status:", e);
    } finally {
      setLoading(false);
    }
  }, [token]);

  React.useEffect(() => {
    if (token) load();
  }, [token, load]);

  const accounts = data?.accounts || [];
  const summary = overview?.summary;

  const copyOverviewUrl = () => {
    navigator.clipboard.writeText(`${window.location.origin}/api/accounts/overview`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 bg-background text-foreground">
        <Login onLogin={(v) => { localStorage.setItem("antigravityAdminToken", v); setToken(v); }} />
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="mx-auto max-w-7xl p-3 space-y-3 font-sans">
        <Skeleton className="h-8 w-full" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      </div>
    );
  }

  // Bar chart dataset: true current usable quota per account
  const chartData = accounts.map((a) => {
    const isPro = a.quota?.tier === "g1-pro-tier" || (a as any).tier === "g1-pro-tier";
    const metrics = a.quota?.metrics || [];
    const g5h = metrics.find((x) => x.name === "gemini-5h");
    const gWeek = metrics.find((x) => x.name === "gemini-weekly");
    
    // Pro uses active 5h window; Free has only weekly limit
    const val = isPro
      ? (g5h ? g5h.remainingPercent : (gWeek ? gWeek.remainingPercent : 100))
      : (gWeek ? gWeek.remainingPercent : 0);

    return {
      name: a.email ? a.email.split("@")[0] : a.id,
      remaining: Math.round(val * 10) / 10,
      tier: isPro ? "Pro (5h cycle)" : "Free (Weekly)",
      isPro,
    };
  });

  const nextRefills = summary?.upcomingRefills || [];
  const targetEta = summary?.target95Eta || "N/A";
  const nearestRefill = summary?.nearestRefill;

  return (
    <div className="mx-auto max-w-7xl px-3 py-2.5 sm:px-6 sm:py-3.5 space-y-2.5 font-sans bg-background text-foreground min-h-screen">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded bg-primary text-primary-foreground font-black text-xs">
            AG
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-sm tracking-tight">Antigravity Quota Manager</span>
            <Badge variant="outline" className="text-[10px] py-0 px-1 font-mono">
              {accounts.length} accts ({summary?.proCount ?? 4} Pro / {summary?.freeCount ?? 3} Free)
            </Badge>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={load} disabled={loading}>
            <RefreshCcw className={`size-3 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={copyOverviewUrl}>
            {copied ? <Check className="size-3 text-emerald-500 mr-1" /> : <Copy className="size-3 mr-1" />}
            /overview
          </Button>
          <AddGoogleButton token={token} onDone={load} />
          <ImportButton token={token} onDone={load} />
          <Button variant="ghost" size="icon" className="size-7" onClick={() => setIsDark(!isDark)} title="Toggle Dark/Light">
            {isDark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="size-7" onClick={() => { localStorage.removeItem("antigravityAdminToken"); setToken(""); }} title="Sign Out">
            <LogOut className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* TOP KPI NUMBERS: Realistic Pool Capacity, Refill ETA, Imminent Reset */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded border bg-card p-2.5 space-y-0.5">
          <div className="text-[10px] text-muted-foreground uppercase font-semibold">Gemini Pool Capacity</div>
          <div className="text-xl font-black tracking-tight text-foreground">
            {summary?.geminiPoolCapacityPercent != null ? `${summary.geminiPoolCapacityPercent}%` : "—"}
          </div>
          <div className="text-[10px] text-muted-foreground">
            Pro avg: {summary?.geminiProAvgPercent ?? 0}% · Free: {summary?.geminiFreeAvgPercent ?? 0}%
          </div>
        </div>

        <div className="rounded border bg-card p-2.5 space-y-0.5">
          <div className="text-[10px] text-muted-foreground uppercase font-semibold">Target 95% Refill ETA</div>
          <div className="text-xl font-black tracking-tight text-primary">
            {targetEta}
          </div>
          <div className="text-[10px] text-muted-foreground truncate">
            {targetEta === "Already at 95%+" ? "Capacity target fulfilled" : "Continuous 5h window restoration"}
          </div>
        </div>

        <div className="rounded border bg-card p-2.5 space-y-0.5">
          <div className="text-[10px] text-muted-foreground uppercase font-semibold">Next Quota Refill</div>
          <div className="text-xl font-black tracking-tight text-foreground">
            {nearestRefill ? `${formatTimeLeftSec(nearestRefill.secondsLeft)}` : "None pending"}
          </div>
          <div className="text-[10px] text-muted-foreground truncate">
            {nearestRefill
              ? `${nearestRefill.email.split("@")[0]} (+${nearestRefill.boostToPool}% pool)`
              : "All accounts topped"}
          </div>
        </div>

        <div className="rounded border bg-card p-2.5 space-y-0.5">
          <div className="text-[10px] text-muted-foreground uppercase font-semibold">Claude / 3P Capacity</div>
          <div className="text-xl font-black tracking-tight text-foreground">
            {summary?.claudePoolCapacityPercent != null ? `${summary.claudePoolCapacityPercent}%` : "100%"}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {data?.stats?.tokensTotal ? `${data.stats.tokensTotal.toLocaleString()} tokens` : "Full capacity available"}
          </div>
        </div>
      </div>

      {/* CHARTS & RECOVERY SCHEDULE (Equal Height, Stretched) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5 items-stretch">
        {/* Chart: Per Account Usable Capacity */}
        <div className="lg:col-span-2 rounded border bg-card p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
            <span>Usable Quota Per Account</span>
            <span className="font-mono text-[10px] font-normal lowercase">
              Pro (5h window) vs Free (weekly cap)
            </span>
          </div>

          <div className="flex-1 w-full min-h-[180px] flex items-center pt-2">
            <ChartContainer config={quotaChartConfig} className="h-[180px] w-full">
              <BarChart data={chartData} margin={{ top: 16, right: 10, left: -25, bottom: 5 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="remaining" fill="var(--color-primary)" radius={[3, 3, 0, 0]}>
                  <LabelList
                    dataKey="remaining"
                    position="top"
                    formatter={(v: any) => `${Number(v).toFixed(0)}%`}
                    style={{ fontSize: 10, fontWeight: 700 }}
                  />
                </Bar>
              </BarChart>
            </ChartContainer>
          </div>
        </div>

        {/* Refill Schedule */}
        <div className="rounded border bg-card p-3 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
              <span>Next Upcoming Refills</span>
              <span className="font-mono text-[10px] font-normal lowercase">deduplicated</span>
            </div>

            <div className="divide-y text-xs">
              {nextRefills.slice(0, 5).map((r: any) => (
                <div key={`${r.accountId}-${r.metric}`} className="flex items-center justify-between py-1.5">
                  <div className="min-w-0 pr-2">
                    <div className="font-semibold truncate text-[11px] flex items-center gap-1.5">
                      <span>{r.email.split("@")[0]}</span>
                      <Badge variant="outline" className="text-[9px] py-0 px-1 font-mono">
                        {r.isPro ? "Pro" : "Free"}
                      </Badge>
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {r.window}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono font-bold text-primary text-[11px]">{formatTimeLeftSec(r.secondsLeft)}</div>
                    <div className="text-[10px] text-muted-foreground">+{r.boostToPool}% pool</div>
                  </div>
                </div>
              ))}
              {!nextRefills.length && (
                <div className="text-xs text-muted-foreground py-6 text-center">
                  All account limits fully topped.
                </div>
              )}
            </div>
          </div>
          <div className="text-[9px] text-muted-foreground pt-1.5 border-t mt-1">
            Pro 5h windows recycle continuously (33.6x/wk) · Free caps reset weekly.
          </div>
        </div>
      </div>

      {/* DENSE CONNECTED ACCOUNTS OVERVIEW */}
      <div className="rounded border bg-card p-3 space-y-2">
        <div className="flex items-center justify-between border-b pb-1.5">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Connected Accounts Quota Windows
          </span>
          <span className="text-[10px] text-muted-foreground">
            Clear numbers & countdowns (no bloated progress bars)
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {accounts.map((a) => {
            const isPro = a.quota?.tier === "g1-pro-tier" || (a as any).tier === "g1-pro-tier";
            const metrics = a.quota?.metrics || [];
            const getM = (id: string) => metrics.find((m) => m.name === id);
            const g5h = getM("gemini-5h");
            const gWeek = getM("gemini-weekly");
            const c5h = getM("3p-5h");
            const cWeek = getM("3p-weekly");

            return (
              <div key={a.id} className="rounded border bg-muted/15 p-2 text-xs space-y-1.5">
                <div className="flex items-center justify-between gap-1">
                  <div className="min-w-0">
                    <div className="font-bold truncate text-xs">{a.email || a.id}</div>
                    <div className="text-[10px] text-muted-foreground font-mono truncate">
                      {a.quota?.projectId || a.projectId || "no-project"} · {isPro ? "Google AI Pro" : "Free Tier"}
                    </div>
                  </div>
                  <Badge variant={a.healthy && !a.banned && !a.verificationRequired ? "outline" : "destructive"} className="text-[9px] py-0 px-1 shrink-0 font-mono" title={a.banned?.message || a.verificationRequired?.message}>
                    {a.banned ? "BANNED" : a.verificationRequired ? "VERIFY" : a.healthy ? "HEALTHY" : "LIMITED"}
                  </Badge>
                </div>

                {/* 4 Windows Grid */}
                <div className="grid grid-cols-2 gap-1 text-[11px]">
                  {/* Gemini 5h */}
                  <div className="rounded bg-background border px-1.5 py-1">
                    <div className="text-muted-foreground text-[9px] uppercase font-semibold">Gemini 5h</div>
                    <div className="font-bold text-xs">
                      {isPro ? (g5h ? `${g5h.remainingPercent.toFixed(0)}%` : "100%") : "N/A (Free)"}
                    </div>
                    <div className="text-[9px] text-muted-foreground truncate">
                      {isPro ? (g5h?.resetTime ? `in ${timeLeft(g5h.resetTime)}` : "Full") : "Weekly only"}
                    </div>
                  </div>

                  {/* Gemini Weekly */}
                  <div className="rounded bg-background border px-1.5 py-1">
                    <div className="text-muted-foreground text-[9px] uppercase font-semibold">Gemini Week</div>
                    <div className="font-bold text-xs">
                      {gWeek ? `${gWeek.remainingPercent.toFixed(0)}%` : (isPro ? "100%" : "0%")}
                    </div>
                    <div className="text-[9px] text-muted-foreground truncate">
                      {gWeek?.resetTime ? `in ${timeLeft(gWeek.resetTime)}` : (isPro ? "Bounded by 5h" : "Exhausted")}
                    </div>
                  </div>

                  {/* Claude 5h */}
                  <div className="rounded bg-background border px-1.5 py-1">
                    <div className="text-muted-foreground text-[9px] uppercase font-semibold">Claude 5h</div>
                    <div className="font-bold text-xs">
                      {isPro ? (c5h ? `${c5h.remainingPercent.toFixed(0)}%` : "100%") : "N/A (Free)"}
                    </div>
                    <div className="text-[9px] text-muted-foreground truncate">
                      {isPro ? (c5h?.resetTime ? `in ${timeLeft(c5h.resetTime)}` : "Full") : "Weekly only"}
                    </div>
                  </div>

                  {/* Claude Weekly */}
                  <div className="rounded bg-background border px-1.5 py-1">
                    <div className="text-muted-foreground text-[9px] uppercase font-semibold">Claude Week</div>
                    <div className="font-bold text-xs">
                      {cWeek ? `${cWeek.remainingPercent.toFixed(0)}%` : "100%"}
                    </div>
                    <div className="text-[9px] text-muted-foreground truncate">
                      {cWeek?.resetTime ? `in ${timeLeft(cWeek.resetTime)}` : "Full"}
                    </div>
                  </div>
                </div>

                {/* Account Footnote & Removal */}
                <div className="flex items-center justify-between text-[10px] text-muted-foreground border-t pt-1">
                  <span>Tokens: {a.totalTokens.toLocaleString()} (Req: {a.requestCount})</span>
                  <button
                    className="text-destructive hover:underline"
                    onClick={async () => {
                      if (!confirm(`Delete ${a.email || a.id}?`)) return;
                      await fetch(`/api/accounts/${encodeURIComponent(a.id)}`, {
                        method: "DELETE",
                        headers: { authorization: `Bearer ${token}` },
                      });
                      load();
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const [v, setV] = React.useState("");
  return (
    <Card className="max-w-xs w-full">
      <CardHeader className="p-3 pb-1">
        <CardTitle className="text-sm font-bold">Admin Login</CardTitle>
        <CardDescription className="text-xs">Enter MANAGEMENT_TOKEN</CardDescription>
      </CardHeader>
      <CardContent className="p-3 pt-1 space-y-2">
        <input
          className="w-full rounded border bg-background px-2.5 py-1.5 text-xs font-mono"
          type="password"
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder="Token"
          onKeyDown={(e) => e.key === "Enter" && v.trim() && onLogin(v.trim())}
        />
        <Button size="sm" className="w-full text-xs h-7" onClick={() => v.trim() && onLogin(v.trim())}>
          Sign In
        </Button>
      </CardContent>
    </Card>
  );
}

function AddGoogleButton({ token, onDone }: { token: string; onDone: () => void }) {
  const [flow, setFlow] = React.useState<any>(null);
  const [callbackUrl, setCallbackUrl] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function start() {
    setBusy(true);
    try {
      const r = await fetch("/api/oauth/manual/start", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(await r.text());
      setFlow(await r.json());
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function complete() {
    setBusy(true);
    try {
      const r = await fetch("/api/oauth/manual/complete", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ callbackUrl }),
      });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      alert(`Added ${j.account?.email || "account"}`);
      setFlow(null);
      setCallbackUrl("");
      onDone();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const [urlCopied, setUrlCopied] = React.useState(false);

  return (
    <>
      <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={start} disabled={busy}>
        <Upload className="size-3 mr-1" /> Add Google
      </Button>

      {flow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <Card className="w-full max-w-md p-4 space-y-3">
            <div className="font-bold text-sm">Authorize Google Account</div>
            <div className="flex gap-1.5">
              <input
                className="flex-1 min-w-0 rounded border bg-muted/30 px-2 py-1 text-[10px] font-mono text-muted-foreground select-all truncate"
                value={flow.url}
                readOnly
                onFocus={(e) => e.target.select()}
              />
              <Button size="sm" variant="outline" className="h-7 text-xs px-2 shrink-0" onClick={() => { navigator.clipboard.writeText(flow.url); setUrlCopied(true); setTimeout(() => setUrlCopied(false), 2000); }}>
                {urlCopied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
              </Button>
              <Button size="sm" className="h-7 text-xs px-2 shrink-0" onClick={() => window.open(flow.url, "_blank")}>
                Open <ExternalLink className="size-3 ml-1" />
              </Button>
            </div>
            <input
              className="w-full rounded border bg-background px-2 py-1 text-xs font-mono"
              value={callbackUrl}
              onChange={(e) => setCallbackUrl(e.target.value)}
              placeholder="Paste redirect URL..."
            />
            <div className="flex gap-2">
              <Button size="sm" className="h-7 text-xs" disabled={!callbackUrl || busy} onClick={complete}>
                Complete
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setFlow(null)}>
                Cancel
              </Button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

function ImportButton({ token, onDone }: { token: string; onDone: () => void }) {
  const ref = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);

  async function file(f: File) {
    setBusy(true);
    try {
      const json = JSON.parse(await f.text());
      const r = await fetch("/api/accounts/import", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(json),
      });
      if (!r.ok) throw new Error(await r.text());
      alert("Imported: " + JSON.stringify(await r.json()));
      onDone();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  }

  return (
    <>
      <input ref={ref} type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && file(e.target.files[0])} />
      <Button variant="outline" size="sm" className="h-7 text-xs px-2" disabled={busy} onClick={() => ref.current?.click()}>
        JSON Import
      </Button>
    </>
  );
}

function formatTimeLeftSec(sec: number) {
  if (sec <= 0) return "ready";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return d ? `${d}d ${rh}h` : `${h}h ${m}m`;
}

function timeLeft(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return "unknown";
  if (ms <= 0) return "ready";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return d ? `${d}d ${rh}h` : `${h}h ${m}m`;
}

createRoot(document.getElementById("root")!).render(<App />);
