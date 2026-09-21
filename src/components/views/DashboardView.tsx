"use client";

/** داشبورد اصلی — کارت‌های آماری رول-محور، عملکرد شعبه‌ها/فروشندگان/مناطق و آخرین تراکنش‌ها */

import { useMemo } from "react";
import {
  Boxes,
  Building2,
  CalendarClock,
  Coins,
  HandCoins,
  PackageX,
  PiggyBank,
  RefreshCw,
  ShoppingCart,
  Store,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useUser, PermissionGate } from "@/components/shared/use-user";
import { useApiData } from "@/lib/client-api";
import {
  PageHeader,
  StatCard,
  StatusBadge,
  BADGE_TONES,
} from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatHijriDate, formatHijriDateTime, formatMoney, formatNumber } from "@/lib/format";

// ─── انواع داده API ───

type DashboardData = {
  branchCount?: number;
  salesTodayAfn?: number;
  salesMonthAfn?: number;
  purchasesMonthAfn?: number;
  receivablesAfn?: number;
  payablesAfn?: number;
  inventoryValueAfn?: number;
  grossProfitMonthAfn?: number;
  netProfitMonthAfn?: number;
  expiringBatches?: number;
  lowStockCount?: number;
  recent?: RecentTx[];
  branchPerformance?: BranchPerf[];
  salespersonPerformance?: SalespersonPerf[];
  territoryPerformance?: TerritoryPerf[];
};

type RecentTx = {
  id?: string;
  kind?: string;
  number?: string | null;
  party?: string | null;
  totalAfn?: number;
  status?: string | null;
  date?: string | null;
  branchName?: string | null;
  [key: string]: unknown;
};

type BranchPerf = {
  branchId?: string;
  branchName?: string;
  salesAfn?: number;
  purchasesAfn?: number;
  expensesAfn?: number;
  netProfitAfn?: number;
  [key: string]: unknown;
};

type SalespersonPerf = {
  name?: string;
  salesAfn?: number;
  count?: number;
  invoices?: number;
  profitAfn?: number;
  [key: string]: unknown;
};

type TerritoryPerf = {
  name?: string;
  salesAfn?: number;
  count?: number;
  invoices?: number;
  [key: string]: unknown;
};

type StatDef = {
  key: string;
  label: string;
  value: number | undefined;
  icon: LucideIcon;
  tone: "emerald" | "amber" | "rose" | "slate";
  money?: boolean;
};

const KIND_MAP: Record<string, { label: string; tone: string }> = {
  SALE: { label: "فروش", tone: "emerald" },
  PURCHASE: { label: "خرید", tone: "amber" },
  PAYMENT: { label: "پرداخت", tone: "slate" },
  SALES_RETURN: { label: "برگشتی فروش", tone: "rose" },
  PURCHASE_RETURN: { label: "برگشتی خرید", tone: "rose" },
  EXPENSE: { label: "مصرف", tone: "slate" },
};

function KindBadge({ kind }: { kind?: string | null }) {
  const info = (kind && KIND_MAP[kind]) || { label: kind || "—", tone: "slate" };
  return (
    <Badge variant="outline" className={BADGE_TONES[info.tone] ?? BADGE_TONES.slate}>
      {info.label}
    </Badge>
  );
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="p-4 pt-0">{children}</CardContent>
    </Card>
  );
}

export default function DashboardView() {
  return (
    <PermissionGate permission="dashboard.view">
      <DashboardInner />
    </PermissionGate>
  );
}

