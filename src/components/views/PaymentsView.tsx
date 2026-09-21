"use client";

/**
 * ویوی پرداخت‌ها — رسیدهای دریافت از مشتری و پرداخت به تأمین‌کننده
 * لیست با فیلتر، ثبت رسید (با یا بدون فاکتور)، چاپ رسید و لغو
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Ban, Plus, Printer } from "lucide-react";
import { PermissionGate, useUser } from "@/components/shared/use-user";
import { PageHeader, StatusBadge } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { ConfirmDialog, FormDialog } from "@/components/shared/form-dialog";
import {
  PrintDialog,
  paymentToPrintDoc,
  type PrintDoc,
} from "@/components/shared/print-invoice";
import { apiSend, useApiData, type QueuedResult } from "@/lib/client-api";
import { runBulkOperation, bulkResultMessage } from "@/lib/bulk";
import { currencyLabel, formatHijriShort, formatMoney } from "@/lib/format";
import { dateToHijriInput, hijriInputToDate, hijriInputToDayEnd, hijriInputToDayStart, hijriInputToGregorianISO } from "@/lib/hijri";
import { labelOf, PAYMENT_METHODS } from "@/lib/terminology";
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
import { Textarea } from "@/components/ui/textarea";

// ─────────────────────── انواع ───────────────────────

type Ref = { id: string; name: string };

type PaymentRow = {
  id: string;
  number: string;
  type: string;
  direction?: string;
  amount: number;
  currency: string;
  exchangeRate: number;
  method: string;
  reference?: string | null;
  date: string;
  notes?: string | null;
  status: string;
  customer?: Ref | null;
  supplier?: Ref | null;
  sale?: { id: string; number: string } | null;
  purchase?: { id: string; number: string } | null;
  branch?: Ref | null;
  createdByName?: string | null;
};

type InvoiceOptionRow = {
  id: string;
  number: string;
  status: string;
  date: string;
  totalAfn: number;
  paidAmount: number;
  returnedAfn?: number;
  customer?: Ref | null;
  supplier?: Ref | null;
};

type PaymentForm = {
  type: "CUSTOMER" | "SUPPLIER";
  partyId: string;
  invoiceId: string;
  amount: string;
  currency: string;
  exchangeRate: string;
  method: string;
  reference: string;
  date: string;
  notes: string;
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

function remainingOf(inv: InvoiceOptionRow): number {
  return inv.totalAfn - inv.paidAmount - (inv.returnedAfn ?? 0);
}

// ─────────────────────── ویو اصلی ───────────────────────

export default function PaymentsView() {
  const { user, hasPermission } = useUser();

  // فیلترها
  const [typeFilter, setTypeFilter] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<PaymentRow | null>(null);
  const [printDoc, setPrintDoc] = useState<PrintDoc | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // انتخاب گروهی
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkCancelOpen, setBulkCancelOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const qs = useMemo(() => {
    const p = new URLSearchParams({ limit: "200" });
    if (nz(typeFilter)) p.set("type", nz(typeFilter));
    if (nz(customerFilter)) p.set("customerId", nz(customerFilter));
    if (nz(supplierFilter)) p.set("supplierId", nz(supplierFilter));
    if (nz(branchFilter)) p.set("branchId", nz(branchFilter));
    const from = fromDate.trim() ? hijriInputToDayStart(normalizeDigits(fromDate))?.toISOString() : null;
    const to = toDate.trim() ? hijriInputToDayEnd(normalizeDigits(toDate))?.toISOString() : null;
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    return p.toString();
  }, [typeFilter, customerFilter, supplierFilter, branchFilter, fromDate, toDate]);

  const { data, loading, refetch } = useApiData<{ items: PaymentRow[] }>(`/api/payments?${qs}`, [qs]);
  const rows = useMemo(() => data?.items ?? [], [data]);

  const { data: customersData } = useApiData<unknown>("/api/customers?limit=500");
  const customers = useMemo(() => asList<Ref>(customersData), [customersData]);

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

  // ─── فرم ثبت رسید ───
  const [form, setForm] = useState<PaymentForm>(() => ({
    type: "CUSTOMER",
    partyId: "",
    invoiceId: "none",
    amount: "",
    currency: "AFN",
    exchangeRate: "1",
    method: "CASH",
    reference: "",
    date: dateToHijriInput(new Date()),
    notes: "",
  }));
  const [rateEdited, setRateEdited] = useState(false);
  const [rateOffline, setRateOffline] = useState(false);

  const invoicesPath =
    dialogOpen && form.partyId
      ? form.type === "CUSTOMER"
        ? `/api/sales?customerId=${form.partyId}&limit=100`
        : `/api/purchases?supplierId=${form.partyId}&limit=100`
      : null;
  const { data: invoicesData, loading: invoicesLoading } = useApiData<unknown>(invoicesPath, [invoicesPath]);
  const openInvoices = useMemo(
    () =>
      asList<InvoiceOptionRow>(invoicesData).filter(
        (inv) =>
          (inv.status === "APPROVED" || inv.status === "COMPLETED") && remainingOf(inv) > 0.009
      ),
    [invoicesData]
  );

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

  const amountNum = Number(form.amount) || 0;
  const rateNum = form.currency === "AFN" ? 1 : Number(form.exchangeRate) || 0;
  const amountAfn = form.currency === "AFN" ? amountNum : amountNum * (rateNum || 0);
  const selectedInvoice = openInvoices.find((inv) => inv.id === form.invoiceId);

  const openCreate = () => {
    setForm({
      type: "CUSTOMER",
      partyId: "",
      invoiceId: "none",
      amount: "",
      currency: "AFN",
      exchangeRate: "1",
      method: "CASH",
      reference: "",
      date: dateToHijriInput(new Date()),
      notes: "",
    });
    setRateEdited(false);
    setRateOffline(false);
    setDialogOpen(true);
  };

  const submitForm = async () => {
    if (!form.partyId) {
      return toast.error(form.type === "CUSTOMER" ? "مشتری را انتخاب کنید" : "تأمین‌کننده را انتخاب کنید");
    }
    if (amountNum <= 0) return toast.error("مبلغ باید بزرگ‌تر از صفر باشد");
    const dateObj = hijriInputToDate(normalizeDigits(form.date));
    if (!dateObj) return toast.error("تاریخ نامعتبر است");

    const body = {
      type: form.type,
      customerId: form.type === "CUSTOMER" ? form.partyId : undefined,
      supplierId: form.type === "SUPPLIER" ? form.partyId : undefined,
      saleId: form.type === "CUSTOMER" && form.invoiceId !== "none" ? form.invoiceId : undefined,
      purchaseId: form.type === "SUPPLIER" && form.invoiceId !== "none" ? form.invoiceId : undefined,
      amount: Math.round(amountAfn * 100) / 100,
      currency: form.currency,
      exchangeRate: form.currency === "AFN" ? 1 : Number(form.exchangeRate) || 1,
      method: form.method,
      reference: form.reference.trim() || undefined,
      date: dateObj.toISOString(),
      notes: form.notes.trim() || undefined,
    };

    setSubmitting(true);
    try {
      const res = await apiSend<{ warning?: string }>("/api/payments", { method: "POST", body });
      if (isQueued(res)) {
        toast.info("به‌صورت آفلاین ذخیره شد؛ پس از اتصال همگام می‌شود");
        setDialogOpen(false);
        return;
      }
      toast.success("رسید پرداخت ثبت شد");
      if (res && typeof res === "object" && res.warning) {
        toast.warning(res.warning);
      }
      setDialogOpen(false);
      refetch();
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  const doCancel = async (row: PaymentRow) => {
    setBusyId(row.id);
    try {
      await apiSend(`/api/payments/${row.id}`, { method: "DELETE" });
      toast.success("رسید لغو شد و اثر آن معکوس گردید");
      refetch();
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  // ─── لغو گروهی رسیدها (فقط رسیدهای تکمیل‌شده قابل لغو هستند) ───
  const bulkCancelTargets = useMemo(
    () =>
      selectedIds.filter((id) => rows.some((r) => r.id === id && r.status === "COMPLETED")),
    [selectedIds, rows]
  );

  const doBulkCancel = async () => {
    setBulkBusy(true);
    try {
      const result = await runBulkOperation(bulkCancelTargets, (id) =>
        apiSend(`/api/payments/${id}`, { method: "DELETE" })
      );
      const msg = bulkResultMessage("لغو گروهی رسیدها", result);
      if (msg.tone === "success") toast.success(msg.message);
      else if (msg.tone === "warning") toast.warning(msg.message);
      else toast.error(msg.message);
      setSelectedIds([]);
      refetch();
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setBulkBusy(false);
      setBulkCancelOpen(false);
    }
  };

  const columns: Column<PaymentRow>[] = [
    { key: "number", header: "شماره رسید", render: (r) => <span className="font-mono text-xs font-semibold">{r.number}</span> },
    {
      key: "type",
      header: "نوع",
      render: (r) => (r.type === "CUSTOMER" ? "دریافت از مشتری" : "پرداخت به تأمین‌کننده"),
    },
    {
      key: "party",
      header: "طرف حساب",
      sortable: false,
      render: (r) => r.customer?.name ?? r.supplier?.name ?? "—",
    },
    {
      key: "invoice",
      header: "فاکتور مربوطه",
      sortable: false,
      render: (r) => r.sale?.number ?? r.purchase?.number ?? "حساب جاری",
    },
    {
      key: "amount",
      header: "مبلغ",
      render: (r) => <span className="font-semibold">{formatMoney(r.amount)}</span>,
    },
    { key: "method", header: "روش", render: (r) => labelOf(PAYMENT_METHODS, r.method) },
    { key: "date", header: "تاریخ", render: (r) => formatHijriShort(r.date) },
    { key: "status", header: "وضعیت", render: (r) => <StatusBadge status={r.status} /> },
    {
      key: "actions",
      header: "عملیات",
      sortable: false,
      render: (r) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="چاپ رسید"
            onClick={() => setPrintDoc(paymentToPrintDoc(r as unknown as Record<string, unknown>, printCtx))}
          >
            <Printer className="h-4 w-4" />
          </Button>
          {r.status === "COMPLETED" && hasPermission("payments.delete") && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-rose-600"
              title="لغو رسید"
              disabled={busyId === r.id}
              onClick={() => setCancelTarget(r)}
            >
              <Ban className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <PermissionGate permission="payments.view">
      <div className="space-y-4">
        <PageHeader
          title="پرداخت‌ها"
          description={`رسیدهای دریافت و پرداخت — شعبه: ${user.branchName ?? "همه شعب"}`}
          actions={
            <PermissionGate permission="payments.create">
              <Button onClick={openCreate} className="bg-primary hover:bg-primary/90">
                <Plus className="ml-1 h-4 w-4" /> ثبت رسید جدید
              </Button>
            </PermissionGate>
          }
        />

        <Card>
          <CardContent className="p-4">
            <DataTable
              columns={columns}
              rows={rows}
              searchKeys={["number", "customer.name", "supplier.name", "sale.number", "purchase.number"]}
              searchPlaceholder="جستجوی شماره رسید..."
              loading={loading}
              emptyText="هنوز پرداختی ثبت نشده است"
              rowKey={(r) => r.id}
              selectable={hasPermission("payments.delete")}
              getRowId={(r) => r.id}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              bulkActions={
                hasPermission("payments.delete") && bulkCancelTargets.length > 0 ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950"
                    disabled={bulkBusy}
                    onClick={() => setBulkCancelOpen(true)}
                  >
                    <Ban className="h-3.5 w-3.5" />
                    لغو گروهی رسیدها
                  </Button>
                ) : null
              }
              toolbar={
                <>
                  <Select value={typeFilter} onValueChange={setTypeFilter}>
                    <SelectTrigger className="h-9 w-[170px]">
                      <SelectValue placeholder="همه انواع" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">همه انواع</SelectItem>
                      <SelectItem value="CUSTOMER">دریافت از مشتری</SelectItem>
                      <SelectItem value="SUPPLIER">پرداخت به تأمین‌کننده</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={customerFilter} onValueChange={setCustomerFilter}>
                    <SelectTrigger className="h-9 w-[170px]">
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
                  <Select value={supplierFilter} onValueChange={setSupplierFilter}>
                    <SelectTrigger className="h-9 w-[170px]">
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
                  <div className="flex items-center gap-1">
                    <Input
                      value={fromDate}
                      onChange={(e) => setFromDate(e.target.value)}
                      placeholder="از ۱۴۰۴/۰۵/۰۱"
                      className="h-9 w-[130px] text-center"
                    />
                    <Input
                      value={toDate}
                      onChange={(e) => setToDate(e.target.value)}
                      placeholder="الی ۱۴۰۴/۰۵/۳۰"
                      className="h-9 w-[130px] text-center"
                    />
                  </div>
                  {(fromDate.trim() || toDate.trim()) && (
                    <Button variant="ghost" size="sm" onClick={() => { setFromDate(""); setToDate(""); }}>
                      حذف فیلتر تاریخ
                    </Button>
                  )}
                </>
              }
            />
          </CardContent>
        </Card>

        {/* دیالوگ ثبت رسید */}
        <FormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          title="ثبت رسید پرداخت"
          description="دریافت از مشتری توازن او را کم می‌کند؛ پرداخت به تأمین‌کننده بدهی ما را کم می‌کند."
          onSubmit={submitForm}
          submitting={submitting}
          submitLabel="ثبت رسید"
        >
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>نوع رسید *</Label>
              <RadioGroup
                value={form.type}
                onValueChange={(v) => {
                  setForm((f) => ({ ...f, type: v as "CUSTOMER" | "SUPPLIER", partyId: "", invoiceId: "none" }));
                }}
                className="flex flex-wrap gap-4"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="CUSTOMER" id="pay-customer" />
                  <Label htmlFor="pay-customer" className="font-normal">دریافت از مشتری</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="SUPPLIER" id="pay-supplier" />
                  <Label htmlFor="pay-supplier" className="font-normal">پرداخت به تأمین‌کننده</Label>
                </div>
              </RadioGroup>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{form.type === "CUSTOMER" ? "مشتری *" : "تأمین‌کننده *"}</Label>
                <Select
                  value={form.partyId}
                  onValueChange={(v) => setForm((f) => ({ ...f, partyId: v, invoiceId: "none" }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={form.type === "CUSTOMER" ? "انتخاب مشتری" : "انتخاب تأمین‌کننده"} />
                  </SelectTrigger>
                  <SelectContent>
                    {(form.type === "CUSTOMER" ? customers : suppliers).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>فاکتور مربوطه</Label>
                <Select value={form.invoiceId} onValueChange={(v) => setForm((f) => ({ ...f, invoiceId: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder={form.partyId ? "انتخاب فاکتور" : "ابتدا طرف حساب را انتخاب کنید"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">بدون فاکتور (حساب جاری)</SelectItem>
                    {invoicesLoading && <SelectItem value="loading" disabled>در حال بارگذاری...</SelectItem>}
                    {openInvoices.map((inv) => (
                      <SelectItem key={inv.id} value={inv.id}>
                        {inv.number} — باقی‌مانده {formatMoney(remainingOf(inv), undefined, { withCurrency: false })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.partyId && !invoicesLoading && openInvoices.length === 0 && (
                  <p className="text-xs text-muted-foreground">فاکتور بازی برای این طرف حساب وجود ندارد</p>
                )}
                {selectedInvoice && (
                  <p className="text-xs text-muted-foreground">
                    مجموع: {formatMoney(selectedInvoice.totalAfn)} — باقی‌مانده:{" "}
                    <b className="text-rose-600">{formatMoney(remainingOf(selectedInvoice))}</b>
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>مبلغ ({currencyLabel(form.currency)}) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  dir="ltr"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  placeholder="0.00"
                />
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
              {form.currency !== "AFN" && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label>نرخ تبدیل</Label>
                    <Badge variant="outline" className={rateOffline ? "border-amber-200 bg-amber-100 text-amber-800" : "border-brand/40 bg-brand-soft text-brand-soft-foreground"}>
                      {rateOffline ? "نرخ ذخیره‌شده" : "نرخ روز"}
                    </Badge>
                  </div>
                  <Input
                    type="number"
                    step="0.0001"
                    min="0"
                    dir="ltr"
                    value={form.exchangeRate}
                    onChange={(e) => {
                      setRateEdited(true);
                      setForm((f) => ({ ...f, exchangeRate: e.target.value }));
                    }}
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>روش پرداخت *</Label>
                <Select value={form.method} onValueChange={(v) => setForm((f) => ({ ...f, method: v }))}>
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
              <div className="space-y-1.5">
                <Label>تاریخ *</Label>
                <div className="space-y-1">
                  <Input
                    value={form.date}
                    onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                    placeholder="۱۴۰۴/۰۵/۰۱"
                    dir="ltr"
                    className="text-center"
                  />
                  {form.date.trim() !== "" && !isValidHijri(form.date) && (
                    <p className="text-xs text-rose-600">تاریخ نامعتبر است</p>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>شماره مرجع (بانک/حواله)</Label>
                <Input
                  value={form.reference}
                  onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                  placeholder="اختیاری"
                />
              </div>
            </div>

            {form.currency !== "AFN" && (
              <div className="rounded-md bg-brand-soft px-3 py-2 text-sm dark:bg-brand-soft/60">
                مبلغ به افغانی: <b className="text-brand-soft-foreground dark:text-brand-soft-foreground">{formatMoney(amountAfn)}</b>
                <span className="text-xs text-muted-foreground"> — مبلغ افغانی در سیستم ثبت می‌شود</span>
              </div>
            )}
            {selectedInvoice && amountAfn > remainingOf(selectedInvoice) + 0.009 && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                مبلغ بیشتر از باقی‌مانده فاکتور است — مازاد به‌صورت پیش‌پرداخت در حساب طرف حساب ثبت می‌شود.
              </p>
            )}

            <div className="space-y-1.5">
              <Label>یادداشت</Label>
              <Textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="یادداشت اختیاری..."
              />
            </div>
          </div>
        </FormDialog>

        <ConfirmDialog
          open={!!cancelTarget}
          onOpenChange={(v) => {
            if (!v) setCancelTarget(null);
          }}
          title="لغو رسید پرداخت"
          message={`آیا از لغو رسید «${cancelTarget?.number ?? ""}» مطمئن هستید؟ اثر آن روی توازن و فاکتور معکوس می‌شود.`}
          confirmLabel="لغو رسید"
          danger
          submitting={!!cancelTarget && busyId === cancelTarget.id}
          onConfirm={() => {
            if (cancelTarget) doCancel(cancelTarget);
            setCancelTarget(null);
          }}
        />

        <ConfirmDialog
          open={bulkCancelOpen}
          onOpenChange={(v) => {
            if (!v) setBulkCancelOpen(false);
          }}
          title={`لغو گروهی ${bulkCancelTargets.length.toLocaleString("en-US")} رسید پرداخت`}
          message={`آیا از لغو گروهی ${bulkCancelTargets.length.toLocaleString("en-US")} رسید تکمیل‌شده مطمئن هستید؟ اثر مالی همه رسیدها روی توازن‌ها و فاکتورها معکوس می‌شود.`}
          confirmLabel="لغو گروهی"
          danger
          submitting={bulkBusy}
          onConfirm={() => void doBulkCancel()}
        />

        <PrintDialog doc={printDoc} onOpenChange={(v) => { if (!v) setPrintDoc(null); }} />
      </div>
    </PermissionGate>
  );
}
