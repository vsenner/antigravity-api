import React from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Copy,
  Cpu,
  Database,
  ExternalLink,
  Layers,
  Lock,
  LogOut,
  RefreshCcw,
  Server,
  Sparkles,
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
  CardFooter,
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

const quotaConfig = {
  remaining: { label: "Remaining", color: "var(--color-primary)" },
} satisfies ChartConfig;

const pieConfig = {
  value: { label: "Accounts" },
  healthy: { label: "Healthy", color: "oklch(0.696 0.17 162.48)" },
  warning: { label: "Warning", color: "oklch(0.769 0.188 70.08)" },
  exhausted: { label: "Exhausted", color: "oklch(0.577 0.245 27.325)" },
} satisfies ChartConfig;

function App() {
  const [token, setToken] = React.useState(
    () => localStorage.getItem("antigravityAdminToken") || ""
  );
  const [data, setData] = React.useState<Status | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [account, setAccount] = React.useState("all");
  const [model, setModel] = React.useState("all");
  const [copiedEndpoint, setCopiedEndpoint] = React.useState(false);

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

  const accounts = React.useMemo(
    () =>
      (data?.accounts || []).filter(
        (a) => account === "all" || a.id === account
      ),
    [data, account]
  );

  const relevantMetrics = React.useMemo(
    () =>
      accounts.flatMap((a) =>
        quotaMetricsForModel(a.quota?.metrics || [], model).map((m) => ({
          ...m,
          account: a.email || a.id,
        }))
      ),
    [accounts, model]
  );

  const avgRemaining = relevantMetrics.length
    ? relevantMetrics.reduce((s, m) => s + m.remainingPercent, 0) /
      relevantMetrics.length
    : 0;

  const critical = relevantMetrics.filter((m) => m.remainingPercent <= 10).length;

  const pieRows = React.useMemo(() => {
    let healthy = 0;
    let warning = 0;
    let exhausted = 0;
    for (const a of data?.accounts || []) {
      const metrics = quotaMetricsForModel(a.quota?.metrics || [], model);
      const min = metrics.length
        ? Math.min(...metrics.map((m) => m.remainingPercent))
        : 100;
      if (min <= 10) exhausted++;
      else if (min <= 35) warning++;
      else healthy++;
    }
    return [
      { name: "healthy", value: healthy, fill: "oklch(0.696 0.17 162.48)" },
      { name: "warning", value: warning, fill: "oklch(0.769 0.188 70.08)" },
      { name: "exhausted", value: exhausted, fill: "oklch(0.577 0.245 27.325)" },
    ];
  }, [data, model]);

  // Find nearest quota reset in the entire pool
  const nearestResetInfo = React.useMemo(() => {
    const all = (data?.accounts || []).flatMap((a) => a.quota?.metrics || []);
    const withReset = all
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
    return withReset[0] || null;
  }, [data]);

  const copyOverviewUrl = () => {
    const url = `${window.location.origin}/api/accounts/overview`;
    navigator.clipboard.writeText(url);
    setCopiedEndpoint(true);
    setTimeout(() => setCopiedEndpoint(false), 2000);
  };

  if (!token)
    return (
      <Shell>
        <Login
          onLogin={(v) => {
            localStorage.setItem("antigravityAdminToken", v);
            setToken(v);
          }}
        />
      </Shell>
    );

  if (loading && !data)
    return (
      <Shell>
        <SkeletonGrid />
      </Shell>
    );

  if (error)
    return (
      <Shell>
        <Card className="border-destructive mx-auto max-w-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="size-5" />
              Failed to load dashboard
            </CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={load}>Retry Connection</Button>
          </CardContent>
        </Card>
      </Shell>
    );

  return (
    <Shell>
      <div className="flex flex-col gap-8">
        {/* Top Header */}
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between border-b pb-6">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Badge variant="secondary" className="px-2.5 py-0.5">
                <span className="size-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse" />
                Live Gateway
              </Badge>
              <Badge variant="outline" className="font-mono text-xs">
                antigravity.vadym.live
              </Badge>
              <Badge variant="outline" className="text-xs">
                Mist / Maia Preset
              </Badge>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
              Antigravity Control Center
            </h1>
            <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
              Intelligent quota management, sliding 5-hour & weekly limits, model
              rotation, and automated AI status tracking.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Select value={account} onValueChange={setAccount}>
              <SelectTrigger className="w-[180px] sm:w-[220px]">
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

            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className="w-[190px] sm:w-[230px]">
                <SelectValue placeholder="All models" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All quotas & models</SelectItem>
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
              title="Copy /api/accounts/overview endpoint"
              onClick={copyOverviewUrl}
            >
              <Copy className="size-4" />
            </Button>

            <Button variant="outline" size="icon" onClick={load} title="Refresh data">
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
              title="Logout"
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>

        {copiedEndpoint && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-400 flex items-center justify-between animate-in fade-in">
            <span>
              Copied <code>/api/accounts/overview</code> URL to clipboard! Ready for agent inspection.
            </span>
            <CheckCircle2 className="size-4" />
          </div>
        )}

        {/* Global Alert / Nearest Limit Drop banner */}
        {nearestResetInfo && (
          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
                <Timer className="size-5" />
              </div>
              <div>
                <div className="font-semibold text-sm">
                  Next Quota Refresh in:{" "}
                  <span className="text-primary font-bold">
                    {timeLeft(nearestResetInfo.resetTime!)}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Limit <b>{canonicalModelLabel(nearestResetInfo)}</b> resets at{" "}
                  {new Date(nearestResetInfo.resetTime!).toLocaleTimeString()} (
                  {new Date(nearestResetInfo.resetTime!).toLocaleDateString()})
                </div>
              </div>
            </div>
            <Badge variant="outline" className="font-mono text-xs">
              {nearestResetInfo.remainingPercent.toFixed(1)}% remaining
            </Badge>
          </div>
        )}

        {/* High-level KPIs */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            icon={Server}
            label="Total Accounts"
            value={String(data?.stats?.accountsTotal ?? 0)}
            sub={`${data?.stats?.accountsHealthy ?? 0} healthy & active`}
          />
          <MetricCard
            icon={Activity}
            label="Average Quota"
            value={`${avgRemaining.toFixed(1)}%`}
            sub={`${critical} critical (${data?.accounts.filter((a) => !a.healthy).length || 0} exhausted/err)`}
          />
          <MetricCard
            icon={Zap}
            label="Total Requests"
            value={String(data?.stats?.requestsTotal ?? 0)}
            sub={`${data?.stats?.successesTotal ?? 0} succeeded`}
          />
          <MetricCard
            icon={Database}
            label="Tokens Used"
            value={(data?.stats?.tokensTotal ?? 0).toLocaleString()}
            sub={`${data?.stats?.errorsTotal ?? 0} errors logged`}
          />
        </div>

        {/* Charts & Distribution */}
        <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">
                Account Quotas Breakdown
              </CardTitle>
              <CardDescription>
                Remaining capacity for filtered model/pool.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={quotaConfig} className="h-[280px] w-full">
                <BarChart
                  data={chartRows(accounts, model)}
                  margin={{ top: 20, right: 10, left: -10, bottom: 50 }}
                >
                  <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.3} />
                  <XAxis
                    dataKey="account"
                    angle={-25}
                    textAnchor="end"
                    height={60}
                    interval={0}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar
                    dataKey="remaining"
                    fill="var(--color-primary)"
                    radius={[6, 6, 0, 0]}
                  >
                    <LabelList
                      dataKey="remaining"
                      position="top"
                      formatter={(v: any) => `${Number(v).toFixed(0)}%`}
                      style={{ fontSize: 11, fontWeight: 600 }}
                    />
                  </Bar>
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">
                Pool Health Distribution
              </CardTitle>
              <CardDescription>
                Active capacity status across all connected accounts.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={pieConfig} className="mx-auto h-[280px]">
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                  <Pie
                    data={pieRows}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={65}
                    outerRadius={105}
                    paddingAngle={4}
                  >
                    {pieRows.map((r) => (
                      <Cell key={r.name} fill={r.fill} />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </div>

        {/* Main Content Tabs */}
        <Tabs defaultValue="accounts" className="w-full">
          <div className="flex items-center justify-between border-b pb-3">
            <TabsList>
              <TabsTrigger value="accounts" className="flex items-center gap-2">
                <UserCheck className="size-4" />
                Accounts & Quotas ({accounts.length})
              </TabsTrigger>
              <TabsTrigger value="models" className="flex items-center gap-2">
                <Cpu className="size-4" />
                Active Models ({data?.models.length || 0})
              </TabsTrigger>
              <TabsTrigger value="api-agent" className="flex items-center gap-2">
                <Sparkles className="size-4" />
                Agent Overview API
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="accounts" className="mt-6">
            <div className="grid gap-6 md:grid-cols-2">
              {accounts.map((a) => (
                <AccountCard
                  key={a.id}
                  account={a}
                  model={model}
                  token={token}
                  onDone={load}
                />
              ))}
            </div>
          </TabsContent>

          <TabsContent value="models" className="mt-6">
            <ModelsTable
              rows={data?.stats?.models || []}
              catalogue={data?.models || []}
            />
          </TabsContent>

          <TabsContent value="api-agent" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="size-5 text-primary" />
                  Hermes / Agent Status Inspection Endpoint
                </CardTitle>
                <CardDescription>
                  This dedicated endpoint is designed for automated subagents and
                  Hermes to inspect account limits without web scraping.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-xl border bg-muted/40 p-4 font-mono text-sm space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground border-b pb-2">
                    <span>GET /api/accounts/overview</span>
                    <span>Auth: Bearer API_KEY or MANAGEMENT_TOKEN</span>
                  </div>
                  <pre className="text-xs text-foreground overflow-x-auto whitespace-pre-wrap">
{`curl -s https://antigravity.vadym.live/api/accounts/overview \\
  -H "Authorization: Bearer \${ANTIGRAVITY_API_KEY}"`}
                  </pre>
                </div>
                <div className="text-sm text-muted-foreground space-y-2">
                  <p><b>Returned payload structure:</b></p>
                  <ul className="list-disc pl-5 space-y-1 text-xs">
                    <li><code>summary.healthyAccounts</code> — number of fully operational accounts</li>
                    <li><code>summary.nearestReset</code> — exact time, seconds left, and metric when the next throttled limit resets</li>
                    <li><code>accounts[].gemini.fiveHourPercent</code> & <code>gemini.weeklyPercent</code> — remaining quotas for Gemini</li>
                    <li><code>accounts[].claude.fiveHourPercent</code> & <code>claude.weeklyPercent</code> — remaining quotas for Claude 3.7 / 4.6</li>
                    <li><code>accounts[].hasAuthError</code> — whether the account requires Google re-auth</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background font-sans p-4 sm:p-6 lg:p-10 text-foreground selection:bg-primary/20">
      <div className="mx-auto max-w-7xl">{children}</div>
    </main>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: any;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <Card className="shadow-xs">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </CardTitle>
        <div className="rounded-lg bg-muted p-1.5 text-muted-foreground">
          <Icon className="size-4" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tracking-tight">{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
      </CardContent>
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
    <Card
      className={`overflow-hidden transition-all shadow-xs ${
        !account.healthy || hasAuthError
          ? "border-destructive/40 bg-destructive/5"
          : "hover:border-foreground/20"
      }`}
    >
      <CardHeader className="pb-3 border-b bg-muted/20">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <CardTitle className="truncate text-base font-bold">
                {account.email || account.id}
              </CardTitle>
              {account.healthy && !hasAuthError ? (
                <Badge
                  variant="outline"
                  className="border-emerald-500/40 bg-emerald-500/10 text-emerald-500 text-[10px]"
                >
                  Healthy
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="border-destructive/40 bg-destructive/10 text-destructive text-[10px]"
                >
                  {hasAuthError ? "Auth Expired" : "Cooldown"}
                </Badge>
              )}
            </div>
            <CardDescription className="truncate text-xs mt-0.5">
              Project:{" "}
              <span className="font-mono">
                {account.quota?.projectId || account.projectId || "none"}
              </span>{" "}
              · Tier: {account.quota?.tier || "unknown"}
            </CardDescription>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <Badge className={badgeClass(min)}>{min.toFixed(0)}% Min</Badge>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive h-8 px-2"
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

      <CardContent className="space-y-4 pt-4">
        {/* Dual Quota Windows: 5-Hour vs Weekly */}
        <div className="grid grid-cols-2 gap-2.5">
          <QuotaWindowBlock
            title="Gemini 5h Window"
            metric={summary.gemini5h}
            fallbackLabel="Rolling 5h"
          />
          <QuotaWindowBlock
            title="Gemini Weekly"
            metric={summary.geminiWeekly}
            fallbackLabel="Weekly Reset"
          />
          <QuotaWindowBlock
            title="Claude 5h Window"
            metric={summary.claude5h}
            fallbackLabel="Rolling 5h"
          />
          <QuotaWindowBlock
            title="Claude Weekly"
            metric={summary.claudeWeekly}
            fallbackLabel="Weekly Reset"
          />
        </div>

        {/* Mini stats */}
        <div className="grid grid-cols-3 gap-2">
          <MiniStat label="Requests" value={account.requestCount} />
          <MiniStat label="Successes" value={account.successCount} />
          <MiniStat label="Errors" value={account.errorCount} />
        </div>

        {account.quota?.error && (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <span className="break-all">{account.quota.error}</span>
          </div>
        )}

        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="details" className="border rounded-xl px-3">
            <AccordionTrigger className="text-xs font-semibold py-2.5 hover:no-underline">
              <span>View Individual Model Quotas ({metrics.length})</span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-2 pt-2 pb-1">
                {metrics.map((m) => (
                  <QuotaRow
                    key={`${m.source}-${m.name}-${m.resetTime}`}
                    metric={m}
                  />
                ))}
                {!metrics.length && (
                  <p className="text-xs text-muted-foreground">
                    No individual quota metrics for this filter.
                  </p>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}

function QuotaWindowBlock({
  title,
  metric,
  fallbackLabel,
}: {
  title: string;
  metric?: QuotaMetric;
  fallbackLabel: string;
}) {
  const p = metric?.remainingPercent ?? null;
  const time = metric?.resetTime ? timeLeft(metric.resetTime) : null;

  return (
    <div className="rounded-xl border bg-card/60 p-3 space-y-2">
      <div className="flex items-center justify-between gap-1 text-xs">
        <span className="font-medium text-muted-foreground truncate">{title}</span>
        {p == null ? (
          <span className="text-muted-foreground text-[11px]">—</span>
        ) : (
          <Badge className={badgeClass(p)} variant="outline">
            {p.toFixed(0)}%
          </Badge>
        )}
      </div>

      <Progress value={p ?? 0} className="h-1.5" />

      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className="size-3" />
          {time ? `Resets in ${time}` : "No reset pending"}
        </span>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-muted/20 px-2.5 py-1.5 text-center">
      <div className="text-[10px] text-muted-foreground uppercase font-medium">{label}</div>
      <div className="text-sm font-semibold">{value.toLocaleString()}</div>
    </div>
  );
}

function QuotaRow({ metric }: { metric: QuotaMetric }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-2.5 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold">{canonicalModelLabel(metric)}</div>
          <div className="text-[10px] font-mono text-muted-foreground">
            {metric.name}
          </div>
        </div>
        <Badge variant="outline" className={badgeClass(metric.remainingPercent)}>
          {metric.remainingPercent.toFixed(1)}%
        </Badge>
      </div>

      <Progress value={metric.remainingPercent} className="h-1" />

      {metric.resetTime && (
        <div className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Clock className="size-3" />
          Resets: {timeLeft(metric.resetTime)} ({new Date(metric.resetTime).toLocaleTimeString()})
        </div>
      )}
    </div>
  );
}

function ModelsTable({
  rows,
  catalogue,
}: {
  rows: any[];
  catalogue: { id: string; displayName: string }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-bold">Runtime Model Registry</CardTitle>
        <CardDescription>
          Confirmed upstream models available via Antigravity proxy.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Model ID / Upstream</TableHead>
              <TableHead>Display Name</TableHead>
              <TableHead className="text-right">Requests</TableHead>
              <TableHead className="text-right">Success</TableHead>
              <TableHead className="text-right">Errors</TableHead>
              <TableHead className="text-right">Total Tokens</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {catalogue.map((cat) => {
              const stat = rows.find((r) => r.model === cat.id) || {
                requests: 0,
                successes: 0,
                errors: 0,
                totalTokens: 0,
              };
              return (
                <TableRow key={cat.id}>
                  <TableCell className="font-mono text-xs font-semibold">
                    {cat.id}
                  </TableCell>
                  <TableCell className="text-sm font-medium">
                    {cat.displayName}
                  </TableCell>
                  <TableCell className="text-right">{stat.requests}</TableCell>
                  <TableCell className="text-right text-emerald-500 font-medium">
                    {stat.successes}
                  </TableCell>
                  <TableCell className="text-right text-destructive font-medium">
                    {stat.errors}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {stat.totalTokens.toLocaleString()}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const [v, setV] = React.useState("");
  return (
    <Card className="mx-auto mt-20 max-w-md shadow-lg border-primary/20">
      <CardHeader>
        <div className="rounded-xl bg-primary/10 w-fit p-3 text-primary mb-2">
          <Lock className="size-6" />
        </div>
        <CardTitle className="text-xl">Antigravity Management</CardTitle>
        <CardDescription>
          Enter the admin MANAGEMENT_TOKEN to access quotas and account operations.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <input
          className="w-full rounded-xl border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          type="password"
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder="Enter management token"
          onKeyDown={(e) => {
            if (e.key === "Enter" && v.trim()) onLogin(v.trim());
          }}
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
      <Button onClick={start} disabled={busy} variant="default">
        <Upload className="mr-1.5 size-4" />
        {busy ? "Starting..." : "Add Account"}
      </Button>

      {flow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <Card className="w-full max-w-xl border-primary shadow-2xl">
            <CardHeader>
              <CardTitle>Authorize Google Account</CardTitle>
              <CardDescription>
                Open Google authorization. After login, copy the redirected URL from
                your address bar and paste it below.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                className="w-full flex items-center justify-center gap-2"
                onClick={() => window.open(flow.url, "_blank")}
              >
                <span>Open Google Sign-In</span>
                <ExternalLink className="size-4" />
              </Button>
              <div className="rounded-xl border bg-muted/40 p-3 text-xs font-mono break-all max-h-24 overflow-y-auto">
                {flow.url}
              </div>
              <input
                className="w-full rounded-xl border bg-background px-3 py-2 text-sm"
                value={callbackUrl}
                onChange={(e) => setCallbackUrl(e.target.value)}
                placeholder="Paste redirect URL: http://localhost:61135/oauth-callback?code=..."
              />
              <div className="flex gap-2">
                <Button disabled={!callbackUrl || busy} onClick={complete}>
                  Complete Import
                </Button>
                <Button variant="outline" onClick={() => setFlow(null)}>
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
        disabled={busy}
        onClick={() => ref.current?.click()}
      >
        <Upload className="mr-1.5 size-4" />
        {busy ? "Importing..." : "JSON Import"}
      </Button>
    </>
  );
}

function SkeletonGrid() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-20 w-full rounded-2xl" />
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-64 rounded-2xl" />
        ))}
      </div>
    </div>
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

  const gemini5h =
    byName("gemini-5h") ||
    byText("gemini", "5h") ||
    byText("gemini", "five");
  const geminiWeekly =
    byName("gemini-weekly") || byText("gemini", "weekly");

  const claude5h =
    byName("3p-5h") ||
    byName("claude:5h") ||
    byText("3p", "5h") ||
    byText("3p", "five") ||
    byText("claude", "5h");
  const claudeWeekly =
    byName("3p-weekly") ||
    byName("claude:weekly") ||
    byText("3p", "weekly") ||
    byText("claude", "weekly");

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
    "gemini-3.1-pro-high": "Gemini 3.1 Pro High",
    "gemini-3.1-pro-low": "Gemini 3.1 Pro Low",
    "gemini-3.6-flash-low": "Gemini 3.6 Flash Low",
    "gemini-3.6-flash-medium": "Gemini 3.6 Flash Medium",
    "gemini-3.6-flash-high": "Gemini 3.6 Flash High",
    "gemini-3.7-flash-low": "Gemini 3.7 Flash Low",
    "gemini-3.7-flash-medium": "Gemini 3.7 Flash Medium",
    "gemini-3.7-flash-high": "Gemini 3.7 Flash High",
    "gemini-3.8-flash-low": "Gemini 3.8 Flash Low",
    "gemini-3.8-flash-medium": "Gemini 3.8 Flash Medium",
    "gemini-3.8-flash-high": "Gemini 3.8 Flash High",
    "gemini-3.5-flash-low": "Gemini 3.5 Flash Medium",
    "gemini-3.5-flash-extra-low": "Gemini 3.5 Flash Low",
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
    return { account: a.email || a.id, remaining };
  });
}

function badgeClass(p: number) {
  return p <= 10
    ? "border-destructive/40 bg-destructive/15 text-destructive font-semibold"
    : p <= 35
    ? "border-amber-500/40 bg-amber-500/15 text-amber-500 font-semibold"
    : "border-emerald-500/40 bg-emerald-500/15 text-emerald-500 font-semibold";
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
