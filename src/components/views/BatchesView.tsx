"use client";

/** ویوی بچ‌ها و انقضا — فیلتر بر اساس گدام/وضعیت/تاریخ انقضا + ردیابی کامل بچ */

import { useMemo, useState } from "react";
import { Boxes, Clock3, Package, Route, XCircle } from "lucide-react";
import { PermissionGate } from "@/components/shared/use-user";
import {
  BADGE_TONES,
  BatchStatusBadge,
  MovementBadge,
  PageHeader,
  StatCard,
} from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FormDialog } from "@/components/shared/form-dialog";
import { useApiData } from "@/lib/client-api";
import { formatMoney, formatNumber } from "@/lib/format";
import { formatHijriDateTime, formatHijriShort, toPersianDigits } from "@/lib/hijri";
import { BATCH_STATUS } from "@/lib/terminology";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type WarehouseItem = { id: string; name: string; isMain?: boolean | null };
type ProductLite = { id: string; name: string };

type BatchStockRef = {
  warehouse?: string | { name?: string } | null;
  quantity?: number | null;
};

type BatchItem = {
  id: string;
  batchNumber?: string | null;
  mfgDate?: string | null;
  expiryDate?: string | null;
  costPrice?: number | null;
  status?: string | null;
  quantity?: number | null;
  totalQuantity?: number | null;
  product?: { id: string; name: string; unit?: string | null } | null;
  productName?: string | null;
  stocks?: BatchStockRef[] | null;
  stockByWarehouse?: BatchStockRef[] | null;
  currentStock?: BatchStockRef[] | null;
};

type TracePurchase = {
  number?: string | null;
  date?: string | null;
  supplier?: string | { name?: string } | null;
  branch?: string | { name?: string } | null;
};

type TraceMovement = {
  id?: string | null;
  createdAt?: string | null;
  date?: string | null;
  type?: string | null;
  quantity?: number | null;
  fromWarehouse?: string | { name?: string } | null;
  toWarehouse?: string | { name?: string } | null;
  reason?: string | null;
  userName?: string | null;
};

type TraceSale = {
  invoice?: string | null;
  number?: string | null;
  date?: string | null;
  customer?: string | { name?: string } | null;
  quantity?: number | null;
  freeQuantity?: number | null;
};

type TraceResponse = {
  batch?: {
    batchNumber?: string | null;
    mfgDate?: string | null;
    expiryDate?: string | null;
    costPrice?: number | null;
    status?: string | null;
  } | null;
  product?: { name?: string | null; unit?: string | null } | null;
  purchase?: TracePurchase | null;
  movements?: TraceMovement[] | null;
  sales?: TraceSale[] | null;
  currentStock?: BatchStockRef[] | null;
};

const POSITIVE_TYPES = new Set(["IN", "RETURN_IN"]);
const NEGATIVE_TYPES = new Set(["OUT", "RETURN_OUT", "DAMAGE", "EXPIRED"]);
const EXPIRY_CHIPS = [30, 60, 90, 180];

function listOf<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)) {
    return (data as { items: T[] }).items;
  }
  return [];
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

function nameOf(v: string | { name?: string } | null | undefined): string {
  if (!v) return "—";
  if (typeof v === "string") return v;
  return v.name ?? "—";
}

function productName(b: BatchItem): string {
  return b.product?.name ?? b.productName ?? "—";
}

function batchStocks(b: BatchItem): { name: string; qty: number }[] {
  const raw = b.stocks ?? b.stockByWarehouse ?? b.currentStock;
  if (!raw || raw.length === 0) return [];
  return raw.map((s) => ({
    name: nameOf(s.warehouse),
    qty: Number(s.quantity ?? 0),
  }));
}

function batchQty(b: BatchItem): number {
  const fromStocks = batchStocks(b);
  if (fromStocks.length > 0) return fromStocks.reduce((a, s) => a + s.qty, 0);
  if (typeof b.quantity === "number") return b.quantity;
  if (typeof b.totalQuantity === "number") return b.totalQuantity;
  return 0;
}

