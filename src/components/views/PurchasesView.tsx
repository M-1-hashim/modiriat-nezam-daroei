"use client";

/**
 * ویوی خریدها — لیست، ثبت/ویرایش، تفصیلات، تصویب/لغو و چاپ فاکتور خرید
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Ban,
  CheckCircle2,
  Eye,
  Pencil,
  Plus,
  Printer,
  Trash2,
} from "lucide-react";

import { PermissionGate, useUser } from "@/components/shared/use-user";
import { PageHeader, StatusBadge } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { ConfirmDialog, FormDialog } from "@/components/shared/form-dialog";
import {
  PrintDialog,
  purchaseToPrintDoc,
  type PrintDoc,
} from "@/components/shared/print-invoice";
import { apiGet, apiSend, useApiData, probeServer, type QueuedResult } from "@/lib/client-api";
import { runBulkOperation, bulkResultMessage } from "@/lib/bulk";
import { currencyLabel, formatHijriDate, formatHijriShort, formatMoney, formatNumber } from "@/lib/format";
import { dateToHijriInput, hijriInputToDate, hijriInputToGregorianISO } from "@/lib/hijri";
import { labelOf, PURCHASE_TYPES, PAYMENT_METHODS } from "@/lib/terminology";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

// ─────────────────────── انواع ───────────────────────

type Ref = { id: string; name: string; phone?: string | null; address?: string | null };

type PurchaseRow = {
  id: string;
  number: string;
  supplierId: string;
  warehouseId: string;
  branchId?: string;
  type: string;
  date: string;
  currency: string;
  exchangeRate: number;
  subtotal: number;
  discountTotal: number;
  extraCost: number;
  total: number;
  totalAfn: number;
  paidAmount: number;
  returnedAfn: number;
  status: string;
  notes?: string | null;
  createdByName?: string | null;
  approvedByName?: string | null;
  supplier?: Ref | null;
  warehouse?: Ref | null;
  branch?: Ref | null;
};

type PurchaseItemRow = {
  id: string;
  productId: string;
  batchNumber: string;
  mfgDate?: string | null;
  expiryDate?: string | null;
  quantity: number;
  freeQuantity: number;
  unitPrice: number;
  discountPct: number;
  discountAmount: number;
  netUnitPrice: number;
  effectiveCost: number;
  promotionNote?: string | null;
  lineTotal: number;
  lineTotalAfn: number;
  product?: { id: string; name: string } | null;
};

type PurchasePaymentRow = {
  id: string;
  number: string;
  amount: number;
  currency: string;
  method: string;
  date: string;
  status: string;
};

type PurchaseReturnRow = {
  id: string;
  number: string;
  date: string;
  totalAfn: number;
  status: string;
  reason?: string | null;
};

type PurchaseDetail = PurchaseRow & {
  items?: PurchaseItemRow[];
  payments?: PurchasePaymentRow[];
  returns?: PurchaseReturnRow[];
};

type ProductOption = { id: string; name: string };

type ItemForm = {
  key: string;
  productId: string;
  batchNumber: string;
  mfgDate: string;
  expiryDate: string;
  quantity: string;
  freeQuantity: string;
  unitPrice: string;
  discountPct: string;
  discountAmount: string;
  promotionId: string;
  promotionNote: string;
};

/** گزینه پروموشن از موتور ارزیابی (سرور) */
type PromoOption = {
  promotionId: string;
  code: string;
  name: string;
  type: string;
  scope: string;
  freeQuantity?: number;
  discountAfn?: number;
  estimatedValueAfn?: number;
  eligible: boolean;
  reason?: string;
};

type EvalResponse = {
  items: { index: number; productId: string; options: PromoOption[]; unavailable: PromoOption[] }[];
  invoice: { options: PromoOption[]; unavailable: PromoOption[] };
  stats: { usablePromotions: number };
};

function promoLabel(o: PromoOption): string {
  const parts: string[] = [`${o.name} (${o.code})`];
  if ((o.freeQuantity ?? 0) > 0) parts.push(`مجانی: ${o.freeQuantity}`);
  if ((o.discountAfn ?? 0) > 0) parts.push(`تخفیف: ${formatMoney(o.discountAfn ?? 0)}`);
  return parts.join(" — ");
}

type PurchaseForm = {
  supplierId: string;
  warehouseId: string;
  type: string;
  date: string;
  currency: string;
  exchangeRate: string;
  extraCost: string;
  extraCostBasis: string;
  notes: string;
  paidAmount: string;
  paymentMethod: string;
  status: string;
  // تخفیف سطح فاکتور — مستقل از تخفیف اقلام و پروموشن
  invoiceDiscountType: string; // NONE | PERCENT | AMOUNT
  invoiceDiscountValue: string;
  discountReason: string;
  // پروموشن سطح فاکتور
  invoicePromotionId: string;
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

function isQueued(r: unknown): r is QueuedResult {
  return typeof r === "object" && r !== null && "queued" in r && (r as { queued?: unknown }).queued === true;
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : "عملیات ناموفق بود";
}

/** مقدار سلکت‌های فیلتر: sentinelهای "all"/"none" را به رشته خالی تبدیل می‌کند */
function nz(v: string): string {
  return v === "all" || v === "none" ? "" : v;
}

const FA_DIGIT_SRC = "۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩";
function normalizeDigits(s: string): string {
  return s.replace(/[۰-۹٠-٩]/g, (d) => String(FA_DIGIT_SRC.indexOf(d) % 10));
}

function hijriToIsoDate(input: string): string | null {
  return hijriInputToGregorianISO(normalizeDigits(input));
}

function isoOrNull(input: string): string | null {
  if (!input.trim()) return null;
  return hijriInputToDate(normalizeDigits(input))?.toISOString() ?? null;
}

function isValidHijri(input: string): boolean {
  if (!input.trim()) return true; // اختیاری
  return hijriInputToDate(normalizeDigits(input)) !== null;
}

function settingsMap(data: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const collect = (arr: unknown[]) => {
    for (const it of arr) {
      if (it && typeof it === "object" && "key" in (it as Record<string, unknown>)) {
        const o = it as Record<string, unknown>;
        out[String(o.key)] = String(o.value ?? "");
      }
    }
  };
  if (Array.isArray(data)) collect(data);
  else if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.items)) collect(obj.items);
    else {
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = String(v);
      }
    }
  }
  return out;
}

