"use client";

/** ویوی موجودی گدام — فهرست موجودی، انتقال بین گدام‌ها، تعدیل و تاریخچه حرکات */

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeftRight,
  Clock3,
  Coins,
  History,
  Plus,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { PermissionGate, useUser } from "@/components/shared/use-user";
import {
  BADGE_TONES,
  BatchStatusBadge,
  MovementBadge,
  PageHeader,
  StatCard,
} from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FormDialog } from "@/components/shared/form-dialog";
import { apiSend, useApiData } from "@/lib/client-api";
import { formatMoney, formatNumber } from "@/lib/format";
import { formatHijriShort, hijriDayEnd, hijriDayStart, hijriInputToDate, toPersianDigits } from "@/lib/hijri";
import { MOVEMENT_TYPES } from "@/lib/terminology";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

type WarehouseItem = { id: string; name: string; isMain?: boolean | null };
type ProductLite = { id: string; name: string; unit?: string | null; minStock?: number | null };

type StockItemRow = {
  id: string;
  productId?: string | null;
  batchId?: string | null;
  warehouseId?: string | null;
  quantity?: number | null;
  product?: ProductLite | null;
  batch?: {
    id?: string | null;
    batchNumber?: string | null;
    expiryDate?: string | null;
    costPrice?: number | null;
    status?: string | null;
  } | null;
  warehouse?: { id: string; name: string } | null;
};

type MovementRow = {
  id: string;
  createdAt?: string | null;
  type?: string | null;
  quantity?: number | null;
  reason?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  userName?: string | null;
  product?: { name?: string | null } | null;
  batch?: { batchNumber?: string | null } | null;
  fromWarehouse?: { name?: string | null } | null;
  toWarehouse?: { name?: string | null } | null;
};

type TransferLine = { key: string; productId: string; batchId: string; quantity: string };
type AdjustLine = { key: string; productId: string; batchId: string; newQuantity: string };

const POSITIVE_TYPES = new Set(["IN", "RETURN_IN"]);
const NEGATIVE_TYPES = new Set(["OUT", "RETURN_OUT", "DAMAGE", "EXPIRED"]);
const EXPIRY_CHIPS = [30, 60, 90, 180];

const ADJUSTMENT_TYPES: { value: string; label: string }[] = [
  { value: "ADJUSTMENT", label: "تعدیل عادی" },
  { value: "DAMAGE", label: "خسارت" },
  { value: "EXPIRED", label: "خراج منقضی" },
];

const REFERENCE_LABELS: Record<string, string> = {
  PURCHASE: "خرید",
  SALE: "فروش",
  TRANSFER: "انتقال",
  ADJUSTMENT: "تعدیل",
  RETURN: "برگشتی",
  PAYMENT: "پرداخت",
};

function listOf<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)) {
    return (data as { items: T[] }).items;
  }
  return [];
}

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    sp.set(k, v === true ? "1" : String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

function isQueued(res: unknown): res is { queued: true; localId: string } {
  return typeof res === "object" && res !== null && "queued" in res;
}

function lineKey(): string {
  return Math.random().toString(36).slice(2, 10);
}

function rowProductId(r: StockItemRow): string {
  return r.product?.id ?? r.productId ?? "";
}

function rowBatchId(r: StockItemRow): string {
  return r.batch?.id ?? r.batchId ?? "";
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">
        {label}
        {required && <span className="text-rose-600"> *</span>}
      </Label>
      {children}
    </div>
  );
}

