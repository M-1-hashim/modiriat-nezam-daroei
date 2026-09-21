"use client";

/** سابقه فعالیت‌ها (Audit Log) — فیلترها، جدول سِرور-صفحه‌بندی‌شده و دیالوگ جزئیات before/after */

import { useMemo, useState } from "react";
import { FileJson, Filter } from "lucide-react";
import { useUser, PermissionGate } from "@/components/shared/use-user";
import { useApiData } from "@/lib/client-api";
import { PageHeader, BADGE_TONES } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FormDialog } from "@/components/shared/form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatHijriDateTime, formatNumber } from "@/lib/format";
import { hijriDayEnd, hijriDayStart, hijriInputToDate } from "@/lib/hijri";

// ─── انواع ───

type AuditItem = {
  id: string;
  userName?: string | null;
  branchName?: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  summary?: string | null;
  before?: string | null;
  after?: string | null;
  ip?: string | null;
  createdAt?: string | null;
  [key: string]: unknown;
};

type AuditPageData = {
  items?: AuditItem[];
  total?: number;
  page?: number;
  limit?: number;
};

type AppliedFilters = {
  action: string;
  branchId: string;
  fromIso: string;
  toIso: string;
  q: string;
};

// ─── ثابت‌ها ───

const PAGE_SIZE = 15;
const ALL = "__ALL__";

const ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: "LOGIN", label: "ورود به سیستم" },
  { value: "LOGOUT", label: "خروج از سیستم" },
  { value: "CREATE", label: "ایجاد رکورد" },
  { value: "UPDATE", label: "ویرایش رکورد" },
  { value: "DELETE", label: "حذف رکورد" },
  { value: "APPROVE", label: "تصویب" },
  { value: "CANCEL", label: "لغو" },
  { value: "PAYMENT", label: "پرداخت" },
  { value: "SEED", label: "بارگذاری دیتای نمایشی" },
  { value: "BACKUP", label: "ایجاد نسخه احتیاطی" },
  { value: "RESTORE", label: "بازیابی نسخه احتیاطی" },
  { value: "RATE_MANUAL", label: "ثبت دستی نرخ اسعار" },
  { value: "RATE_UPDATE", label: "به‌روزرسانی نرخ اسعار" },
];

const ACTION_LABEL_MAP: Record<string, string> = Object.fromEntries(
  ACTION_OPTIONS.map((o) => [o.value, o.label])
);

const ACTION_TONES: Record<string, string> = {
  LOGIN: "emerald",
  CREATE: "emerald",
  APPROVE: "emerald",
  UPDATE: "amber",
  RATE_MANUAL: "amber",
  RATE_UPDATE: "amber",
  PAYMENT: "emerald",
  DELETE: "rose",
  CANCEL: "rose",
  RESTORE: "rose",
  LOGOUT: "slate",
  SEED: "slate",
  BACKUP: "slate",
};

const EMPTY_FILTERS: AppliedFilters = { action: "", branchId: "", fromIso: "", toIso: "", q: "" };

function ActionBadge({ action }: { action?: string | null }) {
  const label = (action && ACTION_LABEL_MAP[action]) || action || "—";
  const tone = (action && ACTION_TONES[action]) || "slate";
  return (
    <Badge variant="outline" className={BADGE_TONES[tone] ?? BADGE_TONES.slate}>
      {label}
    </Badge>
  );
}

/** رشته JSON خام را زیبا نمایش می‌دهد؛ اگر JSON نبود همان متن خام برمی‌گردد */
function prettyJson(raw?: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object") {
      return JSON.stringify(parsed, null, 2);
    }
    return String(parsed);
  } catch {
    return raw;
  }
}

// ─── ویو ───

export default function AuditView() {
  return (
    <PermissionGate permission="audit.view">
      <AuditInner />
    </PermissionGate>
  );
}

