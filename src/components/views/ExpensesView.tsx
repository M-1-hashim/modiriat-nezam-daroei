"use client";

/** ویو مصارف — فیلترها، آمار، جدول، ثبت/ویرایش، تصویب، پرداخت، لغو */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  CheckCircle2,
  Banknote,
  Receipt,
  Clock,
  Layers,
} from "lucide-react";
import { useUser, PermissionGate } from "@/components/shared/use-user";
import {
  PageHeader,
  StatCard,
  StatusBadge,
} from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FormDialog, ConfirmDialog } from "@/components/shared/form-dialog";
import { useApiData, apiSend, uuid, probeServer, type QueuedResult } from "@/lib/client-api";
import { runBulkOperation, bulkResultMessage } from "@/lib/bulk";
import {
  formatMoney,
  formatNumber,
  currencyLabel,
  formatHijriShort,
} from "@/lib/format";
import { dateToHijriInput, hijriInputToDate, hijriInputToDayEnd, hijriInputToDayStart } from "@/lib/hijri";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─────────────────────────── انواع ───────────────────────────

type Expense = {
  id: string;
  categoryId: string;
  category?: { id: string; name: string } | null;
  amount: number;
  currency: string;
  exchangeRate: number;
  amountAfn: number;
  date: string;
  description?: string | null;
  status: string;
  createdByName?: string | null;
  branchId?: string;
  branch?: { id: string; name: string } | null;
};

type ExpenseCategory = { id: string; name: string };

type Branch = { id: string; name: string };

type RateRow = {
  base: string;
  quote: string;
  buyRate: number;
  sellRate: number;
  source?: string;
  isOffline?: boolean;
  createdAt?: string;
};

type ExpenseForm = {
  id?: string;
  categoryId: string;
  amount: string;
  currency: string;
  originalCurrency?: string;
  originalRate?: number;
  date: string;
  description: string;
};

// ─────────────────────────── کمکی ───────────────────────────

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "ALL", label: "همه وضعیت‌ها" },
  { value: "PENDING", label: "در انتظار تصویب" },
  { value: "APPROVED", label: "تأیید شده" },
  { value: "PAID", label: "پرداخت شده" },
  { value: "CANCELLED", label: "لغو شده" },
];

const todayInput = () => dateToHijriInput(new Date());
const monthAgoInput = () => dateToHijriInput(new Date(Date.now() - 30 * 864e5));

function listOf<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    const items = (data as { items?: unknown }).items;
    if (Array.isArray(items)) return items as T[];
  }
  return [];
}

function qs(
  params: Record<string, string | number | undefined | null>,
): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v).trim() !== "")
      sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

function hijriToIso(s: string): string | undefined {
  if (!s.trim()) return undefined;
  const d = hijriInputToDate(s);
  return d ? d.toISOString() : undefined;
}

/** فیلتر «از تاریخ» — شروع روز شمسی (۰۰:۰۰ کابل) */
function hijriRangeFrom(s: string): string | undefined {
  if (!s.trim()) return undefined;
  const d = hijriInputToDayStart(s);
  return d ? d.toISOString() : undefined;
}

/** فیلتر «تا تاریخ» — ختم روز شمسی (۲۳:۵۹:۵۹ کابل) */
function hijriRangeTo(s: string): string | undefined {
  if (!s.trim()) return undefined;
  const d = hijriInputToDayEnd(s);
  return d ? d.toISOString() : undefined;
}

function extractRate(data: unknown): RateRow | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const cand = (o.rate && typeof o.rate === "object" ? o.rate : o) as Record<
    string,
    unknown
  >;
  if (typeof cand.buyRate === "number" || typeof cand.sellRate === "number") {
    return {
      base: String(cand.base ?? ""),
      quote: String(cand.quote ?? ""),
      buyRate: Number(cand.buyRate ?? 0),
      sellRate: Number(cand.sellRate ?? cand.buyRate ?? 0),
      source: typeof cand.source === "string" ? cand.source : undefined,
      isOffline: Boolean(cand.isOffline),
      createdAt:
        typeof cand.createdAt === "string" ? cand.createdAt : undefined,
    };
  }
  return null;
}

function isQueued(res: unknown): res is QueuedResult {
  return !!res && typeof res === "object" && "queued" in res;
}

