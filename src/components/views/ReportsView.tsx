"use client";

/** ویو راپورها — فروش‌ها، خریدها، موجودی، مالی، اسعار + خروجی CSV و چاپ */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  TrendingUp,
  ShoppingCart,
  Boxes,
  Landmark,
  ArrowLeftRight,
  FileDown,
  Printer,
  BarChart3,
  Percent,
  type LucideIcon,
} from "lucide-react";
import { useUser, PermissionGate } from "@/components/shared/use-user";
import {
  PageHeader,
  StatCard,
  BADGE_TONES,
} from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { useApiData } from "@/lib/client-api";
import {
  formatMoney,
  formatNumber,
  formatHijriShort,
  formatHijriDateTime,
} from "@/lib/format";
import { dateToHijriInput, hijriInputToDate, hijriInputToDayEnd, hijriInputToDayStart } from "@/lib/hijri";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// ─────────────────────────── انواع ───────────────────────────

type ReportType =
  "sales" | "purchases" | "inventory" | "financial" | "currency" | "promotions";

type ReportRow = {
  key: string;
  label: string;
  count: number;
  quantity?: number;
  totalAfn?: number;
  costAfn?: number;
  profitAfn?: number;
};

type FinancialSummary = {
  revenueAfn: number;
  salesReturnsAfn: number;
  netRevenueAfn: number;
  cogsAfn: number;
  grossProfitAfn: number;
  expensesAfn: number;
  netProfitAfn: number;
  receivablesAfn: number;
  payablesAfn: number;
  inventoryValueAfn: number;
};

type RateRow = {
  id?: string;
  base: string;
  quote: string;
  buyRate: number;
  sellRate: number;
  source: string;
  createdAt?: string;
  recordedByName?: string | null;
};

type Option = { id: string; name: string };

type RunSpec = {
  type: ReportType;
  path: string;
  groupLabel: string;
  section?: string;
};

type PromoSummary = {
  salesDocs: number;
  salesWithDiscount: number;
  salesWithPromo: number;
  salesDiscountAfn: number;
  salesUserDiscountAfn: number;
  salesPromoDiscountAfn: number;
  salesFreeUnits: number;
  salesFreeValueAfn: number;
  purchaseDocs: number;
  purchWithDiscount: number;
  purchWithPromo: number;
  purchaseDiscountAfn: number;
  purchasePromoDiscountAfn: number;
  purchaseFreeUnits: number;
  purchaseFreeValueAfn: number;
  totalIssuedAfn: number;
  totalReceivedAfn: number;
  totalPromoDiscountAfn: number;
  freeGoodsValueAfn: number;
  profitImpactAfn: number;
};

type PromoListRow = {
  key: string;
  code: string;
  name: string;
  status: string;
  typeLabel: string;
  scopeLabel: string;
  supplierName?: string | null;
  startDate?: string;
  endDate?: string;
  minQuantity?: number;
  minAmount?: number;
  usageCount?: number;
  usageRecords?: number;
  discountAfn?: number;
  freeQuantity?: number;
  freeValueAfn?: number;
  profitImpactAfn?: number;
};

const PROMO_SECTIONS: Record<string, string> = {
  summary: "خلاصه کل",
  byDay: "بر اساس روز",
  byProduct: "بر اساس محصول",
  byCustomer: "بر اساس مشتری",
  bySupplier: "بر اساس تأمین‌کننده",
  byPromotion: "استفاده از طرح‌ها",
  promotions: "فهرست طرح‌ها (فعال/منقضی)",
};

const PROMO_STATUS_META: Record<string, { label: string; tone: string }> = {
  ACTIVE: { label: "فعال", tone: "emerald" },
  SCHEDULED: { label: "در انتظار شروع", tone: "amber" },
  EXPIRED: { label: "منقضی‌شده", tone: "rose" },
  INACTIVE: { label: "غیرفعال", tone: "slate" },
};

// ─────────────────────────── ثابت‌ها ───────────────────────────

const REPORT_TYPES: {
  key: ReportType;
  label: string;
  desc: string;
  icon: LucideIcon;
}[] = [
  {
    key: "sales",
    label: "فروش‌ها",
    desc: "گروه‌بندی فروشات",
    icon: TrendingUp,
  },
  {
    key: "purchases",
    label: "خریدها",
    desc: "گروه‌بندی خریدها",
    icon: ShoppingCart,
  },
  { key: "inventory", label: "موجودی", desc: "وضعیت گدام", icon: Boxes },
  { key: "financial", label: "مالی", desc: "خلاصه مالی دوره", icon: Landmark },
  {
    key: "promotions",
    label: "تخفیف و پروموشن",
    desc: "راپور تخفیف‌ها و طرح‌های تشویقی",
    icon: Percent,
  },
  {
    key: "currency",
    label: "اسعار",
    desc: "تاریخچه نرخ‌ها",
    icon: ArrowLeftRight,
  },
];

const SALES_GROUPS: Record<string, string> = {
  day: "روزانه",
  month: "ماهانه",
  branch: "شعبه",
  customer: "مشتری",
  salesperson: "فروشنده",
  territory: "منطقه",
  product: "محصول",
  batch: "بچ",
};

const PURCHASE_GROUPS: Record<string, string> = {
  day: "روزانه",
  month: "ماهانه",
  branch: "شعبه",
  supplier: "تأمین‌کننده",
  product: "محصول",
  batch: "بچ",
};

const INVENTORY_TYPES: Record<string, string> = {
  current: "موجودی فعلی",
  valuation: "ارزش‌گذاری",
  batch: "بچ‌ها",
  expiry: "انقضا",
  low: "زیر نصاب",
  movement: "حرکات",
};

const FINANCIAL_ROWS: { key: keyof FinancialSummary; label: string }[] = [
  { key: "revenueAfn", label: "عواید" },
  { key: "salesReturnsAfn", label: "برگشتی‌های فروش" },
  { key: "netRevenueAfn", label: "عواید خالص" },
  { key: "cogsAfn", label: "بهای تمام‌شده فروشات" },
  { key: "grossProfitAfn", label: "منفعت ناخالص" },
  { key: "expensesAfn", label: "مصارف" },
  { key: "netProfitAfn", label: "منفعت خالص" },
  { key: "receivablesAfn", label: "مطالبات (بدهی مشتریان به ما)" },
  { key: "payablesAfn", label: "بدهی‌ها (بدهی ما به تأمین‌کنندگان)" },
  { key: "inventoryValueAfn", label: "ارزش موجودی گدام" },
];

// ─────────────────────────── کمکی ───────────────────────────

const todayInput = () => dateToHijriInput(new Date());
const monthAgoInput = () => dateToHijriInput(new Date(Date.now() - 30 * 864e5));

function listOf<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const key of ["items", "rows", "latest", "history"]) {
      if (Array.isArray(obj[key])) return obj[key] as T[];
    }
  }
  return [];
}

