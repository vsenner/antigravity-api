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
  Pie,
  PieChart,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

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
    label: "Quota %",
    color: "var(--primary)",
  },
} satisfies ChartConfig;

function App() {
  const [token, setToken] = React.useState(
    () => localStorage.getItem("antigravityAdminToken") || ""
  );
  const [data, setData] = React.useState<Status | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [isDark, setIsDark] = React.useState(() => {
    return (
      localStorage.getItem("theme") === "dark" ||
      (!("theme" in localStorage) &&
        window.matchMedia("(prefers-color-scheme: dark)").matches)
    );
  });

  React.useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      root.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [isDark]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!token) throw new Error("ADMIN token required");
      const res = await fetch("/api/public/status", {
        cache: "no-store",
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [token]);

  React.useEffect(() => {
    if (token) void load();
  }, [load, token]);

  const accounts = data?.accounts || [];

  // Pool Calculations with Tier weighting (Pro = 5x weight, Free = 1x weight)
  const poolStats = React.useMemo(() => {
    if (!accounts.length) {
      return {
        geminiAvg: 100,
        claudeAvg: 100,
        nearestReset: null as any,
        target95Time: null as string | null,
        pendingResets: [] as any[],
        proCount: 0,
        freeCount: 0,
      };
    }

    let gWeightedSum = 0;
    let cWeightedSum = 0;
    let totalWeight = 0;
    let proCount = 0;
    let freeCount = 0;
    const allPending: any[] = [];

    for (const a of accounts) {
      const isPro = (a.quota?.tier === "g1-pro-tier" || (a as any).tier === "g1-pro-tier");
      const weight = isPro ? 5 : 1;
      totalWeight += weight;
      if (isPro) proCount++; else freeCount++;

      const metrics = a.quota?.metrics || [];
      const getM = (id: string) => metrics.find((m) => m.name === id);
      // Prefer exact weekly bucket from summary
      const gWeek = getM("gemini-weekly") || metrics.find((m) => m.name.includes("gemini") && m.source === "summary");
      const cWeek = getM("3p-weekly") || metrics.find((m) => m.name.includes("3p") && m.source === "summary");

      const gVal = gWeek != null ? gWeek.remainingPercent : 100;
      const cVal = cWeek != null ? cWeek.remainingPercent : 100;

      gWeightedSum += (gVal * weight);
      cWeightedSum += (cVal * weight);

      for (const m of metrics) {
        if (m.resetTime && m.remainingPercent < 98) {
          const ms = new Date(m.resetTime).getTime();
          if (ms > Date.now()) {
            allPending.push({
              account: a.email ? a.email.split("@")[0] : a.id,
              metric: m.name,
              displayName: m.displayName || m.name,
              remaining: m.remainingPercent,
              resetTime: m.resetTime,
              isPro,
              weight,
              ms,
            });
          }
        }
      }
    }

    allPending.sort((a, b) => a.ms - b.ms);
    const geminiAvg = totalWeight > 0 ? (gWeightedSum / totalWeight) : 100;
    const claudeAvg = totalWeight > 0 ? (cWeightedSum / totalWeight) : 100;

    const nearest = allPending[0] || null;

    let target95Time: string | null = null;
    if (geminiAvg >= 95) {
      target95Time = "Already at 95%+";
    } else {
      const weeklyResets = allPending.filter((p) => p.metric.includes("weekly"));
      if (weeklyResets.length > 0) {
        target95Time = timeLeft(weeklyResets[0].resetTime);
      } else if (nearest) {
        target95Time = timeLeft(nearest.resetTime);
      }
    }

    return {
      geminiAvg,
      claudeAvg,
      nearestReset: nearest,
      target95Time,
      pendingResets: allPending,
      proCount,
      freeCount,
    };
  }, [accounts]);

  const copyOverviewUrl = () => {
    navigator.clipboard.writeText(`${window.location.origin}/api/accounts/overview`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Login onLogin={(v) => { localStorage.setItem("antigravityAdminToken", v); setToken(v); }} />
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="mx-auto max-w-7xl p-4 space-y-4">
        <Skeleton className="h-10 w-full" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-3 py-3 sm:px-6 sm:py-4 space-y-3 font-sans">
      {/* Dense Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground font-black text-xs">
            AG
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-sm tracking-tight">Antigravity Hub</span>
              <Badge variant="outline" className="text-[10px] py-0 px-1 font-mono">
                {accounts.length} accts
              </Badge>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={load}>
            <RefreshCcw className="size-3 mr-1" /> Refresh
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={copyOverviewUrl}>
            {copied ? <Check className="size-3 text-emerald-500 mr-1" /> : <Copy className="size-3 mr-1" />}
            /overview
          </Button>
          <AddGoogleButton token={token} onDone={load} />
          <ImportButton token={token} onDone={load} />
          <Button variant="ghost" size="icon" className="size-7" onClick={() => setIsDark(!isDark)}>
            {isDark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="size-7" onClick={() => { localStorage.removeItem("antigravityAdminToken"); setToken(""); }}>
            <LogOut className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* TOP KPI NUMBERS: Pool Capacity, Target 95%, Next Refill */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-lg border bg-card p-2.5 space-y-0.5">
          <div className="text-[10px] text-muted-foreground uppercase font-semibold">Gemini Pool Capacity</div>
          <div className="text-xl font-black tracking-tight text-foreground">
            {poolStats.geminiAvg.toFixed(1)}%
          </div>
          <div className="text-[10px] text-muted-foreground">
            {poolStats.proCount} Pro (5x) + {poolStats.freeCount} Free
          </div>
        </div>

        <div className="rounded-lg border bg-card p-2.5 space-y-0.5">
          <div className="text-[10px] text-muted-foreground uppercase font-semibold">Target 95% Refill ETA</div>
          <div className="text-xl font-black tracking-tight text-primary">
            {poolStats.target95Time}
          </div>
          <div className="text-[10px] text-muted-foreground truncate">
            {poolStats.nearestReset
              ? `Next reset: ${poolStats.nearestReset.account} in ${timeLeft(poolStats.nearestReset.resetTime)}`
              : "Pool fully replenished"}
          </div>
        </div>

        <div className="rounded-lg border bg-card p-2.5 space-y-0.5">
          <div className="text-[10px] text-muted-foreground uppercase font-semibold">Claude / 3P Capacity</div>
          <div className="text-xl font-black tracking-tight text-foreground">
            {poolStats.claudeAvg.toFixed(1)}%
          </div>
          <div className="text-[10px] text-muted-foreground">Weighted pool capacity</div>
        </div>

        <div className="rounded-lg border bg-card p-2.5 space-y-0.5">
          <div className="text-[10px] text-muted-foreground uppercase font-semibold">Tokens Processed</div>
          <div className="text-xl font-black tracking-tight text-foreground">
            {(data?.stats?.tokensTotal ?? 0).toLocaleString()}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {data?.stats?.requestsTotal ?? 0} reqs ({data?.stats?.errorsTotal ?? 0} err)
          </div>
        </div>
      </div>

      {/* CHARTS & RECOVERY TIMELINE (Front and Center) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5 items-stretch">
        {/* Chart: Per Account Capacity */}
        <div className="lg:col-span-2 rounded-lg border bg-card p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">
            <span>Account Gemini Capacity (%)</span>
            <span className="font-mono text-[10px]">Weighted Pool Avg: {poolStats.geminiAvg.toFixed(1)}%</span>
          </div>

          <div className="flex-1 w-full min-h-[170px] flex items-center">
            <ChartContainer config={quotaChartConfig} className="h-[170px] w-full">
              <BarChart
                data={accounts.map((a) => {
                  const metrics = a.quota?.metrics || [];
                  const m = metrics.find((x) => x.name === "gemini-weekly") || metrics.find((x) => x.name.includes("gemini"));
                  const isPro = (a.quota?.tier === "g1-pro-tier" || (a as any).tier === "g1-pro-tier");
                  return {
                    name: a.email ? a.email.split("@")[0] : a.id,
                    remaining: m ? m.remainingPercent : 100,
                    tier: isPro ? "Pro (5x)" : "Free (1x)",
                  };
                })}
                margin={{ top: 14, right: 10, left: -25, bottom: 20 }}
              >
                <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="remaining" fill="var(--color-primary)" radius={[3, 3, 0, 0]}>
                  <LabelList
                    dataKey="remaining"
                    position="top"
                    formatter={(v: any) => `${Number(v).toFixed(0)}%`}
                    style={{ fontSize: 9, fontWeight: 700 }}
                  />
                </Bar>
              </BarChart>
            </ChartContainer>
          </div>
        </div>

        {/* Next Refills Timeline */}
        <div className="rounded-lg border bg-card p-3 flex flex-col justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
              Next Upcoming Refills (Schedule)
            </div>
            <div className="space-y-1">
              {poolStats.pendingResets
                .filter((r, idx, arr) => arr.findIndex(x => x.account === r.account && x.metric === r.metric) === idx)
                .slice(0, 5)
                .map((r, i) => (
                <div key={i} className="flex items-center justify-between text-xs py-1.5 border-b not-last:border-b">
                  <div className="min-w-0 pr-2">
                    <div className="font-semibold truncate text-[11px] flex items-center gap-1.5">
                      <span>{r.account}</span>
                      <Badge variant="outline" className="text-[9px] py-0 px-1 font-mono">
                        {r.isPro ? "Pro" : "Free"}
                      </Badge>
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">{r.displayName}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono font-bold text-primary text-[11px]">{timeLeft(r.resetTime)}</div>
                    <div className="text-[10px] text-muted-foreground">+{ (100 - r.remaining).toFixed(0) }% boost</div>
                  </div>
                </div>
              ))}
              {!poolStats.pendingResets.length && (
                <div className="text-xs text-muted-foreground py-4 text-center">
                  No active throttles in pool.
                </div>
              )}
            </div>
          </div>
          <div className="text-[10px] text-muted-foreground pt-1.5 border-t mt-1">
            Pool auto-balances load across remaining healthy accounts.
          </div>
        </div>
      </div>

      {/* DENSE ACCOUNTS TABLE / CARDS */}
      <div className="rounded-lg border bg-card p-3 space-y-2.5">
        <div className="flex items-center justify-between border-b pb-2">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Connected Accounts Detail
          </span>
          <span className="text-[11px] text-muted-foreground">
            Compact Quota Windows (5-Hour & Weekly)
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {accounts.map((a) => {
            const metrics = a.quota?.metrics || [];
            const getM = (id: string) => metrics.find((m) => m.name === id);
            const g5h = getM("gemini-5h");
            const gWeek = getM("gemini-weekly") || metrics.find((m) => m.name.includes("gemini"));
            const c5h = getM("3p-5h");
            const cWeek = getM("3p-weekly") || metrics.find((m) => m.name.includes("3p"));

            return (
              <div key={a.id} className="rounded-md border bg-muted/15 p-2 text-xs space-y-1.5">
                <div className="flex items-center justify-between gap-1">
                  <div className="min-w-0">
                    <div className="font-bold truncate text-xs">{a.email || a.id}</div>
                    <div className="text-[10px] text-muted-foreground font-mono truncate">
                      {a.quota?.projectId || a.projectId || "no-proj"} · {a.quota?.tier || "tier"}
                    </div>
                  </div>
                  <Badge variant={a.healthy ? "outline" : "destructive"} className="text-[9px] py-0 px-1 shrink-0">
                    {a.healthy ? "OK" : "Limit"}
                  </Badge>
                </div>

                {/* Fast Quota Numbers */}
                <div className="grid grid-cols-2 gap-1 text-[11px]">
                  <div className="rounded bg-background border px-1.5 py-1">
                    <div className="text-muted-foreground text-[9px] uppercase font-semibold">Gemini Week</div>
                    <div className="font-bold text-xs">
                      {gWeek ? `${gWeek.remainingPercent.toFixed(0)}%` : "—"}
                    </div>
                    <div className="text-[9px] text-muted-foreground truncate">
                      {gWeek?.resetTime ? `in ${timeLeft(gWeek.resetTime)}` : "No reset"}
                    </div>
                  </div>

                  <div className="rounded bg-background border px-1.5 py-1">
                    <div className="text-muted-foreground text-[9px] uppercase font-semibold">Gemini 5h</div>
                    <div className="font-bold text-xs">
                      {g5h ? `${g5h.remainingPercent.toFixed(0)}%` : "100%"}
                    </div>
                    <div className="text-[9px] text-muted-foreground truncate">
                      {g5h?.resetTime ? `in ${timeLeft(g5h.resetTime)}` : "Full"}
                    </div>
                  </div>

                  <div className="rounded bg-background border px-1.5 py-1">
                    <div className="text-muted-foreground text-[9px] uppercase font-semibold">Claude Week</div>
                    <div className="font-bold text-xs">
                      {cWeek ? `${cWeek.remainingPercent.toFixed(0)}%` : "100%"}
                    </div>
                    <div className="text-[9px] text-muted-foreground truncate">
                      {cWeek?.resetTime ? `in ${timeLeft(cWeek.resetTime)}` : "Full"}
                    </div>
                  </div>

                  <div className="rounded bg-background border px-1.5 py-1">
                    <div className="text-muted-foreground text-[9px] uppercase font-semibold">Claude 5h</div>
                    <div className="font-bold text-xs">
                      {c5h ? `${c5h.remainingPercent.toFixed(0)}%` : "100%"}
                    </div>
                    <div className="text-[9px] text-muted-foreground truncate">
                      {c5h?.resetTime ? `in ${timeLeft(c5h.resetTime)}` : "Full"}
                    </div>
                  </div>
                </div>

                {/* Bottom Bar: Reqs & Delete */}
                <div className="flex items-center justify-between text-[10px] text-muted-foreground border-t pt-1">
                  <span>Reqs: {a.requestCount} (Err: {a.errorCount})</span>
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
                    Remove
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

  return (
    <>
      <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={start} disabled={busy}>
        <Upload className="size-3 mr-1" /> Add Google
      </Button>

      {flow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <Card className="w-full max-w-md p-4 space-y-3">
            <div className="font-bold text-sm">Authorize Google Account</div>
            <Button size="sm" className="w-full text-xs h-7" onClick={() => window.open(flow.url, "_blank")}>
              Open Google Auth <ExternalLink className="size-3 ml-1" />
            </Button>
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