function movementSign(type?: string | null): string {
  if (!type) return "";
  if (POSITIVE_TYPES.has(type)) return "+";
  if (NEGATIVE_TYPES.has(type)) return "−";
  return "";
}

function movementPath(m: TraceMovement): string {
  const from = nameOf(m.fromWarehouse);
  const to = nameOf(m.toWarehouse);
  if (from !== "—" && to !== "—") return `از ${from} به ${to}`;
  if (to !== "—") return `به ${to}`;
  if (from !== "—") return `از ${from}`;
  return "";
}

function movementDot(type?: string | null): string {
  if (!type) return "bg-slate-400";
  if (POSITIVE_TYPES.has(type)) return "bg-primary";
  if (NEGATIVE_TYPES.has(type)) return "bg-rose-500";
  if (type === "TRANSFER") return "bg-amber-500";
  return "bg-slate-400";
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

export default function BatchesView() {
  // فیلترها
  const [whFilter, setWhFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [productFilter, setProductFilter] = useState("all");
  const [expiryDays, setExpiryDays] = useState<number | null>(null);

  const batchesPath = `/api/batches${qs({
    warehouseId: whFilter !== "all" ? whFilter : "",
    status: statusFilter !== "all" ? statusFilter : "",
    productId: productFilter !== "all" ? productFilter : "",
    expiryWithinDays: expiryDays ?? undefined,
  })}`;
  const { data: batchesData, loading, error, refetch } = useApiData<unknown>(batchesPath);
  const batches = listOf<BatchItem>(batchesData);

  const { data: whData } = useApiData<unknown>("/api/warehouses");
  const warehouses = listOf<WarehouseItem>(whData);
  const { data: prodData } = useApiData<unknown>("/api/products?limit=500");
  const products = listOf<ProductLite>(prodData);

  // ردیابی بچ
  const [traceId, setTraceId] = useState<string | null>(null);
  const {
    data: trace,
    loading: traceLoading,
    error: traceError,
  } = useApiData<TraceResponse>(traceId ? `/api/batches/${traceId}/trace` : null);

  const stats = useMemo(() => {
    let totalQty = 0;
    let expiring = 0;
    let expired = 0;
    for (const b of batches) {
      totalQty += batchQty(b);
      if (b.status === "EXPIRING_SOON") expiring++;
      else if (b.status === "EXPIRED") expired++;
    }
    return { count: batches.length, totalQty, expiring, expired };
  }, [batches]);

  const columns: Column<BatchItem>[] = [
    {
      key: "product",
      header: "محصول",
      render: (b) => <span className="font-semibold">{productName(b)}</span>,
    },
    {
      key: "batchNumber",
      header: "شماره بچ",
      render: (b) => (
        <span dir="ltr" className="font-mono text-xs">
          {b.batchNumber ?? "—"}
        </span>
      ),
    },
    {
      key: "mfgDate",
      header: "تولید",
      render: (b) => <span className="whitespace-nowrap">{formatHijriShort(b.mfgDate)}</span>,
    },
    {
      key: "expiryDate",
      header: "انقضا",
      render: (b) => (
        <div className="flex flex-col items-start gap-1">
          <span
            className={`whitespace-nowrap ${
              b.status === "EXPIRED" ? "font-bold text-rose-600" : ""
            }`}
          >
            {formatHijriShort(b.expiryDate)}
          </span>
          <BatchStatusBadge status={b.status} />
        </div>
      ),
    },
    {
      key: "costPrice",
      header: "بهای واحد",
      render: (b) => (
        <span className="whitespace-nowrap">{formatMoney(b.costPrice)}</span>
      ),
    },
    {
      key: "quantity",
      header: "موجودی",
      render: (b) => {
        const q = batchQty(b);
        return <span className={q <= 0 ? "font-bold text-rose-600" : ""}>{formatNumber(q)}</span>;
      },
    },
    {
      key: "stocks",
      header: "گدام‌ها",
      render: (b) => {
        const st = batchStocks(b);
        if (st.length === 0) return <span className="text-muted-foreground">—</span>;
        return (
          <div className="flex max-w-64 flex-wrap gap-1">
            {st.map((s, i) => (
              <Badge
                key={`${s.name}-${i}`}
                variant="outline"
                className={s.qty > 0 ? BADGE_TONES.emerald : BADGE_TONES.slate}
              >
                {s.name}: {formatNumber(s.qty)}
              </Badge>
            ))}
          </div>
        );
      },
    },
    {
      key: "actions",
      header: "عملیات",
      sortable: false,
      render: (b) => (
        <Button variant="outline" size="sm" onClick={() => setTraceId(b.id)}>
          <Route className="h-4 w-4" /> ردیابی
        </Button>
      ),
    },
  ];

  const movements = trace?.movements ?? [];

  return (
    <PermissionGate permission="batches.view">
      <div className="space-y-4">
        <PageHeader
          title="بچ‌ها و انقضا"
          description="پیگیری بچ‌های ادویه، وضعیت انقضا و ردیابی کامل هر بچ از خرید تا فروش"
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
              <Field label="وضعیت انقضا">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-full bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">همه حالات</SelectItem>
                    {Object.entries(BATCH_STATUS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="محصول">
                <Select value={productFilter} onValueChange={setProductFilter}>
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
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">انقضا در:</span>
              {EXPIRY_CHIPS.map((d) => (
                <Button
                  key={d}
                  size="sm"
                  variant={expiryDays === d ? "default" : "outline"}
                  className={
                    expiryDays === d
                      ? "h-7 bg-primary px-2.5 text-white hover:bg-primary/90"
                      : "h-7 px-2.5"
                  }
                  onClick={() => setExpiryDays((cur) => (cur === d ? null : d))}
                >
                  {toPersianDigits(d)} روز
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="تعداد بچ‌ها"
            value={formatNumber(stats.count)}
            sub="طبق فیلتر فعلی"
            icon={Package}
            tone="emerald"
          />
          <StatCard
            label="مجموع موجودی بچ‌ها"
            value={formatNumber(stats.totalQty)}
            icon={Boxes}
            tone="slate"
          />
          <StatCard
            label="نزدیک انقضا"
            value={formatNumber(stats.expiring)}
            sub="نیازمند توجه"
            icon={Clock3}
            tone="amber"
          />
          <StatCard
            label="منقضی شده"
            value={formatNumber(stats.expired)}
            sub="غیرقابل فروش"
            icon={XCircle}
            tone="rose"
          />
        </div>

        <Card className="border shadow-sm">
          <CardContent className="p-4">
            <DataTable
              columns={columns}
              rows={batches}
              loading={loading}
              searchKeys={["batchNumber", "product.name", "productName"]}
              searchPlaceholder="جستجوی شماره بچ یا محصول..."
              emptyText="بچی یافت نشد"
              rowKey={(b) => b.id}
            />
          </CardContent>
        </Card>

        {/* دیالوگ ردیابی کامل بچ */}
        <FormDialog
          open={traceId !== null}
          onOpenChange={(o) => {
            if (!o) setTraceId(null);
          }}
          title="ردیابی کامل بچ"
          description="مسیر بچ از خرید تا موجودی فعلی، حرکات و فروش‌ها"
          wide
        >
          {traceLoading && (
            <div className="space-y-3">
              <div className="h-16 animate-pulse rounded-md bg-muted" />
              <div className="h-10 animate-pulse rounded-md bg-muted" />
              <div className="h-24 animate-pulse rounded-md bg-muted" />
            </div>
          )}

          {!traceLoading && trace && (
            <div className="space-y-5">
              {/* سرصفحه بچ */}
              <div className="rounded-md border bg-muted/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-bold">{trace.product?.name ?? "—"}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      شماره بچ:{" "}
                      <span dir="ltr" className="font-mono">
                        {trace.batch?.batchNumber ?? "—"}
                      </span>
                    </p>
                  </div>
                  <BatchStatusBadge status={trace.batch?.status} />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                  <span>تولید: {formatHijriShort(trace.batch?.mfgDate)}</span>
                  <span>انقضا: {formatHijriShort(trace.batch?.expiryDate)}</span>
                  <span>بهای واحد: {formatMoney(trace.batch?.costPrice)}</span>
                </div>
              </div>

              {/* منبع خرید */}
              <section>
                <h3 className="mb-2 text-sm font-bold">منبع خرید</h3>
                {trace.purchase ? (
                  <div className="grid grid-cols-2 gap-3 rounded-md border p-3 text-sm sm:grid-cols-4">
                    <div>
                      <span className="block text-xs text-muted-foreground">شماره خرید</span>
                      <span dir="ltr" className="font-mono text-xs">
                        {trace.purchase.number ?? "—"}
                      </span>
                    </div>
                    <div>
                      <span className="block text-xs text-muted-foreground">تاریخ</span>
                      {formatHijriShort(trace.purchase.date)}
                    </div>
                    <div>
                      <span className="block text-xs text-muted-foreground">تأمین‌کننده</span>
                      {nameOf(trace.purchase.supplier)}
                    </div>
                    <div>
                      <span className="block text-xs text-muted-foreground">شعبه</span>
                      {nameOf(trace.purchase.branch)}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">—</p>
                )}
              </section>

              {/* موجودی فعلی */}
              <section>
                <h3 className="mb-2 text-sm font-bold">موجودی فعلی</h3>
                {(trace.currentStock?.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground">موجودی‌ای موجود نیست</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {(trace.currentStock ?? []).map((s, i) => {
                      const q = Number(s.quantity ?? 0);
                      return (
                        <Badge
                          key={i}
                          variant="outline"
                          className={q > 0 ? BADGE_TONES.emerald : BADGE_TONES.slate}
                        >
                          {nameOf(s.warehouse)}: {formatNumber(q)}
                        </Badge>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* حرکات موجودی */}
              <section>
                <h3 className="mb-2 text-sm font-bold">حرکات موجودی</h3>
                {movements.length === 0 ? (
                  <p className="text-sm text-muted-foreground">حرکتی ثبت نشده است</p>
                ) : (
                  <div className="max-h-72 overflow-y-auto pl-1">
                    {movements.map((m, i) => {
                      const q = Number(m.quantity ?? 0);
                      const sign = movementSign(m.type);
                      return (
                        <div key={m.id ?? i} className="flex gap-3">
                          <div className="flex flex-col items-center pt-1.5">
                            <span
                              className={`h-2.5 w-2.5 shrink-0 rounded-full ${movementDot(m.type)}`}
                            />
                            {i < movements.length - 1 && (
                              <span className="w-px flex-1 bg-border" />
                            )}
                          </div>
                          <div className="flex-1 space-y-1 pb-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <MovementBadge type={m.type} />
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
                                {formatNumber(q)}
                              </span>
                              {movementPath(m) && (
                                <span className="text-xs text-muted-foreground">
                                  {movementPath(m)}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {formatHijriDateTime(m.createdAt ?? m.date)}
                              {m.userName ? ` — ${m.userName}` : ""}
                              {m.reason ? ` — دلیل: ${m.reason}` : ""}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* فروش به مشتریان */}
              <section>
                <h3 className="mb-2 text-sm font-bold">فروش به مشتریان</h3>
                {(trace.sales?.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground">فروشی برای این بچ ثبت نشده است</p>
                ) : (
                  <div className="max-h-60 overflow-y-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>فاکتور</TableHead>
                          <TableHead>تاریخ</TableHead>
                          <TableHead>مشتری</TableHead>
                          <TableHead>تعداد</TableHead>
                          <TableHead>مجانی</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(trace.sales ?? []).map((s, i) => (
                          <TableRow key={i}>
                            <TableCell dir="ltr" className="text-right font-mono text-xs">
                              {s.invoice ?? s.number ?? "—"}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {formatHijriShort(s.date)}
                            </TableCell>
                            <TableCell>{nameOf(s.customer)}</TableCell>
                            <TableCell>{formatNumber(s.quantity)}</TableCell>
                            <TableCell>{formatNumber(s.freeQuantity ?? 0)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </section>
            </div>
          )}

          {!traceLoading && !trace && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {traceError ?? "معلومات ردیابی بارگذاری نشد"}
            </p>
          )}
        </FormDialog>
      </div>
    </PermissionGate>
  );
}
