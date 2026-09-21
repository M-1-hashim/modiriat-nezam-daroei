"use client";

/**
 * ویوی برگشتی‌ها — برگشتی فروش و برگشتی خرید (لیست، ایجاد، تصویب/لغو)
 * دیالوگ‌های SalesReturnDialog و PurchaseReturnDialog از SalesView/PurchasesView هم استفاده می‌شوند.
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Ban, CheckCircle2, Plus, RotateCcw } from "lucide-react";

import { PermissionGate, useUser } from "@/components/shared/use-user";
import { PageHeader, StatusBadge } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { ConfirmDialog, FormDialog } from "@/components/shared/form-dialog";
import { apiSend, useApiData, type QueuedResult } from "@/lib/client-api";
import { runBulkOperation, bulkResultMessage } from "@/lib/bulk";
import { formatHijriShort, formatMoney, formatNumber } from "@/lib/format";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

// ─────────────────────── انواع ───────────────────────

type Ref = { id: string; name: string };

type ReturnRow = {
  id: string;
  number: string;
  date: string;
  totalAfn: number;
  status: string;
  reason?: string | null;
  sale?: { id: string; number: string } | null;
  purchase?: { id: string; number: string } | null;
  customer?: Ref | null;
  supplier?: Ref | null;
  branch?: Ref | null;
};

type DocOptionRow = {
  id: string;
  number: string;
  status: string;
  date: string;
  customer?: Ref | null;
  supplier?: Ref | null;
};

type DocItemRow = {
  id: string;
  quantity: number;
  freeQuantity?: number;
  product?: { id: string; name: string } | null;
  batch?: { batchNumber: string } | null;
};

type DocDetail = {
  id: string;
  number: string;
  items?: DocItemRow[];
  returns?: {
    id: string;
    status: string;
    items?: { saleItemId?: string; purchaseItemId?: string; quantity: number }[];
  }[];
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

// ─────────────────────── لیست برگشتی‌ها ───────────────────────

function ReturnsList({ type }: { type: "SALES" | "PURCHASE" }) {
  const { hasPermission } = useUser();
  const [statusFilter, setStatusFilter] = useState("");

  const qs = useMemo(() => {
    const p = new URLSearchParams({ type, limit: "200" });
    if (statusFilter) p.set("status", statusFilter);
    return p.toString();
  }, [type, statusFilter]);

  // توجه: API آرایه‌های جداگانه برمی‌گرداند: { salesReturns, purchaseReturns }
  const { data, loading, refetch } = useApiData<{
    items?: ReturnRow[];
    salesReturns?: ReturnRow[];
    purchaseReturns?: ReturnRow[];
  }>(`/api/returns?${qs}`, [qs]);
  const rows = useMemo(
    () =>
      (type === "SALES" ? data?.salesReturns : data?.purchaseReturns) ??
      data?.items ??
      [],
    [data, type]
  );

  const [busyId, setBusyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // انتخاب گروهی — تصویب گروهی برگشتی‌های درخواست‌شده
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkApproveOpen, setBulkApproveOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<ReturnRow | null>(null);
  const canApproveBulk = hasPermission("returns.approve");
  const bulkApproveTargets = useMemo(
    () => selectedIds.filter((id) => rows.some((r) => r.id === id && r.status === "REQUESTED")),
    [selectedIds, rows]
  );

  const doBulkApprove = async () => {
    setBulkBusy(true);
    try {
      const result = await runBulkOperation(bulkApproveTargets, (id) =>
        apiSend(`/api/returns/${type}/${id}/approve`, { method: "POST" })
      );
      const msg = bulkResultMessage("تصویب گروهی برگشتی‌ها", result);
      if (msg.tone === "success") toast.success(msg.message);
      else if (msg.tone === "warning") toast.warning(msg.message);
      else toast.error(msg.message);
      setSelectedIds([]);
      refetch();
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setBulkBusy(false);
      setBulkApproveOpen(false);
    }
  };

  const doApprove = async (id: string) => {
    setBusyId(id);
    try {
      const res = await apiSend(`/api/returns/${type}/${id}/approve`, { method: "POST" });
      if (isQueued(res)) {
        toast.info("درخواست تصویب به‌صورت آفلاین ذخیره شد؛ پس از اتصال همگام می‌شود");
      } else {
        toast.success("برگشتی تصویب شد و اثر آن ثبت گردید");
        refetch();
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
      const res = await apiSend(`/api/returns/${type}/${id}/cancel`, { method: "POST" });
      if (isQueued(res)) {
        toast.info("درخواست لغو به‌صورت آفلاین ذخیره شد؛ پس از اتصال همگام می‌شود");
      } else {
        toast.success("برگشتی لغو شد");
        refetch();
      }
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const columns: Column<ReturnRow>[] = [
    { key: "number", header: "شماره", render: (r) => <span className="font-mono text-xs font-semibold">{r.number}</span> },
    {
      key: "origin",
      header: "فاکتور اصل",
      sortable: false,
      render: (r) => r.sale?.number ?? r.purchase?.number ?? "—",
    },
    {
      key: "party",
      header: "طرف حساب",
      sortable: false,
      render: (r) => r.customer?.name ?? r.supplier?.name ?? "—",
    },
    {
      key: "totalAfn",
      header: "مبلغ",
      render: (r) => <span className="font-semibold">{formatMoney(r.totalAfn)}</span>,
    },
    { key: "date", header: "تاریخ", render: (r) => formatHijriShort(r.date) },
    {
      key: "reason",
      header: "دلیل",
      render: (r) => <span className="line-clamp-1 max-w-48 text-xs">{r.reason ?? "—"}</span>,
    },
    { key: "status", header: "وضعیت", render: (r) => <StatusBadge status={r.status} /> },
    {
      key: "actions",
      header: "عملیات",
      sortable: false,
      render: (r) => (
        <div className="flex items-center gap-1">
          {r.status === "REQUESTED" && hasPermission("returns.approve") && (
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
          {r.status === "REQUESTED" && (
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
          )}
        </div>
      ),
    },
  ];

  return (
    <Card>
      <CardContent className="p-4">
        <DataTable
          columns={columns}
          rows={rows}
          searchKeys={["number", "sale.number", "purchase.number", "customer.name", "supplier.name"]}
          searchPlaceholder="جستجو..."
          loading={loading}
          emptyText="برگشتی ثبت نشده است"
          rowKey={(r) => r.id}
          selectable={canApproveBulk}
          getRowId={(r) => r.id}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          bulkActions={
            canApproveBulk && bulkApproveTargets.length > 0 ? (
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
                  <SelectItem value="REQUESTED">درخواست شده</SelectItem>
                  <SelectItem value="APPROVED">تأیید شده</SelectItem>
                  <SelectItem value="CANCELLED">لغو شده</SelectItem>
                </SelectContent>
              </Select>
              {hasPermission("returns.create") && (
                <Button
                  size="sm"
                  className="bg-primary hover:bg-primary/90"
                  onClick={() => setCreateOpen(true)}
                >
                  <Plus className="ml-1 h-4 w-4" />
                  {type === "SALES" ? "ثبت برگشتی فروش" : "ثبت برگشتی خرید"}
                </Button>
              )}
            </>
          }
        />
      </CardContent>

      {type === "SALES" ? (
        <SalesReturnDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onSaved={refetch}
        />
      ) : (
        <PurchaseReturnDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onSaved={refetch}
        />
      )}

      <ConfirmDialog
        open={cancelTarget !== null}
        onOpenChange={(o) => {
          if (!o) setCancelTarget(null);
        }}
        title={`لغو برگشتی ${cancelTarget?.number ?? ""}`}
        message="آیا از لغو این برگشتی مطمئن هستید؟ اسناد لغوشده در محاسبات و موجودی لحاظ نمی‌شوند."
        confirmLabel="لغو برگشتی"
        danger
        submitting={busyId !== null}
        onConfirm={() => cancelTarget && void doCancel(cancelTarget.id)}
      />

      <ConfirmDialog
        open={bulkApproveOpen}
        onOpenChange={(v) => {
          if (!v) setBulkApproveOpen(false);
        }}
        title={`تصویب گروهی ${bulkApproveTargets.length.toLocaleString("en-US")} برگشتی`}
        message={`آیا از تصویب گروهی ${bulkApproveTargets.length.toLocaleString("en-US")} برگشتی درخواست‌شده مطمئن هستید؟ با تصویب، موجودی گدام و توازن حساب‌ها به‌روزرسانی می‌شود.`}
        confirmLabel="تصویب گروهی"
        submitting={bulkBusy}
        onConfirm={() => void doBulkApprove()}
      />
    </Card>
  );
}

// ─────────────────────── ویو اصلی ───────────────────────

export default function ReturnsView() {
  return (
    <PermissionGate permission="returns.view">
      <div className="space-y-4">
        <PageHeader
          title="برگشتی‌ها"
          description="ثبت و مدیریت برگشتی فروش به گدام و برگشت اجناس به تأمین‌کننده"
        />
        <Tabs defaultValue="SALES">
          <TabsList>
            <TabsTrigger value="SALES" className="gap-1.5">
              <RotateCcw className="h-4 w-4" /> برگشتی فروش
            </TabsTrigger>
            <TabsTrigger value="PURCHASE" className="gap-1.5">
              <Ban className="h-4 w-4" /> برگشتی خرید
            </TabsTrigger>
          </TabsList>
          <TabsContent value="SALES" className="mt-3">
            <ReturnsList type="SALES" />
          </TabsContent>
          <TabsContent value="PURCHASE" className="mt-3">
            <ReturnsList type="PURCHASE" />
          </TabsContent>
        </Tabs>
      </div>
    </PermissionGate>
  );
}

// ─────────────────────── دیالوگ برگشتی فروش ───────────────────────

export function SalesReturnDialog({
  open,
  onOpenChange,
  presetSaleId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  presetSaleId?: string | null;
  onSaved?: () => void;
}) {
  const [saleId, setSaleId] = useState("");
  const [reason, setReason] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setSaleId(presetSaleId ?? "");
      setReason("");
      setQty({});
    }
  }, [open, presetSaleId]);

  const { data: salesData, loading: salesLoading } = useApiData<unknown>(
    open && !presetSaleId ? "/api/sales?limit=100" : null
  );
  const sales = useMemo(
    () =>
      asList<DocOptionRow>(salesData).filter((s) => s.status === "APPROVED" || s.status === "COMPLETED"),
    [salesData]
  );

  const { data: detail, loading: detailLoading } = useApiData<DocDetail>(open && saleId ? `/api/sales/${saleId}` : null);

  const returnedMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of detail?.returns ?? []) {
      if (r.status === "CANCELLED") continue;
      for (const it of r.items ?? []) {
        const key = String(it.saleItemId ?? "");
        if (key) map[key] = (map[key] ?? 0) + Number(it.quantity ?? 0);
      }
    }
    return map;
  }, [detail]);

  const submit = async () => {
    const rows = (detail?.items ?? [])
      .map((it) => ({ saleItemId: it.id, quantity: Number(qty[it.id]) || 0 }))
      .filter((r) => r.quantity > 0);
    if (rows.length === 0) return toast.error("مقدار برگشتی حداقل برای یک قلم وارد کنید");
    for (const r of rows) {
      const it = (detail?.items ?? []).find((x) => x.id === r.saleItemId);
      const max = (it?.quantity ?? 0) - (returnedMap[String(r.saleItemId)] ?? 0);
      if (r.quantity > max) {
        return toast.error(`مقدار برگشتی از مقدار فروخته‌شده بیشتر است (حداکثر: ${formatNumber(max)})`);
      }
    }
    setSubmitting(true);
    try {
      const res = await apiSend("/api/returns/sales", {
        method: "POST",
        body: { saleId, reason: reason.trim() || undefined, items: rows },
      });
      if (isQueued(res)) {
        toast.info("به‌صورت آفلاین ذخیره شد؛ پس از اتصال همگام می‌شود");
      } else {
        toast.success("درخواست برگشتی فروش ثبت شد");
      }
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="ثبت برگشتی فروش"
      description="فاکتور فروش را انتخاب و مقدار برگشتی هر قلم را وارد کنید. پس از تصویب، اجناس به گدام برمی‌گردد."
      wide
      onSubmit={submit}
      submitting={submitting}
      submitLabel="ثبت درخواست برگشتی"
    >
      <div className="space-y-3">
        {!presetSaleId && (
          <div className="space-y-1.5">
            <Label>فاکتور فروش *</Label>
            <Select value={saleId} onValueChange={setSaleId}>
              <SelectTrigger>
                <SelectValue placeholder="انتخاب فاکتور" />
              </SelectTrigger>
              <SelectContent>
                {salesLoading && <SelectItem value="loading" disabled>در حال بارگذاری...</SelectItem>}
                {sales.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.number} — {s.customer?.name ?? "—"} — {formatHijriShort(s.date)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {!saleId && (
          <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
            برای نمایش اقلام، فاکتور را انتخاب کنید
          </p>
        )}

        {saleId && detailLoading && (
          <p className="py-4 text-center text-sm text-muted-foreground">در حال بارگذاری اقلام فاکتور...</p>
        )}

        {saleId && detail && (
          <>
            <div className="space-y-2">
              {(detail.items ?? []).map((it) => {
                const returned = returnedMap[it.id] ?? 0;
                const max = Math.max(0, it.quantity - returned);
                return (
                  <div
                    key={it.id}
                    className="grid grid-cols-1 items-center gap-2 rounded-lg border bg-muted/30 p-3 sm:grid-cols-[1fr_110px_110px]"
                  >
                    <div>
                      <p className="text-sm font-medium">{it.product?.name ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">
                        بچ {it.batch?.batchNumber ?? "—"} — فروخته‌شده: {formatNumber(it.quantity)}
                        {returned > 0 ? ` — برگشته‌شده: ${formatNumber(returned)}` : ""}
                      </p>
                    </div>
                    <div className="text-xs text-muted-foreground sm:text-center">
                      حداکثر قابل برگشت: <b className="text-foreground">{formatNumber(max)}</b>
                    </div>
                    <Input
                      type="number"
                      step="1"
                      min="0"
                      max={max}
                      dir="ltr"
                      value={qty[it.id] ?? ""}
                      onChange={(e) => setQty((m) => ({ ...m, [it.id]: e.target.value }))}
                      placeholder="مقدار"
                      disabled={max <= 0}
                    />
                  </div>
                );
              })}
            </div>
            <div className="space-y-1.5">
              <Label>دلیل برگشتی</Label>
              <Textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="مثلا: تاریخ نزدیک انقضا، خراب packaging..."
              />
            </div>
          </>
        )}
      </div>
    </FormDialog>
  );
}

// ─────────────────────── دیالوگ برگشتی خرید ───────────────────────

export function PurchaseReturnDialog({
  open,
  onOpenChange,
  presetPurchaseId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  presetPurchaseId?: string | null;
  onSaved?: () => void;
}) {
  const [purchaseId, setPurchaseId] = useState("");
  const [reason, setReason] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setPurchaseId(presetPurchaseId ?? "");
      setReason("");
      setQty({});
    }
  }, [open, presetPurchaseId]);

  const { data: purchasesData, loading: purchasesLoading } = useApiData<unknown>(
    open && !presetPurchaseId ? "/api/purchases?limit=100" : null
  );
  const purchases = useMemo(
    () =>
      asList<DocOptionRow>(purchasesData).filter(
        (p) => p.status === "APPROVED" || p.status === "COMPLETED"
      ),
    [purchasesData]
  );

  const { data: detail, loading: detailLoading } = useApiData<DocDetail>(
    open && purchaseId ? `/api/purchases/${purchaseId}` : null
  );

  const returnedMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of detail?.returns ?? []) {
      if (r.status === "CANCELLED") continue;
      for (const it of r.items ?? []) {
        const key = String(it.purchaseItemId ?? "");
        if (key) map[key] = (map[key] ?? 0) + Number(it.quantity ?? 0);
      }
    }
    return map;
  }, [detail]);

  const submit = async () => {
    const rows = (detail?.items ?? [])
      .map((it) => ({ purchaseItemId: it.id, quantity: Number(qty[it.id]) || 0 }))
      .filter((r) => r.quantity > 0);
    if (rows.length === 0) return toast.error("مقدار برگشتی حداقل برای یک قلم وارد کنید");
    for (const r of rows) {
      const it = (detail?.items ?? []).find((x) => x.id === r.purchaseItemId);
      const max = (it?.quantity ?? 0) - (returnedMap[String(r.purchaseItemId)] ?? 0);
      if (r.quantity > max) {
        return toast.error(`مقدار برگشتی از مقدار خریداری‌شده بیشتر است (حداکثر: ${formatNumber(max)})`);
      }
    }
    setSubmitting(true);
    try {
      const res = await apiSend("/api/returns/purchases", {
        method: "POST",
        body: { purchaseId, reason: reason.trim() || undefined, items: rows },
      });
      if (isQueued(res)) {
        toast.info("به‌صورت آفلاین ذخیره شد؛ پس از اتصال همگام می‌شود");
      } else {
        toast.success("درخواست برگشتی خرید ثبت شد");
      }
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="ثبت برگشتی خرید"
      description="فاکتور خرید را انتخاب و مقدار برگشتی هر قلم را وارد کنید. پس از تصویب، اجناس از گدام کم می‌شود."
      wide
      onSubmit={submit}
      submitting={submitting}
      submitLabel="ثبت درخواست برگشتی"
    >
      <div className="space-y-3">
        {!presetPurchaseId && (
          <div className="space-y-1.5">
            <Label>فاکتور خرید *</Label>
            <Select value={purchaseId} onValueChange={setPurchaseId}>
              <SelectTrigger>
                <SelectValue placeholder="انتخاب فاکتور" />
              </SelectTrigger>
              <SelectContent>
                {purchasesLoading && <SelectItem value="loading" disabled>در حال بارگذاری...</SelectItem>}
                {purchases.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.number} — {p.supplier?.name ?? "—"} — {formatHijriShort(p.date)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {!purchaseId && (
          <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
            برای نمایش اقلام، فاکتور را انتخاب کنید
          </p>
        )}

        {purchaseId && detailLoading && (
          <p className="py-4 text-center text-sm text-muted-foreground">در حال بارگذاری اقلام فاکتور...</p>
        )}

        {purchaseId && detail && (
          <>
            <div className="space-y-2">
              {(detail.items ?? []).map((it) => {
                const returned = returnedMap[it.id] ?? 0;
                const max = Math.max(0, it.quantity - returned);
                return (
                  <div
                    key={it.id}
                    className="grid grid-cols-1 items-center gap-2 rounded-lg border bg-muted/30 p-3 sm:grid-cols-[1fr_110px_110px]"
                  >
                    <div>
                      <p className="text-sm font-medium">{it.product?.name ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">
                        بچ {it.batch?.batchNumber ?? "—"} — خریداری‌شده: {formatNumber(it.quantity)}
                        {returned > 0 ? ` — برگشته‌شده: ${formatNumber(returned)}` : ""}
                      </p>
                    </div>
                    <div className="text-xs text-muted-foreground sm:text-center">
                      حداکثر قابل برگشت: <b className="text-foreground">{formatNumber(max)}</b>
                    </div>
                    <Input
                      type="number"
                      step="1"
                      min="0"
                      max={max}
                      dir="ltr"
                      value={qty[it.id] ?? ""}
                      onChange={(e) => setQty((m) => ({ ...m, [it.id]: e.target.value }))}
                      placeholder="مقدار"
                      disabled={max <= 0}
                    />
                  </div>
                );
              })}
            </div>
            <div className="space-y-1.5">
              <Label>دلیل برگشتی</Label>
              <Textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="مثلا: اجناس معیوب، اشتباه در ارسال..."
              />
            </div>
          </>
        )}
      </div>
    </FormDialog>
  );
}

