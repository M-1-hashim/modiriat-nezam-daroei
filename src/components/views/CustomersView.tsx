"use client";

/**
 * ویوی مشتریان — لیست، ایجاد/ویرایش، غیرفعال‌سازی و صورت‌حساب با چاپ
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FileText, Pencil, Plus, Printer, UserRoundX } from "lucide-react";

import { PermissionGate, useUser } from "@/components/shared/use-user";
import { PageHeader, StatCard, StatusBadge, BADGE_TONES } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { ConfirmDialog, FormDialog } from "@/components/shared/form-dialog";
import { apiSend, useApiData, type QueuedResult } from "@/lib/client-api";
import { runBulkOperation, bulkResultMessage } from "@/lib/bulk";
import { formatHijriDate, formatHijriShort, formatMoney, formatNumber } from "@/lib/format";
import { CUSTOMER_TYPES, PAYMENT_METHODS, labelOf } from "@/lib/terminology";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

// ─────────────────────── انواع ───────────────────────

type Ref = { id: string; name: string };

type CustomerRow = {
  id: string;
  name: string;
  type: string;
  phone?: string | null;
  address?: string | null;
  creditLimit: number;
  paymentTerms: number;
  balance: number;
  isActive: boolean;
  territoryId?: string | null;
  salespersonId?: string | null;
  territory?: Ref | null;
  salesperson?: Ref | null;
  branch?: Ref | null;
};

type StatementSale = {
  id: string;
  number: string;
  date: string;
  totalAfn: number;
  paidAmount: number;
  returnedAfn: number;
  status: string;
};

type StatementPayment = {
  id: string;
  number: string;
  date: string;
  amount: number;
  method: string;
  status: string;
};

type StatementReturn = {
  id: string;
  number: string;
  date: string;
  totalAfn: number;
  status: string;
};

type Statement = {
  customer: CustomerRow;
  sales?: StatementSale[];
  payments?: StatementPayment[];
  returns?: StatementReturn[];
};

type CustomerForm = {
  name: string;
  type: string;
  phone: string;
  address: string;
  territoryId: string;
  salespersonId: string;
  creditLimit: string;
  paymentTerms: string;
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

// ─────────────────────── ویو اصلی ───────────────────────

export default function CustomersView() {
  const { user, hasPermission } = useUser();

  const [typeFilter, setTypeFilter] = useState("");
  const [territoryFilter, setTerritoryFilter] = useState("");
  const [salespersonFilter, setSalespersonFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [statementId, setStatementId] = useState<string | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<CustomerRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [printing, setPrinting] = useState(false);

  // انتخاب گروهی
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const qs = useMemo(() => {
    const p = new URLSearchParams({ limit: "500" });
    if (nz(typeFilter)) p.set("type", nz(typeFilter));
    if (nz(territoryFilter)) p.set("territoryId", nz(territoryFilter));
    if (nz(salespersonFilter)) p.set("salespersonId", nz(salespersonFilter));
    if (nz(branchFilter)) p.set("branchId", nz(branchFilter));
    return p.toString();
  }, [typeFilter, territoryFilter, salespersonFilter, branchFilter]);

  const { data, loading, refetch } = useApiData<{ items: CustomerRow[] }>(`/api/customers?${qs}`, [qs]);
  const rows = useMemo(() => data?.items ?? [], [data]);

  const { data: territoriesData } = useApiData<unknown>("/api/territories");
  const territories = useMemo(() => asList<Ref>(territoriesData), [territoriesData]);

  const { data: salespersonsData } = useApiData<unknown>("/api/salespersons");
  const salespersons = useMemo(() => asList<Ref>(salespersonsData), [salespersonsData]);

  const { data: branchesData } = useApiData<unknown>(user.isSuperAdmin ? "/api/branches" : null);
  const branches = useMemo(() => asList<Ref>(branchesData), [branchesData]);

  const { data: settingsData } = useApiData<unknown>("/api/settings");
  const settings = useMemo(() => settingsMap(settingsData), [settingsData]);

  const { data: statement, loading: statementLoading } = useApiData<Statement>(
    statementId ? `/api/customers/${statementId}` : null
  );

  const stats = useMemo(() => {
    const receivables = rows.reduce((s, r) => s + (r.balance > 0 ? r.balance : 0), 0);
    const inactive = rows.filter((r) => !r.isActive).length;
    return { receivables, inactive };
  }, [rows]);

  // پاک‌سازی انتخاب‌ها اگر ردیف‌ها حذف/فیلتر شده باشند
  useEffect(() => {
    if (selectedIds.length === 0) return;
    const existing = new Set(rows.map((r) => r.id));
    const next = selectedIds.filter((id) => existing.has(id));
    if (next.length !== selectedIds.length) setSelectedIds(next);
  }, [rows, selectedIds]);

  // ─── فرم ───
  const [form, setForm] = useState<CustomerForm>({
    name: "",
    type: "PHARMACY",
    phone: "",
    address: "",
    territoryId: "",
    salespersonId: "",
    creditLimit: "0",
    paymentTerms: "0",
    isActive: true,
  });

  const openCreate = () => {
    setForm({
      name: "",
      type: "PHARMACY",
      phone: "",
      address: "",
      territoryId: "",
      salespersonId: "",
      creditLimit: "0",
      paymentTerms: "0",
      isActive: true,
    });
    setEditingId(null);
    setDialogOpen(true);
  };

  const openEdit = (row: CustomerRow) => {
    setForm({
      name: row.name,
      type: row.type,
      phone: row.phone ?? "",
      address: row.address ?? "",
      territoryId: row.territoryId ?? row.territory?.id ?? "",
      salespersonId: row.salespersonId ?? row.salesperson?.id ?? "",
      creditLimit: String(row.creditLimit ?? 0),
      paymentTerms: String(row.paymentTerms ?? 0),
      isActive: row.isActive,
    });
    setEditingId(row.id);
    setDialogOpen(true);
  };

  const submitForm = async () => {
    if (!form.name.trim()) return toast.error("نام مشتری را وارد کنید");
    const body = {
      name: form.name.trim(),
      type: form.type,
      phone: form.phone.trim() || undefined,
      address: form.address.trim() || undefined,
      territoryId: nz(form.territoryId) || undefined,
      salespersonId: nz(form.salespersonId) || undefined,
      creditLimit: Number(form.creditLimit) || 0,
      paymentTerms: Number(form.paymentTerms) || 0,
      ...(editingId ? { isActive: form.isActive } : {}),
    };
    setSubmitting(true);
    try {
      const res = editingId
        ? await apiSend(`/api/customers/${editingId}`, { method: "PUT", body })
        : await apiSend("/api/customers", { method: "POST", body });
      if (isQueued(res)) {
        toast.info("به‌صورت آفلاین ذخیره شد؛ پس از اتصال همگام می‌شود");
        setDialogOpen(false);
        return;
      }
      toast.success(editingId ? "مشتری ویرایش شد" : "مشتری ثبت شد");
      setDialogOpen(false);
      refetch();
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  const doDeactivate = async (row: CustomerRow) => {
    try {
      await apiSend(`/api/customers/${row.id}`, { method: "DELETE" });
      toast.success("مشتری غیرفعال شد");
      refetch();
    } catch (e) {
      toast.error(errMessage(e));
    }
  };

  /** حذف گروهی مشتریان انتخاب‌شده — بازاستفاده از endpoint تک‌رکورد DELETE */
  const runBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    setBulkBusy(true);
    try {
      const result = await runBulkOperation(selectedIds, (id) =>
        apiSend(`/api/customers/${id}`, { method: "DELETE" }),
      );
      const msg = bulkResultMessage("حذف گروهی", result);
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

  const printStatement = () => {
    setPrinting(true);
    window.setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 100);
  };

  const columns: Column<CustomerRow>[] = [
    {
      key: "name",
      header: "نام",
      render: (r) => (
        <span className="font-semibold">
          {r.name}
          {!r.isActive && <span className="mr-1 text-xs text-rose-600">(غیرفعال)</span>}
        </span>
      ),
    },
    { key: "type", header: "نوع", render: (r) => labelOf(CUSTOMER_TYPES, r.type) },
    { key: "phone", header: "تلفن", render: (r) => r.phone ?? "—" },
    { key: "territory.name", header: "منطقه", render: (r) => r.territory?.name ?? "—" },
    { key: "salesperson.name", header: "فروشنده", render: (r) => r.salesperson?.name ?? "—" },
    { key: "creditLimit", header: "سقف اعتبار", render: (r) => formatMoney(r.creditLimit) },
    {
      key: "balance",
      header: "توازن",
      render: (r) => (
        <span className={r.balance > 0.009 ? "font-semibold text-rose-600" : "font-semibold text-brand-soft-foreground"}>
          {formatMoney(r.balance)}
        </span>
      ),
    },
    {
      key: "isActive",
      header: "فعال",
      render: (r) => (
        <Badge variant="outline" className={r.isActive ? BADGE_TONES.emerald : BADGE_TONES.slate}>
          {r.isActive ? "فعال" : "غیرفعال"}
        </Badge>
      ),
    },
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
            title="صورت‌حساب"
            onClick={() => setStatementId(r.id)}
          >
            <FileText className="h-4 w-4" />
          </Button>
          {hasPermission("customers.edit") && (
            <Button variant="ghost" size="icon" className="h-8 w-8" title="ویرایش" onClick={() => openEdit(r)}>
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {hasPermission("customers.delete") && r.isActive && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-rose-600"
              title="غیرفعال‌سازی"
              onClick={() => setDeactivateTarget(r)}
            >
              <UserRoundX className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <PermissionGate permission="customers.view">
      <div className="space-y-4">
        <PageHeader
          title="مشتریان"
          description={`مدیریت مشتریان و صورت‌حساب‌ها — شعبه: ${user.branchName ?? "همه شعب"}`}
          actions={
            <PermissionGate permission="customers.create">
              <Button onClick={openCreate} className="bg-primary hover:bg-primary/90">
                <Plus className="ml-1 h-4 w-4" /> مشتری جدید
              </Button>
            </PermissionGate>
          }
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard label="تعداد مشتریان" value={formatNumber(rows.length)} tone="emerald" />
          <StatCard
            label="مطالبات (بدهی مشتریان)"
            value={formatMoney(stats.receivables)}
            tone="rose"
          />
          <StatCard label="مشتریان غیرفعال" value={formatNumber(stats.inactive)} tone="slate" />
        </div>

        <Card>
          <CardContent className="p-4">
            <DataTable
              columns={columns}
              rows={rows}
              searchKeys={["name", "phone", "territory.name", "salesperson.name"]}
              searchPlaceholder="جستجوی نام یا تلفن..."
              loading={loading}
              emptyText="مشتری ثبت نشده است"
              rowKey={(r) => r.id}
              selectable
              getRowId={(r) => String(r.id)}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              bulkActions={
                hasPermission("customers.delete") ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 border-rose-300 text-rose-700 hover:bg-rose-50"
                    disabled={bulkBusy}
                    onClick={() => setBulkDeleteOpen(true)}
                  >
                    حذف گروهی
                  </Button>
                ) : null
              }
              toolbar={
                <>
                  <Select value={typeFilter} onValueChange={setTypeFilter}>
                    <SelectTrigger className="h-9 w-[150px]">
                      <SelectValue placeholder="همه انواع" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">همه انواع</SelectItem>
                      {Object.entries(CUSTOMER_TYPES).map(([k, v]) => (
                        <SelectItem key={k} value={k}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={territoryFilter} onValueChange={setTerritoryFilter}>
                    <SelectTrigger className="h-9 w-[150px]">
                      <SelectValue placeholder="همه مناطق" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">همه مناطق</SelectItem>
                      {territories.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={salespersonFilter} onValueChange={setSalespersonFilter}>
                    <SelectTrigger className="h-9 w-[150px]">
                      <SelectValue placeholder="همه فروشندگان" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">همه فروشندگان</SelectItem>
                      {salespersons.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {user.isSuperAdmin && (
                    <Select value={branchFilter} onValueChange={setBranchFilter}>
                      <SelectTrigger className="h-9 w-[150px]">
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
          title={editingId ? "ویرایش مشتری" : "ثبت مشتری جدید"}
          onSubmit={submitForm}
          submitting={submitting}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>نام مشتری *</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>نوع</Label>
              <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CUSTOMER_TYPES).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>تلفن</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                dir="ltr"
                placeholder="07xxxxxxxx"
              />
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
              <Label>سقف اعتبار (افغانی)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                dir="ltr"
                value={form.creditLimit}
                onChange={(e) => setForm((f) => ({ ...f, creditLimit: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>شرایط پرداخت (روز)</Label>
              <Input
                type="number"
                step="1"
                min="0"
                dir="ltr"
                value={form.paymentTerms}
                onChange={(e) => setForm((f) => ({ ...f, paymentTerms: e.target.value }))}
              />
            </div>
            {editingId && (
              <div className="flex items-center justify-between rounded-md border p-3 sm:col-span-2">
                <Label htmlFor="cust-active" className="font-normal">مشتری فعال باشد</Label>
                <Switch
                  id="cust-active"
                  checked={form.isActive}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
                />
              </div>
            )}
            <div className="space-y-1.5 sm:col-span-2">
              <Label>آدرس</Label>
              <Textarea
                rows={2}
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              />
            </div>
          </div>
        </FormDialog>

        {/* دیالوگ صورت‌حساب */}
        <FormDialog
          open={!!statementId}
          onOpenChange={(v) => {
            if (!v) setStatementId(null);
          }}
          title={`صورت‌حساب — ${statement?.customer.name ?? ""}`}
          description={statement ? `نوع: ${labelOf(CUSTOMER_TYPES, statement.customer.type)} — تلفن: ${statement.customer.phone ?? "—"}` : undefined}
          wide
        >
          {statementLoading || !statement ? (
            <p className="py-8 text-center text-sm text-muted-foreground">در حال بارگذاری صورت‌حساب...</p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 rounded-lg border p-3 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-xs text-muted-foreground">منطقه / فروشنده</p>
                  <p className="font-semibold">
                    {statement.customer.territory?.name ?? "—"} / {statement.customer.salesperson?.name ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">سقف اعتبار</p>
                  <p className="font-semibold">{formatMoney(statement.customer.creditLimit)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">شرایط پرداخت</p>
                  <p className="font-semibold">{formatNumber(statement.customer.paymentTerms)} روز</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">توازن فعلی</p>
                  <p className={statement.customer.balance > 0.009 ? "font-bold text-rose-600" : "font-bold text-brand-soft-foreground"}>
                    {formatMoney(statement.customer.balance)}
                  </p>
                </div>
              </div>

              <div>
                <p className="mb-2 text-sm font-bold">فروش‌ها</p>
                <div className="max-h-56 overflow-y-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>شماره</TableHead>
                        <TableHead>تاریخ</TableHead>
                        <TableHead>مجموع</TableHead>
                        <TableHead>پرداخت</TableHead>
                        <TableHead>باقی‌مانده</TableHead>
                        <TableHead>وضعیت</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(statement.sales ?? []).length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="h-20 text-center text-muted-foreground">
                            فروشی ثبت نشده است
                          </TableCell>
                        </TableRow>
                      ) : (
                        (statement.sales ?? []).map((s) => (
                          <TableRow key={s.id}>
                            <TableCell className="font-mono text-xs">{s.number}</TableCell>
                            <TableCell className="text-xs">{formatHijriShort(s.date)}</TableCell>
                            <TableCell>{formatMoney(s.totalAfn)}</TableCell>
                            <TableCell>{formatMoney(s.paidAmount)}</TableCell>
                            <TableCell className={s.totalAfn - s.paidAmount - s.returnedAfn > 0.009 ? "text-rose-600" : ""}>
                              {formatMoney(s.totalAfn - s.paidAmount - s.returnedAfn)}
                            </TableCell>
                            <TableCell><StatusBadge status={s.status} /></TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div>
                <p className="mb-2 text-sm font-bold">پرداخت‌ها</p>
                <div className="max-h-56 overflow-y-auto rounded-md border">
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
                      {(statement.payments ?? []).length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                            پرداختی ثبت نشده است
                          </TableCell>
                        </TableRow>
                      ) : (
                        (statement.payments ?? []).map((p) => (
                          <TableRow key={p.id}>
                            <TableCell className="font-mono text-xs">{p.number}</TableCell>
                            <TableCell className="text-xs">{formatHijriShort(p.date)}</TableCell>
                            <TableCell>{formatMoney(p.amount)}</TableCell>
                            <TableCell>{labelOf(PAYMENT_METHODS, p.method)}</TableCell>
                            <TableCell><StatusBadge status={p.status} /></TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div>
                <p className="mb-2 text-sm font-bold">برگشتی‌ها</p>
                <div className="max-h-56 overflow-y-auto rounded-md border">
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
                      {(statement.returns ?? []).length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="h-20 text-center text-muted-foreground">
                            برگشتی ثبت نشده است
                          </TableCell>
                        </TableRow>
                      ) : (
                        (statement.returns ?? []).map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="font-mono text-xs">{r.number}</TableCell>
                            <TableCell className="text-xs">{formatHijriShort(r.date)}</TableCell>
                            <TableCell>{formatMoney(r.totalAfn)}</TableCell>
                            <TableCell><StatusBadge status={r.status} /></TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 border-t pt-3">
                <Button variant="outline" onClick={printStatement}>
                  <Printer className="ml-1 h-4 w-4" /> چاپ صورت‌حساب
                </Button>
              </div>
            </div>
          )}
        </FormDialog>

        <ConfirmDialog
          open={!!deactivateTarget}
          onOpenChange={(v) => {
            if (!v) setDeactivateTarget(null);
          }}
          title="غیرفعال‌سازی مشتری"
          message={`آیا از غیرفعال کردن «${deactivateTarget?.name ?? ""}» مطمئن هستید؟ مشتری دارای تراکنش حذف نمی‌شود بلکه غیرفعال می‌گردد.`}
          confirmLabel="غیرفعال‌سازی"
          danger
          onConfirm={() => {
            if (deactivateTarget) doDeactivate(deactivateTarget);
            setDeactivateTarget(null);
          }}
        />

        {/* تأیید حذف گروهی */}
        <ConfirmDialog
          open={bulkDeleteOpen}
          onOpenChange={(v) => {
            if (!v) setBulkDeleteOpen(false);
          }}
          title="حذف گروهی مشتریان"
          message={`حذف گروهی ${selectedIds.length.toLocaleString("en-US")} مورد؟ این عمل قابل بازگشت نیست. مشتریان دارای سابقه فروش/پرداخت، به‌جای حذف غیرفعال می‌شوند.`}
          confirmLabel="حذف"
          danger
          onConfirm={() => void runBulkDelete()}
          submitting={bulkBusy}
        />

        {/* ناحیه چاپ صورت‌حساب */}
        {printing && statement && (
          <div id="print-root" dir="rtl" className="fixed inset-0 z-[9999] overflow-auto bg-white p-6 text-slate-900">
            <div className="border-b-2 border-slate-800 pb-3 text-center">
              <h1 className="text-xl font-black">{settings["company_name"] || "شرکت دارویی"}</h1>
              <p className="mt-1 text-xs">
                {settings["company_address"] ? `${settings["company_address"]} — ` : ""}
                {settings["company_phone"] ? `تلفن: ${settings["company_phone"]}` : ""}
              </p>
              <p className="mt-2 text-base font-bold">صورت‌حساب مشتری</p>
            </div>
            <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs">
              <div>
                <p><b>مشتری:</b> {statement.customer.name}</p>
                <p><b>نوع:</b> {labelOf(CUSTOMER_TYPES, statement.customer.type)}</p>
                {statement.customer.phone && <p><b>تلفن:</b> {statement.customer.phone}</p>}
              </div>
              <div className="text-left">
                <p><b>تاریخ چاپ:</b> {formatHijriDate(new Date())}</p>
                <p>
                  <b>توازن فعلی:</b>{" "}
                  {formatMoney(statement.customer.balance)}
                </p>
              </div>
            </div>

            <p className="mt-4 text-sm font-bold">فروش‌ها</p>
            <table className="mt-1 w-full border-collapse text-xs">
              <thead>
                <tr className="border border-slate-400 bg-slate-100 text-center">
                  <th className="border border-slate-300 p-1.5">شماره</th>
                  <th className="border border-slate-300 p-1.5">تاریخ</th>
                  <th className="border border-slate-300 p-1.5">مجموع</th>
                  <th className="border border-slate-300 p-1.5">پرداخت</th>
                  <th className="border border-slate-300 p-1.5">باقی‌مانده</th>
                  <th className="border border-slate-300 p-1.5">وضعیت</th>
                </tr>
              </thead>
              <tbody>
                {(statement.sales ?? []).map((s) => (
                  <tr key={s.id} className="text-center">
                    <td className="border border-slate-300 p-1.5">{s.number}</td>
                    <td className="border border-slate-300 p-1.5">{formatHijriShort(s.date)}</td>
                    <td className="border border-slate-300 p-1.5">{formatMoney(s.totalAfn, undefined, { withCurrency: false })}</td>
                    <td className="border border-slate-300 p-1.5">{formatMoney(s.paidAmount, undefined, { withCurrency: false })}</td>
                    <td className="border border-slate-300 p-1.5">{formatMoney(s.totalAfn - s.paidAmount - s.returnedAfn, undefined, { withCurrency: false })}</td>
                    <td className="border border-slate-300 p-1.5">{s.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className="mt-4 text-sm font-bold">پرداخت‌ها</p>
            <table className="mt-1 w-full border-collapse text-xs">
              <thead>
                <tr className="border border-slate-400 bg-slate-100 text-center">
                  <th className="border border-slate-300 p-1.5">شماره رسید</th>
                  <th className="border border-slate-300 p-1.5">تاریخ</th>
                  <th className="border border-slate-300 p-1.5">مبلغ</th>
                  <th className="border border-slate-300 p-1.5">روش</th>
                </tr>
              </thead>
              <tbody>
                {(statement.payments ?? []).map((p) => (
                  <tr key={p.id} className="text-center">
                    <td className="border border-slate-300 p-1.5">{p.number}</td>
                    <td className="border border-slate-300 p-1.5">{formatHijriShort(p.date)}</td>
                    <td className="border border-slate-300 p-1.5">{formatMoney(p.amount, undefined, { withCurrency: false })}</td>
                    <td className="border border-slate-300 p-1.5">{labelOf(PAYMENT_METHODS, p.method)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className="mt-4 text-sm font-bold">برگشتی‌ها</p>
            <table className="mt-1 w-full border-collapse text-xs">
              <thead>
                <tr className="border border-slate-400 bg-slate-100 text-center">
                  <th className="border border-slate-300 p-1.5">شماره</th>
                  <th className="border border-slate-300 p-1.5">تاریخ</th>
                  <th className="border border-slate-300 p-1.5">مبلغ</th>
                  <th className="border border-slate-300 p-1.5">وضعیت</th>
                </tr>
              </thead>
              <tbody>
                {(statement.returns ?? []).map((r) => (
                  <tr key={r.id} className="text-center">
                    <td className="border border-slate-300 p-1.5">{r.number}</td>
                    <td className="border border-slate-300 p-1.5">{formatHijriShort(r.date)}</td>
                    <td className="border border-slate-300 p-1.5">{formatMoney(r.totalAfn, undefined, { withCurrency: false })}</td>
                    <td className="border border-slate-300 p-1.5">{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-5 flex justify-between border-t border-dashed border-slate-400 pt-3 text-[10px] text-slate-600">
              <span>{settings["invoice_footer_note"] ?? ""}</span>
              <span>امضاء: ....................</span>
            </div>
          </div>
        )}
      </div>
    </PermissionGate>
  );
}
