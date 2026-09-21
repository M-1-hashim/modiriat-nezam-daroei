"use client";

/**
 * ویوی موجودی صندوق — ترازینهٔ نقد هر شعبه به‌صورت جداگانه
 * وارده/صارده/مصارف + آخرین حرکت‌های نقدی
 */

import { useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Landmark,
  RefreshCw,
  ReceiptText,
  Wallet,
} from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { useApiData } from "@/lib/client-api";
import { formatHijriShort, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

// ─────────────────────── انواع ───────────────────────

type BranchBox = {
  branchId: string;
  branchName: string;
  branchCode: string;
  isHeadOffice: boolean;
  inflowAfn: number;
  outflowAfn: number;
  expensesAfn: number;
  pendingExpensesAfn: number;
  balanceAfn: number;
};

type TxRow = {
  id: string;
  kind: "PAYMENT_IN" | "PAYMENT_OUT" | "EXPENSE";
  number: string | null;
  title: string;
  sub: string | null;
  amountAfn: number;
  date: string;
  branchId: string;
  branchName: string;
};

type CashboxData = {
  branches: BranchBox[];
  totals: {
    inflowAfn: number;
    outflowAfn: number;
    expensesAfn: number;
    pendingExpensesAfn: number;
    balanceAfn: number;
  };
  recent: TxRow[];
};

// ─────────────────────── ویو ───────────────────────

export default function CashboxView() {
  const [branchFilter, setBranchFilter] = useState<string>("all");

  const qs = useMemo(
    () =>
      branchFilter && branchFilter !== "all"
        ? `?branchId=${encodeURIComponent(branchFilter)}`
        : "",
    [branchFilter]
  );

  const { data, loading, refetch } = useApiData<CashboxData>(
    `/api/cashbox${qs}`,
    [qs]
  );

  const branches = data?.branches ?? [];
  const totals = data?.totals;
  const recent = data?.recent ?? [];
  const hasData = !!data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="موجودی صندوق"
        description="ترازینهٔ نقد هر شعبه — وارده، صارده و مصارف نقدی"
        actions={
          <div className="flex items-center gap-2">
            <Select value={branchFilter} onValueChange={setBranchFilter}>
              <SelectTrigger className="w-44" aria-label="انتخاب شعبه">
                <SelectValue placeholder="همهٔ شعبه‌ها" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">همهٔ شعبه‌ها</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.branchId} value={b.branchId}>
                    {b.branchName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              onClick={() => refetch()}
              disabled={loading}
              aria-label="بارگیری مجدد"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        }
      />

      {/* ─── خلاصهٔ کلی ─── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          icon={<Wallet className="h-5 w-5" />}
          label="موجودی فعلی صندوق"
          value={totals ? formatMoney(totals.balanceAfn) : null}
          loading={!hasData}
          tone="balance"
        />
        <SummaryCard
          icon={<ArrowDownLeft className="h-5 w-5" />}
          label="مجموع وارده (نقدی)"
          value={totals ? formatMoney(totals.inflowAfn) : null}
          loading={!hasData}
          tone="in"
        />
        <SummaryCard
          icon={<ArrowUpRight className="h-5 w-5" />}
          label="مجموع صارده (نقدی)"
          value={totals ? formatMoney(totals.outflowAfn) : null}
          loading={!hasData}
          tone="out"
        />
        <SummaryCard
          icon={<ReceiptText className="h-5 w-5" />}
          label="مصارف تأییدشده"
          value={totals ? formatMoney(totals.expensesAfn) : null}
          loading={!hasData}
          tone="expense"
          hint={
            totals && totals.pendingExpensesAfn > 0
              ? `در انتظار تصویب: ${formatMoney(totals.pendingExpensesAfn)}`
              : undefined
          }
        />
      </div>

      {/* ─── صندوق هر شعبه ─── */}
      <section aria-label="موجودی صندوق شعبه‌ها">
        <h2 className="mb-3 text-base font-semibold">صندوق شعبه‌ها</h2>
        {!hasData ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-36 rounded-xl" />
            ))}
          </div>
        ) : branches.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              شعبه‌ای یافت نشد
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {branches.map((b) => (
              <Card
                key={b.branchId}
                className={cn(
                  "border-r-4",
                  b.balanceAfn >= 0 ? "border-r-emerald-500" : "border-r-rose-500"
                )}
              >
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Landmark className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate text-sm font-semibold">
                        {b.branchName}
                      </span>
                    </div>
                    {b.isHeadOffice && (
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        دفتر مرکزی
                      </Badge>
                    )}
                  </div>
                  <div>
                    <div className="text-[11px] text-muted-foreground">
                      موجودی فعلی
                    </div>
                    <div
                      className={cn(
                        "text-xl font-bold tabular-nums",
                        b.balanceAfn >= 0 ? "text-emerald-600" : "text-rose-600"
                      )}
                    >
                      {formatMoney(b.balanceAfn)}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/40 p-2 text-center">
                    <div>
                      <div className="text-[10px] text-muted-foreground">وارده</div>
                      <div className="text-xs font-semibold tabular-nums text-emerald-600">
                        {formatMoney(b.inflowAfn, undefined, { withCurrency: false })}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">صارده</div>
                      <div className="text-xs font-semibold tabular-nums text-rose-600">
                        {formatMoney(b.outflowAfn, undefined, { withCurrency: false })}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">مصارف</div>
                      <div className="text-xs font-semibold tabular-nums text-amber-600">
                        {formatMoney(b.expensesAfn, undefined, { withCurrency: false })}
                      </div>
                    </div>
                  </div>
                  {b.pendingExpensesAfn > 0 && (
                    <div className="text-[11px] text-muted-foreground">
                      مصرف در انتظار تصویب: {formatMoney(b.pendingExpensesAfn)}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* ─── آخرین حرکت‌های نقدی ─── */}
      <section aria-label="آخرین حرکت‌های نقدی">
        <h2 className="mb-3 text-base font-semibold">آخرین حرکت‌های نقدی</h2>
        <Card>
          <CardContent className="p-0">
            {!hasData ? (
              <div className="space-y-2 p-4">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-10 rounded-lg" />
                ))}
              </div>
            ) : recent.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                هنوز حرکت نقدی ثبت نشده است
              </div>
            ) : (
              <div className="max-h-96 overflow-y-auto">
                <ul className="divide-y">
                  {recent.map((t) => (
                    <li
                      key={`${t.kind}-${t.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-2.5"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                            t.kind === "PAYMENT_IN" &&
                              "bg-emerald-100 text-emerald-600",
                            t.kind === "PAYMENT_OUT" && "bg-rose-100 text-rose-600",
                            t.kind === "EXPENSE" && "bg-amber-100 text-amber-600"
                          )}
                        >
                          {t.kind === "PAYMENT_IN" ? (
                            <ArrowDownLeft className="h-4 w-4" />
                          ) : t.kind === "PAYMENT_OUT" ? (
                            <ArrowUpRight className="h-4 w-4" />
                          ) : (
                            <ReceiptText className="h-4 w-4" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">
                            {t.title}
                            {t.number && (
                              <span className="mr-2 font-mono text-[11px] text-muted-foreground">
                                {t.number}
                              </span>
                            )}
                          </div>
                          <div className="truncate text-[11px] text-muted-foreground">
                            {t.branchName} — {formatHijriShort(t.date)}
                            {t.kind === "EXPENSE" ? " — مصرف" : ""}
                            {t.sub ? ` — ${t.sub}` : ""}
                          </div>
                        </div>
                      </div>
                      <div
                        className={cn(
                          "shrink-0 text-sm font-semibold tabular-nums",
                          t.kind === "PAYMENT_IN"
                            ? "text-emerald-600"
                            : t.kind === "PAYMENT_OUT"
                              ? "text-rose-600"
                              : "text-amber-600"
                        )}
                      >
                        {t.kind === "PAYMENT_IN" ? "+" : "−"}
                        {formatMoney(t.amountAfn, undefined, {
                          withCurrency: false,
                        })}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

// ─────────────────────── کارت خلاصه ───────────────────────

function SummaryCard({
  icon,
  label,
  value,
  loading,
  tone,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  loading: boolean;
  tone: "balance" | "in" | "out" | "expense";
  hint?: string;
}) {
  const toneCls =
    tone === "balance"
      ? "bg-primary/10 text-primary"
      : tone === "in"
        ? "bg-emerald-100 text-emerald-600"
        : tone === "out"
          ? "bg-rose-100 text-rose-600"
          : "bg-amber-100 text-amber-600";
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
            toneCls
          )}
        >
          {icon}
        </span>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          {loading ? (
            <Skeleton className="mt-1 h-6 w-28" />
          ) : (
            <div className="truncate text-lg font-bold tabular-nums">
              {value}
            </div>
          )}
          {hint && (
            <div className="text-[11px] text-muted-foreground">{hint}</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
