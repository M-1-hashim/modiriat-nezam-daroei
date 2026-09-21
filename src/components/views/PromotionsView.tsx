"use client";

/**
 * ویوی طرح‌های تشویقی (پروموشن) — مدیریت کامل طرح‌ها
 *
 * پروموشن مستقل از تخفیف است:
 * - تخفیف: کاهش مستقیم قیمت در فاکتور (در ویوهای خرید/فروش)
 * - پروموشن: طرح تشویقی با شرایط خرید و پاداش (کالای رایگان / درصد / مبلغ / ترکیبی)
 */

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, CircleOff, Eye, Pencil, Plus, Trash2 } from "lucide-react";

import { PermissionGate, useUser } from "@/components/shared/use-user";
import { PageHeader, StatCard, BADGE_TONES } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { ConfirmDialog, FormDialog } from "@/components/shared/form-dialog";
import { apiGet, apiSend, useApiData } from "@/lib/client-api";
import { runBulkOperation, bulkResultMessage } from "@/lib/bulk";
import { formatMoney, formatNumber } from "@/lib/format";
import { dateToHijriInput, hijriInputToDate, hijriInputToDayEnd, hijriInputToDayStart } from "@/lib/hijri";
import {
  CUSTOMER_TYPES,
  PROMO_SCOPES,
  PROMO_STATUSES,
  PROMO_TYPES,
  labelOf,
} from "@/lib/terminology";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

// ─────────────────────── انواع ───────────────────────

type ProductRef = { id: string; name: string; unit?: string | null };

type PromoRow = {
  id: string;
  code: string;
  name: string;
  type: string;
  scope: string;
  allProducts: boolean;
  products: ProductRef[];
  supplier: { id: string; name: string } | null;
  customerType: string | null;
  appliesToSale: boolean;
  appliesToPurchase: boolean;
  minQuantity: number;
  minAmount: number;
  freeQuantity: number;
  discountPct: number;
  discountAmount: number;
  startDate: string;
  endDate: string;
  terms?: string | null;
  description?: string | null;
  isActive: boolean;
  usageCount: number;
  status: string;
};

type UsageRow = {
  id: string;
  docType: string;
  docNumber: string;
  scope: string;
  productName?: string | null;
  quantity: number;
  freeQuantity: number;
  freeValueAfn: number;
  discountAfn: number;
  usedAt: string;
};

type PromoDetail = PromoRow & { usages?: UsageRow[] };

type PromoForm = {
  code: string;
  name: string;
  type: string;
  scope: string;
  allProducts: boolean;
  productIds: string[];
  supplierId: string;
  customerType: string;
  appliesToSale: boolean;
  appliesToPurchase: boolean;
  minQuantity: string;
  minAmount: string;
  freeQuantity: string;
  discountPct: string;
  discountAmount: string;
  startDate: string;
  endDate: string;
  terms: string;
  description: string;
  isActive: boolean;
};

// ─────────────────────── کمک‌کاری‌ها ───────────────────────

function asList<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    const items = (data as { items?: unknown }).items;
    if (Array.isArray(items)) return items as T[];
  }
  return [];
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : "عملیات ناموفق بود";
}

function nz(v: string): string {
  return v === "all" || v === "none" ? "" : v;
}

const FA_DIGIT_SRC = "۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩";
function normalizeDigits(s: string): string {
  return s.replace(/[۰-۹٠-٩]/g, (d) => String(FA_DIGIT_SRC.indexOf(d) % 10));
}

function statusOf(p: { isActive: boolean; startDate: string; endDate: string }): string {
  if (!p.isActive) return "INACTIVE";
  const now = Date.now();
  const s = new Date(p.startDate).getTime();
  const e = new Date(p.endDate).getTime();
  if (now < s) return "SCHEDULED";
  if (now > e) return "EXPIRED";
  return "ACTIVE";
}

function hijriBad(v: string): boolean {
  return v.trim() !== "" && hijriInputToDate(normalizeDigits(v)) === null;
}

/** خلاصه پاداش طرح به دری */
function benefitSummary(p: {
  type: string;
  freeQuantity: number;
  discountPct: number;
  discountAmount: number;
}): string {
  const parts: string[] = [];
  if ((p.type === "FREE_QTY" || p.type === "COMBINED") && p.freeQuantity > 0) {
    parts.push(`${formatNumber(p.freeQuantity)} عدد مجانی`);
  }
  if ((p.type === "PERCENT" || p.type === "COMBINED") && p.discountPct > 0) {
    parts.push(`${formatNumber(p.discountPct)}٪ تخفیف`);
  }
  if (p.type === "AMOUNT" && p.discountAmount > 0) {
    parts.push(`${formatMoney(p.discountAmount)} تخفیف`);
  }
  if (p.type === "COMBINED" && p.discountPct <= 0 && p.discountAmount > 0) {
    parts.push(`${formatMoney(p.discountAmount)} تخفیف`);
  }
  return parts.length ? parts.join(" + ") : "—";
}

