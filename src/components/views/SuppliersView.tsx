"use client";

/**
 * ویوی تأمین‌کنندگان — لیست سراسری، ایجاد/ویرایش و غیرفعال‌سازی
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, UserRoundX } from "lucide-react";

import { PermissionGate, useUser } from "@/components/shared/use-user";
import { PageHeader, StatCard, BADGE_TONES } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { ConfirmDialog, FormDialog } from "@/components/shared/form-dialog";
import { apiSend, useApiData, type QueuedResult } from "@/lib/client-api";
import { runBulkOperation, bulkResultMessage } from "@/lib/bulk";
import { formatMoney, formatNumber } from "@/lib/format";
import { SUPPLIER_TYPES, labelOf } from "@/lib/terminology";
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
import { Textarea } from "@/components/ui/textarea";

// ─────────────────────── انواع ───────────────────────

type SupplierRow = {
  id: string;
  name: string;
  type: string;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  contactPerson?: string | null;
  balance: number;
  isActive: boolean;
};

type SupplierForm = {
  name: string;
  type: string;
  country: string;
  phone: string;
  email: string;
  address: string;
  contactPerson: string;
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

// ─────────────────────── ویو اصلی ───────────────────────

export default function SuppliersView() {
  const { hasPermission } = useUser();

  const [typeFilter, setTypeFilter] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<SupplierRow | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // انتخاب گروهی
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const { data, loading, refetch } = useApiData<{ items: SupplierRow[] }>(
    nz(typeFilter) ? `/api/suppliers?type=${nz(typeFilter)}` : "/api/suppliers"
  );
  const rows = useMemo(() => data?.items ?? [], [data]);

  const stats = useMemo(() => {
    const payables = rows.reduce((s, r) => s + (r.balance > 0 ? r.balance : 0), 0);
    const inactive = rows.filter((r) => !r.isActive).length;
    return { payables, inactive };
  }, [rows]);

  // پاک‌سازی انتخاب‌ها اگر ردیف‌ها حذف/فیلتر شده باشند
  useEffect(() => {
    if (selectedIds.length === 0) return;
    const existing = new Set(rows.map((r) => r.id));
    const next = selectedIds.filter((id) => existing.has(id));
    if (next.length !== selectedIds.length) setSelectedIds(next);
  }, [rows, selectedIds]);

  const [form, setForm] = useState<SupplierForm>({
    name: "",
    type: "LOCAL",
    country: "",
    phone: "",
    email: "",
    address: "",
    contactPerson: "",
    isActive: true,
  });

  const openCreate = () => {
    setForm({
      name: "",
      type: "LOCAL",
      country: "",
      phone: "",
      email: "",
      address: "",
      contactPerson: "",
      isActive: true,
    });
    setEditingId(null);
    setDialogOpen(true);
  };

  const openEdit = (row: SupplierRow) => {
    setForm({
      name: row.name,
      type: row.type,
      country: row.country ?? "",
      phone: row.phone ?? "",
      email: row.email ?? "",
      address: row.address ?? "",
      contactPerson: row.contactPerson ?? "",
      isActive: row.isActive,
    });
    setEditingId(row.id);
    setDialogOpen(true);
  };

  const submitForm = async () => {
    if (!form.name.trim()) return toast.error("نام تأمین‌کننده را وارد کنید");
    if (form.type === "FOREIGN" && !form.country.trim()) {
      return toast.error("برای تأمین‌کننده خارجی، کشور را وارد کنید");
    }
    const body = {
      name: form.name.trim(),
      type: form.type,
      country: form.country.trim() || undefined,
      phone: form.phone.trim() || undefined,
      email: form.email.trim() || undefined,
      address: form.address.trim() || undefined,
      contactPerson: form.contactPerson.trim() || undefined,
      ...(editingId ? { isActive: form.isActive } : {}),
    };
    setSubmitting(true);
    try {
      const res = editingId
        ? await apiSend(`/api/suppliers/${editingId}`, { method: "PUT", body })
        : await apiSend("/api/suppliers", { method: "POST", body });
      if (isQueued(res)) {
        toast.info("به‌صورت آفلاین ذخیره شد؛ پس از اتصال همگام می‌شود");
        setDialogOpen(false);
        return;
      }
      toast.success(editingId ? "تأمین‌کننده ویرایش شد" : "تأمین‌کننده ثبت شد");
      setDialogOpen(false);
      refetch();
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  const doDeactivate = async (row: SupplierRow) => {
    try {
      await apiSend(`/api/suppliers/${row.id}`, { method: "DELETE" });
      toast.success("تأمین‌کننده غیرفعال شد");
      refetch();
    } catch (e) {
      toast.error(errMessage(e));
    }
  };

  /** حذف گروهی تأمین‌کنندگان انتخاب‌شده — بازاستفاده از endpoint تک‌رکورد DELETE */
  const runBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    setBulkBusy(true);
    try {
      const result = await runBulkOperation(selectedIds, (id) =>
        apiSend(`/api/suppliers/${id}`, { method: "DELETE" }),
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

  const columns: Column<SupplierRow>[] = [
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
    { key: "type", header: "نوع", render: (r) => labelOf(SUPPLIER_TYPES, r.type) },
    { key: "country", header: "کشور", render: (r) => r.country ?? "—" },
    { key: "phone", header: "تلفن", render: (r) => r.phone ?? "—" },
    { key: "contactPerson", header: "شخص تماس", render: (r) => r.contactPerson ?? "—" },
    {
      key: "balance",
      header: "توازن (بدهی ما)",
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
          <Button variant="ghost" size="icon" className="h-8 w-8" title="ویرایش" onClick={() => openEdit(r)}>
            <Pencil className="h-4 w-4" />
          </Button>
          {r.isActive && (
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
    <PermissionGate permission="suppliers.view">
      <div className="space-y-4">
        <PageHeader
          title="تأمین‌کنندگان"
          description="مدیریت تأمین‌کنندگان داخلی و خارجی (سراسری)"
          actions={
            <PermissionGate permission="suppliers.create">
              <Button onClick={openCreate} className="bg-primary hover:bg-primary/90">
                <Plus className="ml-1 h-4 w-4" /> تأمین‌کننده جدید
              </Button>
            </PermissionGate>
          }
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard label="تعداد تأمین‌کنندگان" value={formatNumber(rows.length)} tone="emerald" />
          <StatCard label="بدهی ما به تأمین‌کنندگان" value={formatMoney(stats.payables)} tone="rose" />
          <StatCard label="غیرفعال" value={formatNumber(stats.inactive)} tone="slate" />
        </div>

        <Card>
          <CardContent className="p-4">
            <DataTable
              columns={columns}
              rows={rows}
              searchKeys={["name", "country", "phone", "contactPerson"]}
              searchPlaceholder="جستجوی نام یا کشور..."
              loading={loading}
              emptyText="تأمین‌کننده ثبت نشده است"
              rowKey={(r) => r.id}
              selectable
              getRowId={(r) => String(r.id)}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              bulkActions={
                hasPermission("suppliers.delete") ? (
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
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="h-9 w-[150px]">
                    <SelectValue placeholder="همه انواع" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">همه انواع</SelectItem>
                    <SelectItem value="LOCAL">داخلی</SelectItem>
                    <SelectItem value="FOREIGN">خارجی</SelectItem>
                  </SelectContent>
                </Select>
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
          title={editingId ? "ویرایش تأمین‌کننده" : "ثبت تأمین‌کننده جدید"}
          onSubmit={submitForm}
          submitting={submitting}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>نام تأمین‌کننده *</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>نوع *</Label>
              <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOCAL">داخلی</SelectItem>
                  <SelectItem value="FOREIGN">خارجی</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>کشور {form.type === "FOREIGN" ? "*" : ""}</Label>
              <Input
                value={form.country}
                onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
                placeholder={form.type === "FOREIGN" ? "مثلا: پاکستان، ایران..." : "اختیاری"}
              />
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
              <Label>ایمیل</Label>
              <Input
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                dir="ltr"
                type="email"
              />
            </div>
            <div className="space-y-1.5">
              <Label>شخص تماس</Label>
              <Input
                value={form.contactPerson}
                onChange={(e) => setForm((f) => ({ ...f, contactPerson: e.target.value }))}
              />
            </div>
            {editingId && (
              <div className="flex items-center justify-between rounded-md border p-3 sm:col-span-2">
                <Label htmlFor="sup-active" className="font-normal">تأمین‌کننده فعال باشد</Label>
                <Switch
                  id="sup-active"
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

        <ConfirmDialog
          open={!!deactivateTarget}
          onOpenChange={(v) => {
            if (!v) setDeactivateTarget(null);
          }}
          title="غیرفعال‌سازی تأمین‌کننده"
          message={`آیا از غیرفعال کردن «${deactivateTarget?.name ?? ""}» مطمئن هستید؟ تأمین‌کننده دارای خرید حذف نمی‌شود بلکه غیرفعال می‌گردد.`}
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
          title="حذف گروهی تأمین‌کنندگان"
          message={`حذف گروهی ${selectedIds.length.toLocaleString("en-US")} مورد؟ این عمل قابل بازگشت نیست. تأمین‌کنندگان دارای خرید، حذف نمی‌شوند بلکه غیرفعال می‌گردند.`}
          confirmLabel="حذف"
          danger
          onConfirm={() => void runBulkDelete()}
          submitting={bulkBusy}
        />

      </div>
    </PermissionGate>
  );
}