function extractRate(data: unknown): { rate: number; offline: boolean } | null {
  if (!data || typeof data !== "object") return null;
  const direct = data as Record<string, unknown>;
  const nested = direct.record ?? direct.rate;
  const cand = (nested && typeof nested === "object" ? nested : direct) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const rate = num(cand.sellRate) || num(cand.buyRate);
  if (rate <= 0) return null;
  return { rate, offline: cand.isOffline === true };
}

function lineNetUnitPrice(it: ItemForm): number {
  const qty = Number(it.quantity) || 0;
  const price = Number(it.unitPrice) || 0;
  const pct = Number(it.discountPct) || 0;
  const amt = Number(it.discountAmount) || 0;
  if (qty <= 0) return 0;
  return price * (1 - pct / 100) - amt / qty;
}

function lineTotalOf(it: ItemForm): number {
  const qty = Number(it.quantity) || 0;
  return lineNetUnitPrice(it) * qty;
}

function emptyItem(key: string): ItemForm {
  return {
    key,
    productId: "",
    batchNumber: "",
    mfgDate: "",
    expiryDate: "",
    quantity: "",
    freeQuantity: "0",
    unitPrice: "",
    discountPct: "0",
    discountAmount: "0",
    promotionId: "",
    promotionNote: "",
  };
}

function HijriDateInput({
  value,
  onChange,
  optional,
}: {
  value: string;
  onChange: (v: string) => void;
  optional?: boolean;
}) {
  const bad = value.trim() !== "" && !isValidHijri(value);
  return (
    <div className="space-y-1">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={optional ? "۱۴۰۴/۰۵/۰۱ (اختیاری)" : "۱۴۰۴/۰۵/۰۱"}
        dir="ltr"
        className="text-center"
      />
      {bad && <p className="text-xs text-rose-600">تاریخ نامعتبر است</p>}
    </div>
  );
}