function DashboardInner() {
  const { user } = useUser();
  const { data, loading, error, refetch } = useApiData<DashboardData>("/api/dashboard");
  const todayHijri = useMemo(() => formatHijriDate(new Date()), []);

  const stats: StatDef[] = [
    { key: "branchCount", label: "تعداد شعبه‌ها", value: data?.branchCount, icon: Building2, tone: "slate" },
    { key: "salesToday", label: "فروش امروز", value: data?.salesTodayAfn, icon: Store, tone: "emerald", money: true },
    { key: "salesMonth", label: "فروش ماه جاری", value: data?.salesMonthAfn, icon: TrendingUp, tone: "emerald", money: true },
    { key: "purchasesMonth", label: "خرید ماه جاری", value: data?.purchasesMonthAfn, icon: ShoppingCart, tone: "amber", money: true },
    { key: "receivables", label: "مطالبات از مشتریان", value: data?.receivablesAfn, icon: HandCoins, tone: "rose", money: true },
    { key: "payables", label: "بدهی به تأمین‌کنندگان", value: data?.payablesAfn, icon: Wallet, tone: "amber", money: true },
    { key: "inventory", label: "ارزش موجودی گدام", value: data?.inventoryValueAfn, icon: Boxes, tone: "emerald", money: true },
    { key: "grossProfit", label: "منفعت ناخالص ماه جاری", value: data?.grossProfitMonthAfn, icon: Coins, tone: "emerald", money: true },
    { key: "netProfit", label: "منفعت خالص ماه جاری", value: data?.netProfitMonthAfn, icon: PiggyBank, tone: "emerald", money: true },
    { key: "expiring", label: "بچ‌های نزدیک انقضا", value: data?.expiringBatches, icon: CalendarClock, tone: "amber" },
    { key: "lowStock", label: "اقلام زیر حد نصاب", value: data?.lowStockCount, icon: PackageX, tone: "rose" },
  ];
  const visibleStats = stats.filter((s) => typeof s.value === "number");

  const branchCols: Column<BranchPerf>[] = [
    { key: "branchName", header: "شعبه", render: (r) => r.branchName ?? "—" },
    { key: "salesAfn", header: "فروش", render: (r) => formatMoney(r.salesAfn, "AFN") },
    { key: "purchasesAfn", header: "خرید", render: (r) => formatMoney(r.purchasesAfn, "AFN") },
    { key: "expensesAfn", header: "مصارف", render: (r) => formatMoney(r.expensesAfn, "AFN") },
    { key: "netProfitAfn", header: "منفعت خالص", render: (r) => formatMoney(r.netProfitAfn, "AFN") },
  ];

  const salespersonCols: Column<SalespersonPerf>[] = [
    { key: "name", header: "فروشنده", render: (r) => r.name ?? "—" },
    { key: "salesAfn", header: "مبلغ فروش", render: (r) => formatMoney(r.salesAfn, "AFN") },
    {
      key: "count",
      header: "تعداد فاکتور",
      render: (r) => {
        const c = r.count ?? r.invoices;
        return typeof c === "number" ? formatNumber(c) : "—";
      },
    },
    {
      key: "profitAfn",
      header: "منفعت",
      render: (r) => (typeof r.profitAfn === "number" ? formatMoney(r.profitAfn, "AFN") : "—"),
    },
  ];

  const territoryCols: Column<TerritoryPerf>[] = [
    { key: "name", header: "منطقه", render: (r) => r.name ?? "—" },
    { key: "salesAfn", header: "مبلغ فروش", render: (r) => formatMoney(r.salesAfn, "AFN") },
    {
      key: "count",
      header: "تعداد فاکتور",
      render: (r) => {
        const c = r.count ?? r.invoices;
        return typeof c === "number" ? formatNumber(c) : "—";
      },
    },
  ];

  const recentCols: Column<RecentTx>[] = [
    { key: "kind", header: "نوع", render: (r) => <KindBadge kind={r.kind} /> },
    {
      key: "number",
      header: "شماره سند",
      render: (r) => (
        <span dir="ltr" className="font-mono text-xs">
          {r.number ?? "—"}
        </span>
      ),
    },
    { key: "party", header: "طرف حساب", render: (r) => r.party ?? "—" },
    {
      key: "totalAfn",
      header: "مبلغ",
      render: (r) => (typeof r.totalAfn === "number" ? formatMoney(r.totalAfn, "AFN") : "—"),
    },
    { key: "status", header: "وضعیت", render: (r) => <StatusBadge status={r.status} /> },
    { key: "date", header: "تاریخ", render: (r) => formatHijriDateTime(r.date) },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={`داشبورد — ${user.branchName ?? "کل سیستم"}`}
        description={`خلاصه عملکرد — امروز ${todayHijri}`}
        actions={
          <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            به‌روزرسانی
          </Button>
        }
      />

      {error ? (
        <Card className="border-rose-300 dark:border-rose-900">
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <p className="text-sm text-rose-600 dark:text-rose-400">
              خطا در دریافت معلومات داشبورد: {error}
            </p>
            <Button size="sm" onClick={refetch} className="bg-primary text-primary-foreground hover:bg-primary/90">
              تلاش دوباره
            </Button>
          </CardContent>
        </Card>
      ) : loading && !data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : visibleStats.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            فعلاً معلومات آماری موجود نیست. پس از ثبت اولین تراکنش‌ها، خلاصه عملکرد در اینجا نمایش داده می‌شود.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {visibleStats.map((s) => (
            <StatCard
              key={s.key}
              label={s.label}
              value={s.money ? formatMoney(s.value, "AFN") : formatNumber(s.value)}
              icon={s.icon}
              tone={s.tone}
            />
          ))}
        </div>
      )}

      {data?.branchPerformance && data.branchPerformance.length > 0 && (
        <SectionCard title="عملکرد شعبه‌ها" description="ماه جاری شمسی (افغانی)">
          <DataTable
            columns={branchCols}
            rows={data.branchPerformance}
            rowKey={(r, i) => r.branchId ?? String(i)}
            pageSize={10}
            emptyText="معلوماتی برای شعبه‌ها ثبت نشده است"
          />
        </SectionCard>
      )}

      {data?.salespersonPerformance && data.salespersonPerformance.length > 0 && (
        <SectionCard title="عملکرد فروشندگان" description="ماه جاری شمسی (افغانی)">
          <DataTable
            columns={salespersonCols}
            rows={data.salespersonPerformance}
            rowKey={(r, i) => r.name ?? String(i)}
            pageSize={10}
            emptyText="معلوماتی برای فروشندگان ثبت نشده است"
          />
        </SectionCard>
      )}

      {data?.territoryPerformance && data.territoryPerformance.length > 0 && (
        <SectionCard title="عملکرد مناطق" description="ماه جاری شمسی (افغانی)">
          <DataTable
            columns={territoryCols}
            rows={data.territoryPerformance}
            rowKey={(r, i) => r.name ?? String(i)}
            pageSize={10}
            emptyText="معلوماتی برای مناطق ثبت نشده است"
          />
        </SectionCard>
      )}

      <SectionCard title="آخرین تراکنش‌ها" description="ده تراکنش اخیر سیستم">
        <DataTable
          columns={recentCols}
          rows={data?.recent ?? []}
          searchKeys={["number", "party"]}
          searchPlaceholder="جستجوی شماره سند یا طرف حساب..."
          loading={loading && !data}
          rowKey={(r, i) => r.id ?? String(i)}
          pageSize={10}
          emptyText="تراکنشی ثبت نشده است"
        />
      </SectionCard>
    </div>
  );
}