function toOptions(data: unknown): Option[] {
  return listOf<Record<string, unknown>>(data)
    .filter(
      (o) =>
        o &&
        typeof o.id === "string" &&
        typeof o.name === "string" &&
        (o.isActive === undefined || o.isActive !== false),
    )
    .map((o) => ({ id: o.id as string, name: o.name as string }));
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

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function SourceBadge({ source }: { source?: string | null }) {
  const isApi = source === "API";
  return (
    <Badge
      variant="outline"
      className={BADGE_TONES[isApi ? "emerald" : "slate"]}
    >
      {isApi ? "API" : "دستی"}
    </Badge>
  );
}

function fmtRate(n: number | null | undefined): string {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return formatNumber(v, v >= 10 ? 2 : 4);
}

// ─────────────────────────── ویو ───────────────────────────

export default function ReportsView() {
  const { user } = useUser();

  // نوع راپور
  const [type, setType] = useState<ReportType>("sales");

  // فیلترهای مشترک
  const [fromInput, setFromInput] = useState(monthAgoInput);
  const [toInput, setToInput] = useState(todayInput);
  const [branchId, setBranchId] = useState("ALL");

  // گزینه‌ها
  const [groupBy, setGroupBy] = useState("day");
  const [invType, setInvType] = useState("current");
  const [warehouseId, setWarehouseId] = useState("ALL");
  const [customerId, setCustomerId] = useState("ALL");
  const [salespersonId, setSalespersonId] = useState("ALL");
  const [territoryId, setTerritoryId] = useState("ALL");
  const [productId, setProductId] = useState("ALL");
  const [supplierId, setSupplierId] = useState("ALL");

  // راپور تخفیف و پروموشن
  const [promoSection, setPromoSection] = useState("summary");

  // اجرای راپور
  const [run, setRun] = useState<RunSpec | null>(null);
  const { data: runData, loading: runLoading } = useApiData<unknown>(
    run ? run.path : null,
    [run],
  );

  // چاپ
  const [printMode, setPrintMode] = useState(false);
  useEffect(() => {
    if (!printMode) return;
    const t = window.setTimeout(() => {
      window.print();
      setPrintMode(false);
    }, 150);
    return () => window.clearTimeout(t);
  }, [printMode]);

  // منابع سلکت‌ها
  const { data: branchesData } = useApiData<unknown>(
    user.isSuperAdmin ? "/api/branches" : null,
  );
  const { data: customersData } = useApiData<unknown>(
    type === "sales" || type === "promotions" ? "/api/customers?limit=500" : null,
  );
  const { data: salespersonsData } = useApiData<unknown>(
    type === "sales" ? "/api/salespersons" : null,
  );
  const { data: territoriesData } = useApiData<unknown>(
    type === "sales" ? "/api/territories" : null,
  );
  const { data: productsData } = useApiData<unknown>(
    type === "sales" || type === "purchases" || type === "promotions"
      ? "/api/products?limit=500"
      : null,
  );
  const { data: suppliersData } = useApiData<unknown>(
    type === "purchases" || type === "promotions" ? "/api/suppliers" : null,
  );
  const { data: warehousesData } = useApiData<unknown>(
    type === "inventory" ? "/api/warehouses" : null,
  );
  const { data: settingsData } = useApiData<unknown>("/api/settings");

  const branchOptions = useMemo(() => toOptions(branchesData), [branchesData]);
  const customerOptions = useMemo(
    () => toOptions(customersData),
    [customersData],
  );
  const salespersonOptions = useMemo(
    () => toOptions(salespersonsData),
    [salespersonsData],
  );
  const territoryOptions = useMemo(
    () => toOptions(territoriesData),
    [territoriesData],
  );
  const productOptions = useMemo(() => toOptions(productsData), [productsData]);
  const supplierOptions = useMemo(
    () => toOptions(suppliersData),
    [suppliersData],
  );
  const warehouseOptions = useMemo(
    () => toOptions(warehousesData),
    [warehousesData],
  );

  const companyName = useMemo(() => {
    if (settingsData && typeof settingsData === "object") {
      const n = (settingsData as Record<string, unknown>).company_name;
      if (typeof n === "string" && n.trim()) return n;
    }
    return "سیستم مدیریت دارویی";
  }, [settingsData]);

  const selectType = (t: ReportType) => {
    setType(t);
    if (t === "sales") setGroupBy("day");
    if (t === "purchases") setGroupBy("day");
    if (t === "inventory") setInvType("current");
    if (t === "promotions") setPromoSection("summary");
  };

  const opt = (v: string): string | undefined => (v !== "ALL" ? v : undefined);

  const buildPath = (): string => {
    const from = hijriRangeFrom(fromInput);
    const to = hijriRangeTo(toInput);
    const branch = opt(branchId);
    if (type === "sales") {
      return `/api/reports/sales${qs({
        groupBy,
        from,
        to,
        branchId: branch,
        customerId: opt(customerId),
        salespersonId: opt(salespersonId),
        territoryId: opt(territoryId),
        productId: opt(productId),
      })}`;
    }
    if (type === "purchases") {
      return `/api/reports/purchases${qs({
        groupBy,
        from,
        to,
        branchId: branch,
        supplierId: opt(supplierId),
        productId: opt(productId),
      })}`;
    }
    if (type === "inventory") {
      return `/api/reports/inventory${qs({
        type: invType,
        warehouseId: opt(warehouseId),
        branchId: branch,
        from,
        to,
      })}`;
    }
    if (type === "financial") {
      return `/api/reports/financial${qs({ from, to, branchId: branch })}`;
    }
    if (type === "promotions") {
      const isList = promoSection === "promotions";
      return `/api/reports/promotions${qs({
        section: promoSection,
        from: isList ? undefined : from,
        to: isList ? undefined : to,
        branchId: branch,
        customerId:
          promoSection === "summary" || promoSection === "byCustomer"
            ? opt(customerId)
            : undefined,
        supplierId:
          promoSection === "summary" ||
          promoSection === "bySupplier" ||
          promoSection === "promotions"
            ? opt(supplierId)
            : undefined,
        productId: promoSection === "byProduct" ? opt(productId) : undefined,
      })}`;
    }
    return `/api/reports/currency${qs({ limit: 100 })}`;
  };

  const showReport = () => {
    if (type !== "currency") {
      for (const [label, val] of [
        ["از", fromInput],
        ["تا", toInput],
      ] as const) {
        if (val.trim() && !hijriInputToDate(val)) {
          toast.error(`تاریخ «${label}» نامعتبر است — مثال: ۱۴۰۴/۰۱/۰۱`);
          return;
        }
      }
    }
    let groupLabel = "";
    if (type === "sales") groupLabel = SALES_GROUPS[groupBy] ?? groupBy;
    if (type === "purchases") groupLabel = PURCHASE_GROUPS[groupBy] ?? groupBy;
    if (type === "inventory") groupLabel = INVENTORY_TYPES[invType] ?? invType;
    if (type === "promotions") groupLabel = PROMO_SECTIONS[promoSection] ?? promoSection;
    setRun({
      type,
      path: buildPath(),
      groupLabel,
      section: type === "promotions" ? promoSection : undefined,
    });
  };

  // ── نتیجه: ردیف‌های عمومی ──
  const reportRows = useMemo<ReportRow[]>(() => {
    if (
      !run ||
      run.type === "financial" ||
      run.type === "currency" ||
      run.type === "promotions"
    )
      return [];
    return listOf<Record<string, unknown>>(runData).map((item, idx) => {
      const q = item.quantity;
      const t = item.totalAfn;
      const c = item.costAfn;
      const p = item.profitAfn;
      return {
        key: typeof item.key === "string" ? item.key : String(idx),
        label:
          typeof item.label === "string" && item.label
            ? item.label
            : "بدون عنوان",
        count: Number(item.count) || 0,
        quantity: q === undefined || q === null ? undefined : Number(q),
        totalAfn: t === undefined || t === null ? undefined : Number(t),
        costAfn: c === undefined || c === null ? undefined : Number(c),
        profitAfn: p === undefined || p === null ? undefined : Number(p),
      };
    });
  }, [run, runData]);

  // ── نتیجه: ردیف‌های راپور تخفیف و پروموشن ──
  const promoRows = useMemo<ReportRow[]>(() => {
    if (!run || run.type !== "promotions" || run.section === "promotions")
      return [];
    return listOf<Record<string, unknown>>(runData).map((item, idx) => {
      const q = item.quantity;
      const t = item.totalAfn;
      const c = item.costAfn;
      const p = item.profitAfn;
      return {
        key: typeof item.key === "string" ? item.key : String(idx),
        label:
          typeof item.label === "string" && item.label
            ? item.label
            : "بدون عنوان",
        count: Number(item.count) || 0,
        quantity: q === undefined || q === null ? undefined : Number(q),
        totalAfn: t === undefined || t === null ? undefined : Number(t),
        costAfn: c === undefined || c === null ? undefined : Number(c),
        profitAfn: p === undefined || p === null ? undefined : Number(p),
      };
    });
  }, [run, runData]);

  const promoSummary = useMemo<PromoSummary | null>(() => {
    if (
      !run ||
      run.type !== "promotions" ||
      run.section !== "summary" ||
      !runData ||
      typeof runData !== "object"
    )
      return null;
    const o = runData as Record<string, unknown>;
    if (!o.summary || typeof o.summary !== "object") return null;
    const s = o.summary as Record<string, unknown>;
    const num = (k: string): number =>
      typeof s[k] === "number" ? (s[k] as number) : 0;
    return {
      salesDocs: num("salesDocs"),
      salesWithDiscount: num("salesWithDiscount"),
      salesWithPromo: num("salesWithPromo"),
      salesDiscountAfn: num("salesDiscountAfn"),
      salesUserDiscountAfn: num("salesUserDiscountAfn"),
      salesPromoDiscountAfn: num("salesPromoDiscountAfn"),
      salesFreeUnits: num("salesFreeUnits"),
      salesFreeValueAfn: num("salesFreeValueAfn"),
      purchaseDocs: num("purchaseDocs"),
      purchWithDiscount: num("purchWithDiscount"),
      purchWithPromo: num("purchWithPromo"),
      purchaseDiscountAfn: num("purchaseDiscountAfn"),
      purchasePromoDiscountAfn: num("purchasePromoDiscountAfn"),
      purchaseFreeUnits: num("purchaseFreeUnits"),
      purchaseFreeValueAfn: num("purchaseFreeValueAfn"),
      totalIssuedAfn: num("totalIssuedAfn"),
      totalReceivedAfn: num("totalReceivedAfn"),
      totalPromoDiscountAfn: num("totalPromoDiscountAfn"),
      freeGoodsValueAfn: num("freeGoodsValueAfn"),
      profitImpactAfn: num("profitImpactAfn"),
    };
  }, [run, runData]);

  const promoListRows = useMemo<PromoListRow[]>(() => {
    if (!run || run.type !== "promotions" || run.section !== "promotions")
      return [];
    return listOf<Record<string, unknown>>(runData).map((item, idx) => ({
      key: typeof item.key === "string" ? item.key : String(idx),
      code: typeof item.code === "string" ? item.code : "",
      name: typeof item.name === "string" ? item.name : "",
      status: typeof item.status === "string" ? item.status : "INACTIVE",
      typeLabel: typeof item.typeLabel === "string" ? item.typeLabel : "",
      scopeLabel: typeof item.scopeLabel === "string" ? item.scopeLabel : "",
      supplierName:
        typeof item.supplierName === "string" ? item.supplierName : null,
      startDate:
        typeof item.startDate === "string" ? item.startDate : undefined,
      endDate: typeof item.endDate === "string" ? item.endDate : undefined,
      minQuantity: Number(item.minQuantity) || 0,
      minAmount: Number(item.minAmount) || 0,
      usageCount: Number(item.usageCount) || 0,
      usageRecords: Number(item.usageRecords) || 0,
      discountAfn: Number(item.discountAfn) || 0,
      freeQuantity: Number(item.freeQuantity) || 0,
      freeValueAfn: Number(item.freeValueAfn) || 0,
      profitImpactAfn: Number(item.profitImpactAfn) || 0,
    }));
  }, [run, runData]);

  const financialSummary = useMemo<FinancialSummary | null>(() => {
    if (
      !run ||
      run.type !== "financial" ||
      !runData ||
      typeof runData !== "object"
    )
      return null;
    const o = runData as Record<string, unknown>;
    if (typeof o.revenueAfn !== "number") return null;
    const num = (k: string): number =>
      typeof o[k] === "number" ? (o[k] as number) : 0;
    return {
      revenueAfn: num("revenueAfn"),
      salesReturnsAfn: num("salesReturnsAfn"),
      netRevenueAfn: num("netRevenueAfn"),
      cogsAfn: num("cogsAfn"),
      grossProfitAfn: num("grossProfitAfn"),
      expensesAfn: num("expensesAfn"),
      netProfitAfn: num("netProfitAfn"),
      receivablesAfn: num("receivablesAfn"),
      payablesAfn: num("payablesAfn"),
      inventoryValueAfn: num("inventoryValueAfn"),
    };
  }, [run, runData]);

  const currencyRows = useMemo<RateRow[]>(() => {
    if (!run || run.type !== "currency") return [];
    if (runData && typeof runData === "object" && Array.isArray((runData as Record<string, unknown>).history)) {
      return (runData as { history: RateRow[] }).history;
    }
    return listOf<RateRow>(runData);
  }, [run, runData]);

  const currentTitle = useMemo(() => {
    if (!run) return "";
    if (run.type === "sales")
      return `راپور فروش‌ها${run.groupLabel ? ` — گروه‌بندی ${run.groupLabel}` : ""}`;
    if (run.type === "purchases")
      return `راپور خریدها${run.groupLabel ? ` — گروه‌بندی ${run.groupLabel}` : ""}`;
    if (run.type === "inventory") return `راپور موجودی — ${run.groupLabel}`;
    if (run.type === "financial") return "خلاصه مالی دوره";
    if (run.type === "promotions") return `راپور تخفیف و پروموشن — ${run.groupLabel}`;
    return "تاریخچه نرخ اسعار";
  }, [run]);

  const periodLabel = useMemo(() => {
    if (!run || run.type === "currency") return "";
    const f = hijriToIso(fromInput);
    const t = hijriToIso(toInput);
    if (!f && !t) return "";
    return `${f ? formatHijriShort(f) : "ابتدا"} — ${t ? formatHijriShort(t) : "اکنون"}`;
  }, [run, fromInput, toInput]);

  // ── ستون‌های عمومی ──
  const reportColumns: Column<ReportRow>[] = useMemo(() => {
    const has = (k: "quantity" | "costAfn" | "profitAfn") =>
      reportRows.some((r) => r[k] !== undefined);
    const cols: Column<ReportRow>[] = [
      {
        key: "label",
        header: "عنوان",
        render: (r) => <span className="font-bold">{r.label}</span>,
      },
      { key: "count", header: "تعداد", render: (r) => formatNumber(r.count) },
    ];
    if (has("quantity")) {
      cols.push({
        key: "quantity",
        header: "مقدار",
        render: (r) => formatNumber(r.quantity ?? 0, 2),
      });
    }
    cols.push({
      key: "totalAfn",
      header: "مجموع (افغانی)",
      render: (r) => (
        <span className="font-semibold">{formatMoney(r.totalAfn)}</span>
      ),
    });
    if (has("costAfn")) {
      cols.push({
        key: "costAfn",
        header: "بهای تمام‌شده",
        render: (r) => formatMoney(r.costAfn),
      });
    }
    if (has("profitAfn")) {
      cols.push({
        key: "profitAfn",
        header: "منفعت",
        render: (r) => {
          const v = r.profitAfn ?? 0;
          return (
            <span
              className={cn(
                "font-semibold",
                v >= 0
                  ? "text-brand-soft-foreground dark:text-brand-soft-foreground"
                  : "text-rose-600 dark:text-rose-400",
              )}
            >
              {formatMoney(v)}
            </span>
          );
        },
      });
    }
    return cols;
  }, [reportRows]);

  // ── ستون‌های اسعار ──
  const currencyColumns: Column<RateRow>[] = useMemo(
    () => [
      {
        key: "createdAt",
        header: "تاریخ",
        render: (r) => (
          <span className="whitespace-nowrap">
            {formatHijriDateTime(r.createdAt)}
          </span>
        ),
      },
      {
        key: "pair",
        header: "جوړه",
        render: (r) => (
          <span dir="ltr" className="font-semibold">
            {r.base} → {r.quote}
          </span>
        ),
      },
      {
        key: "buyRate",
        header: "خرید",
        render: (r) => <span dir="ltr">{fmtRate(r.buyRate)}</span>,
      },
      {
        key: "sellRate",
        header: "فروش",
        render: (r) => <span dir="ltr">{fmtRate(r.sellRate)}</span>,
      },
      {
        key: "source",
        header: "منبع",
        render: (r) => <SourceBadge source={r.source} />,
      },
      {
        key: "recordedByName",
        header: "ثبت‌کننده",
        render: (r) => r.recordedByName || "—",
      },
    ],
    [],
  );

  // ── ستون‌های راپور تخفیف و پروموشن (بر اساس بخش) ──
  const promoColumns: Column<ReportRow>[] = useMemo(() => {
    const sec = run?.section ?? "summary";
    const moneyCell = (v: number | undefined) => (
      <span className="font-semibold">{formatMoney(v ?? 0)}</span>
    );
    const impactCell = (v: number | undefined) => {
      const val = v ?? 0;
      return (
        <span
          className={cn(
            "font-semibold",
            val >= 0
              ? "text-brand-soft-foreground dark:text-brand-soft-foreground"
              : "text-rose-600 dark:text-rose-400",
          )}
        >
          {formatMoney(val)}
        </span>
      );
    };
    const secMeta: Record<
      string,
      { label: string; count: string; total: string; cost: string | null }
    > = {
      summary: {
        label: "عنوان",
        count: "اسناد",
        total: "مجموع تخفیف (افغانی)",
        cost: "ارزش کالای رایگان",
      },
      byDay: {
        label: "روز",
        count: "فاکتورها",
        total: "مجموع تخفیف (افغانی)",
        cost: "ارزش کالای رایگان",
      },
      byProduct: {
        label: "محصول",
        count: "اقلام",
        total: "تخفیف به مشتریان",
        cost: "تخفیف از تأمین‌کنندگان",
      },
      byCustomer: {
        label: "مشتری",
        count: "فاکتورها",
        total: "مجموع تخفیف",
        cost: "ارزش کالای رایگان",
      },
      bySupplier: {
        label: "تأمین‌کننده",
        count: "فاکتورها",
        total: "تخفیف دریافتی",
        cost: "ارزش کالای رایگان دریافتی",
      },
      byPromotion: {
        label: "طرح تشویقی",
        count: "دفعات استفاده",
        total: "تخفیف اعطاشده (افغانی)",
        cost: "ارزش کالای رایگان",
      },
    };
    const meta = secMeta[sec] ?? secMeta.summary;
    const has = (k: "quantity" | "costAfn" | "profitAfn") =>
      promoRows.some((r) => r[k] !== undefined);
    const cols: Column<ReportRow>[] = [
      {
        key: "label",
        header: meta.label,
        render: (r) => <span className="font-bold">{r.label}</span>,
      },
      {
        key: "count",
        header: meta.count,
        render: (r) => formatNumber(r.count),
      },
    ];
    if (has("quantity")) {
      cols.push({
        key: "quantity",
        header: "واحد رایگان",
        render: (r) => formatNumber(r.quantity ?? 0, 2),
      });
    }
    cols.push({
      key: "totalAfn",
      header: meta.total,
      render: (r) => moneyCell(r.totalAfn),
    });
    if (meta.cost && has("costAfn")) {
      cols.push({
        key: "costAfn",
        header: meta.cost,
        render: (r) => moneyCell(r.costAfn),
      });
    }
    if (has("profitAfn")) {
      cols.push({
        key: "profitAfn",
        header: sec === "bySupplier" ? "منفعت" : "تأثیر منفعت",
        render: (r) => impactCell(r.profitAfn),
      });
    }
    return cols;
  }, [run, promoRows]);

  // ── ستون‌های فهرست طرح‌ها ──
  const promoListColumns: Column<PromoListRow>[] = useMemo(
    () => [
      {
        key: "code",
        header: "کد",
        render: (r) => (
          <span dir="ltr" className="font-semibold">
            {r.code}
          </span>
        ),
      },
      {
        key: "name",
        header: "نام طرح",
        render: (r) => <span className="font-bold">{r.name}</span>,
      },
      {
        key: "status",
        header: "وضعیت",
        render: (r) => {
          const meta = PROMO_STATUS_META[r.status] ?? PROMO_STATUS_META.INACTIVE;
          return (
            <Badge variant="outline" className={BADGE_TONES[meta.tone]}>
              {meta.label}
            </Badge>
          );
        },
      },
      { key: "typeLabel", header: "نوع", render: (r) => r.typeLabel || "—" },
      { key: "scopeLabel", header: "دامنه", render: (r) => r.scopeLabel || "—" },
      {
        key: "supplierName",
        header: "تأمین‌کننده",
        render: (r) => r.supplierName || "—",
      },
      {
        key: "startDate",
        header: "از",
        render: (r) => (
          <span className="whitespace-nowrap">
            {r.startDate ? formatHijriShort(r.startDate) : "—"}
          </span>
        ),
      },
      {
        key: "endDate",
        header: "تا",
        render: (r) => (
          <span className="whitespace-nowrap">
            {r.endDate ? formatHijriShort(r.endDate) : "—"}
          </span>
        ),
      },
      {
        key: "usageCount",
        header: "دفعات استفاده",
        render: (r) => formatNumber(r.usageCount ?? 0),
      },
      {
        key: "discountAfn",
        header: "مجموع تخفیف",
        render: (r) => formatMoney(r.discountAfn ?? 0),
      },
      {
        key: "freeValueAfn",
        header: "ارزش کالای رایگان",
        render: (r) => formatMoney(r.freeValueAfn ?? 0),
      },
      {
        key: "profitImpactAfn",
        header: "تأثیر منفعت",
        render: (r) => {
          const v = r.profitImpactAfn ?? 0;
          return (
            <span
              className={cn(
                "font-semibold",
                v >= 0
                  ? "text-brand-soft-foreground dark:text-brand-soft-foreground"
                  : "text-rose-600 dark:text-rose-400",
              )}
            >
              {formatMoney(v)}
            </span>
          );
        },
      },
    ],
    [],
  );

  // ── خروجی CSV ──
  const exportCsv = () => {
    if (run?.type === "promotions" && run.section === "promotions") {
      if (promoListRows.length === 0) {
        toast.info("راپوری برای خروجی وجود ندارد");
        return;
      }
      const header = [
        "کد",
        "نام طرح",
        "وضعیت",
        "نوع",
        "دامنه",
        "تأمین‌کننده",
        "از تاریخ",
        "تا تاریخ",
        "دفعات استفاده",
        "مجموع تخفیف (افغانی)",
        "واحد رایگان",
        "ارزش کالای رایگان (افغانی)",
        "تأثیر منفعت (افغانی)",
      ];
      const statusLabel = (s: string) =>
        PROMO_STATUS_META[s]?.label ?? s;
      const lines = promoListRows.map((r) =>
        [
          r.code,
          r.name,
          statusLabel(r.status),
          r.typeLabel,
          r.scopeLabel,
          r.supplierName ?? "",
          r.startDate ? formatHijriShort(r.startDate) : "",
          r.endDate ? formatHijriShort(r.endDate) : "",
          r.usageCount ?? 0,
          r.discountAfn ?? 0,
          r.freeQuantity ?? 0,
          r.freeValueAfn ?? 0,
          r.profitImpactAfn ?? 0,
        ]
          .map(csvCell)
          .join(","),
      );
      const csv =
        "\uFEFF" + [header.map(csvCell).join(","), ...lines].join("\n");
      const url = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
      const a = document.createElement("a");
      a.href = url;
      a.download = "promotions-report.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success("فایل CSV دانلود شد");
      return;
    }
    const rowsForCsv =
      run?.type === "promotions" ? promoRows : reportRows;
    if (rowsForCsv.length === 0) {
      toast.info("راپوری برای خروجی وجود ندارد");
      return;
    }
    const promoHeader =
      run?.type === "promotions"
        ? [
            promoColumns[0]?.header ?? "عنوان",
            promoColumns[1]?.header ?? "تعداد",
            "واحد رایگان",
            "مجموع تخفیف (افغانی)",
            "ارزش کالای رایگان (افغانی)",
            "تأثیر منفعت (افغانی)",
          ]
        : [
            "عنوان",
            "تعداد",
            "مقدار",
            "مجموع (افغانی)",
            "بهای تمام‌شده (افغانی)",
            "منفعت (افغانی)",
          ];
    const header = promoHeader;
    const lines = rowsForCsv.map((r) =>
      [
        r.label,
        r.count,
        r.quantity ?? "",
        r.totalAfn ?? "",
        r.costAfn ?? "",
        r.profitAfn ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
    const csv = "\uFEFF" + [header.map(csvCell).join(","), ...lines].join("\n");
    const url = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = "report.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.success("فایل CSV دانلود شد");
  };

  const totals = useMemo(() => {
    return {
      totalAfn: reportRows.reduce((s, r) => s + (r.totalAfn ?? 0), 0),
      costAfn: reportRows.reduce((s, r) => s + (r.costAfn ?? 0), 0),
      profitAfn: reportRows.reduce((s, r) => s + (r.profitAfn ?? 0), 0),
      count: reportRows.reduce((s, r) => s + (r.count ?? 0), 0),
    };
  }, [reportRows]);

  const promoTotals = useMemo(() => {
    return {
      totalAfn: promoRows.reduce((s, r) => s + (r.totalAfn ?? 0), 0),
      costAfn: promoRows.reduce((s, r) => s + (r.costAfn ?? 0), 0),
      profitAfn: promoRows.reduce((s, r) => s + (r.profitAfn ?? 0), 0),
      count: promoRows.reduce((s, r) => s + (r.count ?? 0), 0),
    };
  }, [promoRows]);

  // ── چاپ ──
  const printBody = () => {
    if (run?.type === "promotions" && run.section === "promotions") {
      return (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-slate-100">
              <th className="px-3 py-2 text-right">کد</th>
              <th className="px-3 py-2 text-right">نام طرح</th>
              <th className="px-3 py-2 text-right">وضعیت</th>
              <th className="px-3 py-2 text-right">نوع</th>
              <th className="px-3 py-2 text-right">تأمین‌کننده</th>
              <th className="px-3 py-2 text-right">از</th>
              <th className="px-3 py-2 text-right">تا</th>
              <th className="px-3 py-2 text-right">دفعات استفاده</th>
              <th className="px-3 py-2 text-right">مجموع تخفیف</th>
              <th className="px-3 py-2 text-right">ارزش کالای رایگان</th>
            </tr>
          </thead>
          <tbody>
            {promoListRows.map((r) => (
              <tr key={r.key} className="border-b">
                <td dir="ltr" className="px-3 py-2 text-right">
                  {r.code}
                </td>
                <td className="px-3 py-2 font-semibold">{r.name}</td>
                <td className="px-3 py-2">
                  {PROMO_STATUS_META[r.status]?.label ?? r.status}
                </td>
                <td className="px-3 py-2">{r.typeLabel}</td>
                <td className="px-3 py-2">{r.supplierName || "—"}</td>
                <td className="px-3 py-2">
                  {r.startDate ? formatHijriShort(r.startDate) : "—"}
                </td>
                <td className="px-3 py-2">
                  {r.endDate ? formatHijriShort(r.endDate) : "—"}
                </td>
                <td className="px-3 py-2">{formatNumber(r.usageCount ?? 0)}</td>
                <td dir="ltr" className="px-3 py-2 text-left">
                  {formatMoney(r.discountAfn ?? 0)}
                </td>
                <td dir="ltr" className="px-3 py-2 text-left">
                  {formatMoney(r.freeValueAfn ?? 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    if (run?.type === "promotions") {
      const hasQty = promoRows.some((r) => r.quantity !== undefined);
      const hasCost = promoRows.some((r) => r.costAfn !== undefined);
      const hasProfit = promoRows.some((r) => r.profitAfn !== undefined);
      return (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-slate-100">
              {promoColumns.map((c) => (
                <th key={c.key} className="px-3 py-2 text-right">
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {promoRows.map((r) => (
              <tr key={r.key} className="border-b">
                <td className="px-3 py-2 font-semibold">{r.label}</td>
                <td className="px-3 py-2">{formatNumber(r.count)}</td>
                {hasQty && (
                  <td className="px-3 py-2">
                    {formatNumber(r.quantity ?? 0, 2)}
                  </td>
                )}
                <td dir="ltr" className="px-3 py-2 text-left">
                  {formatMoney(r.totalAfn ?? 0)}
                </td>
                {hasCost && (
                  <td dir="ltr" className="px-3 py-2 text-left">
                    {formatMoney(r.costAfn ?? 0)}
                  </td>
                )}
                {hasProfit && (
                  <td
                    dir="ltr"
                    className={
                      (r.profitAfn ?? 0) >= 0
                        ? "px-3 py-2 text-left text-brand-soft-foreground"
                        : "px-3 py-2 text-left text-rose-600"
                    }
                  >
                    {formatMoney(r.profitAfn ?? 0)}
                  </td>
                )}
              </tr>
            ))}
            <tr className="border-t-2 bg-slate-50 font-bold">
              <td className="px-3 py-2">مجموع کل</td>
              <td className="px-3 py-2">{formatNumber(promoTotals.count)}</td>
              {hasQty && <td className="px-3 py-2">—</td>}
              <td dir="ltr" className="px-3 py-2 text-left">
                {formatMoney(promoTotals.totalAfn)}
              </td>
              {hasCost && (
                <td dir="ltr" className="px-3 py-2 text-left">
                  {formatMoney(promoTotals.costAfn)}
                </td>
              )}
              {hasProfit && (
                <td dir="ltr" className="px-3 py-2 text-left">
                  {formatMoney(promoTotals.profitAfn)}
                </td>
              )}
            </tr>
          </tbody>
        </table>
      );
    }
    if (run?.type === "financial" && financialSummary) {
      return (
        <table className="w-full border-collapse text-sm">
          <tbody>
            {FINANCIAL_ROWS.map((row) => (
              <tr key={row.key} className="border-b">
                <td className="px-3 py-2 font-medium">{row.label}</td>
                <td dir="ltr" className="px-3 py-2 text-left">
                  {formatMoney(financialSummary[row.key])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    if (run?.type === "currency") {
      return (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-slate-100">
              <th className="px-3 py-2 text-right">تاریخ</th>
              <th className="px-3 py-2 text-right">جوړه</th>
              <th className="px-3 py-2 text-right">خرید</th>
              <th className="px-3 py-2 text-right">فروش</th>
              <th className="px-3 py-2 text-right">منبع</th>
              <th className="px-3 py-2 text-right">ثبت‌کننده</th>
            </tr>
          </thead>
          <tbody>
            {currencyRows.map((r, i) => (
              <tr key={r.id ?? i} className="border-b">
                <td className="px-3 py-2">
                  {formatHijriDateTime(r.createdAt)}
                </td>
                <td dir="ltr" className="px-3 py-2 text-right">
                  {r.base} → {r.quote}
                </td>
                <td dir="ltr" className="px-3 py-2 text-right">
                  {fmtRate(r.buyRate)}
                </td>
                <td dir="ltr" className="px-3 py-2 text-right">
                  {fmtRate(r.sellRate)}
                </td>
                <td className="px-3 py-2">
                  {r.source === "API" ? "API" : "دستی"}
                </td>
                <td className="px-3 py-2">{r.recordedByName || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    const hasCost = reportRows.some((r) => r.costAfn !== undefined);
    const hasProfit = reportRows.some((r) => r.profitAfn !== undefined);
    const hasQty = reportRows.some((r) => r.quantity !== undefined);
    return (
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b bg-slate-100">
            <th className="px-3 py-2 text-right">عنوان</th>
            <th className="px-3 py-2 text-right">تعداد</th>
            {hasQty && <th className="px-3 py-2 text-right">مقدار</th>}
            <th className="px-3 py-2 text-right">مجموع (افغانی)</th>
            {hasCost && <th className="px-3 py-2 text-right">بهای تمام‌شده</th>}
            {hasProfit && <th className="px-3 py-2 text-right">منفعت</th>}
          </tr>
        </thead>
        <tbody>
          {reportRows.map((r) => (
            <tr key={r.key} className="border-b">
              <td className="px-3 py-2 font-semibold">{r.label}</td>
              <td className="px-3 py-2">{formatNumber(r.count)}</td>
              {hasQty && (
                <td className="px-3 py-2">
                  {formatNumber(r.quantity ?? 0, 2)}
                </td>
              )}
              <td dir="ltr" className="px-3 py-2 text-left">
                {formatMoney(r.totalAfn)}
              </td>
              {hasCost && (
                <td dir="ltr" className="px-3 py-2 text-left">
                  {formatMoney(r.costAfn)}
                </td>
              )}
              {hasProfit && (
                <td
                  dir="ltr"
                  className={
                    (r.profitAfn ?? 0) >= 0
                      ? "px-3 py-2 text-left text-brand-soft-foreground"
                      : "px-3 py-2 text-left text-rose-600"
                  }
                >
                  {formatMoney(r.profitAfn)}
                </td>
              )}
            </tr>
          ))}
          <tr className="border-t-2 bg-slate-50 font-bold">
            <td className="px-3 py-2">مجموع کل</td>
            <td className="px-3 py-2">{formatNumber(totals.count)}</td>
            {hasQty && <td className="px-3 py-2">—</td>}
            <td dir="ltr" className="px-3 py-2 text-left">
              {formatMoney(totals.totalAfn)}
            </td>
            {hasCost && (
              <td dir="ltr" className="px-3 py-2 text-left">
                {formatMoney(totals.costAfn)}
              </td>
            )}
            {hasProfit && (
              <td dir="ltr" className="px-3 py-2 text-left">
                {formatMoney(totals.profitAfn)}
              </td>
            )}
          </tr>
        </tbody>
      </table>
    );
  };

  return (
    <PermissionGate permission="reports.view">
      <div className="space-y-4">
        <PageHeader
          title="راپورها"
          description={`راپورهای فروش، خرید، موجودی، مالی، تخفیف و پروموشن و اسعار${user.branchName ? ` — شعبه ${user.branchName}` : ""}`}
        />

        {/* انتخاب نوع راپور */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {REPORT_TYPES.map((rt) => {
            const active = type === rt.key;
            const Icon = rt.icon;
            return (
              <button
                key={rt.key}
                type="button"
                onClick={() => selectType(rt.key)}
                className={cn(
                  "rounded-xl border p-4 text-right shadow-sm transition hover:border-brand/50",
                  active
                    ? "border-primary bg-brand-soft dark:border-brand/40 dark:bg-brand-soft"
                    : "bg-card",
                )}
              >
                <Icon
                  className={cn(
                    "h-5 w-5",
                    active
                      ? "text-brand-soft-foreground dark:text-brand-soft-foreground"
                      : "text-muted-foreground",
                  )}
                />
                <p className="mt-2 text-sm font-bold">{rt.label}</p>
                <p className="text-xs text-muted-foreground">{rt.desc}</p>
              </button>
            );
          })}
        </div>

        {/* گزینه‌ها و فیلترها */}
        <Card>
          <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
            {type !== "currency" && (
              <>
                <div className="space-y-1.5">
                  <Label>از تاریخ (هجری)</Label>
                  <Input
                    dir="ltr"
                    value={fromInput}
                    onChange={(e) => setFromInput(e.target.value)}
                    placeholder="۱۴۰۴/۰۱/۰۱"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>تا تاریخ (هجری)</Label>
                  <Input
                    dir="ltr"
                    value={toInput}
                    onChange={(e) => setToInput(e.target.value)}
                    placeholder="۱۴۰۴/۰۱/۰۱"
                  />
                </div>
              </>
            )}
            {user.isSuperAdmin && type !== "currency" && (
              <div className="space-y-1.5">
                <Label>شعبه</Label>
                <Select value={branchId} onValueChange={setBranchId}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">همه شعب</SelectItem>
                    {branchOptions.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {type === "sales" && (
              <>
                <div className="space-y-1.5">
                  <Label>گروه‌بندی</Label>
                  <Select value={groupBy} onValueChange={setGroupBy}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(SALES_GROUPS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>مشتری (اختیاری)</Label>
                  <Select value={customerId} onValueChange={setCustomerId}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">همه مشتریان</SelectItem>
                      {customerOptions.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>فروشنده (اختیاری)</Label>
                  <Select
                    value={salespersonId}
                    onValueChange={setSalespersonId}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">همه فروشندگان</SelectItem>
                      {salespersonOptions.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>منطقه (اختیاری)</Label>
                  <Select value={territoryId} onValueChange={setTerritoryId}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">همه مناطق</SelectItem>
                      {territoryOptions.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>محصول (اختیاری)</Label>
                  <Select value={productId} onValueChange={setProductId}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">همه محصولات</SelectItem>
                      {productOptions.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {type === "purchases" && (
              <>
                <div className="space-y-1.5">
                  <Label>گروه‌بندی</Label>
                  <Select value={groupBy} onValueChange={setGroupBy}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(PURCHASE_GROUPS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>تأمین‌کننده (اختیاری)</Label>
                  <Select value={supplierId} onValueChange={setSupplierId}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">همه تأمین‌کنندگان</SelectItem>
                      {supplierOptions.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>محصول (اختیاری)</Label>
                  <Select value={productId} onValueChange={setProductId}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">همه محصولات</SelectItem>
                      {productOptions.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {type === "inventory" && (
              <>
                <div className="space-y-1.5">
                  <Label>نوع راپور موجودی</Label>
                  <Select value={invType} onValueChange={setInvType}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(INVENTORY_TYPES).map(([k, v]) => (
                        <SelectItem key={k} value={k}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>گدام (اختیاری)</Label>
                  <Select value={warehouseId} onValueChange={setWarehouseId}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">همه گدام‌ها</SelectItem>
                      {warehouseOptions.map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {type === "promotions" && (
              <>
                <div className="space-y-1.5">
                  <Label>بخش راپور</Label>
                  <Select
                    value={promoSection}
                    onValueChange={setPromoSection}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(PROMO_SECTIONS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {(promoSection === "summary" ||
                  promoSection === "byCustomer") && (
                  <div className="space-y-1.5">
                    <Label>مشتری (اختیاری)</Label>
                    <Select value={customerId} onValueChange={setCustomerId}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">همه مشتریان</SelectItem>
                        {customerOptions.map((o) => (
                          <SelectItem key={o.id} value={o.id}>
                            {o.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {(promoSection === "summary" ||
                  promoSection === "bySupplier" ||
                  promoSection === "promotions") && (
                  <div className="space-y-1.5">
                    <Label>تأمین‌کننده (اختیاری)</Label>
                    <Select value={supplierId} onValueChange={setSupplierId}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">همه تأمین‌کنندگان</SelectItem>
                        {supplierOptions.map((o) => (
                          <SelectItem key={o.id} value={o.id}>
                            {o.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {promoSection === "byProduct" && (
                  <div className="space-y-1.5">
                    <Label>محصول (اختیاری)</Label>
                    <Select value={productId} onValueChange={setProductId}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">همه محصولات</SelectItem>
                        {productOptions.map((o) => (
                          <SelectItem key={o.id} value={o.id}>
                            {o.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </>
            )}

            <div className="flex items-end">
              <Button
                onClick={showReport}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 sm:w-fit"
              >
                <BarChart3 className="h-4 w-4" />
                نمایش راپور
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* نتیجه */}
        {!run ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed">
            <BarChart3 className="h-10 w-10 text-muted-foreground opacity-40" />
            <p className="text-sm text-muted-foreground">
              نوع راپور و فیلترها را انتخاب کرده و دکمه «نمایش راپور» را بزنید
            </p>
          </div>
        ) : run.type === "financial" ? (
          <div className="space-y-4">
            {!financialSummary && !runLoading && (
              <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                راپوری برای نمایش وجود ندارد — فیلترها را تغییر دهید
              </div>
            )}
            {financialSummary && (
              <>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                  <StatCard
                    label="عواید"
                    value={formatMoney(financialSummary.revenueAfn)}
                    tone="slate"
                  />
                  <StatCard
                    label="برگشتی‌ها"
                    value={formatMoney(financialSummary.salesReturnsAfn)}
                    tone="amber"
                  />
                  <StatCard
                    label="عواید خالص"
                    value={formatMoney(financialSummary.netRevenueAfn)}
                    tone="emerald"
                  />
                  <StatCard
                    label="بهای تمام‌شده"
                    value={formatMoney(financialSummary.cogsAfn)}
                    tone="amber"
                  />
                  <StatCard
                    label="منفعت ناخالص"
                    value={formatMoney(financialSummary.grossProfitAfn)}
                    tone={
                      financialSummary.grossProfitAfn >= 0 ? "emerald" : "rose"
                    }
                  />
                  <StatCard
                    label="مصارف"
                    value={formatMoney(financialSummary.expensesAfn)}
                    tone="rose"
                  />
                  <StatCard
                    label="منفعت خالص"
                    value={formatMoney(financialSummary.netProfitAfn)}
                    tone={
                      financialSummary.netProfitAfn >= 0 ? "emerald" : "rose"
                    }
                  />
                  <StatCard
                    label="مطالبات"
                    value={formatMoney(financialSummary.receivablesAfn)}
                    tone="slate"
                  />
                  <StatCard
                    label="بدهی‌ها"
                    value={formatMoney(financialSummary.payablesAfn)}
                    tone="rose"
                  />
                  <StatCard
                    label="ارزش موجودی"
                    value={formatMoney(financialSummary.inventoryValueAfn)}
                    tone="emerald"
                  />
                </div>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">خلاصه مالی دوره</CardTitle>
                    {periodLabel && (
                      <CardDescription>دوره: {periodLabel}</CardDescription>
                    )}
                  </CardHeader>
                  <CardContent>
                    <table className="w-full text-sm">
                      <tbody>
                        {FINANCIAL_ROWS.map((row) => (
                          <tr key={row.key} className="border-b last:border-0">
                            <td className="px-2 py-2.5 font-medium">
                              {row.label}
                            </td>
                            <td
                              dir="ltr"
                              className="px-2 py-2.5 text-left font-semibold"
                            >
                              {formatMoney(financialSummary[row.key])}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        ) : run.type === "promotions" ? (
          <div className="space-y-4">
            {run.section === "summary" && promoSummary && (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <StatCard
                  label="تخفیف فروشات (صادرشده)"
                  value={formatMoney(promoSummary.totalIssuedAfn)}
                  tone="rose"
                />
                <StatCard
                  label="تخفیف خریدها (از تأمین‌کنندگان)"
                  value={formatMoney(promoSummary.totalReceivedAfn)}
                  tone="emerald"
                />
                <StatCard
                  label="تخفیف پروموشن‌ها"
                  value={formatMoney(promoSummary.totalPromoDiscountAfn)}
                  tone="amber"
                />
                <StatCard
                  label="ارزش کالای رایگان"
                  value={formatMoney(promoSummary.freeGoodsValueAfn)}
                  tone="amber"
                />
                <StatCard
                  label="تأثیر بر منفعت"
                  value={formatMoney(promoSummary.profitImpactAfn)}
                  tone={promoSummary.profitImpactAfn >= 0 ? "emerald" : "rose"}
                />
              </div>
            )}
            {run.section === "promotions" ? (
              <Card>
                <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className="text-base">{currentTitle}</CardTitle>
                    <CardDescription>
                      طرح‌های تشویقی با وضعیت فعلی (فعال، در انتظار، منقضی)
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" onClick={exportCsv}>
                      <FileDown className="h-4 w-4" />
                      خروجی CSV
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPrintMode(true)}
                      disabled={promoListRows.length === 0}
                    >
                      <Printer className="h-4 w-4" />
                      چاپ
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <DataTable<PromoListRow>
                    columns={promoListColumns}
                    rows={promoListRows}
                    searchKeys={["code", "name", "supplierName", "typeLabel"]}
                    searchPlaceholder="جستجو در طرح‌ها..."
                    loading={runLoading}
                    emptyText="طرح تشویقی ثبت نشده است"
                    rowKey={(r) => r.key}
                  />
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className="text-base">{currentTitle}</CardTitle>
                    {periodLabel && (
                      <CardDescription>دوره: {periodLabel}</CardDescription>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" onClick={exportCsv}>
                      <FileDown className="h-4 w-4" />
                      خروجی CSV
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPrintMode(true)}
                      disabled={promoRows.length === 0}
                    >
                      <Printer className="h-4 w-4" />
                      چاپ
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <DataTable<ReportRow>
                    columns={promoColumns}
                    rows={promoRows}
                    searchKeys={["label"]}
                    searchPlaceholder="جستجو در راپور..."
                    loading={runLoading}
                    emptyText="راپوری برای نمایش وجود ندارد — فیلترها را تغییر دهید"
                    rowKey={(r) => r.key}
                    footer={
                      promoRows.length > 0
                        ? `مجموع کل: ${formatMoney(promoTotals.totalAfn)}${
                            promoRows.some((r) => r.profitAfn !== undefined)
                              ? ` — تأثیر منفعت: ${formatMoney(promoTotals.profitAfn)}`
                              : ""
                          }`
                        : undefined
                    }
                  />
                </CardContent>
              </Card>
            )}
          </div>
        ) : run.type === "currency" ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{currentTitle}</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable<RateRow>
                columns={currencyColumns}
                rows={currencyRows}
                searchKeys={["base", "quote", "recordedByName"]}
                searchPlaceholder="جستجو..."
                loading={runLoading}
                emptyText="راپوری برای نمایش وجود ندارد — فیلترها را تغییر دهید"
                rowKey={(r, i) => r.id ?? `${r.base}/${r.quote}/${i}`}
              />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base">{currentTitle}</CardTitle>
                {periodLabel && (
                  <CardDescription>دوره: {periodLabel}</CardDescription>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={exportCsv}>
                  <FileDown className="h-4 w-4" />
                  خروجی CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPrintMode(true)}
                  disabled={reportRows.length === 0}
                >
                  <Printer className="h-4 w-4" />
                  چاپ
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <DataTable<ReportRow>
                columns={reportColumns}
                rows={reportRows}
                searchKeys={["label"]}
                searchPlaceholder="جستجو در راپور..."
                loading={runLoading}
                emptyText="راپوری برای نمایش وجود ندارد — فیلترها را تغییر دهید"
                rowKey={(r) => r.key}
                footer={
                  reportRows.length > 0
                    ? `مجموع کل: ${formatMoney(totals.totalAfn)}${
                        reportRows.some((r) => r.profitAfn !== undefined)
                          ? ` — منفعت: ${formatMoney(totals.profitAfn)}`
                          : ""
                      }`
                    : undefined
                }
              />
            </CardContent>
          </Card>
        )}
      </div>

      {/* بلوک چاپ */}
      {printMode && (
        <div
          id="print-root"
          dir="rtl"
          className="print-doc fixed inset-0 z-[100] overflow-auto bg-white p-8 text-slate-900"
        >
          <div className="mb-4 border-b pb-3 text-center">
            <h2 className="text-lg font-bold">{companyName}</h2>
            <p className="mt-1 text-sm font-semibold">{currentTitle}</p>
            {periodLabel && (
              <p className="text-xs text-slate-500">دوره: {periodLabel}</p>
            )}
            <p className="text-xs text-slate-500">
              تاریخ چاپ: {formatHijriDateTime(new Date())}
            </p>
          </div>
          {printBody()}
        </div>
      )}
    </PermissionGate>
  );
}
