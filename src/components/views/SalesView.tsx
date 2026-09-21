"use client";

/**
 * ویوی فروش‌ها — لیست، ثبت/ویرایش با انتخاب بچ از گدام، تفصیلات، تصویب/لغو، چاپ فاکتور و ثبت برگشتی
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
  RotateCcw,
  Trash2,
} from "lucide-react";

import { PermissionGate, useUser } from "@/components/shared/use-user";
import { PageHeader, StatusBadge } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { ConfirmDialog, FormDialog } from "@/components/shared/form-dialog";
import {
  PrintDialog,
  saleToPrintDoc,
  type PrintDoc,
} from "@/components/shared/print-invoice";
import { SalesReturnDialog } from "@/components/views/ReturnsView";
import { apiGet, apiSend, useApiData, probeServer, type QueuedResult } from "@/lib/client-api";
import { runBulkOperation, bulkResultMessage } from "@/lib/bulk";
import { currencyLabel, formatHijriDate, formatHijriShort, formatMoney, formatNumber } from "@/lib/format";
import { dateToHijriInput, hijriInputToDate } from "@/lib/hijri";
import { labelOf, SALE_TYPES, PAYMENT_METHODS } from "@/lib/terminology";
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

type CustomerOption = {
  id: string;
  name: string;
  balance: number;
  creditLimit: number;
  salespersonId?: string | null;
  territoryId?: string | null;
};

type SaleRow = {
  id: string;
  number: string;
  customerId?: string;
  warehouseId?: string;
  salespersonId?: string | null;
  territoryId?: string | null;
  branchId?: string;
  type: string;
  invoiceTemplate?: string;
  date: string;
  currency: string;
  exchangeRate: number;
  subtotal: number;
  discountTotal: number;
  invoiceDiscountType?: string | null;
  invoiceDiscountValue?: number;
  invoiceDiscountAmount?: number;
  discountReason?: string | null;
  promotionCode?: string | null;
  promotionDiscountAmount?: number;
  total: number;
  totalAfn: number;
  paidAmount: number;
  returnedAfn: number;
  status: string;
  notes?: string | null;
  createdByName?: string | null;
  customer?: Ref | null;
  salesperson?: Ref | null;
  territory?: { id: string; name: string } | null;
  warehouse?: Ref | null;
  branch?: Ref | null;
};

type SaleItemRow = {
  id: string;
  productId: string;
  batchId?: string | null;
  quantity: number;
  freeQuantity: number;
  promoFreeQuantity?: number;
  unitPrice: number;
  discountPct: number;
  discountAmount: number;
  discountReason?: string | null;
  promoDiscountAmount?: number;
  netUnitPrice: number;
  lineTotal: number;
  lineTotalAfn: number;
  promotionNote?: string | null;
  product?: { id: string; name: string } | null;
  batch?: { id: string; batchNumber: string; expiryDate?: string | null } | null;
};

type SalePaymentRow = {
  id: string;
  number: string;
  amount: number;
  method: string;
  date: string;
  status: string;
};

type SaleReturnRow = {
  id: string;
  number: string;
  date: string;
  totalAfn: number;
  status: string;
};

type SaleDetail = SaleRow & {
  items?: SaleItemRow[];
  payments?: SalePaymentRow[];
  returns?: SaleReturnRow[];
};

type ProductOption = { id: string; name: string; salePrice?: number };

type StockRow = {
  id: string;
  productId: string;
  batchId?: string | null;
  quantity: number;
  product?: { id: string; name: string; salePrice?: number } | null;
  batch?: { id: string; batchNumber: string; expiryDate?: string | null; status?: string | null } | null;
};

type ItemForm = {
  key: string;
  productId: string;
  batchId: string;
  quantity: string;
  freeQuantity: string;
  unitPrice: string;
  discountPct: string;
  discountAmount: string;
  discountReason: string;
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

type SaleForm = {
  customerId: string;
  warehouseId: string;
  salespersonId: string;
  territoryId: string;
  type: string;
  invoiceTemplate: string;
  date: string;
  currency: string;
  exchangeRate: string;
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

function isValidHijri(input: string): boolean {
  if (!input.trim()) return true;
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
    batchId: "",
    quantity: "",
    freeQuantity: "0",
    unitPrice: "",
    discountPct: "0",
    discountAmount: "0",
    discountReason: "",
    promotionId: "",
    promotionNote: "",
  };
}

function HijriDateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const bad = value.trim() !== "" && !isValidHijri(value);
  return (
    <div className="space-y-1">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="۱۴۰۴/۰۵/۰۱"
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
  step = "0.01",
}: {
  value: string;
  onChange: (v: string) => void;
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
    />
  );
}

// ─────────────────────── ویو اصلی ───────────────────────

export default function SalesView() {
  const { user, hasPermission } = useUser();

  const [statusFilter, setStatusFilter] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<SaleRow | null>(null);
  const [printDoc, setPrintDoc] = useState<PrintDoc | null>(null);
  const [returnSaleId, setReturnSaleId] = useState<string | null>(null);
  const [returnOpen, setReturnOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // انتخاب گروهی — تصویب گروهی فاکتورهای در انتظار
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkApproveOpen, setBulkApproveOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (nz(statusFilter)) p.set("status", nz(statusFilter));
    if (nz(customerFilter)) p.set("customerId", nz(customerFilter));
    if (nz(branchFilter)) p.set("branchId", nz(branchFilter));
    p.set("limit", "200");
    return p.toString();
  }, [statusFilter, customerFilter, branchFilter]);

  const { data, loading, refetch } = useApiData<{ items: SaleRow[] }>(`/api/sales?${qs}`, [qs]);
  const rows = useMemo(() => data?.items ?? [], [data]);

  const { data: customersData } = useApiData<unknown>("/api/customers?limit=500");
  const customers = useMemo(() => asList<CustomerOption>(customersData), [customersData]);

  const { data: branchesData } = useApiData<unknown>(user.isSuperAdmin ? "/api/branches" : null);
  const branches = useMemo(() => asList<Ref>(branchesData), [branchesData]);

  const { data: settingsData } = useApiData<unknown>("/api/settings");
  const settings = useMemo(() => settingsMap(settingsData), [settingsData]);
  const blockExpired = settings["block_expired_sales"] !== "false";

  const printCtx = useMemo(
    () => ({
      companyName: settings["company_name"] || "شرکت دارویی",
      footerNote: settings["invoice_footer_note"] || undefined,
    }),
    [settings]
  );

  const {
    data: detail,
    loading: detailLoading,
    refetch: refetchDetail,
  } = useApiData<SaleDetail>(detailId ? `/api/sales/${detailId}` : null);

  // ─── فرم ───
  const [form, setForm] = useState<SaleForm>(() => ({
    customerId: "",
    warehouseId: "",
    salespersonId: "",
    territoryId: "",
    type: "WHOLESALE",
    invoiceTemplate: "DETAILED",
    date: dateToHijriInput(new Date()),
    currency: "AFN",
    exchangeRate: "1",
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

  const { data: salespersonsData } = useApiData<unknown>("/api/salespersons");
  const salespersons = useMemo(() => asList<Ref>(salespersonsData), [salespersonsData]);

  const { data: territoriesData } = useApiData<unknown>("/api/territories");
  const territories = useMemo(() => asList<Ref>(territoriesData), [territoriesData]);

  const { data: productsData } = useApiData<unknown>("/api/products?limit=500");
  const products = useMemo(() => asList<ProductOption>(productsData), [productsData]);

  const stockPath = dialogOpen && form.warehouseId ? `/api/stock?warehouseId=${form.warehouseId}` : null;
  const { data: stockData, loading: stockLoading } = useApiData<unknown>(stockPath, [stockPath]);
  const stock = useMemo(() => asList<StockRow>(stockData), [stockData]);

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

  const canApprove = hasPermission("sales.approve");

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
            docType: "SALE",
            date: (dateObj ?? new Date()).toISOString(),
            customerId: form.customerId || undefined,
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
  }, [dialogOpen, items, form.customerId, form.date]);

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
  const rateNum = form.currency === "AFN" ? 1 : Number(form.exchangeRate) || 0;
  const netTotal = subtotal - invoiceDiscountPreview;
  const totalAfn = netTotal * (rateNum || 1);
  const paidNum = Number(form.paidAmount) || 0;
  const remainingAfn = totalAfn - paidNum;

  const selectedCustomer = customers.find((c) => c.id === form.customerId);
  const overCredit =
    !!selectedCustomer &&
    (selectedCustomer.creditLimit ?? 0) > 0 &&
    selectedCustomer.balance + remainingAfn > selectedCustomer.creditLimit + 0.009;

  const batchOptionsFor = (productId: string) =>
    stock.filter(
      (s) => (s.productId ?? s.product?.id) === productId && s.quantity > 0
    );

  const batchOf = (batchId: string) => stock.find((s) => (s.batchId ?? s.batch?.id) === batchId);

  const availableFor = (item: ItemForm): number => {
    if (!item.batchId) return 0;
    const s = batchOf(item.batchId);
    if (!s) return 0;
    const others = items
      .filter((o) => o.key !== item.key && o.batchId === item.batchId)
      .reduce((sum, o) => sum + (Number(o.quantity) || 0) + (Number(o.freeQuantity) || 0), 0);
    return s.quantity - others;
  };

  const resetForm = () => {
    setForm({
      customerId: "",
      warehouseId: "",
      salespersonId: "",
      territoryId: "",
      type: "WHOLESALE",
      invoiceTemplate: settings["invoice_template_default"] === "SIMPLE" ? "SIMPLE" : "DETAILED",
      date: dateToHijriInput(new Date()),
      currency: "AFN",
      exchangeRate: "1",
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

  const openEdit = async (row: SaleRow) => {
    if (row.status !== "DRAFT") {
      toast.error("فقط فاکتورهای پیش‌نویس قابل ویرایش هستند");
      return;
    }
    try {
      const d = await apiGet<SaleDetail>(`/api/sales/${row.id}`);
      setForm({
        customerId: d.customerId ?? d.customer?.id ?? "",
        warehouseId: d.warehouseId ?? d.warehouse?.id ?? "",
        salespersonId: d.salespersonId ?? "",
        territoryId: d.territoryId ?? "",
        type: d.type,
        invoiceTemplate: d.invoiceTemplate === "SIMPLE" ? "SIMPLE" : "DETAILED",
        date: dateToHijriInput(d.date),
        currency: d.currency,
        exchangeRate: String(d.exchangeRate ?? 1),
        notes: d.notes ?? "",
        paidAmount: String(d.paidAmount ?? 0),
        paymentMethod: "CASH",
        status: d.status,
        invoiceDiscountType: d.invoiceDiscountType ?? "NONE",
        invoiceDiscountValue: String(d.invoiceDiscountValue ?? 0),
        discountReason: d.discountReason ?? "",
        invoicePromotionId: (d as { promotionId?: string | null }).promotionId ?? "",
      });
      setItems(
        (d.items ?? []).map((it, i) => ({
          key: `it-edit-${i}`,
          productId: it.productId,
          batchId: it.batchId ?? "",
          quantity: String(it.quantity ?? 0),
          freeQuantity: String(it.freeQuantity ?? 0),
          unitPrice: String(it.unitPrice ?? 0),
          discountPct: String(it.discountPct ?? 0),
          discountAmount: String(it.discountAmount ?? 0),
          discountReason: it.discountReason ?? "",
          promotionId: (it as unknown as { promotionId?: string | null }).promotionId ?? "",
          promotionNote: it.promotionNote ?? "",
        }))
      );
      setItemSeq((d.items ?? []).length + 1);
      setRateEdited(true);
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
    if (!form.customerId) return toast.error("مشتری را انتخاب کنید");
    if (!form.warehouseId) return toast.error("گدام را انتخاب کنید");
    const dateObj = hijriInputToDate(normalizeDigits(form.date));
    if (!dateObj) return toast.error("تاریخ نامعتبر است");
    const validItems = items.filter((it) => it.productId && it.batchId && Number(it.quantity) > 0);
    if (validItems.length === 0) return toast.error("حداقل یک قلم با محصول، بچ و تعداد معتبر لازم است");

    const status = form.status === "APPROVED" && !canApprove ? "PENDING" : form.status;
    const body = {
      customerId: form.customerId,
      warehouseId: form.warehouseId,
      salespersonId: nz(form.salespersonId) || undefined,
      territoryId: nz(form.territoryId) || undefined,
      type: form.type,
      invoiceTemplate: form.invoiceTemplate,
      date: dateObj.toISOString(),
      currency: form.currency,
      exchangeRate: form.currency === "AFN" ? 1 : Number(form.exchangeRate) || 1,
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
        batchId: it.batchId,
        quantity: Number(it.quantity),
        freeQuantity: Number(it.freeQuantity) || 0,
        unitPrice: Number(it.unitPrice) || 0,
        discountPct: Number(it.discountPct) || 0,
        discountAmount: Number(it.discountAmount) || 0,
        discountReason: it.discountReason.trim() || undefined,
        promotionId: it.promotionId || undefined,
        promotionNote: it.promotionNote.trim() || undefined,
      })),
    };

    setSubmitting(true);
    try {
      const res = editingId
        ? await apiSend(`/api/sales/${editingId}`, { method: "PUT", body })
        : await apiSend("/api/sales", { method: "POST", body });
      if (isQueued(res)) {
        toast.info("به‌صورت آفلاین ذخیره شد؛ پس از اتصال همگام می‌شود");
        setDialogOpen(false);
        return;
      }
      toast.success(editingId ? "فاکتور فروش ویرایش شد" : "فاکتور فروش ثبت شد");
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
      const res = await apiSend(`/api/sales/${id}/approve`, { method: "POST" });
      if (isQueued(res)) {
        toast.info("درخواست تصویب به‌صورت آفلاین ذخیره شد؛ پس از اتصال همگام می‌شود");
      } else {
        toast.success("فاکتور فروش تصویب شد و از موجودی کم گردید");
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
      const res = await apiSend(`/api/sales/${id}/cancel`, { method: "POST" });
      if (isQueued(res)) {
        toast.info("درخواست لغو به‌صورت آفلاین ذخیره شد؛ پس از اتصال همگام می‌شود");
      } else {
        toast.success("فاکتور فروش لغو شد");
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
        await apiSend(`/api/sales/${id}/approve`, { method: "POST" });
      });
      const msg = bulkResultMessage("تصویب گروهی فاکتورهای فروش", result);
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

  const printRow = async (row: SaleRow) => {
    try {
      const d = await apiGet<SaleDetail>(`/api/sales/${row.id}`);
      setPrintDoc(saleToPrintDoc(d as unknown as Record<string, unknown>, printCtx));
    } catch (e) {
      toast.error(errMessage(e));
    }
  };

  const columns: Column<SaleRow>[] = [
    { key: "number", header: "شماره", render: (r) => <span className="font-mono text-xs font-semibold">{r.number}</span> },
    { key: "customer.name", header: "مشتری", render: (r) => r.customer?.name ?? "—" },
    { key: "branch.name", header: "شعبه", render: (r) => r.branch?.name ?? "—" },
    { key: "type", header: "نوع", render: (r) => labelOf(SALE_TYPES, r.type) },
    { key: "salesperson.name", header: "فروشنده", render: (r) => r.salesperson?.name ?? "—" },
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
              {hasPermission("sales.edit") && r.status === "DRAFT" && (
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
    <PermissionGate permission="sales.view">
      <div className="space-y-4">
        <PageHeader
          title="فروش‌ها"
          description={`مدیریت فاکتورهای فروش — شعبه: ${user.branchName ?? "همه شعب"}`}
          actions={
            <PermissionGate permission="sales.create">
              <Button onClick={openCreate} className="bg-primary hover:bg-primary/90">
                <Plus className="ml-1 h-4 w-4" /> ثبت فروش جدید
              </Button>
            </PermissionGate>
          }
        />

        <Card>
          <CardContent className="p-4">
            <DataTable
              columns={columns}
              rows={rows}
              searchKeys={["number", "customer.name", "branch.name", "salesperson.name"]}
              searchPlaceholder="جستجوی شماره یا مشتری..."
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
                  <Select value={customerFilter} onValueChange={setCustomerFilter}>
                    <SelectTrigger className="h-9 w-[190px]">
                      <SelectValue placeholder="همه مشتریان" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">همه مشتریان</SelectItem>
                      {customers.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
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
          title={editingId ? "ویرایش فاکتور فروش" : "ثبت فاکتور فروش جدید"}
          description="مشتری، بچ موجودی و اقلام را انتخاب کنید؛ موجودی به‌صورت زنده کنترل می‌شود."
          wide
          onSubmit={submitForm}
          submitting={submitting}
          submitLabel={editingId ? "ذخیره تغییرات" : "ثبت فاکتور"}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>مشتری *</Label>
                <Select
                  value={form.customerId}
                  onValueChange={(v) => {
                    const c = customers.find((x) => x.id === v);
                    setForm((f) => ({
                      ...f,
                      customerId: v,
                      salespersonId: c?.salespersonId ?? "",
                      territoryId: c?.territoryId ?? "",
                    }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="انتخاب مشتری" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                        {c.balance > 0.009 ? ` — بدهی: ${formatMoney(c.balance, undefined, { withCurrency: false })}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedCustomer && (
                  <p className="text-xs text-muted-foreground">
                    توازن فعلی: <b className={selectedCustomer.balance > 0 ? "text-rose-600" : "text-brand-soft-foreground"}>{formatMoney(selectedCustomer.balance)}</b>
                    {(selectedCustomer.creditLimit ?? 0) > 0 && <> — سقف اعتبار: {formatMoney(selectedCustomer.creditLimit)}</>}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>گدام (منبع موجودی) *</Label>
                <Select
                  value={form.warehouseId}
                  onValueChange={(v) => {
                    setForm((f) => ({ ...f, warehouseId: v }));
                    setItems((arr) => arr.map((it) => ({ ...it, batchId: "" })));
                  }}
                >
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
                <Label>نوع فروش</Label>
                <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(SALE_TYPES).map(([k, v]) => (
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
                <Label>فروشنده</Label>
                <Select value={form.salespersonId} onValueChange={(v) => setForm((f) => ({ ...f, salespersonId: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="انتخاب فروشنده" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— بدون فروشنده —</SelectItem>
                    {salespersons.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>منطقه</Label>
                <Select value={form.territoryId} onValueChange={(v) => setForm((f) => ({ ...f, territoryId: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="انتخاب منطقه" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— بدون منطقه —</SelectItem>
                    {territories.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                  <Label>نرخ تبدیل</Label>
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
            </div>

            <div className="space-y-1.5">
              <Label>تمپلیت فاکتور</Label>
              <RadioGroup
                value={form.invoiceTemplate}
                onValueChange={(v) => setForm((f) => ({ ...f, invoiceTemplate: v }))}
                className="flex flex-wrap gap-4"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="SIMPLE" id="tpl-simple" />
                  <Label htmlFor="tpl-simple" className="font-normal">ساده</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="DETAILED" id="tpl-detailed" />
                  <Label htmlFor="tpl-detailed" className="font-normal">مفصل (با بچ و انقضا)</Label>
                </div>
              </RadioGroup>
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
              {!form.warehouseId && (
                <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
                  برای نمایش موجودی بچ‌ها، ابتدا گدام را انتخاب کنید
                </p>
              )}
              {form.warehouseId && stockLoading && (
                <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
                  در حال بارگذاری موجودی گدام...
                </p>
              )}
              {items.map((it, idx) => {
                const options = batchOptionsFor(it.productId);
                const selected = batchOf(it.batchId);
                const expired = selected?.batch?.status === "EXPIRED";
                const qtyTotal = (Number(it.quantity) || 0) + (Number(it.freeQuantity) || 0);
                const available = availableFor(it);
                const overStock = !!it.batchId && qtyTotal > available;
                const badQty = it.quantity.trim() !== "" && (Number(it.quantity) || 0) <= 0;
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
                        <Select
                          value={it.productId}
                          onValueChange={(v) => {
                            const p = products.find((x) => x.id === v);
                            updateItem(it.key, {
                              productId: v,
                              batchId: "",
                              unitPrice: it.unitPrice.trim() === "" && p?.salePrice ? String(p.salePrice) : it.unitPrice,
                            });
                          }}
                        >
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
                      <div className="space-y-1 sm:col-span-2">
                        <Label className="text-xs">بچ موجودی *</Label>
                        <Select
                          value={it.batchId}
                          onValueChange={(v) => updateItem(it.key, { batchId: v })}
                          disabled={!it.productId}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder={it.productId ? "انتخاب بچ" : "ابتدا محصول را انتخاب کنید"} />
                          </SelectTrigger>
                          <SelectContent>
                            {options.length === 0 && (
                              <SelectItem value="no-stock" disabled>
                                موجودی قابل فروش در این گدام نیست
                              </SelectItem>
                            )}
                            {options.map((s) => {
                              const bid = s.batchId ?? s.batch?.id ?? "";
                              const isExpired = s.batch?.status === "EXPIRED";
                              const label = `بچ ${s.batch?.batchNumber ?? "—"} — انقضا ${
                                s.batch?.expiryDate ? formatHijriShort(s.batch.expiryDate) : "—"
                              } — موجودی ${formatNumber(s.quantity)}`;
                              return (
                                <SelectItem key={bid} value={bid} disabled={isExpired && blockExpired}>
                                  <span className={isExpired ? "text-rose-600" : ""}>{label}</span>
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
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
                    {expired && (
                      <p className="mt-2 rounded-md bg-rose-50 px-3 py-1.5 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                        هشدار: این بچ منقضی شده است{blockExpired ? " و فروش آن ممنوع است" : ""}.
                      </p>
                    )}
                    {overStock && (
                      <p className="mt-2 rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                        مقدار درخواستی ({formatNumber(qtyTotal)}) از موجودی این بچ بیشتر است (موجودی قابل: {formatNumber(Math.max(0, available))}).
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* پرداخت و وضعیت */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>مبلغ دریافت‌شده ({currencyLabel(form.currency)})</Label>
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
                  <RadioGroupItem value="DRAFT" id="sl-draft" />
                  <Label htmlFor="sl-draft" className="font-normal">پیش‌نویس</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="PENDING" id="sl-pending" />
                  <Label htmlFor="sl-pending" className="font-normal">در انتظار تصویب</Label>
                </div>
                {canApprove && (
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="APPROVED" id="sl-approved" />
                    <Label htmlFor="sl-approved" className="font-normal">تأیید فوری</Label>
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

            {overCredit && (
              <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                هشدار سقف اعتبار: مجموع بدهی فعلی مشتری ({formatMoney(selectedCustomer?.balance)}) و باقی‌مانده این فاکتور
                ({formatMoney(remainingAfn)}) از سقف اعتبار ({formatMoney(selectedCustomer?.creditLimit ?? 0)}) بیشتر می‌شود.
              </div>
            )}

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
                    placeholder="مثلا: تخفیف قراردادی سالانه"
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

            <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/40 p-3 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">مجموع کل ({currencyLabel(form.currency)})</p>
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
                <p className="text-xs text-muted-foreground">مبلغ قابل پرداخت ({currencyLabel(form.currency)})</p>
                <p className="font-bold">{formatMoney(netTotal, form.currency, { decimals: true })}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">معادل افغانی</p>
                <p className="font-bold text-brand-soft-foreground dark:text-brand-soft-foreground">{formatMoney(totalAfn)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">باقی‌مانده</p>
                <p className={remainingAfn > 0.009 ? "font-bold text-rose-600" : "font-bold"}>
                  {formatMoney(remainingAfn)}
                </p>
              </div>
            </div>
          </div>
        </FormDialog>

        {/* دیالوگ تفصیلات */}
        <FormDialog
          open={!!detailId}
          onOpenChange={(v) => {
            if (!v) setDetailId(null);
          }}
          title={`فاکتور فروش ${detail?.number ?? ""}`}
          description={detail ? `تاریخ: ${formatHijriDate(detail.date)}` : undefined}
          wide
        >
          {detailLoading || !detail ? (
            <p className="py-8 text-center text-sm text-muted-foreground">در حال بارگذاری تفصیلات...</p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 rounded-lg border p-3 text-sm sm:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground">مشتری</p>
                  <p className="font-semibold">{detail.customer?.name ?? "—"}</p>
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
                  <p className="text-xs text-muted-foreground">نوع / تمپلیت</p>
                  <p className="font-semibold">
                    {labelOf(SALE_TYPES, detail.type)} — {detail.invoiceTemplate === "SIMPLE" ? "ساده" : "مفصل"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">فروشنده / منطقه</p>
                  <p className="font-semibold">
                    {detail.salesperson?.name ?? "—"} / {detail.territory?.name ?? "—"}
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
                        <TableHead>مجموع</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(detail.items ?? []).map((it) => (
                        <TableRow key={it.id}>
                          <TableCell className="font-medium">{it.product?.name ?? "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{it.batch?.batchNumber ?? "—"}</TableCell>
                          <TableCell className="text-xs">{it.batch?.expiryDate ? formatHijriShort(it.batch.expiryDate) : "—"}</TableCell>
                          <TableCell>{formatNumber(it.quantity)}</TableCell>
                          <TableCell>{formatNumber(it.freeQuantity)}</TableCell>
                          <TableCell>{formatMoney(it.unitPrice, detail.currency, { decimals: true, withCurrency: false })}</TableCell>
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
                          <TableHead>وضعیت</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(detail.returns ?? []).map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="font-mono text-xs">{r.number}</TableCell>
                            <TableCell className="text-xs">{formatHijriShort(r.date)}</TableCell>
                            <TableCell>{formatMoney(r.totalAfn)}</TableCell>
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
                  onClick={() => setPrintDoc(saleToPrintDoc(detail as unknown as Record<string, unknown>, printCtx))}
                >
                  <Printer className="ml-1 h-4 w-4" /> چاپ فاکتور
                </Button>
                {(detail.status === "APPROVED" || detail.status === "COMPLETED") && hasPermission("returns.create") && (
                  <Button
                    variant="outline"
                    className="text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/40"
                    onClick={() => {
                      setReturnSaleId(detail.id);
                      setReturnOpen(true);
                    }}
                  >
                    <RotateCcw className="ml-1 h-4 w-4" /> برگشتی
                  </Button>
                )}
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
                    onClick={() => setCancelTarget({ ...detail, customer: detail.customer, branch: detail.branch })}
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
          title="لغو فاکتور فروش"
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
          title={`تصویب گروهی ${bulkApproveTargets.length.toLocaleString("en-US")} فاکتور فروش`}
          message={`آیا از تصویب گروهی ${bulkApproveTargets.length.toLocaleString("en-US")} فاکتور در انتظار مطمئن هستید؟ موجودی گدام و حساب مشتریان به‌روزرسانی می‌شود.`}
          confirmLabel="تصویب گروهی"
          submitting={bulkBusy}
          onConfirm={() => void doBulkApprove()}
        />

        <SalesReturnDialog
          open={returnOpen}
          onOpenChange={setReturnOpen}
          presetSaleId={returnSaleId}
          onSaved={() => {
            refetch();
            if (detailId) refetchDetail();
          }}
        />

        <PrintDialog doc={printDoc} onOpenChange={(v) => { if (!v) setPrintDoc(null); }} />
      </div>
    </PermissionGate>
  );
}