function WarehouseSelect({
  value,
  onChange,
  warehouses,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  warehouses: WarehouseItem[];
  placeholder: string;
}) {
  return (
    <Select value={value || "none"} onValueChange={(v) => onChange(v === "none" ? "" : v)}>
      <SelectTrigger className="w-full bg-background">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none" disabled>
          — انتخاب گدام —
        </SelectItem>
        {warehouses.map((w) => (
          <SelectItem key={w.id} value={w.id}>
            {w.name}
            {w.isMain ? " (اصلی)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function InventoryView() {
  const { hasPermission } = useUser();

  // ─── فهرست موجودی ───
  const [whFilter, setWhFilter] = useState("all");
  const [q, setQ] = useState("");
  const [belowMin, setBelowMin] = useState(false);
  const [expDays, setExpDays] = useState<number | null>(null);

  const stockPath = `/api/stock${qs({
    warehouseId: whFilter !== "all" ? whFilter : "",
    q: q.trim(),
    belowMin: belowMin ? 1 : undefined,
    expiringDays: expDays ?? undefined,
  })}`;
  const { data: stockData, loading, error, refetch } = useApiData<unknown>(stockPath);
  const stockItems = listOf<StockItemRow>(stockData);

  const { data: whData } = useApiData<unknown>("/api/warehouses");
  const warehouses = listOf<WarehouseItem>(whData);
  const { data: prodData } = useApiData<unknown>("/api/products?limit=1000");
  const products = listOf<ProductLite>(prodData);

  const stats = useMemo(() => {
    let value = 0;
    let below = 0;
    let expiring = 0;
    for (const it of stockItems) {
      const qty = Number(it.quantity ?? 0);
      value += qty * Number(it.batch?.costPrice ?? 0);
      const min = Number(it.product?.minStock ?? 0);
      if (min > 0 && qty <= min) below++;
      if (it.batch?.status === "EXPIRING_SOON") expiring++;
    }
    return { value, below, expiring };
  }, [stockItems]);

  const columns: Column<StockItemRow>[] = [
    {
      key: "product",
      header: "محصول",
      render: (r) => <span className="font-semibold">{r.product?.name ?? "—"}</span>,
    },
    {
      key: "batch",
      header: "بچ",
      render: (r) => (
        <span dir="ltr" className="font-mono text-xs">
          {r.batch?.batchNumber ?? "—"}
        </span>
      ),
    },
    {
      key: "expiry",
      header: "انقضا",
      render: (r) => (
        <div className="flex flex-col items-start gap-1">
          <span className="whitespace-nowrap">{formatHijriShort(r.batch?.expiryDate)}</span>
          {r.batch?.status && <BatchStatusBadge status={r.batch.status} />}
        </div>
      ),
    },
    { key: "warehouse", header: "گدام", render: (r) => r.warehouse?.name ?? "—" },
    {
      key: "quantity",
      header: "موجودی",
      render: (r) => {
        const qty = Number(r.quantity ?? 0);
        const min = Number(r.product?.minStock ?? 0);
        const low = min > 0 && qty <= min;
        return (
          <span className={low ? "font-bold text-rose-600" : ""}>{formatNumber(qty)}</span>
        );
      },
    },
    {
      key: "minStock",
      header: "حد نصاب",
      render: (r) => formatNumber(r.product?.minStock),
    },
    {
      key: "value",
      header: "ارزش",
      render: (r) => (
        <span className="whitespace-nowrap">
          {formatMoney(Number(r.quantity ?? 0) * Number(r.batch?.costPrice ?? 0))}
        </span>
      ),
    },
  ];

  // ─── انتقال بین گدام‌ها ───
  const [transferOpen, setTransferOpen] = useState(false);
  const [fromWh, setFromWh] = useState("");
  const [toWh, setToWh] = useState("");
  const [transferReason, setTransferReason] = useState("");
  const [transferLines, setTransferLines] = useState<TransferLine[]>([]);
  const [saving, setSaving] = useState(false);

  const { data: fromStockData, loading: fromStockLoading } = useApiData<unknown>(
    transferOpen && fromWh ? `/api/stock?warehouseId=${fromWh}` : null
  );
  const fromStock = listOf<StockItemRow>(fromStockData);

  function openTransfer() {
    setFromWh("");
    setToWh("");
    setTransferReason("");
    setTransferLines([{ key: lineKey(), productId: "", batchId: "", quantity: "" }]);
    setTransferOpen(true);
  }

  function updateTransferLine(key: string, patch: Partial<TransferLine>) {
    setTransferLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function availableBatches(productId: string): { batchId: string; label: string; qty: number }[] {
    if (!productId) return [];
    const out: { batchId: string; label: string; qty: number }[] = [];
    for (const s of fromStock) {
      if (rowProductId(s) !== productId) continue;
      const qty = Number(s.quantity ?? 0);
      if (qty <= 0) continue;
      const bid = rowBatchId(s);
      if (!bid) continue;
      out.push({
        batchId: bid,
        qty,
        label: `${s.batch?.batchNumber ?? "بدون بچ"} (موجودی: ${formatNumber(qty)})`,
      });
    }
    return out;
  }

  function availableQty(productId: string, batchId: string): number {
    return fromStock
      .filter((s) => rowProductId(s) === productId && rowBatchId(s) === batchId)
      .reduce((a, s) => a + Number(s.quantity ?? 0), 0);
  }

  async function submitTransfer() {
    if (!fromWh || !toWh) {
      toast.error("گدام مبدأ و مقصد را انتخاب کنید");
      return;
    }
    if (fromWh === toWh) {
      toast.error("گدام مبدأ و مقصد باید متفاوت باشند");
      return;
    }
    const lines = transferLines
      .filter((l) => l.productId && l.batchId && Number(l.quantity) > 0)
      .map((l) => ({ productId: l.productId, batchId: l.batchId, quantity: Number(l.quantity) }));
    if (lines.length === 0) {
      toast.error("حداقل یک قلم با بچ و مقدار معتبر وارد کنید");
      return;
    }
    for (const l of lines) {
      const avail = availableQty(l.productId, l.batchId);
      if (l.quantity > avail) {
        const prod = products.find((p) => p.id === l.productId);
        toast.error(
          `مقدار انتقال برای «${prod?.name ?? "محصول"}» بیش از موجودی قابل انتقال است (${formatNumber(avail)})`
        );
        return;
      }
    }
    setSaving(true);
    try {
      const res = await apiSend<unknown>("/api/stock/transfers", {
        method: "POST",
        body: { fromWarehouseId: fromWh, toWarehouseId: toWh, reason: transferReason.trim() || null, lines },
      });
      if (isQueued(res)) {
        toast.info("به‌صورت آفلاین ذخیره شد؛ پس از اتصال همگام می‌شود");
        setTransferOpen(false);
      } else {
        toast.success("انتقال موجودی با موفقیت ثبت شد");
        setTransferOpen(false);
        refetch();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ثبت انتقال ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  // ─── تعدیل موجودی ───
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustWh, setAdjustWh] = useState("");
  const [adjustType, setAdjustType] = useState("ADJUSTMENT");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustLines, setAdjustLines] = useState<AdjustLine[]>([]);

  const { data: adjustStockData, loading: adjustStockLoading } = useApiData<unknown>(
    adjustOpen && adjustWh ? `/api/stock?warehouseId=${adjustWh}` : null
  );
  const adjustStock = listOf<StockItemRow>(adjustStockData);

  function openAdjust() {
    setAdjustWh("");
    setAdjustType("ADJUSTMENT");
    setAdjustReason("");
    setAdjustLines([{ key: lineKey(), productId: "", batchId: "", newQuantity: "" }]);
    setAdjustOpen(true);
  }

  function updateAdjustLine(key: string, patch: Partial<AdjustLine>) {
    setAdjustLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function adjustBatches(productId: string): { batchId: string; label: string; qty: number }[] {
    if (!productId) return [];
    const out: { batchId: string; label: string; qty: number }[] = [];
    for (const s of adjustStock) {
      if (rowProductId(s) !== productId) continue;
      const bid = rowBatchId(s);
      if (!bid) continue;
      const qty = Number(s.quantity ?? 0);
      out.push({
        batchId: bid,
        qty,
        label: `${s.batch?.batchNumber ?? "بدون بچ"} (موجودی فعلی: ${formatNumber(qty)})`,
      });
    }
    return out;
  }

  async function submitAdjust() {
    if (!adjustWh) {
      toast.error("گدام را انتخاب کنید");
      return;
    }
    if (!adjustReason.trim()) {
      toast.error("دلیل تعدیل الزامی است");
      return;
    }
    const lines = adjustLines
      .filter((l) => l.productId && l.batchId && l.newQuantity !== "" && Number(l.newQuantity) >= 0)
      .map((l) => ({
        productId: l.productId,
        batchId: l.batchId,
        newQuantity: Number(l.newQuantity),
        reason: adjustReason.trim(),
        type: adjustType,
      }));
    if (lines.length === 0) {
      toast.error("حداقل یک قلم با بچ و مقدار جدید معتبر وارد کنید");
      return;
    }
    setSaving(true);
    try {
      const res = await apiSend<unknown>("/api/stock/adjustments", {
        method: "POST",
        body: { warehouseId: adjustWh, lines },
      });
      if (isQueued(res)) {
        toast.info("به‌صورت آفلاین ذخیره شد؛ پس از اتصال همگام می‌شود");
        setAdjustOpen(false);
      } else {
        toast.success("تعدیل موجودی با موفقیت ثبت شد");
        setAdjustOpen(false);
        refetch();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ثبت تعدیل ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  // ─── تاریخچه حرکات ───
  const [mvType, setMvType] = useState("all");
  const [mvWh, setMvWh] = useState("all");
  const [mvProduct, setMvProduct] = useState("all");
  const [mvFrom, setMvFrom] = useState("");
  const [mvTo, setMvTo] = useState("");

  const mvFromParsed = mvFrom.trim() ? hijriInputToDate(mvFrom.trim()) : null;
  const mvToParsed = mvTo.trim() ? hijriInputToDate(mvTo.trim()) : null;
  const mvInvalid =
    (mvFrom.trim() !== "" && !mvFromParsed) || (mvTo.trim() !== "" && !mvToParsed);

  const mvPath = `/api/stock/movements${qs({
    type: mvType !== "all" ? mvType : "",
    warehouseId: mvWh !== "all" ? mvWh : "",
    productId: mvProduct !== "all" ? mvProduct : "",
    from: mvFromParsed ? hijriDayStart(mvFromParsed).toISOString() : "",
    to: mvToParsed ? hijriDayEnd(mvToParsed).toISOString() : "",
  })}`;
  const { data: mvData, loading: mvLoading, error: mvError, refetch: mvRefetch } =
    useApiData<unknown>(mvPath);
  const movements = listOf<MovementRow>(mvData);

  const mvColumns: Column<MovementRow>[] = [
    {
      key: "createdAt",
      header: "تاریخ",
      render: (m) => (
        <span className="whitespace-nowrap text-xs">{formatHijriShort(m.createdAt)}</span>
      ),
    },
    {
      key: "product",
      header: "محصول",
      render: (m) => <span className="font-semibold">{m.product?.name ?? "—"}</span>,
    },
    {
      key: "batch",
      header: "بچ",
      render: (m) => (
        <span dir="ltr" className="font-mono text-xs">
          {m.batch?.batchNumber ?? "—"}
        </span>
      ),
    },
    { key: "type", header: "نوع", render: (m) => <MovementBadge type={m.type} /> },
    {
      key: "quantity",
      header: "مقدار",
      render: (m) => {
        const qv = Number(m.quantity ?? 0);
        const sign = m.type && POSITIVE_TYPES.has(m.type) ? "+" : m.type && NEGATIVE_TYPES.has(m.type) ? "−" : "";
        return (
          <span
            className={
              sign === "+"
                ? "font-bold text-brand-soft-foreground dark:text-brand-soft-foreground"
                : sign === "−"
                  ? "font-bold text-rose-600 dark:text-rose-400"
                  : "font-bold"
            }
          >
            {sign}
            {formatNumber(qv)}
          </span>
        );
      },
    },
    { key: "from", header: "از گدام", render: (m) => m.fromWarehouse?.name ?? "—" },
    { key: "to", header: "به گدام", render: (m) => m.toWarehouse?.name ?? "—" },
    { key: "reason", header: "دلیل", render: (m) => m.reason ?? "—" },
    {
      key: "reference",
      header: "مرجع",
      render: (m) => {
        if (!m.referenceType) return "—";
        const label = REFERENCE_LABELS[m.referenceType] ?? m.referenceType;
        const short = m.referenceId ? ` …${m.referenceId.slice(-6)}` : "";
        return (
          <span dir="ltr" className="text-right font-mono text-xs">
            {label}
            {short}
          </span>
        );
      },
    },
    { key: "userName", header: "کاربر", render: (m) => m.userName ?? "—" },
  ];

  return (
    <PermissionGate permission="inventory.view">
      <div className="space-y-4">
        <PageHeader
          title="موجودی گدام"
          description="موجودی لحظه‌ای هر بچ در گدام‌ها، ارزش موجودی و حرکات انبار"
        />

        {error && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={refetch}>
              تلاش مجدد
            </Button>
          </div>
        )}

        <Card className="border shadow-sm">
          <CardContent className="flex flex-col gap-3 p-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="گدام">
                <Select value={whFilter} onValueChange={setWhFilter}>
                  <SelectTrigger className="w-full bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">همه گدام‌ها</SelectItem>
                    {warehouses.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="جستجو">
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="نام محصول یا شماره بچ..."
                />
              </Field>
              <div className="flex flex-col justify-center gap-2">
                <div className="flex items-center gap-2">
                  <Switch id="inv-below-min" checked={belowMin} onCheckedChange={setBelowMin} />
                  <Label htmlFor="inv-below-min" className="text-sm font-normal">
                    فقط زیر حد نصاب
                  </Label>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">انقضا:</span>
                  {EXPIRY_CHIPS.map((d) => (
                    <Button
                      key={d}
                      size="sm"
                      variant={expDays === d ? "default" : "outline"}
                      className={
                        expDays === d
                          ? "h-7 bg-primary px-2.5 text-white hover:bg-primary/90"
                          : "h-7 px-2.5"
                      }
                      onClick={() => setExpDays((cur) => (cur === d ? null : d))}
                    >
                      {toPersianDigits(d)} روز
                    </Button>
                  ))}
                </div>
              </div>
            </div>
            {hasPermission("inventory.edit") && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={openTransfer}>
                  <ArrowLeftRight className="h-4 w-4" /> انتقال بین گدام‌ها
                </Button>
                <Button variant="outline" onClick={openAdjust}>
                  <SlidersHorizontal className="h-4 w-4" /> تعدیل موجودی
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard
            label="ارزش موجودی"
            value={formatMoney(stats.value)}
            sub="طبق فیلتر فعلی"
            icon={Coins}
            tone="emerald"
          />
          <StatCard
            label="اقلام زیر نصاب"
            value={formatNumber(stats.below)}
            sub="نیازمند سفارش"
            icon={TriangleAlert}
            tone="rose"
          />
          <StatCard
            label="نزدیک انقضا"
            value={formatNumber(stats.expiring)}
            sub="بچ‌های در معرض خطر"
            icon={Clock3}
            tone="amber"
          />
        </div>

        <Card className="border shadow-sm">
          <CardContent className="p-4">
            <DataTable
              columns={columns}
              rows={stockItems}
              loading={loading}
              searchKeys={["product.name", "batch.batchNumber", "warehouse.name"]}
              searchPlaceholder="جستجو در نتایج..."
              emptyText="موجودی ثبت نشده است"
              rowKey={(r) => r.id}
            />
          </CardContent>
        </Card>

        {/* تاریخچه حرکات */}
        <Card className="border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4" /> تاریخچه حرکات موجودی
            </CardTitle>
            <CardDescription>
              ورود، خروج، انتقال، برگشت و تعدیل‌های ثبت‌شده روی موجودی
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
              <Field label="نوع حرکت">
                <Select value={mvType} onValueChange={setMvType}>
                  <SelectTrigger className="w-full bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">همه انواع</SelectItem>
                    {Object.entries(MOVEMENT_TYPES).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="گدام">
                <Select value={mvWh} onValueChange={setMvWh}>
                  <SelectTrigger className="w-full bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">همه گدام‌ها</SelectItem>
                    {warehouses.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="محصول">
                <Select value={mvProduct} onValueChange={setMvProduct}>
                  <SelectTrigger className="w-full bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">همه محصولات</SelectItem>
                    {products.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="از تاریخ">
                <Input
                  dir="ltr"
                  value={mvFrom}
                  onChange={(e) => setMvFrom(e.target.value)}
                  placeholder="۱۴۰۴/۰۵/۰۱"
                />
              </Field>
              <Field label="تا تاریخ">
                <Input
                  dir="ltr"
                  value={mvTo}
                  onChange={(e) => setMvTo(e.target.value)}
                  placeholder="۱۴۰۴/۰۵/۳۰"
                />
              </Field>
            </div>
            {mvInvalid && (
              <p className="text-xs text-rose-600">
                قالب تاریخ هجری صحیح نیست — نمونه صحیح: ۱۴۰۴/۰۵/۰۱
              </p>
            )}
            {mvError && (
              <div className="flex items-center justify-between gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300">
                <span>{mvError}</span>
                <Button variant="outline" size="sm" onClick={mvRefetch}>
                  تلاش مجدد
                </Button>
              </div>
            )}
            <DataTable
              columns={mvColumns}
              rows={movements}
              loading={mvLoading}
              searchKeys={["product.name", "batch.batchNumber", "userName", "reason"]}
              searchPlaceholder="جستجو در حرکات..."
              emptyText="حرکتی ثبت نشده است"
              rowKey={(m) => m.id}
            />
          </CardContent>
        </Card>

        {/* دیالوگ انتقال بین گدام‌ها */}
        <FormDialog
          open={transferOpen}
          onOpenChange={(o) => {
            if (!o) setTransferOpen(false);
          }}
          title="انتقال بین گدام‌ها"
          description="انتقال موجودی بچ‌ها از یک گدام به گدام دیگر در همان شعبه"
          wide
          onSubmit={submitTransfer}
          submitting={saving}
          submitLabel="ثبت انتقال"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="گدام مبدأ" required>
                <WarehouseSelect
                  value={fromWh}
                  onChange={setFromWh}
                  warehouses={warehouses}
                  placeholder="انتخاب گدام مبدأ"
                />
              </Field>
              <Field label="گدام مقصد" required>
                <WarehouseSelect
                  value={toWh}
                  onChange={setToWh}
                  warehouses={warehouses}
                  placeholder="انتخاب گدام مقصد"
                />
              </Field>
            </div>
            <Field label="دلیل انتقال">
              <Input
                value={transferReason}
                onChange={(e) => setTransferReason(e.target.value)}
                placeholder="مثلاً تقویت گدام مرکزی"
              />
            </Field>
            <div className="space-y-2">
              <Label className="text-xs">اقلام انتقال</Label>
              {fromStockLoading && fromWh && (
                <p className="text-xs text-muted-foreground">در حال بارگیری موجودی گدام مبدأ...</p>
              )}
              {transferLines.map((line, idx) => {
                const batches = availableBatches(line.productId);
                return (
                  <div
                    key={line.key}
                    className="grid grid-cols-1 gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1.2fr_110px_40px]"
                  >
                    <Select
                      value={line.productId || "none"}
                      onValueChange={(v) =>
                        updateTransferLine(line.key, {
                          productId: v === "none" ? "" : v,
                          batchId: "",
                          quantity: "",
                        })
                      }
                    >
                      <SelectTrigger className="w-full bg-background">
                        <SelectValue placeholder={`قلم ${idx + 1} — محصول`} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none" disabled>
                          — انتخاب محصول —
                        </SelectItem>
                        {products.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={line.batchId || "none"}
                      onValueChange={(v) =>
                        updateTransferLine(line.key, { batchId: v === "none" ? "" : v })
                      }
                      disabled={!line.productId}
                    >
                      <SelectTrigger className="w-full bg-background">
                        <SelectValue
                          placeholder={line.productId ? "انتخاب بچ" : "اول محصول را انتخاب کنید"}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {batches.length === 0 ? (
                          <SelectItem value="none" disabled>
                            بچ قابل انتقالی موجود نیست
                          </SelectItem>
                        ) : (
                          batches.map((b) => (
                            <SelectItem key={b.batchId} value={b.batchId}>
                              {b.label}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    <Input
                      dir="ltr"
                      type="number"
                      min="0"
                      step="any"
                      placeholder="مقدار"
                      value={line.quantity}
                      onChange={(e) => updateTransferLine(line.key, { quantity: e.target.value })}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-rose-600 hover:text-rose-700"
                      title="حذف قلم"
                      disabled={transferLines.length <= 1}
                      onClick={() =>
                        setTransferLines((ls) => ls.filter((l) => l.key !== line.key))
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setTransferLines((ls) => [
                    ...ls,
                    { key: lineKey(), productId: "", batchId: "", quantity: "" },
                  ])
                }
              >
                <Plus className="h-4 w-4" /> افزودن قلم
              </Button>
            </div>
          </div>
        </FormDialog>

        {/* دیالوگ تعدیل موجودی */}
        <FormDialog
          open={adjustOpen}
          onOpenChange={(o) => {
            if (!o) setAdjustOpen(false);
          }}
          title="تعدیل موجودی"
          description="تنظیم موجودی بچ‌ها بر اساس شمارش واقعی، خسارت یا خراج منقضی"
          wide
          onSubmit={submitAdjust}
          submitting={saving}
          submitLabel="ثبت تعدیل"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="گدام" required>
                <WarehouseSelect
                  value={adjustWh}
                  onChange={(v) => {
                    setAdjustWh(v);
                    setAdjustLines([
                      { key: lineKey(), productId: "", batchId: "", newQuantity: "" },
                    ]);
                  }}
                  warehouses={warehouses}
                  placeholder="انتخاب گدام"
                />
              </Field>
              <Field label="نوع تعدیل" required>
                <Select value={adjustType} onValueChange={setAdjustType}>
                  <SelectTrigger className="w-full bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ADJUSTMENT_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="دلیل تعدیل" required>
              <Input
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                placeholder="مثلاً شمارش گدام — کسری ۵ عدد"
              />
            </Field>
            <div className="space-y-2">
              <Label className="text-xs">اقلام تعدیل</Label>
              {adjustStockLoading && adjustWh && (
                <p className="text-xs text-muted-foreground">در حال بارگیری موجودی گدام...</p>
              )}
              {adjustLines.map((line, idx) => {
                const batches = adjustBatches(line.productId);
                return (
                  <div
                    key={line.key}
                    className="grid grid-cols-1 gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1.2fr_110px_40px]"
                  >
                    <Select
                      value={line.productId || "none"}
                      onValueChange={(v) =>
                        updateAdjustLine(line.key, {
                          productId: v === "none" ? "" : v,
                          batchId: "",
                          newQuantity: "",
                        })
                      }
                    >
                      <SelectTrigger className="w-full bg-background">
                        <SelectValue placeholder={`قلم ${idx + 1} — محصول`} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none" disabled>
                          — انتخاب محصول —
                        </SelectItem>
                        {products.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={line.batchId || "none"}
                      onValueChange={(v) => {
                        const bid = v === "none" ? "" : v;
                        const current = batches.find((b) => b.batchId === bid);
                        updateAdjustLine(line.key, {
                          batchId: bid,
                          newQuantity: current ? String(current.qty) : "",
                        });
                      }}
                      disabled={!line.productId}
                    >
                      <SelectTrigger className="w-full bg-background">
                        <SelectValue
                          placeholder={line.productId ? "انتخاب بچ" : "اول محصول را انتخاب کنید"}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {batches.length === 0 ? (
                          <SelectItem value="none" disabled>
                            بچی در این گدام موجود نیست
                          </SelectItem>
                        ) : (
                          batches.map((b) => (
                            <SelectItem key={b.batchId} value={b.batchId}>
                              {b.label}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    <Input
                      dir="ltr"
                      type="number"
                      min="0"
                      step="any"
                      placeholder="مقدار جدید"
                      value={line.newQuantity}
                      onChange={(e) =>
                        updateAdjustLine(line.key, { newQuantity: e.target.value })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-rose-600 hover:text-rose-700"
                      title="حذف قلم"
                      disabled={adjustLines.length <= 1}
                      onClick={() => setAdjustLines((ls) => ls.filter((l) => l.key !== line.key))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setAdjustLines((ls) => [
                    ...ls,
                    { key: lineKey(), productId: "", batchId: "", newQuantity: "" },
                  ])
                }
              >
                <Plus className="h-4 w-4" /> افزودن قلم
              </Button>
            </div>
          </div>
        </FormDialog>
      </div>
    </PermissionGate>
  );
}
