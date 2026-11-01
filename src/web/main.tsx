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
import { Separator } from "@/components/ui/separator";
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
    label: "Remaining Quota",
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
  const [accountFilter, setAccountFilter] = React.useState("all");
  const [modelFilter, setModelFilter] = React.useState("all");
  const [copied, setCopied] = React.useState(false);

  // Dark mode toggle
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

  const accounts = React.useMemo(() => {
    return (data?.accounts || []).filter(
      (a) => accountFilter === "all" || a.id === accountFilter
    );
  }, [data, accountFilter]);

  const allMetrics = React.useMemo(() => {
    return accounts.flatMap((a) =>
      quotaMetricsForModel(a.quota?.metrics || [], modelFilter).map((m) => ({
        ...m,
        account: a.email || a.id,
      }))
    );
  }, [accounts, modelFilter]);

  const avgRemaining = allMetrics.length
    ? allMetrics.reduce((s, m) => s + m.remainingPercent, 0) / allMetrics.length
    : 0;

  const lowQuotaCount = allMetrics.filter((m) => m.remainingPercent <= 15).length;

  const nearestReset = React.useMemo(() => {
    const list = (data?.accounts || []).flatMap((a) => a.quota?.metrics || []);
    const pending = list
      .filter(
        (m) =>
          m.resetTime &&
          m.remainingPercent < 95 &&
          new Date(m.resetTime).getTime() > Date.now()
      )
      .sort(
        (a, b) =>
          new Date(a.resetTime!).getTime() - new Date(b.resetTime!).getTime()
      );
    return pending[0] || null;
  }, [data]);

  const copyOverviewUrl = () => {
    navigator.clipboard.writeText(
      `${window.location.origin}/api/accounts/overview`
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Login
          onLogin={(v) => {
            localStorage.setItem("antigravityAdminToken", v);
            setToken(v);
          }}
        />
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8 space-y-6">
        <div className="flex justify-between items-center">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-8 w-24" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2">
              <AlertCircle className="size-5" />
              Failed to connect
            </CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={load}>
              Retry Connection
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Top Navbar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b pb-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold shadow-xs">
            A
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight">Antigravity API</h1>
              <Badge variant="outline" className="text-[11px] px-1.5 py-0 font-mono">
                5111
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Multi-account Cloud Code quota proxy & automatic failover gateway
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={accountFilter} onValueChange={setAccountFilter}>
            <SelectTrigger className="w-[170px] sm:w-[200px]">
              <SelectValue placeholder="All accounts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All accounts ({data?.accounts.length})</SelectItem>
              {data?.accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.email || a.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={modelFilter} onValueChange={setModelFilter}>
            <SelectTrigger className="w-[170px] sm:w-[210px]">
              <SelectValue placeholder="All models" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All models / quotas</SelectItem>
              {data?.models.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="icon"
            onClick={() => setIsDark(!isDark)}
            title="Toggle theme"
          >
            {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>

          <Button
            variant="outline"
            size="icon"
            onClick={copyOverviewUrl}
            title="Copy /api/accounts/overview URL"
          >
            {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
          </Button>

          <Button variant="outline" size="icon" onClick={load} title="Refresh">
            <RefreshCcw className="size-4" />
          </Button>

          <AddGoogleButton token={token} onDone={load} />
          <ImportButton token={token} onDone={load} />

          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              localStorage.removeItem("antigravityAdminToken");
              setToken("");
            }}
            title="Sign out"
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </div>

      {copied && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400 flex items-center justify-between">
          <span>Agent endpoint copied: <code>/api/accounts/overview</code></span>
          <Check className="size-4" />
        </div>
      )}

      {/* Next Limit Drop Highlight Banner */}
      {nearestReset && (
        <div className="rounded-xl border bg-muted/40 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-3 min-w-0">
            <div className="rounded-lg bg-background border p-2 text-foreground shrink-0">
              <Timer className="size-4" />
            </div>
            <div className="min-w-0 text-xs">
              <div className="font-semibold text-foreground truncate">
                Next Quota Refresh in:{" "}
                <span className="text-primary font-bold">
                  {timeLeft(nearestReset.resetTime!)}
                </span>
              </div>
              <div className="text-muted-foreground truncate">
                {canonicalModelLabel(nearestReset)} refreshes at{" "}
                {new Date(nearestReset.resetTime!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({new Date(nearestReset.resetTime!).toLocaleDateString()})
              </div>
            </div>
          </div>
          <Badge variant="outline" className="font-mono text-xs self-start sm:self-auto shrink-0">
            {nearestReset.remainingPercent.toFixed(1)}% remaining
          </Badge>
        </div>
      )}

      {/* KPI Cards (Tight & Balanced) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Total Accounts"
          value={String(data?.stats?.accountsTotal ?? 0)}
          sub={`${data?.stats?.accountsHealthy ?? 0} operational`}
          icon={Server}
        />
        <KpiCard
          label="Avg Quota Pool"
          value={`${avgRemaining.toFixed(1)}%`}
          sub={`${lowQuotaCount} exhausted/critical`}
          icon={Activity}
        />
        <KpiCard
          label="Total Requests"
          value={String(data?.stats?.requestsTotal ?? 0)}
          sub={`${data?.stats?.successesTotal ?? 0} completed`}
          icon={Zap}
        />
        <KpiCard
          label="Tokens Handled"
          value={(data?.stats?.tokensTotal ?? 0).toLocaleString()}
          sub={`${data?.stats?.errorsTotal ?? 0} errors`}
          icon={Database}
        />
      </div>

      {/* Main Content Tabs */}
      <Tabs defaultValue="accounts" className="w-full">
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="accounts" className="text-xs">
            Accounts ({accounts.length})
          </TabsTrigger>
          <TabsTrigger value="chart" className="text-xs">
            Quota Chart
          </TabsTrigger>
          <TabsTrigger value="models" className="text-xs">
            Models ({data?.models.length || 0})
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Accounts Grid */}
        <TabsContent value="accounts" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {accounts.map((a) => (
              <AccountCard
                key={a.id}
                account={a}
                model={modelFilter}
                token={token}
                onDone={load}
              />
            ))}
          </div>
        </TabsContent>

        {/* Tab 2: Visual Chart */}
        <TabsContent value="chart" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Account Quota Capacity</CardTitle>
              <CardDescription className="text-xs">
                Remaining percentage for current filter: {modelFilter === "all" ? "Lowest available quota" : modelFilter}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={quotaChartConfig} className="h-[260px] w-full">
                <BarChart
                  data={chartRows(accounts, modelFilter)}
                  margin={{ top: 20, right: 10, left: -20, bottom: 40 }}
                >
                  <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.3} />
                  <XAxis
                    dataKey="account"
                    angle={-20}
                    textAnchor="end"
                    height={50}
                    interval={0}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar
                    dataKey="remaining"
                    fill="var(--color-remaining)"
                    radius={[4, 4, 0, 0]}
                  >
                    <LabelList
                      dataKey="remaining"
                      position="top"
                      formatter={(v: any) => `${Number(v).toFixed(0)}%`}
                      style={{ fontSize: 10, fontWeight: 600 }}
                    />
                  </Bar>
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 3: Models Registry */}
        <TabsContent value="models" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Upstream Model Catalogue</CardTitle>
              <CardDescription className="text-xs">
                Supported models confirmed against Antigravity internal endpoints
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Model ID</TableHead>
                    <TableHead className="text-xs">Display Name</TableHead>
                    <TableHead className="text-right text-xs">Requests</TableHead>
                    <TableHead className="text-right text-xs">OK</TableHead>
                    <TableHead className="text-right text-xs">Tokens</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.models.map((m) => {
                    const stat = (data?.stats?.models || []).find(
                      (s: any) => s.model === m.id
                    ) || { requests: 0, successes: 0, totalTokens: 0 };
                    return (
                      <TableRow key={m.id} className="text-xs">
                        <TableCell className="font-mono font-medium">{m.id}</TableCell>
                        <TableCell>{m.displayName}</TableCell>
                        <TableCell className="text-right">{stat.requests}</TableCell>
                        <TableCell className="text-right text-emerald-600 dark:text-emerald-400 font-medium">
                          {stat.successes}
                        </TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">
                          {stat.totalTokens.toLocaleString()}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub: string;
  icon: any;
}) {
  return (
    <Card className="p-3.5 space-y-1 shadow-xs">
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="text-[11px] font-medium uppercase tracking-wider">{label}</span>
        <Icon className="size-3.5" />
      </div>
      <div className="text-xl font-bold tracking-tight">{value}</div>
      <div className="text-[11px] text-muted-foreground truncate">{sub}</div>
    </Card>
  );
}

function AccountCard({
  account,
  model,
  token,
  onDone,
}: {
  account: Account;
  model: string;
  token: string;
  onDone: () => void;
}) {
  const metrics = quotaMetricsForModel(account.quota?.metrics || [], model);
  const summary = quotaSummary(metrics);
  const min = summary.all.length
    ? Math.min(...summary.all.map((m) => m.remainingPercent))
    : 100;
  const hasAuthError =
    account.quota?.error && /401|auth/i.test(account.quota.error);

  return (
    <Card className="shadow-xs overflow-hidden flex flex-col justify-between">
      <div>
        <CardHeader className="p-3.5 border-b bg-muted/20">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-semibold text-sm truncate">
                  {account.email || account.id}
                </span>
                {account.healthy && !hasAuthError ? (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
                    Healthy
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                    {hasAuthError ? "Auth Expired" : "Cooldown"}
                  </Badge>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                {account.quota?.projectId || account.projectId || "no-project"} · {account.quota?.tier || "unknown tier"}
              </p>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <Badge variant="outline" className="font-mono text-[11px]">
                {min.toFixed(0)}%
              </Badge>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10 text-xs"
                onClick={async () => {
                  if (!confirm(`Delete ${account.email || account.id}?`)) return;
                  const r = await fetch(
                    `/api/accounts/${encodeURIComponent(account.id)}`,
                    {
                      method: "DELETE",
                      headers: { authorization: `Bearer ${token}` },
                    }
                  );
                  if (!r.ok) alert(await r.text());
                  onDone();
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-3.5 space-y-3">
          {/* Dual quota windows */}
          <div className="grid grid-cols-2 gap-2">
            <QuotaPill title="Gemini 5h" metric={summary.gemini5h} />
            <QuotaPill title="Gemini Week" metric={summary.geminiWeekly} />
            <QuotaPill title="Claude 5h" metric={summary.claude5h} />
            <QuotaPill title="Claude Week" metric={summary.claudeWeekly} />
          </div>

          <div className="grid grid-cols-3 gap-1.5 text-center text-xs">
            <div className="rounded-md border bg-muted/20 py-1 px-1.5">
              <div className="text-[9px] text-muted-foreground uppercase font-medium">Req</div>
              <div className="font-semibold text-xs">{account.requestCount}</div>
            </div>
            <div className="rounded-md border bg-muted/20 py-1 px-1.5">
              <div className="text-[9px] text-muted-foreground uppercase font-medium">OK</div>
              <div className="font-semibold text-xs text-emerald-600 dark:text-emerald-400">{account.successCount}</div>
            </div>
            <div className="rounded-md border bg-muted/20 py-1 px-1.5">
              <div className="text-[9px] text-muted-foreground uppercase font-medium">Err</div>
              <div className="font-semibold text-xs text-destructive">{account.errorCount}</div>
            </div>
          </div>

          {account.quota?.error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive flex items-start gap-1.5">
              <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
              <span className="break-all">{account.quota.error}</span>
            </div>
          )}

          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="details" className="border-0">
              <AccordionTrigger className="text-[11px] py-1 text-muted-foreground hover:no-underline hover:text-foreground">
                <span>View {metrics.length} model quota entries</span>
              </AccordionTrigger>
              <AccordionContent className="pt-2 pb-0 space-y-1.5">
                {metrics.map((m) => (
                  <QuotaMiniRow
                    key={`${m.source}-${m.name}-${m.resetTime}`}
                    metric={m}
                  />
                ))}
                {!metrics.length && (
                  <p className="text-[11px] text-muted-foreground">
                    No quota entries found for filter.
                  </p>
                )}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </div>
    </Card>
  );
}

function QuotaPill({
  title,
  metric,
}: {
  title: string;
  metric?: QuotaMetric;
}) {
  const p = metric?.remainingPercent ?? null;
  const time = metric?.resetTime ? timeLeft(metric.resetTime) : null;

  return (
    <div className="rounded-lg border bg-muted/30 p-2 space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-medium text-muted-foreground truncate">{title}</span>
        {p == null ? (
          <span className="text-muted-foreground text-[10px]">—</span>
        ) : (
          <span className="font-semibold text-[11px]">{p.toFixed(0)}%</span>
        )}
      </div>
      <Progress value={p ?? 0} className="h-1.5" />
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground truncate">
        <Clock className="size-2.5 shrink-0" />
        <span className="truncate">{time ? `Resets in ${time}` : "No reset"}</span>
      </div>
    </div>
  );
}

function QuotaMiniRow({ metric }: { metric: QuotaMetric }) {
  return (
    <div className="rounded-md border bg-muted/20 p-2 text-xs space-y-1">
      <div className="flex items-center justify-between gap-1">
        <span className="font-medium truncate">{canonicalModelLabel(metric)}</span>
        <span className="font-semibold shrink-0">{metric.remainingPercent.toFixed(1)}%</span>
      </div>
      <Progress value={metric.remainingPercent} className="h-1" />
      {metric.resetTime && (
        <div className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Clock className="size-2.5" />
          <span>Resets {timeLeft(metric.resetTime)}</span>
        </div>
      )}
    </div>
  );
}

function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const [v, setV] = React.useState("");
  return (
    <Card className="max-w-sm w-full shadow-lg">
      <CardHeader>
        <CardTitle className="text-lg">Antigravity Management</CardTitle>
        <CardDescription className="text-xs">
          Enter MANAGEMENT_TOKEN to inspect accounts and quotas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <input
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          type="password"
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder="Enter management token"
          onKeyDown={(e) => e.key === "Enter" && v.trim() && onLogin(v.trim())}
        />
        <Button className="w-full" onClick={() => v.trim() && onLogin(v.trim())}>
          Sign In
        </Button>
      </CardContent>
    </Card>
  );
}

function AddGoogleButton({
  token,
  onDone,
}: {
  token: string;
  onDone: () => void;
}) {
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
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
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
      <Button onClick={start} disabled={busy} size="sm">
        <Upload className="mr-1.5 size-3.5" />
        {busy ? "Starting..." : "Add Account"}
      </Button>

      {flow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <Card className="w-full max-w-lg shadow-xl">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Authorize Google Account</CardTitle>
              <CardDescription className="text-xs">
                Open Google OAuth in a new tab, copy the redirected URL from your browser address bar and paste below.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                variant="outline"
                className="w-full text-xs"
                onClick={() => window.open(flow.url, "_blank")}
              >
                Open Google Sign-In <ExternalLink className="ml-1 size-3.5" />
              </Button>
              <input
                className="w-full rounded-md border bg-background px-3 py-1.5 text-xs font-mono"
                value={callbackUrl}
                onChange={(e) => setCallbackUrl(e.target.value)}
                placeholder="Paste redirect URL: http://localhost:61135/oauth-callback?code=..."
              />
              <div className="flex gap-2">
                <Button size="sm" disabled={!callbackUrl || busy} onClick={complete}>
                  Complete
                </Button>
                <Button size="sm" variant="outline" onClick={() => setFlow(null)}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}

function ImportButton({
  token,
  onDone,
}: {
  token: string;
  onDone: () => void;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);

  async function file(f: File) {
    setBusy(true);
    try {
      const json = JSON.parse(await f.text());
      const r = await fetch("/api/accounts/import", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
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
      <input
        ref={ref}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && file(e.target.files[0])}
      />
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => ref.current?.click()}
      >
        <Upload className="mr-1.5 size-3.5" />
        {busy ? "Importing..." : "JSON"}
      </Button>
    </>
  );
}

function quotaSummary(metrics: QuotaMetric[]) {
  const byName = (id: string) => metrics.find((m) => m.name === id);
  const byText = (...parts: string[]) =>
    metrics.find((m) =>
      parts.every((part) =>
        `${m.name} ${m.displayName || ""}`.toLowerCase().includes(part)
      )
    );

  const gemini5h = byName("gemini-5h") || byText("gemini", "5h");
  const geminiWeekly = byName("gemini-weekly") || byText("gemini", "weekly");
  const claude5h =
    byName("3p-5h") || byName("claude:5h") || byText("3p", "5h");
  const claudeWeekly =
    byName("3p-weekly") || byName("claude:weekly") || byText("3p", "weekly");

  return { all: metrics, gemini5h, geminiWeekly, claude5h, claudeWeekly };
}

function canonicalModelLabel(metric: QuotaMetric) {
  const id = metric.name;
  const map: Record<string, string> = {
    "gemini-2.5-flash-lite": "Gemini 2.5 Flash Lite",
    "gemini-2.5-flash": "Gemini 2.5 Flash",
    "gemini-2.5-flash-thinking": "Gemini 2.5 Flash Thinking",
    "gemini-2.5-pro": "Gemini 2.5 Pro",
    "gemini-3-flash": "Gemini 3 Flash",
    "gemini-3-flash-agent": "Gemini 3 Flash Agent",
    "gemini-pro-agent": "Gemini Pro Agent",
    "gemini-3.1-flash-lite": "Gemini 3.1 Flash Lite",
    "gemini-3.5-flash-lite": "Gemini 3.5 Flash Lite",
    "gemini-3.1-flash-image": "Gemini 3.1 Flash Image",
    "gemini-3.8-flash-low": "Gemini 3.8 Flash Low",
    "gemini-3.8-flash-medium": "Gemini 3.8 Flash Medium",
    "gemini-3.8-flash-high": "Gemini 3.8 Flash High",
    "gemini-3.8-flash-tiered": "Gemini 3.8 Flash Tiered",
    "claude-sonnet-4-6": "Claude Sonnet 4.6 Thinking",
    "claude-opus-4-6-thinking": "Claude Opus 4.6 Thinking",
    "gpt-oss-120b-medium": "GPT-OSS 120B Medium",
    "gemini-weekly": "Gemini Weekly Limit",
    "gemini-5h": "Gemini 5-Hour Limit",
    "3p-weekly": "Claude/GPT Weekly Limit",
    "3p-5h": "Claude/GPT 5-Hour Limit",
  };
  return map[id] || metric.displayName || id;
}

function quotaMetricsForModel(metrics: QuotaMetric[], model: string) {
  if (model === "all") return metrics;
  return metrics.filter((m) => matchMetric(m, model));
}

function matchMetric(metric: QuotaMetric, model: string) {
  const hay = `${metric.name} ${metric.displayName || ""}`.toLowerCase();
  const m = model.toLowerCase();
  if (m.includes("opus")) return hay.includes("opus") || hay.includes("3p");
  if (m.includes("sonnet")) return hay.includes("sonnet") || hay.includes("3p");
  if (m.includes("gemini")) return hay.includes("gemini");
  return hay.includes(m);
}

function chartRows(accounts: Account[], model: string) {
  return accounts.map((a) => {
    const ms = quotaMetricsForModel(a.quota?.metrics || [], model);
    const remaining = ms.length
      ? Math.min(...ms.map((m) => m.remainingPercent))
      : 0;
    return { account: a.email ? a.email.split("@")[0] : a.id, remaining };
  });
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