function AuditInner() {
  const { user } = useUser();
  const { data: branchesRaw } = useApiData<unknown>(user.isSuperAdmin ? "/api/branches" : null);

  const [page, setPage] = useState(1);
  const [applied, setApplied] = useState<AppliedFilters>(EMPTY_FILTERS);

  // درفت فیلترها — پس از «اعمال» در کوئری استفاده می‌شود
  const [draftAction, setDraftAction] = useState(ALL);
  const [draftBranch, setDraftBranch] = useState(ALL);
  const [draftFrom, setDraftFrom] = useState("");
  const [draftTo, setDraftTo] = useState("");
  const [draftQ, setDraftQ] = useState("");
  const [dateErr, setDateErr] = useState("");

  const branches = useMemo(() => {
    if (!Array.isArray(branchesRaw)) {
      const items = (branchesRaw as { items?: unknown } | null)?.items;
      return Array.isArray(items) ? (items as { id: string; name: string }[]) : [];
    }
    return branchesRaw as { id: string; name: string }[];
  }, [branchesRaw]);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", String(PAGE_SIZE));
    if (applied.action) params.set("action", applied.action);
    if (applied.branchId) params.set("branchId", applied.branchId);
    if (applied.fromIso) params.set("from", applied.fromIso);
    if (applied.toIso) params.set("to", applied.toIso);
    if (applied.q) params.set("q", applied.q);
    return params.toString();
  }, [page, applied]);

  const { data, loading, error, refetch } = useApiData<AuditPageData>(`/api/audit?${query}`, [query]);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const limit = data?.limit ?? PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const apply = () => {
    const fromTrim = draftFrom.trim();
    const toTrim = draftTo.trim();
    const fromDate = fromTrim ? hijriInputToDate(fromTrim) : null;
    const toDate = toTrim ? hijriInputToDate(toTrim) : null;
    if (fromTrim && !fromDate) {
      setDateErr("تاریخ «از» نامعتبر است — قالب صحیح: 1404/01/01");
      return;
    }
    if (toTrim && !toDate) {
      setDateErr("تاریخ «تا» نامعتبر است — قالب صحیح: 1404/01/01");
      return;
    }
    if (fromDate && toDate && fromDate > toDate) {
      setDateErr("تاریخ «از» نمی‌تواند بعد از تاریخ «تا» باشد");
      return;
    }
    setDateErr("");
    setApplied({
      action: draftAction === ALL ? "" : draftAction,
      branchId: draftBranch === ALL ? "" : draftBranch,
      fromIso: fromDate ? hijriDayStart(fromDate).toISOString() : "",
      toIso: toDate ? hijriDayEnd(toDate).toISOString() : "",
      q: draftQ.trim(),
    });
    setPage(1);
  };

  const reset = () => {
    setDraftAction(ALL);
    setDraftBranch(ALL);
    setDraftFrom("");
    setDraftTo("");
    setDraftQ("");
    setDateErr("");
    setApplied(EMPTY_FILTERS);
    setPage(1);
  };

  const [detail, setDetail] = useState<AuditItem | null>(null);
  const beforeJson = useMemo(() => prettyJson(detail?.before), [detail]);
  const afterJson = useMemo(() => prettyJson(detail?.after), [detail]);

  const columns: Column<AuditItem>[] = [
    { key: "userName", header: "کاربر", render: (r) => r.userName ?? "—" },
    { key: "branchName", header: "شعبه", render: (r) => r.branchName ?? "—" },
    { key: "action", header: "عملیه", render: (r) => <ActionBadge action={r.action} /> },
    { key: "entity", header: "موجودیت", render: (r) => r.entity ?? "—" },
    {
      key: "summary",
      header: "خلاصه",
      render: (r) => (
        <span className="line-clamp-2 block max-w-xs text-xs">{r.summary ?? "—"}</span>
      ),
    },
    { key: "createdAt", header: "تاریخ", render: (r) => formatHijriDateTime(r.createdAt) },
    {
      key: "details",
      header: "جزئیات",
      sortable: false,
      render: (r) => (
        <Button variant="outline" size="sm" onClick={() => setDetail(r)}>
          <FileJson className="h-3.5 w-3.5" />
          جزئیات
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="سابقه فعالیت‌ها"
        description="ثبت تمام عملیات کاربران در سیستم به‌صورت زنده"
        actions={
          <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
            <Filter className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            به‌روزرسانی
          </Button>
        }
      />

      <Card className="gap-3 py-4">
        <CardHeader className="px-4">
          <CardTitle className="text-base">فیلترها</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              apply();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="grid gap-2">
                <Label htmlFor="audit-action">نوع عملیه</Label>
                <Select value={draftAction} onValueChange={setDraftAction}>
                  <SelectTrigger id="audit-action" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>همه عملیات</SelectItem>
                    {ACTION_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {user.isSuperAdmin && (
                <div className="grid gap-2">
                  <Label htmlFor="audit-branch">شعبه</Label>
                  <Select value={draftBranch} onValueChange={setDraftBranch}>
                    <SelectTrigger id="audit-branch" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>همه شعبه‌ها</SelectItem>
                      {branches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="grid gap-2">
                <Label htmlFor="audit-from">از تاریخ (هجری)</Label>
                <Input
                  id="audit-from"
                  dir="ltr"
                  value={draftFrom}
                  onChange={(e) => setDraftFrom(e.target.value)}
                  placeholder="1404/01/01"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="audit-to">تا تاریخ (هجری)</Label>
                <Input
                  id="audit-to"
                  dir="ltr"
                  value={draftTo}
                  onChange={(e) => setDraftTo(e.target.value)}
                  placeholder="1404/01/30"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
              <div className="grid gap-2">
                <Label htmlFor="audit-q">جستجو</Label>
                <Input
                  id="audit-q"
                  value={draftQ}
                  onChange={(e) => setDraftQ(e.target.value)}
                  placeholder="جستجو در نام کاربر، خلاصه و موجودیت..."
                />
              </div>
              <Button
                type="submit"
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                اعمال فیلتر
              </Button>
              <Button type="button" variant="outline" onClick={reset}>
                پاک کردن فیلترها
              </Button>
            </div>

            {dateErr && (
              <p className="text-sm font-medium text-rose-600 dark:text-rose-400">{dateErr}</p>
            )}
          </form>
        </CardContent>
      </Card>

      {error ? (
        <Card className="border-rose-300 dark:border-rose-900">
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <p className="text-sm text-rose-600 dark:text-rose-400">خطا در دریافت سابقه فعالیت‌ها: {error}</p>
            <Button size="sm" onClick={refetch} className="bg-primary text-primary-foreground hover:bg-primary/90">
              تلاش دوباره
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="gap-3 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-base">رکوردهای سابقه</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 p-4 pt-0">
            <DataTable
              columns={columns}
              rows={items}
              loading={loading}
              rowKey={(r) => r.id}
              pageSize={1000}
              emptyText="رکوردی با این فیلترها یافت نشد"
              footer={`مجموع کل: ${formatNumber(total)} رکورد`}
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                صفحه {formatNumber(page)} از {formatNumber(totalPages)}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  قبلی
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  بعدی
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <FormDialog
        open={!!detail}
        onOpenChange={(o) => {
          if (!o) setDetail(null);
        }}
        wide
        title="جزئیات رکورد سابقه"
        description={detail ? `${detail.entity ?? "—"} — ${formatHijriDateTime(detail.createdAt)}` : undefined}
      >
        {detail && (
          <div className="grid gap-4">
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <p>
                کاربر: <span className="font-medium">{detail.userName ?? "—"}</span>
              </p>
              <p className="flex items-center gap-1">
                عملیه: <ActionBadge action={detail.action} />
              </p>
              <p>
                شعبه: <span className="font-medium">{detail.branchName ?? "—"}</span>
              </p>
              <p>
                موجودیت:{" "}
                <span className="font-medium">
                  {detail.entity ?? "—"}
                  {detail.entityId ? ` (${detail.entityId})` : ""}
                </span>
              </p>
              {detail.ip && (
                <p dir="auto">
                  آی‌پی: <span dir="ltr" className="font-mono text-xs">{detail.ip}</span>
                </p>
              )}
              {detail.summary && (
                <p className="sm:col-span-2">
                  خلاصه: <span className="font-medium">{detail.summary}</span>
                </p>
              )}
            </div>

            {beforeJson && (
              <div>
                <p className="mb-1 text-xs font-semibold text-muted-foreground">حالت قبل از تغییر</p>
                <pre
                  dir="ltr"
                  className="max-h-56 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-100"
                >
                  {beforeJson}
                </pre>
              </div>
            )}
            {afterJson && (
              <div>
                <p className="mb-1 text-xs font-semibold text-muted-foreground">حالت بعد از تغییر</p>
                <pre
                  dir="ltr"
                  className="max-h-56 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-100"
                >
                  {afterJson}
                </pre>
              </div>
            )}
            {!beforeJson && !afterJson && (
              <p className="text-sm text-muted-foreground">برای این عملیات حالت قبل/بعد ثبت نشده است</p>
            )}
          </div>
        )}
      </FormDialog>
    </div>
  );
}