/** خلاصه شرایط خرید */
function conditionSummary(p: { minQuantity: number; minAmount: number }): string {
  const parts: string[] = [];
  if (p.minQuantity > 0) parts.push(`حداقل ${formatNumber(p.minQuantity)} عدد`);
  if (p.minAmount > 0) parts.push(`حداقل ${formatMoney(p.minAmount)} افغانی`);
  return parts.length ? parts.join(" و ") : "—";
}

function emptyForm(): PromoForm {
  return {
    code: "",
    name: "",
    type: "FREE_QTY",
    scope: "LINE",
    allProducts: false,
    productIds: [],
    supplierId: "",
    customerType: "",
    appliesToSale: true,
    appliesToPurchase: false,
    minQuantity: "",
    minAmount: "",
    freeQuantity: "",
    discountPct: "",
    discountAmount: "",
    startDate: dateToHijriInput(new Date()),
    endDate: "",
    terms: "",
    description: "",
    isActive: true,
  };
}

// ─────────────────────── ویو اصلی ───────────────────────

export default function PromotionsView() {
  const { hasPermission } = useUser();
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  // انتخاب گروهی
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkToggleOpen, setBulkToggleOpen] = useState(false);
  const [bulkToggleActive, setBulkToggleActive] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PromoRow | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PromoDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [productSearch, setProductSearch] = useState("");

  const { data, loading, refetch } = useApiData<{ items: PromoRow[] }>("/api/promotions");
  const { data: suppliersData } = useApiData<unknown>("/api/suppliers");
  const { data: productsData } = useApiData<unknown>("/api/products?limit=500");

  const suppliers = useMemo(() => asList<{ id: string; name: string }>(suppliersData), [suppliersData]);
  const products = useMemo(() => asList<ProductRef>(productsData), [productsData]);

  const rows = useMemo(() => asList<PromoRow>(data), [data]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      if (statusFilter !== "all") {
        const st = statusOf(r);
        if (statusFilter === "ACTIVE_USABLE" ? st !== "ACTIVE" : st !== statusFilter) return false;
      }
      return true;
    });
  }, [rows, typeFilter, statusFilter]);

  const stats = useMemo(() => {
    let active = 0;
    let scheduled = 0;
    let expired = 0;
    let usages = 0;
    for (const r of rows) {
      const st = statusOf(r);
      if (st === "ACTIVE") active += 1;
      else if (st === "SCHEDULED") scheduled += 1;
      else if (st === "EXPIRED") expired += 1;
      usages += r.usageCount ?? 0;
    }
    return { total: rows.length, active, scheduled, expired, usages };
  }, [rows]);

  const [form, setForm] = useState<PromoForm>(emptyForm());

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return products.slice(0, 60);
    return products.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 60);
  }, [products, productSearch]);

  const openCreate = () => {
    setForm(emptyForm());
    setEditingId(null);
    setProductSearch("");
    setDialogOpen(true);
  };

  const openEdit = (row: PromoRow) => {
    setForm({
      code: row.code,
      name: row.name,
      type: row.type,
      scope: row.scope,
      allProducts: row.allProducts,
      productIds: (row.products ?? []).map((p) => p.id),
      supplierId: row.supplier?.id ?? "",
      customerType: row.customerType ?? "",
      appliesToSale: row.appliesToSale,
      appliesToPurchase: row.appliesToPurchase,
      minQuantity: row.minQuantity ? String(row.minQuantity) : "",
      minAmount: row.minAmount ? String(row.minAmount) : "",
      freeQuantity: row.freeQuantity ? String(row.freeQuantity) : "",
      discountPct: row.discountPct ? String(row.discountPct) : "",
      discountAmount: row.discountAmount ? String(row.discountAmount) : "",
      startDate: dateToHijriInput(row.startDate),
      endDate: dateToHijriInput(row.endDate),
      terms: row.terms ?? "",
      description: row.description ?? "",
      isActive: row.isActive,
    });
    setEditingId(row.id);
    setProductSearch("");
    setDialogOpen(true);
  };

  const openDetail = async (row: PromoRow) => {
    setDetailId(row.id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const d = await apiGet<PromoDetail>(`/api/promotions/${row.id}`);
      setDetail(d);
    } catch (e) {
      toast.error(errMessage(e));
      setDetailId(null);
    } finally {
      setDetailLoading(false);
    }
  };

  /** فیلدهای پاداش بر اساس نوع طرح */
  const benefitFieldsVisible = useMemo(() => {
    const t = form.type;
    return {
      free: t === "FREE_QTY" || t === "COMBINED",
      pct: t === "PERCENT" || t === "COMBINED",
      amount: t === "AMOUNT" || t === "COMBINED",
    };
  }, [form.type]);

  const submitForm = async () => {
    const code = form.code.trim().toUpperCase();
    if (!code) return toast.error("کد طرح را وارد کنید (مثلا: PROMO-101)");
    if (!/^[\w-]{2,30}$/.test(code)) {
      return toast.error("کد طرح باید ۲ تا ۳۰ نویسه لاتین/عدد یا خط تیره باشد");
    }
    if (!form.name.trim()) return toast.error("نام طرح را وارد کنید");

    const startDate = hijriInputToDayStart(normalizeDigits(form.startDate));
    if (!startDate) return toast.error("تاریخ شروع معتبر وارد کنید (مثال: ۱۴۰۴/۰۵/۰۱)");
    const endDate = hijriInputToDayEnd(normalizeDigits(form.endDate));
    if (!endDate) return toast.error("تاریخ ختم معتبر وارد کنید");
    if (startDate > endDate) return toast.error("تاریخ شروع باید قبل از تاریخ ختم باشد");

    if (!form.appliesToSale && !form.appliesToPurchase) {
      return toast.error("طرح باید برای فروش یا خرید (حداقل یکی) فعال باشد");
    }
    if (!form.allProducts && form.productIds.length === 0) {
      return toast.error("حداقل یک محصول مشمول انتخاب کنید یا «همه محصولات» را فعال کنید");
    }

    const minQuantity = Number(form.minQuantity) || 0;
    const minAmount = Number(form.minAmount) || 0;
    const freeQuantity = Number(form.freeQuantity) || 0;
    const discountPct = Number(form.discountPct) || 0;
    const discountAmount = Number(form.discountAmount) || 0;

    if (minQuantity <= 0 && minAmount <= 0) {
      return toast.error("حداقل یک شرط خرید (تعداد یا مبلغ) تعیین کنید");
    }
    if (benefitFieldsVisible.free && freeQuantity <= 0) {
      return toast.error("مقدار کالای رایگان باید بزرگ‌تر از صفر باشد");
    }
    if (benefitFieldsVisible.pct && discountPct <= 0 && discountAmount <= 0) {
      return toast.error("برای طرح درصدی، درصد تخفیف را وارد کنید");
    }
    if (form.type === "AMOUNT" && discountAmount <= 0) {
      return toast.error("برای طرح مبلغی، مبلغ تخفیف را وارد کنید");
    }
    if (form.type === "COMBINED" && discountPct <= 0 && discountAmount <= 0) {
      return toast.error("برای طرح ترکیبی، درصد یا مبلغ تخفیف را وارد کنید");
    }
    if (discountPct < 0 || discountPct > 100) {
      return toast.error("درصد تخفیف باید بین ۰ تا ۱۰۰ باشد");
    }

    if (form.scope === "INVOICE" && (form.type === "FREE_QTY" || (form.type === "COMBINED" && freeQuantity > 0))) {
      return toast.error("کالای رایگان فقط در دامنه «هر قلم» قابل اعمال است");
    }

    const body = {
      code,
      name: form.name.trim(),
      type: form.type,
      scope: form.scope,
      allProducts: form.allProducts,
      productIds: form.allProducts ? [] : form.productIds,
      supplierId: nz(form.supplierId) || undefined,
      customerType: nz(form.customerType) || undefined,
      appliesToSale: form.appliesToSale,
      appliesToPurchase: form.appliesToPurchase,
      minQuantity,
      minAmount,
      freeQuantity,
      discountPct,
      discountAmount,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      terms: form.terms.trim() || undefined,
      description: form.description.trim() || undefined,
      isActive: form.isActive,
    };

    setSubmitting(true);
    try {
      if (editingId) {
        await apiSend(`/api/promotions/${editingId}`, { method: "PUT", body });
        toast.success("طرح تشویقی ویرایش شد");
      } else {
        await apiSend("/api/promotions", { method: "POST", body });
        toast.success("طرح تشویقی ثبت شد");
      }
      setDialogOpen(false);
      refetch();
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  const doDelete = async (row: PromoRow) => {
    try {
      const res = await apiSend<{ deactivated?: boolean; message?: string }>(
        `/api/promotions/${row.id}`,
        { method: "DELETE" }
      );
      const deleted =
        res && !("queued" in res) ? res : undefined;
      if (deleted?.deactivated)
        toast.info(deleted.message ?? "طرح دارای سابقه استفاده است؛ غیرفعال شد");
      else toast.success("طرح تشویقی حذف شد");
      refetch();
    } catch (e) {
      toast.error(errMessage(e));
    }
  };

  // ─── عملیات گروهی ───
  const selectedRows = useMemo(
    () => rows.filter((r) => selectedIds.includes(r.id)),
    [rows, selectedIds]
  );

  /** بدنه کامل PUT بر اساس ردیف — سرویس PUT طرح، کل فیلدها را الزامی می‌داند */
  const toggleBody = (row: PromoRow, isActive: boolean) => ({
    code: row.code,
    name: row.name,
    type: row.type,
    scope: row.scope,
    allProducts: row.allProducts,
    productIds: row.allProducts ? [] : (row.products ?? []).map((p) => p.id),
    supplierId: row.supplier?.id || undefined,
    customerType: row.customerType || undefined,
    appliesToSale: row.appliesToSale,
    appliesToPurchase: row.appliesToPurchase,
    minQuantity: row.minQuantity,
    minAmount: row.minAmount,
    freeQuantity: row.freeQuantity,
    discountPct: row.discountPct,
    discountAmount: row.discountAmount,
    startDate: row.startDate,
    endDate: row.endDate,
    terms: row.terms || undefined,
    description: row.description || undefined,
    isActive,
  });

  const doBulkToggle = async () => {
    setBulkBusy(true);
    try {
      const result = await runBulkOperation(selectedIds, (id) => {
        const row = rows.find((r) => r.id === id);
        if (!row) throw new Error("طرح یافت نشد");
        return apiSend(`/api/promotions/${id}`, {
          method: "PUT",
          body: toggleBody(row, bulkToggleActive),
        });
      });
      const msg = bulkResultMessage(
        bulkToggleActive ? "فعال‌سازی گروهی طرح‌ها" : "غیرفعال‌سازی گروهی طرح‌ها",
        result
      );
      if (msg.tone === "success") toast.success(msg.message);
      else if (msg.tone === "warning") toast.warning(msg.message);
      else toast.error(msg.message);
      setSelectedIds([]);
      refetch();
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setBulkBusy(false);
      setBulkToggleOpen(false);
    }
  };

  const doBulkDelete = async () => {
    setBulkBusy(true);
    try {
      const result = await runBulkOperation(selectedIds, (id) =>
        apiSend(`/api/promotions/${id}`, { method: "DELETE" })
      );
      const msg = bulkResultMessage("حذف گروهی طرح‌ها", result);
      if (msg.tone === "success") toast.success(msg.message);
      else if (msg.tone === "warning") toast.warning(msg.message);
      else toast.error(msg.message);
      setSelectedIds([]);
      refetch();
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setBulkBusy(false);
      setBulkDeleteOpen(false);
    }
  };

  const canBulkToggle = hasPermission("promotions.edit") && selectedRows.length > 0;
  const canBulkDelete = hasPermission("promotions.delete") && selectedRows.length > 0;

  const columns: Column<PromoRow>[] = [
    {
      key: "code",
      header: "کد",
      render: (r) => <span className="font-mono text-xs font-semibold">{r.code}</span>,
    },
    {
      key: "name",
      header: "نام طرح",
      render: (r) => (
        <div>
          <p className="font-semibold">{r.name}</p>
          {r.description && (
            <p className="max-w-[220px] truncate text-xs text-muted-foreground">{r.description}</p>
          )}
        </div>
      ),
    },
    { key: "type", header: "نوع", render: (r) => labelOf(PROMO_TYPES, r.type) },
    { key: "scope", header: "دامنه", render: (r) => labelOf(PROMO_SCOPES, r.scope) },
    {
      key: "products",
      header: "مشمول",
      render: (r) =>
        r.allProducts ? (
          <Badge variant="outline" className={BADGE_TONES.emerald}>همه محصولات</Badge>
        ) : (
          <span className="text-xs">{formatNumber(r.products?.length ?? 0)} محصول</span>
        ),
    },
    {
      key: "condition",
      header: "شرط خرید",
      render: (r) => <span className="text-xs">{conditionSummary(r)}</span>,
    },
    {
      key: "benefit",
      header: "پاداش",
      render: (r) => <span className="text-xs font-medium text-brand-soft-foreground dark:text-brand-soft-foreground">{benefitSummary(r)}</span>,
    },
    {
      key: "applies",
      header: "برای",
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.appliesToSale && <Badge variant="outline" className={BADGE_TONES.emerald}>فروش</Badge>}
          {r.appliesToPurchase && <Badge variant="outline" className={BADGE_TONES.amber}>خرید</Badge>}
        </div>
      ),
    },
    {
      key: "range",
      header: "بازه",
      render: (r) => (
        <span className="whitespace-nowrap text-xs">
          {dateToHijriInput(r.startDate)} — {dateToHijriInput(r.endDate)}
        </span>
      ),
    },
    {
      key: "usageCount",
      header: "استفاده",
      render: (r) => <span className="font-semibold">{formatNumber(r.usageCount)}</span>,
    },
    {
      key: "status",
      header: "وضعیت",
      render: (r) => {
        const st = statusOf(r);
        const meta = PROMO_STATUSES[st] ?? PROMO_STATUSES.INACTIVE;
        return <Badge variant="outline" className={BADGE_TONES[meta.tone] ?? BADGE_TONES.slate}>{meta.label}</Badge>;
      },
    },
    {
      key: "actions",
      header: "عملیات",
      sortable: false,
      render: (r) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" title="تفصیلات" onClick={() => openDetail(r)}>
            <Eye className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" title="ویرایش" onClick={() => openEdit(r)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-rose-600"
            title="حذف"
            onClick={() => setDeleteTarget(r)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <PermissionGate permission="promotions.view">
      <div className="space-y-4">
        <PageHeader
          title="طرح‌های تشویقی (پروموشن)"
          description="مدیریت طرح‌های تشویقی فروش و خرید — کالای رایگان، درصدی، مبلغی و ترکیبی؛ مستقل از تخفیف‌های عادی"
          actions={
            <PermissionGate permission="promotions.create">
              <Button onClick={openCreate} className="bg-primary hover:bg-primary/90">
                <Plus className="ml-1 h-4 w-4" /> طرح جدید
              </Button>
            </PermissionGate>
          }
        />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard label="مجموع طرح‌ها" value={formatNumber(stats.total)} tone="slate" />
          <StatCard label="فعال" value={formatNumber(stats.active)} tone="emerald" />
          <StatCard label="در انتظار شروع" value={formatNumber(stats.scheduled)} tone="amber" />
          <StatCard label="منقضی‌شده" value={formatNumber(stats.expired)} tone="rose" />
          <StatCard label="مجموع استفاده" value={formatNumber(stats.usages)} tone="emerald" />
        </div>

        <Card>
          <CardContent className="p-4">
            <DataTable
              columns={columns}
              rows={filtered}
              searchKeys={["code", "name", "description"]}
              searchPlaceholder="جستجوی کد یا نام طرح..."
              loading={loading}
              emptyText="طرح تشویقی ثبت نشده است"
              rowKey={(r) => r.id}
              selectable
              getRowId={(r) => r.id}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              bulkActions={
                <>
                  {canBulkToggle && (
                    <>
                      <Button
                        size="sm"
                        className="h-7 bg-primary text-primary-foreground hover:bg-primary/90"
                        disabled={bulkBusy}
                        onClick={() => {
                          setBulkToggleActive(true);
                          setBulkToggleOpen(true);
                        }}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        فعال‌سازی گروهی
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 border-amber-300 text-amber-800 hover:bg-amber-100 dark:border-amber-900 dark:text-amber-300 dark:hover:bg-amber-950"
                        disabled={bulkBusy}
                        onClick={() => {
                          setBulkToggleActive(false);
                          setBulkToggleOpen(true);
                        }}
                      >
                        <CircleOff className="h-3.5 w-3.5" />
                        غیرفعال‌سازی گروهی
                      </Button>
                    </>
                  )}
                  {canBulkDelete && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950"
                      disabled={bulkBusy}
                      onClick={() => setBulkDeleteOpen(true)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      حذف گروهی
                    </Button>
                  )}
                </>
              }
              toolbar={
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={typeFilter} onValueChange={setTypeFilter}>
                    <SelectTrigger className="h-9 w-[170px]">
                      <SelectValue placeholder="همه انواع" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">همه انواع</SelectItem>
                      {Object.entries(PROMO_TYPES).map(([k, v]) => (
                        <SelectItem key={k} value={k}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="h-9 w-[150px]">
                      <SelectValue placeholder="همه وضعیت‌ها" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">همه وضعیت‌ها</SelectItem>
                      <SelectItem value="ACTIVE">فعال</SelectItem>
                      <SelectItem value="SCHEDULED">در انتظار شروع</SelectItem>
                      <SelectItem value="EXPIRED">منقضی‌شده</SelectItem>
                      <SelectItem value="INACTIVE">غیرفعال</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              }
            />
          </CardContent>
        </Card>

        {/* دیالوگ ایجاد/ویرایش */}
        <FormDialog
          open={dialogOpen}
          onOpenChange={(v) => {
            setDialogOpen(v);
            if (!v) setEditingId(null);
          }}
          title={editingId ? "ویرایش طرح تشویقی" : "ثبت طرح تشویقی جدید"}
          description="پروموشن مستقل از تخفیف عادی است — پاداش‌ها هنگام ثبت فاکتور به‌صورت خودکار محاسبه می‌شوند"
          onSubmit={submitForm}
          submitting={submitting}
          wide
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>کد طرح *</Label>
              <Input
                dir="ltr"
                className="text-center"
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                placeholder="PROMO-101"
              />
            </div>
            <div className="space-y-1.5">
              <Label>نام طرح *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="مثلا: ۱۰ جعبه بخر ۱ جعبه مجانی بگیر"
              />
            </div>

            <div className="space-y-1.5">
              <Label>نوع طرح *</Label>
              <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PROMO_TYPES).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>دامنه طرح *</Label>
              <Select value={form.scope} onValueChange={(v) => setForm((f) => ({ ...f, scope: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PROMO_SCOPES).map(([k, v]) => (
                    <SelectItem key={k} value={k} disabled={k === "INVOICE" && form.type === "FREE_QTY"}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.scope === "INVOICE" && (
                <p className="text-xs text-amber-600">
                  در دامنه «کل فاکتور» فقط تخفیف (درصد/مبلغ) اعمال می‌شود؛ کالای رایگان فقط در سطح قلم است.
                </p>
              )}
            </div>

            {/* شرایط حداقل خرید */}
            <div className="space-y-1.5">
              <Label>حداقل تعداد خرید *</Label>
              <Input
                dir="ltr"
                type="number"
                min="0"
                step="1"
                value={form.minQuantity}
                onChange={(e) => setForm((f) => ({ ...f, minQuantity: e.target.value }))}
                placeholder="مثلا ۱۰ (جعبه)"
              />
            </div>
            <div className="space-y-1.5">
              <Label>حداقل مبلغ خرید (افغانی) *</Label>
              <Input
                dir="ltr"
                type="number"
                min="0"
                step="1"
                value={form.minAmount}
                onChange={(e) => setForm((f) => ({ ...f, minAmount: e.target.value }))}
                placeholder="مثلا ۵۰۰۰۰"
              />
            </div>

            {/* پاداش‌ها */}
            {benefitFieldsVisible.free && (
              <div className="space-y-1.5">
                <Label>تعداد کالای رایگان *</Label>
                <Input
                  dir="ltr"
                  type="number"
                  min="0"
                  step="1"
                  value={form.freeQuantity}
                  onChange={(e) => setForm((f) => ({ ...f, freeQuantity: e.target.value }))}
                  placeholder="مثلا ۱"
                />
              </div>
            )}
            {benefitFieldsVisible.pct && (
              <div className="space-y-1.5">
                <Label>درصد تخفیف طرح</Label>
                <Input
                  dir="ltr"
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={form.discountPct}
                  onChange={(e) => setForm((f) => ({ ...f, discountPct: e.target.value }))}
                  placeholder="مثلا ۵"
                />
              </div>
            )}
            {benefitFieldsVisible.amount && (
              <div className="space-y-1.5">
                <Label>مبلغ تخفیف طرح (افغانی)</Label>
                <Input
                  dir="ltr"
                  type="number"
                  min="0"
                  step="1"
                  value={form.discountAmount}
                  onChange={(e) => setForm((f) => ({ ...f, discountAmount: e.target.value }))}
                  placeholder="مثلا ۵۰۰۰"
                />
                <p className="text-xs text-muted-foreground">
                  مبالغ طرح همیشه به افغانی محاسبه و در فاکتورهای اسعاری تبدیل می‌شوند.
                </p>
              </div>
            )}

            {/* محصولات مشمول */}
            <div className="space-y-2 sm:col-span-2">
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <Label htmlFor="promo-all-products" className="font-normal">
                    همه محصولات مشمول طرح باشند
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    اگر فعال باشد، طرح روی تمام محصولات قابل اعمال است
                  </p>
                </div>
                <Switch
                  id="promo-all-products"
                  checked={form.allProducts}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, allProducts: v }))}
                />
              </div>
              {!form.allProducts && (
                <div className="space-y-2 rounded-md border p-3">
                  <Input
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="جستجوی محصول..."
                    className="h-9"
                  />
                  <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border bg-muted/30 p-2">
                    {filteredProducts.length === 0 && (
                      <p className="py-4 text-center text-xs text-muted-foreground">محصولی یافت نشد</p>
                    )}
                    {filteredProducts.map((p) => {
                      const checked = form.productIds.includes(p.id);
                      return (
                        <label
                          key={p.id}
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) =>
                              setForm((f) => ({
                                ...f,
                                productIds: v
                                  ? [...f.productIds, p.id]
                                  : f.productIds.filter((x) => x !== p.id),
                              }))
                            }
                          />
                          <span>{p.name}</span>
                        </label>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {form.productIds.length} محصول انتخاب شده
                  </p>
                </div>
              )}
            </div>

            {/* تأمین‌کننده / نوع مشتری */}
            <div className="space-y-1.5">
              <Label>تأمین‌کننده مربوطه (اختیاری)</Label>
              <Select
                value={form.supplierId || "none"}
                onValueChange={(v) => setForm((f) => ({ ...f, supplierId: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">همه تأمین‌کنندگان</SelectItem>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                برای طرح‌های تشویقی شرکت‌های دارویی (مثلا طرح کمپانی روی خرید از آن تأمین‌کننده)
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>نوع مشتری مشمول (فروش — اختیاری)</Label>
              <Select
                value={form.customerType || "none"}
                onValueChange={(v) => setForm((f) => ({ ...f, customerType: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">همه مشتریان</SelectItem>
                  {Object.entries(CUSTOMER_TYPES).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* کاربرد برای فروش/خرید */}
            <div className="flex items-center justify-between rounded-md border p-3">
              <Label htmlFor="promo-sale" className="font-normal">قابل استفاده در فاکتورهای فروش</Label>
              <Switch
                id="promo-sale"
                checked={form.appliesToSale}
                onCheckedChange={(v) => setForm((f) => ({ ...f, appliesToSale: v }))}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <Label htmlFor="promo-purchase" className="font-normal">قابل استفاده در فاکتورهای خرید</Label>
              <Switch
                id="promo-purchase"
                checked={form.appliesToPurchase}
                onCheckedChange={(v) => setForm((f) => ({ ...f, appliesToPurchase: v }))}
              />
            </div>

            {/* بازه تاریخ */}
            <div className="space-y-1.5">
              <Label>تاریخ شروع *</Label>
              <Input
                value={form.startDate}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                placeholder="۱۴۰۴/۰۵/۰۱"
                dir="ltr"
                className="text-center"
              />
              {hijriBad(form.startDate) && <p className="text-xs text-rose-600">تاریخ نامعتبر است</p>}
            </div>
            <div className="space-y-1.5">
              <Label>تاریخ ختم *</Label>
              <Input
                value={form.endDate}
                onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                placeholder="۱۴۰۴/۰۶/۳۰"
                dir="ltr"
                className="text-center"
              />
              {hijriBad(form.endDate) && <p className="text-xs text-rose-600">تاریخ نامعتبر است</p>}
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label>شرایط استفاده / شرایط و ضوابط</Label>
              <Textarea
                rows={2}
                value={form.terms}
                onChange={(e) => setForm((f) => ({ ...f, terms: e.target.value }))}
                placeholder="مثلا: طرح برای بچ‌های با تاریخ انقضای بیشتر از ۶ ماه اعتبار دارد"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>توضیحات / یادداشت</Label>
              <Textarea
                rows={2}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>

            <div className="flex items-center justify-between rounded-md border p-3 sm:col-span-2">
              <Label htmlFor="promo-active" className="font-normal">طرح فعال باشد</Label>
              <Switch
                id="promo-active"
                checked={form.isActive}
                onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
              />
            </div>
          </div>
        </FormDialog>

        {/* دیالوگ تفصیلات */}
        <FormDialog
          open={!!detailId}
          onOpenChange={(v) => {
            if (!v) {
              setDetailId(null);
              setDetail(null);
            }
          }}
          title={`طرح تشویقی ${detail?.name ?? ""}`}
          description={detail ? `کد: ${detail.code}` : undefined}
          wide
        >
          {detailLoading || !detail ? (
            <p className="py-8 text-center text-sm text-muted-foreground">در حال بارگذاری تفصیلات...</p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/40 p-3 text-sm sm:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground">نوع</p>
                  <p className="font-semibold">{labelOf(PROMO_TYPES, detail.type)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">دامنه</p>
                  <p className="font-semibold">{labelOf(PROMO_SCOPES, detail.scope)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">وضعیت</p>
                  {(() => {
                    const st = statusOf(detail);
                    const meta = PROMO_STATUSES[st] ?? PROMO_STATUSES.INACTIVE;
                    return (
                      <Badge variant="outline" className={BADGE_TONES[meta.tone] ?? BADGE_TONES.slate}>
                        {meta.label}
                      </Badge>
                    );
                  })()}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">شرط خرید</p>
                  <p className="font-semibold">{conditionSummary(detail)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">پاداش</p>
                  <p className="font-semibold text-brand-soft-foreground dark:text-brand-soft-foreground">{benefitSummary(detail)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">بازه اجرا</p>
                  <p className="font-semibold">
                    {dateToHijriInput(detail.startDate)} — {dateToHijriInput(detail.endDate)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">تأمین‌کننده</p>
                  <p className="font-semibold">{detail.supplier?.name ?? "همه"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">نوع مشتری</p>
                  <p className="font-semibold">
                    {detail.customerType ? labelOf(CUSTOMER_TYPES, detail.customerType) : "همه مشتریان"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">استفاده‌شده</p>
                  <p className="font-semibold">{formatNumber(detail.usageCount)} بار</p>
                </div>
              </div>

              {detail.terms && (
                <div className="rounded-md border p-3 text-sm">
                  <p className="text-xs font-semibold text-muted-foreground">شرایط استفاده</p>
                  <p className="mt-1 whitespace-pre-wrap">{detail.terms}</p>
                </div>
              )}

              <div>
                <p className="mb-2 text-sm font-semibold">محصولات مشمول</p>
                {detail.allProducts ? (
                  <Badge variant="outline" className={BADGE_TONES.emerald}>همه محصولات</Badge>
                ) : (
                  <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto rounded-md border p-2">
                    {(detail.products ?? []).length === 0 && (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                    {(detail.products ?? []).map((p) => (
                      <Badge key={p.id} variant="outline" className={BADGE_TONES.slate}>
                        {p.name}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="mb-2 text-sm font-semibold">سابقه استفاده (۲۵ مورد اخیر)</p>
                <div className="max-h-56 overflow-y-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted">
                      <tr className="text-right">
                        <th className="p-2 font-medium">سند</th>
                        <th className="p-2 font-medium">محصول</th>
                        <th className="p-2 font-medium">تعداد</th>
                        <th className="p-2 font-medium">مجانی</th>
                        <th className="p-2 font-medium">ارزش مجانی</th>
                        <th className="p-2 font-medium">تخفیف طرح</th>
                        <th className="p-2 font-medium">تاریخ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detail.usages ?? []).length === 0 && (
                        <tr>
                          <td colSpan={7} className="p-4 text-center text-xs text-muted-foreground">
                            این طرح تاکنون استفاده نشده است
                          </td>
                        </tr>
                      )}
                      {(detail.usages ?? []).map((u) => (
                        <tr key={u.id} className="border-t">
                          <td className="p-2 font-mono text-xs">{u.docNumber}</td>
                          <td className="p-2">{u.productName ?? "کل فاکتور"}</td>
                          <td className="p-2">{formatNumber(u.quantity)}</td>
                          <td className="p-2">{formatNumber(u.freeQuantity)}</td>
                          <td className="p-2">{formatMoney(u.freeValueAfn)}</td>
                          <td className="p-2">{formatMoney(u.discountAfn)}</td>
                          <td className="p-2 text-xs">{dateToHijriInput(u.usedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </FormDialog>

        <ConfirmDialog
          open={!!deleteTarget}
          onOpenChange={(v) => {
            if (!v) setDeleteTarget(null);
          }}
          title="حذف طرح تشویقی"
          message={`آیا از حذف «${deleteTarget?.name ?? ""}» مطمئن هستید؟ اگر طرح سابقه استفاده داشته باشد، فقط غیرفعال می‌شود تا اسناد قبلی سالم بمانند.`}
          confirmLabel="حذف"
          danger
          onConfirm={() => {
            if (deleteTarget) doDelete(deleteTarget);
            setDeleteTarget(null);
          }}
        />

        <ConfirmDialog
          open={bulkDeleteOpen}
          onOpenChange={(v) => {
            if (!v) setBulkDeleteOpen(false);
          }}
          title={`حذف گروهی ${selectedIds.length.toLocaleString("en-US")} طرح تشویقی`}
          message={`آیا از حذف گروهی ${selectedIds.length.toLocaleString("en-US")} طرح انتخاب‌شده مطمئن هستید؟ طرح‌های دارای سابقه استفاده حذف نمی‌شوند و فقط غیرفعال می‌گردند.`}
          confirmLabel="حذف گروهی"
          danger
          submitting={bulkBusy}
          onConfirm={() => void doBulkDelete()}
        />

        <ConfirmDialog
          open={bulkToggleOpen}
          onOpenChange={(v) => {
            if (!v) setBulkToggleOpen(false);
          }}
          title={bulkToggleActive ? "فعال‌سازی گروهی طرح‌ها" : "غیرفعال‌سازی گروهی طرح‌ها"}
          message={`${bulkToggleActive ? "فعال‌سازی" : "غیرفعال‌سازی"} گروهی ${selectedIds.length.toLocaleString("en-US")} طرح انتخاب‌شده انجام شود؟ طرح‌های غیرفعال در فاکتورهای جدید پیشنهاد نمی‌شوند.`}
          confirmLabel={bulkToggleActive ? "فعال‌سازی گروهی" : "غیرفعال‌سازی گروهی"}
          submitting={bulkBusy}
          onConfirm={() => void doBulkToggle()}
        />
      </div>
    </PermissionGate>
  );
}