// ─────────────────────────── ویو ───────────────────────────

export default function ExpensesView() {
  const { user, hasPermission } = useUser();
  const canCreate = hasPermission("expenses.create");
  const canEdit = hasPermission("expenses.edit");
  const canApprove = hasPermission("expenses.approve");

  // فیلترها
  const [status, setStatus] = useState("ALL");
  const [categoryId, setCategoryId] = useState("ALL");
  const [branchId, setBranchId] = useState("ALL");
  const [fromInput, setFromInput] = useState(monthAgoInput);
  const [toInput, setToInput] = useState(todayInput);

  const filterQuery = useMemo(
    () =>
      qs({
        status: status !== "ALL" ? status : undefined,
        categoryId: categoryId !== "ALL" ? categoryId : undefined,
        branchId: branchId !== "ALL" ? branchId : undefined,
        from: hijriRangeFrom(fromInput),
        to: hijriRangeTo(toInput),
      }),
    [status, categoryId, branchId, fromInput, toInput],
  );

  const {
    data: expensesData,
    loading,
    refetch,
  } = useApiData<unknown>(`/api/expenses${filterQuery}`, [filterQuery]);
  const expenses = useMemo(() => listOf<Expense>(expensesData), [expensesData]);

  const { data: categoriesData, refetch: refetchCategories } =
    useApiData<unknown>("/api/expense-categories");
  const categories = useMemo(
    () => listOf<ExpenseCategory>(categoriesData),
    [categoriesData],
  );

  const { data: branchesData } = useApiData<unknown>(
    user.isSuperAdmin ? "/api/branches" : null,
  );
  const branches = useMemo(() => listOf<Branch>(branchesData), [branchesData]);

  // آمار کوچک
  const periodTotal = useMemo(
    () =>
      expenses
        .filter((e) => e.status === "APPROVED" || e.status === "PAID")
        .reduce((s, e) => s + (Number(e.amountAfn) || 0), 0),
    [expenses],
  );
  const pendingCount = useMemo(
    () => expenses.filter((e) => e.status === "PENDING").length,
    [expenses],
  );

  // دیالوگ ثبت/ویرایش
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ExpenseForm>(() => ({
    categoryId: "",
    amount: "",
    currency: "AFN",
    date: todayInput(),
    description: "",
  }));
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickName, setQuickName] = useState("");
  const [quickSaving, setQuickSaving] = useState(false);

  // لغو
  const [cancelTarget, setCancelTarget] = useState<Expense | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // انتخاب گروهی (فقط آنلاین — عملیات گروهی از صف آفلاین عبور نمی‌کند)
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkCancelOpen, setBulkCancelOpen] = useState(false);
  const [bulkApproveOpen, setBulkApproveOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  // پاک‌سازی انتخاب‌ها اگر ردیف‌ها حذف/فیلتر شده باشند
  useEffect(() => {
    if (selectedIds.length === 0) return;
    const existing = new Set(expenses.map((e) => e.id));
    const next = selectedIds.filter((id) => existing.has(id));
    if (next.length !== selectedIds.length) setSelectedIds(next);
  }, [expenses, selectedIds]);

  // نرخ اسعار برای ارز خارجی
  const needRate = dialogOpen && form.currency !== "AFN";
  const { data: latestRateData } = useApiData<unknown>(
    needRate ? `/api/exchange-rates/latest?base=${form.currency}` : null,
    [needRate, form.currency],
  );
  const latestRate = useMemo(
    () => extractRate(latestRateData),
    [latestRateData],
  );

  const derivedRate = useMemo(() => {
    if (form.currency === "AFN") return 1;
    if (!latestRate) return 0;
    return latestRate.sellRate || latestRate.buyRate || 0;
  }, [form.currency, latestRate]);

  // در ویرایش اگر ارز تغییر نکرده باشد نرخ اصلی حفظ می‌شود
  const effectiveRate =
    form.id && form.originalCurrency === form.currency && form.originalRate
      ? form.originalRate
      : derivedRate;

  const afnPreview = (Number(form.amount) || 0) * effectiveRate;

  const openCreate = () => {
    setForm({
      categoryId: "",
      amount: "",
      currency: "AFN",
      date: todayInput(),
      description: "",
    });
    setQuickOpen(false);
    setQuickName("");
    setDialogOpen(true);
  };

  const openEdit = (e: Expense) => {
    setForm({
      id: e.id,
      categoryId: e.categoryId,
      amount: String(e.amount ?? ""),
      currency: e.currency || "AFN",
      originalCurrency: e.currency || "AFN",
      originalRate: Number(e.exchangeRate ?? 1),
      date: dateToHijriInput(e.date) || todayInput(),
      description: e.description ?? "",
    });
    setQuickOpen(false);
    setDialogOpen(true);
  };

  const submitForm = async () => {
    if (!form.categoryId) {
      toast.error("کتگوری مصرف را انتخاب کنید");
      return;
    }
    const amount = Number(form.amount);
    if (!amount || amount <= 0) {
      toast.error("مبلغ مصرف را درست وارد کنید");
      return;
    }
    const dateIso = hijriToIso(form.date);
    if (!dateIso) {
      toast.error("تاریخ نامعتبر است — مثال: ۱۴۰۴/۰۱/۰۱");
      return;
    }
    if (form.currency !== "AFN" && !effectiveRate) {
      toast.error(
        "نرخ ارز در دسترس نیست — ابتدا نرخ‌ها را ثبت یا به‌روزرسانی کنید",
      );
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        categoryId: form.categoryId,
        amount,
        currency: form.currency,
        exchangeRate: effectiveRate,
        date: dateIso,
        description: form.description.trim() || undefined,
      };
      let res: unknown;
      if (form.id) {
        res = await apiSend(`/api/expenses/${form.id}`, {
          method: "PUT",
          body,
        });
      } else {
        body.localId = uuid();
        res = await apiSend("/api/expenses", { body });
      }
      if (isQueued(res)) {
        toast.info("به‌صورت آفلاین ذخیره شد؛ پس از اتصال همگام می‌شود");
      } else {
        toast.success(form.id ? "مصرف ویرایش شد" : "مصرف ثبت شد");
        refetch();
      }
      setDialogOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ثبت مصرف ناموفق بود");
    } finally {
      setSaving(false);
    }
  };

  const quickAddCategory = async () => {
    const name = quickName.trim();
    if (!name) {
      toast.error("نام کتگوری را وارد کنید");
      return;
    }
    setQuickSaving(true);
    try {
      const created = await apiSend<{ id?: string }>(
        "/api/expense-categories",
        {
          body: { name },
        },
      );
      if (!isQueued(created)) {
        toast.success("کتگوری جدید ثبت شد");
        await refetchCategories();
        if (created && typeof created === "object" && "id" in created) {
          const id = (created as { id?: string }).id;
          if (id) setForm((f) => ({ ...f, categoryId: id }));
        }
      }
      setQuickOpen(false);
      setQuickName("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ثبت کتگوری ناموفق بود");
    } finally {
      setQuickSaving(false);
    }
  };

  const doAction = async (exp: Expense, action: string, msg: string) => {
    setBusyId(exp.id);
    try {
      const res = await apiSend(`/api/expenses/${exp.id}/${action}`, {
        method: "POST",
        body: {},
      });
      if (isQueued(res)) {
        toast.info("به‌صورت آفلاین ذخیره شد؛ پس از اتصال همگام می‌شود");
      } else {
        toast.success(msg);
        refetch();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "عملیات ناموفق بود");
    } finally {
      setBusyId(null);
    }
  };

  const confirmCancel = async () => {
    if (!cancelTarget) return;
    await doAction(cancelTarget, "cancel", "مصرف لغو شد");
    setCancelTarget(null);
  };

  /** عملیات گروهی تصویب/لغو — بازاستفاده از endpointهای تک‌رکورد؛ نیاز به دسترسی سرور */
  const runBulk = async (action: "approve" | "cancel") => {
    if (selectedIds.length === 0) return;
    // حالت لوکال: مرورگر ممکن است آفلاین باشد ولی سرور محلی در دسترس — بررسی واقعی
    if (typeof navigator !== "undefined" && !navigator.onLine && !(await probeServer(3000))) {
      toast.error("سرور در دسترس نیست — برای عملیات گروهی باید سرور در دسترس باشد");
      return;
    }
    // فقط اسناد «در انتظار تصویب» واجد شرایط‌اند (مطابق منطق دکمه‌های تک‌ردیفی)
    const eligible = expenses
      .filter((e) => selectedIds.includes(e.id) && e.status === "PENDING")
      .map((e) => e.id);
    if (eligible.length === 0) {
      toast.warning("در انتخاب‌ها سند در انتظار تصویب وجود ندارد");
      return;
    }
    setBulkBusy(true);
    try {
      const result = await runBulkOperation(eligible, (id) =>
        apiSend(`/api/expenses/${id}/${action}`, { method: "POST", body: {} }),
      );
      const msg = bulkResultMessage(
        action === "approve" ? "تصویب گروهی" : "لغو گروهی",
        result,
      );
      if (msg.tone === "success") toast.success(msg.message);
      else if (msg.tone === "warning") toast.warning(msg.message);
      else toast.error(msg.message);
      setSelectedIds([]);
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "عملیات گروهی ناموفق بود");
    } finally {
      setBulkBusy(false);
      setBulkCancelOpen(false);
    }
  };

  // ستون‌های جدول — ترتیب RTL: کتگوری (اطلاعات اصلی) اول، عملیات آخر
  const columns: Column<Expense>[] = useMemo(
    () => [
      {
        key: "category.name",
        header: "کتگوری",
        render: (r) => r.category?.name ?? "—",
      },
      {
        key: "amountAfn",
        header: "مبلغ",
        render: (r) => (
          <div className="flex flex-col">
            <span className="font-semibold">{formatMoney(r.amountAfn)}</span>
            {r.currency && r.currency !== "AFN" && (
              <span className="text-xs text-muted-foreground">
                {formatMoney(r.amount, r.currency)} ({currencyLabel(r.currency)}
                )
              </span>
            )}
          </div>
        ),
      },
      {
        key: "description",
        header: "توضیحات",
        render: (r) => r.description || "—",
      },
      {
        key: "date",
        header: "تاریخ",
        render: (r) => (
          <span className="whitespace-nowrap">{formatHijriShort(r.date)}</span>
        ),
      },
      {
        key: "branch.name",
        header: "شعبه",
        render: (r) => r.branch?.name ?? "—",
      },
      {
        key: "status",
        header: "وضعیت",
        render: (r) => <StatusBadge status={r.status} />,
      },
      {
        key: "createdByName",
        header: "ثبت‌کننده",
        render: (r) => r.createdByName ?? "—",
      },
      {
        key: "actions",
        header: "عملیات",
        sortable: false,
        render: (r) => {
          const busy = busyId === r.id;
          const hasAny =
            (r.status === "PENDING" && (canEdit || canApprove)) ||
            (r.status === "APPROVED" && canApprove);
          if (!hasAny) return <span className="text-muted-foreground">—</span>;
          return (
            <div className="flex flex-wrap items-center gap-1">
              {r.status === "PENDING" && canEdit && (
                <Button variant="outline" size="sm" onClick={() => openEdit(r)}>
                  <Pencil className="h-3.5 w-3.5" />
                  ویرایش
                </Button>
              )}
              {r.status === "PENDING" && canApprove && (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-brand/40 text-brand-soft-foreground hover:bg-brand-soft"
                  disabled={busy}
                  onClick={() => void doAction(r, "approve", "مصرف تصویب شد")}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  تصویب
                </Button>
              )}
              {r.status === "APPROVED" && canApprove && (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-brand/40 text-brand-soft-foreground hover:bg-brand-soft"
                  disabled={busy}
                  onClick={() =>
                    void doAction(r, "mark-paid", "پرداخت مصرف ثبت شد")
                  }
                >
                  <Banknote className="h-3.5 w-3.5" />
                  پرداخت‌شده
                </Button>
              )}
              {r.status === "PENDING" && canEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-rose-600 hover:text-rose-700"
                  disabled={busy}
                  onClick={() => setCancelTarget(r)}
                >
                  لغو
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    [busyId, canEdit, canApprove],
  );

  return (
    <PermissionGate permission="expenses.view">
      <div className="space-y-4">
        <PageHeader
          title="مصارف"
          description={`مدیریت مصارف جاری${user.branchName ? ` — شعبه ${user.branchName}` : ""}`}
          actions={
            canCreate ? (
              <Button
                onClick={openCreate}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" />
                ثبت مصرف جدید
              </Button>
            ) : null
          }
        />

        {/* فیلترها */}
        <Card>
          <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1.5">
              <Label>کتگوری</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">همه کتگوری‌ها</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>وضعیت</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {user.isSuperAdmin && (
              <div className="space-y-1.5">
                <Label>شعبه</Label>
                <Select value={branchId} onValueChange={setBranchId}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">همه شعب</SelectItem>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>از تاریخ</Label>
              <Input
                dir="ltr"
                value={fromInput}
                onChange={(e) => setFromInput(e.target.value)}
                placeholder="۱۴۰۴/۰۱/۰۱"
              />
            </div>
            <div className="space-y-1.5">
              <Label>تا تاریخ</Label>
              <Input
                dir="ltr"
                value={toInput}
                onChange={(e) => setToInput(e.target.value)}
                placeholder="۱۴۰۴/۰۱/۰۱"
              />
            </div>
          </CardContent>
        </Card>

        {/* آمار کوچک */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard
            label="مجموع مصارف دوره (تأیید/پرداخت‌شده)"
            value={formatMoney(periodTotal)}
            icon={Receipt}
            tone="emerald"
          />
          <StatCard
            label="در انتظار تصویب"
            value={formatNumber(pendingCount)}
            sub={`${formatNumber(pendingCount)} سند نیازمند بررسی`}
            icon={Clock}
            tone="amber"
          />
          <StatCard
            label="تعداد اسناد دوره"
            value={formatNumber(expenses.length)}
            icon={Layers}
            tone="slate"
          />
        </div>

        {/* جدول */}
        <Card>
          <CardContent className="p-4">
            <DataTable<Expense>
              columns={columns}
              rows={expenses}
              searchKeys={["category.name", "description", "createdByName"]}
              searchPlaceholder="جستجو در مصارف..."
              loading={loading}
              emptyText="مصرفی برای نمایش وجود ندارد — فیلترها را تغییر دهید"
              rowKey={(r) => r.id}
              selectable
              getRowId={(r) => String(r.id)}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              bulkActions={
                <>
                  {canApprove && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 border-brand/40 text-brand-soft-foreground hover:bg-brand-soft"
                      disabled={bulkBusy}
                      onClick={() => setBulkApproveOpen(true)}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      تصویب گروهی
                    </Button>
                  )}
                  {canEdit && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 border-rose-300 text-rose-700 hover:bg-rose-50"
                      disabled={bulkBusy}
                      onClick={() => setBulkCancelOpen(true)}
                    >
                      لغو گروهی
                    </Button>
                  )}
                </>
              }
            />
          </CardContent>
        </Card>

        {/* دیالوگ ثبت/ویرایش مصرف */}
        <FormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          title={form.id ? "ویرایش مصرف" : "ثبت مصرف جدید"}
          description="مبالغ به افغانی محاسبه و ذخیره می‌شوند"
          onSubmit={() => void submitForm()}
          submitting={saving}
          submitLabel={form.id ? "ذخیره تغییرات" : "ثبت مصرف"}
        >
          <div className="space-y-4">
            {/* کتگوری */}
            <div className="space-y-1.5">
              <Label>کتگوری مصرف *</Label>
              <div className="flex flex-col gap-2">
                <Select
                  value={form.categoryId || undefined}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, categoryId: v }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="انتخاب کتگوری..." />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {quickOpen ? (
                  <div className="flex gap-2">
                    <Input
                      value={quickName}
                      onChange={(e) => setQuickName(e.target.value)}
                      placeholder="نام کتگوری جدید"
                      autoFocus
                    />
                    <Button
                      size="sm"
                      className="bg-primary text-primary-foreground hover:bg-primary/90"
                      disabled={quickSaving}
                      onClick={() => void quickAddCategory()}
                    >
                      ذخیره
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setQuickOpen(false)}
                    >
                      انصراف
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    onClick={() => setQuickOpen(true)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    کتگوری جدید
                  </Button>
                )}
              </div>
            </div>

            {/* مبلغ + ارز */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>مبلغ *</Label>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={form.amount}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, amount: e.target.value }))
                  }
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <Label>واحد پول *</Label>
                <Select
                  value={form.currency}
                  onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AFN">افغانی (AFN)</SelectItem>
                    <SelectItem value="USD">دالر امریکایی (USD)</SelectItem>
                    <SelectItem value="PKR">کلدار پاکستانی (PKR)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* نرخ و پیش‌نمایش */}
            {form.currency !== "AFN" && (
              <div className="rounded-md border bg-slate-50 p-3 text-xs dark:bg-slate-900">
                {latestRate ? (
                  <>
                    <p>
                      نرخ اعمال‌شده (فروش):{" "}
                      <span className="font-bold" dir="ltr">
                        {effectiveRate}
                      </span>{" "}
                      — هر {currencyLabel(form.currency)} ={" "}
                      {formatMoney(effectiveRate)} افغانی
                      {latestRate.isOffline && (
                        <span className="mr-1 rounded border border-amber-300 bg-amber-50 px-1 text-amber-800">
                          نرخ قدیمی/ذخیره‌شده
                        </span>
                      )}
                    </p>
                  </>
                ) : (
                  <p className="text-amber-700">در دریافت نرخ ارز...</p>
                )}
              </div>
            )}
            <div className="flex items-center justify-between rounded-md border border-brand/40 bg-brand-soft p-3 text-sm dark:border-brand/40 dark:bg-brand-soft">
              <span className="font-medium">مجموع به افغانی:</span>
              <span className="font-bold text-brand-soft-foreground dark:text-brand-soft-foreground">
                {formatMoney(afnPreview)}
              </span>
            </div>

            {/* تاریخ */}
            <div className="space-y-1.5">
              <Label>تاریخ (هجری شمسی) *</Label>
              <Input
                dir="ltr"
                value={form.date}
                onChange={(e) =>
                  setForm((f) => ({ ...f, date: e.target.value }))
                }
                placeholder="۱۴۰۴/۰۱/۰۱"
              />
              <p className="text-xs text-muted-foreground">
                قالب: سال/ماه/روز — مثال: ۱۴۰۴/۰۱/۰۱
              </p>
            </div>

            {/* توضیحات */}
            <div className="space-y-1.5">
              <Label>توضیحات</Label>
              <Textarea
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="شرح مصرف (اختیاری)"
                rows={3}
              />
            </div>
          </div>
        </FormDialog>

        {/* تأیید لغو */}
        <ConfirmDialog
          open={!!cancelTarget}
          onOpenChange={(o) => !o && setCancelTarget(null)}
          title="لغو مصرف"
          message="آیا از لغو این مصرف مطمئن هستید؟ اسناد لغوشده در محاسبات لحاظ نمی‌شوند."
          confirmLabel="لغو مصرف"
          danger
          onConfirm={() => void confirmCancel()}
          submitting={!!busyId}
        />

        {/* تأیید لغو گروهی */}
        <ConfirmDialog
          open={bulkCancelOpen}
          onOpenChange={(v) => {
            if (!v) setBulkCancelOpen(false);
          }}
          title="لغو گروهی مصارف"
          message={`لغو گروهی ${selectedIds.length.toLocaleString("en-US")} مورد در انتظار تصویب؟ اسناد لغوشده در محاسبات لحاظ نمی‌شوند.`}
          confirmLabel="لغو مصرف"
          danger
          onConfirm={() => void runBulk("cancel")}
          submitting={bulkBusy}
        />

        {/* تأیید تصویب گروهی */}
        <ConfirmDialog
          open={bulkApproveOpen}
          onOpenChange={(v) => {
            if (!v) setBulkApproveOpen(false);
          }}
          title="تصویب گروهی مصارف"
          message={`تصویب گروهی ${selectedIds.length.toLocaleString("en-US")} مصرف انتخاب‌شده؟ اسناد تصویب‌شده در محاسبات مالی و موجودی لحاظ می‌شوند و این عمل قابل بازگشت سریع نیست.`}
          confirmLabel="تصویب"
          onConfirm={() => void runBulk("approve")}
          submitting={bulkBusy}
        />
      </div>
    </PermissionGate>
  );
}