function MoneyInput({
  value,
  onChange,
  placeholder,
  step = "0.01",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  step?: string;
}) {
  return (
    <Input
      type="number"
      step={step}
      min="0"
      dir="ltr"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

// ─────────────────────── ویو اصلی ───────────────────────

export default function PurchasesView() {
  const { user, hasPermission } = useUser();

  // فیلترها
  const [statusFilter, setStatusFilter] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState("");

  // دیالوگ‌ها
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<PurchaseRow | null>(null);
  const [printDoc, setPrintDoc] = useState<PrintDoc | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // انتخاب گروهی — تصویب گروهی فاکتورهای در انتظار
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkApproveOpen, setBulkApproveOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (nz(statusFilter)) p.set("status", nz(statusFilter));
    if (nz(supplierFilter)) p.set("supplierId", nz(supplierFilter));
    if (nz(branchFilter)) p.set("branchId", nz(branchFilter));
    p.set("limit", "200");
    return p.toString();
  }, [statusFilter, supplierFilter, branchFilter]);

  const { data, loading, refetch } = useApiData<{ items: PurchaseRow[] }>(`/api/purchases?${qs}`, [qs]);
  const rows = useMemo(() => data?.items ?? [], [data]);

  const { data: suppliersData } = useApiData<unknown>("/api/suppliers");
  const suppliers = useMemo(() => asList<Ref>(suppliersData), [suppliersData]);

  const { data: branchesData } = useApiData<unknown>(user.isSuperAdmin ? "/api/branches" : null);
  const branches = useMemo(() => asList<Ref>(branchesData), [branchesData]);

  const { data: settingsData } = useApiData<unknown>("/api/settings");
  const settings = useMemo(() => settingsMap(settingsData), [settingsData]);

  const printCtx = useMemo(
    () => ({
      companyName: settings["company_name"] || "شرکت دارویی",
      footerNote: settings["invoice_footer_note"] || undefined,
    }),
    [settings]
  );

  // تفصیلات
  const {
    data: detail,
    loading: detailLoading,
    refetch: refetchDetail,
  } = useApiData<PurchaseDetail>(detailId ? `/api/purchases/${detailId}` : null);

  // ─── فرم ایجاد/ویرایش ───
  const [form, setForm] = useState<PurchaseForm>(() => ({
    supplierId: "",
    warehouseId: "",
    type: "LOCAL",
    date: dateToHijriInput(new Date()),
    currency: "AFN",
    exchangeRate: "1",
    extraCost: "0",
    extraCostBasis: "VALUE",
    notes: "",
    paidAmount: "0",
    paymentMethod: "CASH",
    status: "PENDING",
    invoiceDiscountType: "NONE",
    invoiceDiscountValue: "0",
    discountReason: "",
    invoicePromotionId: "",
  }));
  const [items, setItems] = useState<ItemForm[]>([emptyItem("it-1")]);
  const [itemSeq, setItemSeq] = useState(2);
  const [rateEdited, setRateEdited] = useState(false);
  const [rateOffline, setRateOffline] = useState(false);

  const { data: warehousesData } = useApiData<unknown>("/api/warehouses");
  const warehouses = useMemo(() => asList<Ref & { branch?: Ref | null }>(warehousesData), [warehousesData]);

  const { data: productsData } = useApiData<unknown>("/api/products?limit=500");
  const products = useMemo(() => asList<ProductOption>(productsData), [productsData]);

  const ratePath =
    dialogOpen && form.currency !== "AFN" ? `/api/exchange-rates/latest?base=${form.currency}` : null;
  const { data: latestRateData } = useApiData<unknown>(ratePath);

  useEffect(() => {
    if (!latestRateData || rateEdited) return;
    const r = extractRate(latestRateData);
    if (r) {
      setForm((f) => ({ ...f, exchangeRate: String(r.rate) }));
      setRateOffline(r.offline);
    }
  }, [latestRateData, rateEdited]);

  const canApprove = hasPermission("purchases.approve");

  // ─── ارزیابی پروموشن‌ها (موتور سرور) ───
  const [promoEval, setPromoEval] = useState<EvalResponse | null>(null);
  const [promoEvalKeys, setPromoEvalKeys] = useState<string[]>([]);

  useEffect(() => {
    if (!dialogOpen) {
      setPromoEval(null);
      setPromoEvalKeys([]);
      return;
    }
    const valid = items.filter((it) => it.productId && Number(it.quantity) > 0);
    if (valid.length === 0) {
      setPromoEval(null);
      setPromoEvalKeys([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const dateObj = hijriInputToDate(normalizeDigits(form.date));
        const res = await apiSend<EvalResponse>("/api/promotions/evaluate", {
          method: "POST",
          body: {
            docType: "PURCHASE",
            date: (dateObj ?? new Date()).toISOString(),
            supplierId: form.supplierId || undefined,
            items: valid.map((it) => ({
              productId: it.productId,
              quantity: Number(it.quantity) || 0,
              unitPrice: Number(it.unitPrice) || 0,
              discountPct: Number(it.discountPct) || 0,
              discountAmount: Number(it.discountAmount) || 0,
            })),
          },
        });
        if (isQueued(res)) {
          setPromoEval(null);
          return;
        }
        setPromoEval(res);
        setPromoEvalKeys(valid.map((it) => it.key));
      } catch {
        setPromoEval(null);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [dialogOpen, items, form.supplierId, form.date]);

  const promoOptionsFor = (
    key: string
  ): { options: PromoOption[]; unavailable: PromoOption[] } => {
    const idx = promoEvalKeys.indexOf(key);
    if (idx < 0 || !promoEval) return { options: [], unavailable: [] };
    const e = promoEval.items.find((x) => x.index === idx);
    return { options: e?.options ?? [], unavailable: e?.unavailable ?? [] };
  };

  const invoiceOptions = promoEval?.invoice.options ?? [];
  const invoiceUnavailable = promoEval?.invoice.unavailable ?? [];

  const subtotal = useMemo(() => items.reduce((s, it) => s + lineTotalOf(it), 0), [items]);
  // تخفیف سطح فاکتور (پیش‌نمایش محلی — محاسبه نهایی سرورمحور است)
  const invoiceDiscountPreview = useMemo(() => {
    if (form.invoiceDiscountType === "PERCENT") {
      const pct = Number(form.invoiceDiscountValue) || 0;
      return Math.min(Math.max(pct, 0), 100) * subtotal * 0.01;
    }
    if (form.invoiceDiscountType === "AMOUNT") {
      return Math.min(Math.max(Number(form.invoiceDiscountValue) || 0, 0), subtotal);
    }
    return 0;
  }, [form.invoiceDiscountType, form.invoiceDiscountValue, subtotal]);
  const extraCostNum = Number(form.extraCost) || 0;
  const total = subtotal - invoiceDiscountPreview + extraCostNum;
  const rateNum = form.currency === "AFN" ? 1 : Number(form.exchangeRate) || 0;
  const totalAfn = total * (rateNum || 1);
  const paidNum = Number(form.paidAmount) || 0;
  const remainingAfn = totalAfn - paidNum;

  const resetForm = () => {
    setForm({
      supplierId: "",
      warehouseId: "",
      type: "LOCAL",
      date: dateToHijriInput(new Date()),
      currency: "AFN",
      exchangeRate: "1",
      extraCost: "0",
      extraCostBasis: "VALUE",
      notes: "",
      paidAmount: "0",
      paymentMethod: "CASH",
      status: "PENDING",
      invoiceDiscountType: "NONE",
      invoiceDiscountValue: "0",
      discountReason: "",
      invoicePromotionId: "",
    });
    setItems([emptyItem("it-1")]);
    setItemSeq(2);
    setRateEdited(false);
    setRateOffline(false);
  };

  const openCreate = () => {
    resetForm();
    setEditingId(null);
    setDialogOpen(true);
  };

  const openEdit = async (row: PurchaseRow) => {
    if (row.status !== "DRAFT") {
      toast.error("فقط فاکتورهای پیش‌نویس قابل ویرایش هستند");
      return;
    }
    try {
      const d = await apiGet<PurchaseDetail>(`/api/purchases/${row.id}`);
      setForm({
        supplierId: d.supplierId,
        warehouseId: d.warehouseId,
        type: d.type,
        date: dateToHijriInput(d.date),
        currency: d.currency,
        exchangeRate: String(d.exchangeRate ?? 1),
        extraCost: String(d.extraCost ?? 0),
        extraCostBasis: "VALUE",
        notes: d.notes ?? "",
        paidAmount: String(d.paidAmount ?? 0),
        paymentMethod: "CASH",
        status: d.status,
        invoiceDiscountType:
          (d as { invoiceDiscountType?: string | null }).invoiceDiscountType ?? "NONE",
        invoiceDiscountValue: String(
          (d as { invoiceDiscountValue?: number }).invoiceDiscountValue ?? 0
        ),
        discountReason: (d as { discountReason?: string | null }).discountReason ?? "",
        invoicePromotionId:
          (d as { promotionId?: string | null }).promotionId ?? "",
      });
      setItems(
        (d.items ?? []).map((it, i) => ({
          key: `it-edit-${i}`,
          productId: it.productId,
          batchNumber: it.batchNumber ?? "",
          mfgDate: it.mfgDate ? dateToHijriInput(it.mfgDate) : "",
          expiryDate: it.expiryDate ? dateToHijriInput(it.expiryDate) : "",
          quantity: String(it.quantity ?? 0),
          freeQuantity: String(it.freeQuantity ?? 0),
          unitPrice: String(it.unitPrice ?? 0),
          discountPct: String(it.discountPct ?? 0),
          discountAmount: String(it.discountAmount ?? 0),
          promotionId:
            (it as unknown as { promotionId?: string | null }).promotionId ?? "",
          promotionNote: it.promotionNote ?? "",
        }))
      );
      setItemSeq((d.items ?? []).length + 1);
      setRateEdited(true); // نرخ ذخیره‌شده سند دست نخورد
      setEditingId(row.id);
      setDialogOpen(true);
    } catch (e) {
      toast.error(errMessage(e));
    }
  };

  const updateItem = (key: string, patch: Partial<ItemForm>) => {
    setItems((arr) => arr.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  };

  const submitForm = async () => {
    if (!form.supplierId) return toast.error("تأمین‌کننده را انتخاب کنید");
    if (!form.warehouseId) return toast.error("گدام را انتخاب کنید");
    const dateObj = hijriInputToDate(normalizeDigits(form.date));
    if (!dateObj) return toast.error("تاریخ نامعتبر است");
    const validItems = items.filter((it) => it.productId && Number(it.quantity) > 0);
    if (validItems.length === 0) return toast.error("حداقل یک قلم با تعداد معتبر لازم است");
    for (const it of validItems) {
      if (it.mfgDate.trim() && !isValidHijri(it.mfgDate)) return toast.error("تاریخ تولید نامعتبر است");
      if (it.expiryDate.trim() && !isValidHijri(it.expiryDate)) return toast.error("تاریخ انقضا نامعتبر است");
    }

    const status = form.status === "APPROVED" && !canApprove ? "PENDING" : form.status;
    const body = {
      supplierId: form.supplierId,
      warehouseId: form.warehouseId,
      type: form.type,
      date: dateObj.toISOString(),
      currency: form.currency,
      exchangeRate: form.currency === "AFN" ? 1 : Number(form.exchangeRate) || 1,
      extraCost: Number(form.extraCost) || 0,
      extraCostBasis: form.extraCostBasis,
      notes: form.notes.trim() || undefined,
      paidAmount: Number(form.paidAmount) || 0,
      paymentMethod: form.paymentMethod,
      status,
      // تخفیف سطح فاکتور (مستقل از تخفیف اقلام)
      invoiceDiscountType:
        form.invoiceDiscountType === "PERCENT" || form.invoiceDiscountType === "AMOUNT"
          ? form.invoiceDiscountType
          : undefined,
      invoiceDiscountValue:
        form.invoiceDiscountType === "PERCENT" || form.invoiceDiscountType === "AMOUNT"
          ? Number(form.invoiceDiscountValue) || 0
          : 0,
      discountReason: form.discountReason.trim() || undefined,
      // پروموشن سطح فاکتور
      promotionId: nz(form.invoicePromotionId) || undefined,
      items: validItems.map((it) => ({
        productId: it.productId,
        batchNumber: it.batchNumber.trim() || "بدون-بچ",
        mfgDate: isoOrNull(it.mfgDate),
        expiryDate: isoOrNull(it.expiryDate),
        quantity: Number(it.quantity),
        freeQuantity: Number(it.freeQuantity) || 0,
        unitPrice: Number(it.unitPrice) || 0,
        discountPct: Number(it.discountPct) || 0,
        discountAmount: Number(it.discountAmount) || 0,
        promotionId: it.promotionId || undefined,
        promotionNote: it.promotionNote.trim() || undefined,
      })),
    };

    setSubmitting(true);
    try {
      const res = editingId
        ? await apiSend(`/api/purchases/${editingId}`, { method: "PUT", body })
        : await apiSend("/api/purchases", { method: "POST", body });
      if (isQueued(res)) {
        toast.info("به‌صورت آفلاین ذخیره شد؛ پس از اتصال همگام می‌شود");
        setDialogOpen(false);
        return;
      }
      toast.success(editingId ? "فاکتور خرید ویرایش شد" : "فاکتور خرید ثبت شد");
      setDialogOpen(false);
      refetch();
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  const doApprove = async (id: string) => {
    setBusyId(id);
    try {
      const res = await apiSend(`/api/purchases/${id}/approve`, { method: "POST" });
      if (isQueued(res)) {
        toast.info("درخواست تصویب به‌صورت آفلاین ذخیره شد؛ پس از اتصال همگام می‌شود");
      } else {
        toast.success("فاکتور خرید تصویب شد و موجودی به‌روز گردید");
        refetch();
        if (detailId === id) refetchDetail();
      }
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const doCancel = async (id: string) => {
    setBusyId(id);
    try {
      const res = await apiSend(`/api/purchases/${id}/cancel`, { method: "POST" });
      if (isQueued(res)) {
        toast.info("درخواست لغو به‌صورت آفلاین ذخیره شد؛ پس از اتصال همگام می‌شود");
      } else {
        toast.success("فاکتور خرید لغو شد");
        refetch();
        if (detailId === id) refetchDetail();
      }
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  // ─── تصویب گروهی — فقط فاکتورهای PENDING؛ اسناد مالی هرگز از صف آفلاین عبور نمی‌کنند ───
  const bulkApproveTargets = useMemo(
    () => selectedIds.filter((id) => rows.some((r) => r.id === id && r.status === "PENDING")),
    [selectedIds, rows]
  );

  const doBulkApprove = async () => {
    setBulkBusy(true);
    try {
      const result = await runBulkOperation(bulkApproveTargets, async (id) => {
        // حالت لوکال: مرورگر ممکن است آفلاین باشد ولی سرور محلی در دسترس — بررسی واقعی
        if (typeof navigator !== "undefined" && !navigator.onLine && !(await probeServer(3000))) {
          throw new Error("سرور در دسترس نیست — برای تصویب گروهی اسناد مالی باید سرور در دسترس باشد");
        }
        await apiSend(`/api/purchases/${id}/approve`, { method: "POST" });
      });
      const msg = bulkResultMessage("تصویب گروهی فاکتورهای خرید", result);
      if (msg.tone === "success") toast.success(msg.message);
      else if (msg.tone === "warning") toast.warning(msg.message);
      else toast.error(msg.message);
      setSelectedIds([]);
      refetch();
      if (detailId) refetchDetail();
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setBulkBusy(false);
      setBulkApproveOpen(false);
    }
  };

  const printRow = async (row: PurchaseRow) => {
    try {
      const d = await apiGet<PurchaseDetail>(`/api/purchases/${row.id}`);
      setPrintDoc(purchaseToPrintDoc(d as unknown as Record<string, unknown>, printCtx));
    } catch (e) {
      toast.error(errMessage(e));
    }
  };

  const columns: Column<PurchaseRow>[] = [
    { key: "number", header: "شماره", render: (r) => <span className="font-mono text-xs font-semibold">{r.number}</span> },
    { key: "supplier.name", header: "تأمین‌کننده", render: (r) => r.supplier?.name ?? "—" },
    { key: "branch.name", header: "شعبه", render: (r) => r.branch?.name ?? "—" },
    { key: "type", header: "نوع", render: (r) => labelOf(PURCHASE_TYPES, r.type) },
    { key: "date", header: "تاریخ", render: (r) => formatHijriShort(r.date) },
    {
      key: "totalAfn",
      header: "مجموع",
      render: (r) => <span className="font-semibold">{formatMoney(r.totalAfn)}</span>,
    },
    { key: "paidAmount", header: "پرداخت‌شده", render: (r) => formatMoney(r.paidAmount) },
    {
      key: "remaining",
      header: "باقی‌مانده",
      sortable: false,
      render: (r) => {
        const rem = r.totalAfn - r.paidAmount - r.returnedAfn;
        return (
          <span className={rem > 0.009 ? "font-semibold text-rose-600" : "text-brand-soft-foreground"}>
            {formatMoney(rem)}
          </span>
        );
      },
    },
    { key: "status", header: "وضعیت", render: (r) => <StatusBadge status={r.status} /> },
    {
      key: "actions",
      header: "عملیات",
      sortable: false,
      render: (r) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" title="دیدن" onClick={() => setDetailId(r.id)}>
            <Eye className="h-4 w-4" />
          </Button>
          {r.status === "PENDING" && canApprove && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-primary"
              title="تصویب"
              disabled={busyId === r.id}
              onClick={() => doApprove(r.id)}
            >
              <CheckCircle2 className="h-4 w-4" />
            </Button>
          )}
          {(r.status === "DRAFT" || r.status === "PENDING") && (
            <>
              {hasPermission("purchases.edit") && r.status === "DRAFT" && (
                <Button variant="ghost" size="icon" className="h-8 w-8" title="ویرایش" onClick={() => openEdit(r)}>
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-rose-600"
                title="لغو"
                disabled={busyId === r.id}
                onClick={() => setCancelTarget(r)}
              >
                <Ban className="h-4 w-4" />
              </Button>
            </>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" title="چاپ" onClick={() => printRow(r)}>
            <Printer className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <PermissionGate permission="purchases.view">
      <div className="space-y-4">
        <PageHeader
          title="خریدها"
          description={`مدیریت فاکتورهای خرید — شعبه: ${user.branchName ?? "همه شعب"}`}
          actions={
            <PermissionGate permission="purchases.create">
              <Button onClick={openCreate} className="bg-primary hover:bg-primary/90">
                <Plus className="ml-1 h-4 w-4" /> ثبت خرید جدید
              </Button>
            </PermissionGate>
          }
        />

        <Card>
          <CardContent className="p-4">
            <DataTable
              columns={columns}
              rows={rows}
              searchKeys={["number", "supplier.name", "branch.name"]}
              searchPlaceholder="جستجوی شماره یا تأمین‌کننده..."
              loading={loading}
              emptyText="هنوز فاکتوری ثبت نشده است"
              rowKey={(r) => r.id}
              selectable={canApprove}
              getRowId={(r) => r.id}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              bulkActions={
                canApprove && bulkApproveTargets.length > 0 ? (
                  <Button
                    size="sm"
                    className="h-7 bg-primary text-primary-foreground hover:bg-primary/90"
                    disabled={bulkBusy}
                    onClick={() => setBulkApproveOpen(true)}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    تصویب گروهی
                  </Button>
                ) : null
              }
              toolbar={
                <>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="h-9 w-[170px]">
                      <SelectValue placeholder="همه وضعیت‌ها" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">همه وضعیت‌ها</SelectItem>
                      <SelectItem value="DRAFT">پیش‌نویس</SelectItem>
                      <SelectItem value="PENDING">در انتظار تصویب</SelectItem>
                      <SelectItem value="APPROVED">تأیید شده</SelectItem>
                      <SelectItem value="COMPLETED">تکمیل شده</SelectItem>
                      <SelectItem value="CANCELLED">لغو شده</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={supplierFilter} onValueChange={setSupplierFilter}>
                    <SelectTrigger className="h-9 w-[190px]">
                      <SelectValue placeholder="همه تأمین‌کنندگان" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">همه تأمین‌کنندگان</SelectItem>
                      {suppliers.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {user.isSuperAdmin && (
                    <Select value={branchFilter} onValueChange={setBranchFilter}>
                      <SelectTrigger className="h-9 w-[170px]">
                        <SelectValue placeholder="همه شعب" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">همه شعب</SelectItem>
                        {branches.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </>
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
          title={editingId ? "ویرایش فاکتور خرید" : "ثبت فاکتور خرید جدید"}
          description="معلومات سند و اقلام را وارد کنید؛ محاسبات به‌صورت خودکار انجام می‌شود."
          wide
          onSubmit={submitForm}
          submitting={submitting}
          submitLabel={editingId ? "ذخیره تغییرات" : "ثبت فاکتور"}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>تأمین‌کننده *</Label>
                <Select value={form.supplierId} onValueChange={(v) => setForm((f) => ({ ...f, supplierId: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="انتخاب تأمین‌کننده" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>گدام (مقصد موجودی) *</Label>
                <Select value={form.warehouseId} onValueChange={(v) => setForm((f) => ({ ...f, warehouseId: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="انتخاب گدام" />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses
                      .filter((w) => {
                        if (!user.isSuperAdmin) return true;
                        const bf = nz(branchFilter);
                        return !bf || !w.branch || w.branch.id === bf;
                      })
                      .map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.name}
                          {w.branch?.name ? ` — ${w.branch.name}` : ""}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>نوع خرید</Label>
                <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PURCHASE_TYPES).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>تاریخ سند *</Label>
                <HijriDateInput value={form.date} onChange={(v) => setForm((f) => ({ ...f, date: v }))} />
              </div>
              <div className="space-y-1.5">
                <Label>اسعار</Label>
                <Select
                  value={form.currency}
                  onValueChange={(v) => {
                    setRateEdited(false);
                    setForm((f) => ({ ...f, currency: v, exchangeRate: v === "AFN" ? "1" : f.exchangeRate }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AFN">افغانی (AFN)</SelectItem>
                    <SelectItem value="USD">دالر امریکایی (USD)</SelectItem>
                    <SelectItem value="PKR">کلدار پاکستانی (PKR)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>نرخ تبدیل {form.currency !== "AFN" ? `(1 ${form.currency} = ? افغانی)` : ""}</Label>
                  {form.currency !== "AFN" && (
                    <Badge variant="outline" className={rateOffline ? "border-amber-200 bg-amber-100 text-amber-800" : "border-brand/40 bg-brand-soft text-brand-soft-foreground"}>
                      {rateOffline ? "نرخ ذخیره‌شده" : "نرخ روز"}
                    </Badge>
                  )}
                </div>
                <MoneyInput
                  value={form.exchangeRate}
                  onChange={(v) => {
                    setRateEdited(true);
                    setForm((f) => ({ ...f, exchangeRate: v }));
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label>مصارف اضافی (ترانسپورت و غیره)</Label>
                <MoneyInput value={form.extraCost} onChange={(v) => setForm((f) => ({ ...f, extraCost: v }))} />
              </div>
              <div className="space-y-1.5">
                <Label>تقسیم مصارف اضافی بر اساس</Label>
                <Select value={form.extraCostBasis} onValueChange={(v) => setForm((f) => ({ ...f, extraCostBasis: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="VALUE">ارزش قلم‌ها</SelectItem>
                    <SelectItem value="QTY">تعداد</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* اقلام */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-bold">اقلام فاکتور</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setItems((arr) => [...arr, emptyItem(`it-${itemSeq}`)]);
                    setItemSeq((n) => n + 1);
                  }}
                >
                  <Plus className="ml-1 h-4 w-4" /> افزودن قلم
                </Button>
              </div>
              {items.length === 0 && (
                <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
                  هنوز قلمی افزوده نشده است
                </p>
              )}
              {items.map((it, idx) => {
                const badQty = it.quantity.trim() !== "" && (Number(it.quantity) || 0) <= 0;
                const badMfg = it.mfgDate.trim() !== "" && !isValidHijri(it.mfgDate);
                const badExp = it.expiryDate.trim() !== "" && !isValidHijri(it.expiryDate);
                return (
                  <div key={it.key} className="rounded-lg border bg-muted/30 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted-foreground">قلم {idx + 1}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-rose-600"
                        title="حذف قلم"
                        onClick={() => setItems((arr) => arr.filter((x) => x.key !== it.key))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      <div className="space-y-1 sm:col-span-2">
                        <Label className="text-xs">محصول *</Label>
                        <Select value={it.productId} onValueChange={(v) => updateItem(it.key, { productId: v })}>
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="انتخاب محصول" />
                          </SelectTrigger>
                          <SelectContent>
                            {products.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">شماره بچ</Label>
                        <Input
                          className="h-9"
                          value={it.batchNumber}
                          onChange={(e) => updateItem(it.key, { batchNumber: e.target.value })}
                          placeholder="B-101"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">تاریخ تولید</Label>
                        <HijriDateInput value={it.mfgDate} onChange={(v) => updateItem(it.key, { mfgDate: v })} optional />
                        {badMfg && <p className="text-xs text-rose-600">تاریخ نامعتبر است</p>}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">تاریخ انقضا</Label>
                        <HijriDateInput value={it.expiryDate} onChange={(v) => updateItem(it.key, { expiryDate: v })} optional />
                        {badExp && <p className="text-xs text-rose-600">تاریخ نامعتبر است</p>}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">تعداد *</Label>
                        <Input
                          type="number"
                          step="1"
                          min="0"
                          dir="ltr"
                          className="h-9"
                          value={it.quantity}
                          onChange={(e) => updateItem(it.key, { quantity: e.target.value })}
                        />
                        {badQty && <p className="text-xs text-rose-600">تعداد باید بزرگ‌تر از صفر باشد</p>}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">مجانی</Label>
                        <Input
                          type="number"
                          step="1"
                          min="0"
                          dir="ltr"
                          className="h-9"
                          value={it.freeQuantity}
                          onChange={(e) => updateItem(it.key, { freeQuantity: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">قیمت واحد ({currencyLabel(form.currency)})</Label>
                        <MoneyInput value={it.unitPrice} onChange={(v) => updateItem(it.key, { unitPrice: v })} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">تخفیف ٪</Label>
                        <MoneyInput value={it.discountPct} onChange={(v) => updateItem(it.key, { discountPct: v })} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">تخفیف مبلغی</Label>
                        <MoneyInput value={it.discountAmount} onChange={(v) => updateItem(it.key, { discountAmount: v })} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">پروموشن قلم (اختیاری)</Label>
                        <Select
                          value={it.promotionId || "NONE"}
                          onValueChange={(v) =>
                            updateItem(it.key, { promotionId: v === "NONE" ? "" : v })
                          }
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="NONE">بدون پروموشن</SelectItem>
                            {promoOptionsFor(it.key).options.map((o) => (
                              <SelectItem key={o.promotionId} value={o.promotionId}>
                                {promoLabel(o)}
                              </SelectItem>
                            ))}
                            {promoOptionsFor(it.key).unavailable.map((o) => (
                              <SelectItem
                                key={`un-${o.promotionId}`}
                                value={`un-${o.promotionId}`}
                                disabled
                              >
                                {promoLabel(o)}
                                {o.reason ? ` — ${o.reason}` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <Label className="text-xs">یادداشت پروموشن</Label>
                        <Input
                          className="h-9"
                          value={it.promotionNote}
                          onChange={(e) => updateItem(it.key, { promotionNote: e.target.value })}
                          placeholder="مثلا: ۱+۱"
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-md bg-brand-soft px-3 py-2 sm:col-span-2 dark:bg-brand-soft/60">
                        <span className="text-xs text-muted-foreground">مجموع قلم</span>
                        <span className="text-sm font-bold text-brand-soft-foreground dark:text-brand-soft-foreground">
                          {formatMoney(lineTotalOf(it), form.currency, { decimals: true })}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* پرداخت و وضعیت */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>مبلغ پرداخت‌شده اولیه ({currencyLabel(form.currency)})</Label>
                <MoneyInput value={form.paidAmount} onChange={(v) => setForm((f) => ({ ...f, paidAmount: v }))} />
              </div>
              <div className="space-y-1.5">
                <Label>روش پرداخت</Label>
                <Select value={form.paymentMethod} onValueChange={(v) => setForm((f) => ({ ...f, paymentMethod: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PAYMENT_METHODS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>وضعیت سند</Label>
              <RadioGroup
                value={form.status}
                onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}
                className="flex flex-wrap gap-4"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="DRAFT" id="st-draft" />
                  <Label htmlFor="st-draft" className="font-normal">پیش‌نویس</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="PENDING" id="st-pending" />
                  <Label htmlFor="st-pending" className="font-normal">در انتظار تصویب</Label>
                </div>
                {canApprove && (
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="APPROVED" id="st-approved" />
                    <Label htmlFor="st-approved" className="font-normal">تأیید فوری</Label>
                  </div>
                )}
              </RadioGroup>
            </div>

            <div className="space-y-1.5">
              <Label>یادداشت</Label>
              <Textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="یادداشت اختیاری..."
              />
            </div>

            {/* تخفیف سطح فاکتور و پروموشن فاکتور — مستقل از تخفیف اقلام */}
            <div className="grid grid-cols-1 gap-3 rounded-lg border p-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>تخفیف سطح فاکتور</Label>
                <Select
                  value={form.invoiceDiscountType}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      invoiceDiscountType: v,
                      invoiceDiscountValue: v === "NONE" ? "0" : f.invoiceDiscountValue,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">بدون تخفیف</SelectItem>
                    <SelectItem value="PERCENT">درصدی (٪)</SelectItem>
                    <SelectItem value="AMOUNT">مبلغی</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.invoiceDiscountType !== "NONE" && (
                <div className="space-y-1.5">
                  <Label>
                    {form.invoiceDiscountType === "PERCENT"
                      ? "درصد تخفیف (٪)"
                      : `مبلغ تخفیف (${currencyLabel(form.currency)})`}
                  </Label>
                  <MoneyInput
                    value={form.invoiceDiscountValue}
                    onChange={(v) => setForm((f) => ({ ...f, invoiceDiscountValue: v }))}
                  />
                </div>
              )}
              {form.invoiceDiscountType !== "NONE" && (
                <div className="space-y-1.5">
                  <Label>دلیل تخفیف (اختیاری)</Label>
                  <Input
                    value={form.discountReason}
                    onChange={(e) => setForm((f) => ({ ...f, discountReason: e.target.value }))}
                    placeholder="مثلا: تخفیف قراردادی تأمین‌کننده"
                  />
                </div>
              )}
              <div className="space-y-1.5 sm:col-span-3">
                <Label>پروموشن سطح فاکتور (اختیاری)</Label>
                <Select
                  value={form.invoicePromotionId || "NONE"}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, invoicePromotionId: v === "NONE" ? "" : v }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">بدون پروموشن فاکتور</SelectItem>
                    {invoiceOptions.map((o) => (
                      <SelectItem key={o.promotionId} value={o.promotionId}>
                        {promoLabel(o)}
                      </SelectItem>
                    ))}
                    {invoiceUnavailable.map((o) => (
                      <SelectItem key={`un-${o.promotionId}`} value={`un-${o.promotionId}`} disabled>
                        {promoLabel(o)}
                        {o.reason ? ` — ${o.reason}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  کالای رایگان فقط در سطح قلم قابل اعمال است؛ پروموشن فاکتور فقط تخفیف درصدی یا مبلغی است.
                </p>
              </div>
            </div>

            {/* مجموع‌ها */}
            <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/40 p-3 text-sm sm:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">مجموع جزء</p>
                <p className="font-bold">{formatMoney(subtotal, form.currency, { decimals: true })}</p>
              </div>
              {invoiceDiscountPreview > 0.009 && (
                <div>
                  <p className="text-xs text-muted-foreground">تخفیف فاکتور</p>
                  <p className="font-bold text-rose-600 dark:text-rose-400">
                    {formatMoney(-invoiceDiscountPreview, form.currency, { decimals: true })}
                  </p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground">مصارف اضافی</p>
                <p className="font-bold">{formatMoney(extraCostNum, form.currency, { decimals: true })}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">مجموع کل ({currencyLabel(form.currency)})</p>
                <p className="font-bold">{formatMoney(total, form.currency, { decimals: true })}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">معادل افغانی</p>
                <p className="font-bold text-brand-soft-foreground dark:text-brand-soft-foreground">{formatMoney(totalAfn)}</p>
              </div>
            </div>
            {remainingAfn > 0.009 && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                باقی‌مانده این سند: {formatMoney(remainingAfn)} — در توازن تأمین‌کننده ثبت می‌شود.
              </p>
            )}
          </div>
        </FormDialog>

        {/* دیالوگ تفصیلات */}
        <FormDialog
          open={!!detailId}
          onOpenChange={(v) => {
            if (!v) setDetailId(null);
          }}
          title={`فاکتور خرید ${detail?.number ?? ""}`}
          description={detail ? `تاریخ: ${formatHijriDate(detail.date)}` : undefined}
          wide
        >
          {detailLoading || !detail ? (
            <p className="py-8 text-center text-sm text-muted-foreground">در حال بارگذاری تفصیلات...</p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 rounded-lg border p-3 text-sm sm:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground">تأمین‌کننده</p>
                  <p className="font-semibold">{detail.supplier?.name ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">گدام</p>
                  <p className="font-semibold">{detail.warehouse?.name ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">شعبه</p>
                  <p className="font-semibold">{detail.branch?.name ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">نوع</p>
                  <p className="font-semibold">{labelOf(PURCHASE_TYPES, detail.type)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">اسعار / نرخ</p>
                  <p className="font-semibold">
                    {currencyLabel(detail.currency)}
                    {detail.currency !== "AFN" ? ` — 1 ${detail.currency} = ${detail.exchangeRate}` : ""}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">وضعیت</p>
                  <StatusBadge status={detail.status} />
                </div>
                {detail.notes && (
                  <div className="col-span-2 sm:col-span-3">
                    <p className="text-xs text-muted-foreground">یادداشت</p>
                    <p>{detail.notes}</p>
                  </div>
                )}
              </div>

              <div>
                <p className="mb-2 text-sm font-bold">اقلام</p>
                <div className="max-h-72 overflow-y-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>محصول</TableHead>
                        <TableHead>بچ</TableHead>
                        <TableHead>انقضا</TableHead>
                        <TableHead>تعداد</TableHead>
                        <TableHead>مجانی</TableHead>
                        <TableHead>قیمت</TableHead>
                        <TableHead>خالص واحد</TableHead>
                        <TableHead>بهای مؤثر</TableHead>
                        <TableHead>مجموع</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(detail.items ?? []).map((it) => (
                        <TableRow key={it.id}>
                          <TableCell className="font-medium">{it.product?.name ?? "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{it.batchNumber || "—"}</TableCell>
                          <TableCell className="text-xs">{it.expiryDate ? formatHijriShort(it.expiryDate) : "—"}</TableCell>
                          <TableCell>{formatNumber(it.quantity)}</TableCell>
                          <TableCell>{formatNumber(it.freeQuantity)}</TableCell>
                          <TableCell>{formatMoney(it.unitPrice, detail.currency, { decimals: true, withCurrency: false })}</TableCell>
                          <TableCell>{formatMoney(it.netUnitPrice, detail.currency, { decimals: true, withCurrency: false })}</TableCell>
                          <TableCell>{formatMoney(it.effectiveCost, undefined, { decimals: true, withCurrency: false })}</TableCell>
                          <TableCell className="font-semibold">{formatMoney(it.lineTotal, detail.currency, { decimals: true, withCurrency: false })}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/40 p-3 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-xs text-muted-foreground">مجموع</p>
                  <p className="font-bold">{formatMoney(detail.totalAfn)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">پرداخت‌شده</p>
                  <p className="font-bold">{formatMoney(detail.paidAmount)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">برگشتی</p>
                  <p className="font-bold">{formatMoney(detail.returnedAfn)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">باقی‌مانده</p>
                  <p className={`font-bold ${(detail.totalAfn - detail.paidAmount - detail.returnedAfn) > 0.009 ? "text-rose-600" : "text-brand-soft-foreground"}`}>
                    {formatMoney(detail.totalAfn - detail.paidAmount - detail.returnedAfn)}
                  </p>
                </div>
              </div>

              {(detail.payments ?? []).length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-bold">پرداخت‌ها</p>
                  <div className="max-h-40 overflow-y-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>شماره رسید</TableHead>
                          <TableHead>تاریخ</TableHead>
                          <TableHead>مبلغ</TableHead>
                          <TableHead>روش</TableHead>
                          <TableHead>وضعیت</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(detail.payments ?? []).map((p) => (
                          <TableRow key={p.id}>
                            <TableCell className="font-mono text-xs">{p.number}</TableCell>
                            <TableCell className="text-xs">{formatHijriShort(p.date)}</TableCell>
                            <TableCell>{formatMoney(p.amount)}</TableCell>
                            <TableCell>{labelOf(PAYMENT_METHODS, p.method)}</TableCell>
                            <TableCell><StatusBadge status={p.status} /></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {(detail.returns ?? []).length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-bold">برگشتی‌ها</p>
                  <div className="max-h-40 overflow-y-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>شماره</TableHead>
                          <TableHead>تاریخ</TableHead>
                          <TableHead>مبلغ</TableHead>
                          <TableHead>دلیل</TableHead>
                          <TableHead>وضعیت</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(detail.returns ?? []).map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="font-mono text-xs">{r.number}</TableCell>
                            <TableCell className="text-xs">{formatHijriShort(r.date)}</TableCell>
                            <TableCell>{formatMoney(r.totalAfn)}</TableCell>
                            <TableCell className="max-w-40 truncate text-xs">{r.reason ?? "—"}</TableCell>
                            <TableCell><StatusBadge status={r.status} /></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
                <Button
                  variant="outline"
                  onClick={() =>
                    setPrintDoc(purchaseToPrintDoc(detail as unknown as Record<string, unknown>, printCtx))
                  }
                >
                  <Printer className="ml-1 h-4 w-4" /> چاپ فاکتور
                </Button>
                {detail.status === "PENDING" && canApprove && (
                  <Button
                    className="bg-primary hover:bg-primary/90"
                    disabled={busyId === detail.id}
                    onClick={() => doApprove(detail.id)}
                  >
                    <CheckCircle2 className="ml-1 h-4 w-4" /> تصویب
                  </Button>
                )}
                {(detail.status === "DRAFT" || detail.status === "PENDING") && (
                  <Button
                    variant="destructive"
                    disabled={busyId === detail.id}
                    onClick={() => setCancelTarget({ ...detail, supplier: detail.supplier, branch: detail.branch })}
                  >
                    <Ban className="ml-1 h-4 w-4" /> لغو فاکتور
                  </Button>
                )}
              </div>
            </div>
          )}
        </FormDialog>

        <ConfirmDialog
          open={!!cancelTarget}
          onOpenChange={(v) => {
            if (!v) setCancelTarget(null);
          }}
          title="لغو فاکتور خرید"
          message={`آیا از لغو فاکتور «${cancelTarget?.number ?? ""}» مطمئن هستید؟ این عملیات قابل بازگشت نیست.`}
          confirmLabel="لغو فاکتور"
          danger
          submitting={!!cancelTarget && busyId === cancelTarget.id}
          onConfirm={() => {
            if (cancelTarget) doCancel(cancelTarget.id);
            setCancelTarget(null);
          }}
        />

        <ConfirmDialog
          open={bulkApproveOpen}
          onOpenChange={(v) => {
            if (!v) setBulkApproveOpen(false);
          }}
          title={`تصویب گروهی ${bulkApproveTargets.length.toLocaleString("en-US")} فاکتور خرید`}
          message={`آیا از تصویب گروهی ${bulkApproveTargets.length.toLocaleString("en-US")} فاکتور در انتظار مطمئن هستید؟ موجودی گدام، بچ‌ها و حساب تأمین‌کنندگان به‌روزرسانی می‌شود.`}
          confirmLabel="تصویب گروهی"
          submitting={bulkBusy}
          onConfirm={() => void doBulkApprove()}
        />

        <PrintDialog doc={printDoc} onOpenChange={(v) => { if (!v) setPrintDoc(null); }} />
      </div>
    </PermissionGate>
  );
}
