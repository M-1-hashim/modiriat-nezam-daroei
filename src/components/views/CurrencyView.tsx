"use client";

/**
 * ویو اسعار — نرخ‌های زنده از API معتبر، ماتریس تبدیل ارزها، مدیریت ارزهای
 * قابل توسعه (USD/AFN/EUR/PKR/IRR/...)، ثبت دستی، تنظیمات و تاریخچه.
 *
 * - نرخ‌ها به‌صورت خودکار (زمان‌بند سمت سرور) و دستی از منبع معتبر دریافت می‌شوند.
 * - در صورت قطع انترنت، آخرین نرخ معتبر ذخیره‌شده نمایش داده می‌شود و وضعیت
 *   همگام‌سازی شفاف نشان داده می‌گردد — هیچ نرخ ساختگی نمایش داده نمی‌شود.
 * - کلید API هرگز از سرور به Frontend ارسال نمی‌شود (فقط apiKeySet).
 * - محاسبهٔ نرخ‌های متقاطع: rate(A→B) = rates[B] / rates[A] (USD-base)
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  RefreshCw,
  PenLine,
  Settings2,
  ArrowLeftRight,
  Wifi,
  Plus,
  Pencil,
  Trash2,
  Coins,
  CircleCheck,
  CircleAlert,
  CircleX,
  Globe,
} from "lucide-react";
import { useUser, PermissionGate } from "@/components/shared/use-user";
import { PageHeader, BADGE_TONES } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FormDialog } from "@/components/shared/form-dialog";
import { useApiData, apiSend } from "@/lib/client-api";
import { runBulkOperation, bulkResultMessage } from "@/lib/bulk";
import { formatNumber, formatHijriDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
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
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// ─────────────────────────── انواع ───────────────────────────

type RateRow = {
  id?: string;
  base: string;
  quote: string;
  buyRate: number;
  sellRate: number;
  source: string;
  isOffline?: boolean;
  createdAt?: string;
  recordedByName?: string | null;
};

type CurrencyRow = {
  id: string;
  code: string;
  name: string;
  symbol: string | null;
  isActive: boolean;
  isBase: boolean;
  sortOrder: number;
};

type CurrencySettings = {
  apiEndpoint: string;
  apiKeySet?: boolean;
  refreshMinutes: number;
  mapping: string;
  spreadPercent: number;
  enabled: boolean;
  lastSyncAt?: string | null;
  lastSyncStatus?: string | null;
  lastSyncError?: string | null;
};

type SettingsForm = {
  apiEndpoint: string;
  refreshMinutes: string;
  mapping: string;
  spreadPercent: string;
  enabled: boolean;
};

const REFRESH_DEFAULT_MINUTES = 15;
const SPREAD_DEFAULT = 1;

/** منابع آماده برای تغییر سریع منبع نرخ از تنظیمات (قابل گسترش) */
const RATE_SOURCE_PRESETS: { id: string; label: string; endpoint: string; needsKey: boolean }[] = [
  {
    id: "sarafi",
    label: "sarafi.af — بازار واقعی افغانستان (پیش‌فرض)",
    endpoint: "https://sarafi.af/",
    needsKey: false,
  },
  {
    id: "er-api",
    label: "ExchangeRate-API — بدون کلید",
    endpoint: "https://open.er-api.com/v6/latest/USD",
    needsKey: false,
  },
  {
    id: "currency-api",
    label: "Currency-API pages.dev — بدون کلید",
    endpoint: "https://latest.currency-api.pages.dev/v1/currencies/usd.json",
    needsKey: false,
  },
  {
    id: "openexchangerates",
    label: "Open Exchange Rates — با کلید",
    endpoint: "https://openexchangerates.org/api/latest.json",
    needsKey: true,
  },
];

// ─────────────────────────── کمکی ───────────────────────────

function parseRates(data: unknown): { latest: RateRow[]; history: RateRow[] } {
  if (Array.isArray(data)) return { latest: [], history: data as RateRow[] };
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    const latest = Array.isArray(o.latest) ? (o.latest as RateRow[]) : [];
    let history = Array.isArray(o.history) ? (o.history as RateRow[]) : [];
    if (history.length === 0 && Array.isArray(o.items))
      history = o.items as RateRow[];
    return { latest, history };
  }
  return { latest: [], history: [] };
}

function parseSettings(data: unknown): CurrencySettings | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  if (typeof o.apiEndpoint !== "string") return null;
  return {
    apiEndpoint: o.apiEndpoint,
    apiKeySet: Boolean(o.apiKeySet),
    refreshMinutes: Number(o.refreshMinutes) || REFRESH_DEFAULT_MINUTES,
    mapping: typeof o.mapping === "string" ? o.mapping : "",
    spreadPercent: Number.isFinite(Number(o.spreadPercent))
      ? Number(o.spreadPercent)
      : SPREAD_DEFAULT,
    enabled: o.enabled !== false,
    lastSyncAt: typeof o.lastSyncAt === "string" ? o.lastSyncAt : null,
    lastSyncStatus:
      typeof o.lastSyncStatus === "string" ? o.lastSyncStatus : null,
    lastSyncError: typeof o.lastSyncError === "string" ? o.lastSyncError : null,
  };
}

function parseCurrencies(data: unknown): CurrencyRow[] {
  if (data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).items)) {
    return (data as { items: CurrencyRow[] }).items;
  }
  return [];
}

/** برچسب منبع نرخ — API/SARAFI خودکار و بقیه دستی */
const SOURCE_LABELS: Record<string, string> = {
  API: "API",
  SARAFI: "sarafi.af",
};

function sourceLabel(source?: string | null): string {
  return (source && SOURCE_LABELS[source]) || "دستی";
}

function isAutoSource(source?: string | null): boolean {
  return !!source && source in SOURCE_LABELS;
}

function SourceBadge({ source }: { source?: string | null }) {
  const isAuto = isAutoSource(source);
  return (
    <Badge
      variant="outline"
      className={BADGE_TONES[isAuto ? "emerald" : "slate"]}
    >
      {sourceLabel(source)}
    </Badge>
  );
}

/** نمایش نرخ با دقت مناسب — نرخ‌های ریز (مثل IRR→AFN) تا ۸ رقم اعشار */
function fmtRate(n: number | null | undefined): string {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  const decimals = v >= 10 ? 2 : v >= 0.01 ? 4 : 8;
  return formatNumber(v, decimals);
}

function safeHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

// ─────────────────────────── ویو ───────────────────────────

export default function CurrencyView() {
  const { hasPermission } = useUser();
  const canEdit = hasPermission("currency.edit");

  // ارزها
  const {
    data: currenciesData,
    loading: currenciesLoading,
    refetch: refetchCurrencies,
  } = useApiData<unknown>("/api/currencies");
  const currencies = useMemo(() => parseCurrencies(currenciesData), [currenciesData]);
  const activeCurrencies = useMemo(
    () => currencies.filter((c) => c.isActive),
    [currencies],
  );

  // ارز محلی — افغانی در صورت وجود، وگرنه اولین ارز فعال
  const localCurrency = useMemo(
    () =>
      activeCurrencies.find((c) => c.code === "AFN") ??
      activeCurrencies[0] ??
      null,
    [activeCurrencies],
  );

  // نرخ‌ها
  const {
    data: ratesData,
    loading: ratesLoading,
    refetch: refetchRates,
  } = useApiData<unknown>("/api/exchange-rates?limit=100");
  const { latest, history } = useMemo(() => parseRates(ratesData), [ratesData]);

  // آخرین نرخ هر جوړه (از latest و در صورت نیاز از history)
  const latestByPair = useMemo(() => {
    const map = new Map<string, RateRow>();
    for (const r of [...latest, ...history]) {
      const key = `${r.base}/${r.quote}`;
      if (!map.has(key)) map.set(key, r);
    }
    return map;
  }, [latest, history]);

  // تنظیمات
  const { data: settingsData, refetch: refetchSettings } = useApiData<unknown>(
    "/api/exchange-rates/settings",
  );
  const settings = useMemo(() => parseSettings(settingsData), [settingsData]);

  const [settingsForm, setSettingsForm] = useState<SettingsForm>({
    apiEndpoint: "",
    refreshMinutes: String(REFRESH_DEFAULT_MINUTES),
    mapping: "",
    spreadPercent: String(SPREAD_DEFAULT),
    enabled: true,
  });
  const [newApiKey, setNewApiKey] = useState("");
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  useEffect(() => {
    if (settings && !settingsLoaded) {
      setSettingsForm({
        apiEndpoint: settings.apiEndpoint,
        refreshMinutes: String(settings.refreshMinutes),
        mapping: settings.mapping,
        spreadPercent: String(settings.spreadPercent ?? SPREAD_DEFAULT),
        enabled: settings.enabled,
      });
      setSettingsLoaded(true);
      setNewApiKey("");
    }
  }, [settings, settingsLoaded]);

  // دیالوگ نرخ دستی — بر اساس ارزهای فعال (قابل توسعه)
  const [manualOpen, setManualOpen] = useState(false);
  const [manualRows, setManualRows] = useState<
    Record<string, { buy: string; sell: string }>
  >({});
  const [savingManual, setSavingManual] = useState(false);

  const [refreshing, setRefreshing] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  const refreshMinutes = settings?.refreshMinutes ?? REFRESH_DEFAULT_MINUTES;

  const isStale = (r?: RateRow): boolean => {
    if (!r) return false;
    if (r.isOffline) return true;
    if (!r.createdAt) return false;
    const ageMin = (Date.now() - new Date(r.createdAt).getTime()) / 60000;
    return ageMin > 2 * refreshMinutes;
  };

  // ─── مدیریت ارزها ───
  const [currencySelectedIds, setCurrencySelectedIds] = useState<string[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    code: "",
    name: "",
    symbol: "",
    sortOrder: "100",
  });
  const [savingAdd, setSavingAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<CurrencyRow | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    symbol: "",
    sortOrder: "100",
    isActive: true,
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CurrencyRow | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDisableOpen, setBulkDisableOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const refreshFromApi = async () => {
    setRefreshing(true);
    try {
      await apiSend("/api/exchange-rates", { body: { source: "API" } });
      toast.success("نرخ‌ها از منبع انترنتی به‌روزرسانی شد");
      refetchRates();
      refetchSettings();
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : "به‌روزرسانی از انترنت ناموفق بود — آخرین نرخ معتبر نمایش داده می‌شود",
      );
    } finally {
      setRefreshing(false);
    }
  };

  const openManual = () => {
    const others = activeCurrencies.filter(
      (c) => localCurrency && c.code !== localCurrency.code,
    );
    if (!localCurrency || others.length === 0) {
      toast.error("برای ثبت دستی، حداقل دو ارز فعال لازم است");
      return;
    }
    const next: Record<string, { buy: string; sell: string }> = {};
    for (const c of others) {
      const r = latestByPair.get(`${c.code}/${localCurrency.code}`);
      next[`${c.code}/${localCurrency.code}`] = {
        buy: r ? String(r.buyRate) : "",
        sell: r ? String(r.sellRate) : "",
      };
    }
    setManualRows(next);
    setManualOpen(true);
  };

  const submitManual = async () => {
    if (!localCurrency) return;
    const rates: {
      base: string;
      quote: string;
      buyRate: number;
      sellRate: number;
    }[] = [];
    for (const c of activeCurrencies) {
      if (c.code === localCurrency.code) continue;
      const key = `${c.code}/${localCurrency.code}`;
      const v = manualRows[key];
      if (!v) continue;
      const buy = Number(v.buy);
      const sell = Number(v.sell);
      if (buy > 0 && sell > 0) {
        rates.push({ base: c.code, quote: localCurrency.code, buyRate: buy, sellRate: sell });
      }
    }
    if (rates.length === 0) {
      toast.error("حداقل یک جوړه نرخ را کامل (خرید و فروش) وارد کنید");
      return;
    }
    setSavingManual(true);
    try {
      await apiSend("/api/exchange-rates", {
        body: { source: "MANUAL", rates },
      });
      toast.success("نرخ‌های دستی با نام شما ثبت شد");
      setManualOpen(false);
      refetchRates();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ثبت نرخ دستی ناموفق بود");
    } finally {
      setSavingManual(false);
    }
  };

  const submitSettings = async () => {
    const minutes = Number(settingsForm.refreshMinutes);
    if (!minutes || minutes <= 0) {
      toast.error("بازه به‌روزرسانی را درست وارد کنید");
      return;
    }
    const spread = Number(settingsForm.spreadPercent);
    if (!Number.isFinite(spread) || spread < 0 || spread > 50) {
      toast.error("اسپرد خرید/فروش باید عددی بین ۰ تا ۵۰ باشد");
      return;
    }
    setSavingSettings(true);
    try {
      await apiSend("/api/exchange-rates/settings", {
        method: "PUT",
        body: {
          apiEndpoint: settingsForm.apiEndpoint.trim(),
          apiKey: newApiKey.trim() || undefined, // فقط اگر کلید جدید وارد شده باشد
          refreshMinutes: minutes,
          spreadPercent: spread,
          mapping: settingsForm.mapping,
          enabled: settingsForm.enabled,
        },
      });
      toast.success("تنظیمات اسعار ذخیره شد");
      setSettingsLoaded(false);
      refetchSettings();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ذخیره تنظیمات ناموفق بود");
    } finally {
      setSavingSettings(false);
    }
  };

  const removeApiKey = async () => {
    setSavingSettings(true);
    try {
      await apiSend("/api/exchange-rates/settings", {
        method: "PUT",
        body: { apiKey: null },
      });
      toast.success("کلید API حذف شد");
      setSettingsLoaded(false);
      refetchSettings();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "حذف کلید ناموفق بود");
    } finally {
      setSavingSettings(false);
    }
  };

  // ─── عملیات ارزها ───
  const submitAddCurrency = async () => {
    const code = addForm.code.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) {
      toast.error("کد ارز باید سه حرف انگلیسی باشد (مثال: CNY)");
      return;
    }
    if (!addForm.name.trim()) {
      toast.error("نام ارز الزامی است");
      return;
    }
    setSavingAdd(true);
    try {
      await apiSend("/api/currencies", {
        body: {
          code,
          name: addForm.name.trim(),
          symbol: addForm.symbol.trim() || undefined,
          sortOrder: Number(addForm.sortOrder) || 100,
        },
      });
      toast.success(`ارز ${code} اضافه شد`);
      setAddOpen(false);
      setAddForm({ code: "", name: "", symbol: "", sortOrder: "100" });
      refetchCurrencies();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "افزودن ارز ناموفق بود");
    } finally {
      setSavingAdd(false);
    }
  };

  const openEditCurrency = (c: CurrencyRow) => {
    setEditTarget(c);
    setEditForm({
      name: c.name,
      symbol: c.symbol ?? "",
      sortOrder: String(c.sortOrder),
      isActive: c.isActive,
    });
  };

  const submitEditCurrency = async () => {
    if (!editTarget) return;
    if (!editForm.name.trim()) {
      toast.error("نام ارز الزامی است");
      return;
    }
    setSavingEdit(true);
    try {
      await apiSend(`/api/currencies/${editTarget.id}`, {
        method: "PUT",
        body: {
          name: editForm.name.trim(),
          symbol: editForm.symbol.trim() || null,
          sortOrder: Number(editForm.sortOrder) || 0,
          isActive: editForm.isActive,
        },
      });
      toast.success("ارز ویرایش شد");
      setEditTarget(null);
      refetchCurrencies();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ویرایش ارز ناموفق بود");
    } finally {
      setSavingEdit(false);
    }
  };

  const deleteCurrency = async (c: CurrencyRow) => {
    setDeleting(true);
    try {
      const res = await apiSend<{ softDeleted?: boolean; message?: string }>(
        `/api/currencies/${c.id}`,
        { method: "DELETE" },
      );
      const soft = res && !("queued" in res && res.queued) ? (res as { softDeleted?: boolean; message?: string }) : null;
      if (soft?.softDeleted) toast.warning(soft.message ?? "ارز غیرفعال شد");
      else toast.success(`ارز ${c.code} حذف شد`);
      setDeleteTarget(null);
      refetchCurrencies();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "حذف ارز ناموفق بود");
    } finally {
      setDeleting(false);
    }
  };

  const bulkDeleteCurrencies = async () => {
    const eligible = currencySelectedIds.filter((id) => {
      const c = currencies.find((x) => x.id === id);
      return c && !c.isBase;
    });
    if (eligible.length === 0) {
      toast.error("ارز پایه (دالر) قابل حذف نیست");
      return;
    }
    setDeleting(true);
    try {
      const result = await runBulkOperation(eligible, (id) =>
        apiSend(`/api/currencies/${id}`, { method: "DELETE" }),
      );
      const msg = bulkResultMessage("حذف گروهی ارزها", result);
      if (msg.tone === "success") toast.success(msg.message);
      else if (msg.tone === "warning") toast.warning(msg.message);
      else toast.error(msg.message);
      setBulkDeleteOpen(false);
      setCurrencySelectedIds([]);
      refetchCurrencies();
    } finally {
      setDeleting(false);
    }
  };

  const bulkToggleCurrencies = async (isActive: boolean) => {
    const eligible = currencySelectedIds.filter((id) => {
      const c = currencies.find((x) => x.id === id);
      return c && !c.isBase;
    });
    if (eligible.length === 0) {
      toast.error("ارز پایه (دالر) قابل تغییر وضعیت نیست");
      return;
    }
    setDeleting(true);
    try {
      const result = await runBulkOperation(eligible, (id) =>
        apiSend(`/api/currencies/${id}`, { method: "PUT", body: { isActive } }),
      );
      const msg = bulkResultMessage(
        isActive ? "فعال‌سازی گروهی" : "غیرفعال‌سازی گروهی",
        result,
      );
      if (msg.tone === "success") toast.success(msg.message);
      else if (msg.tone === "warning") toast.warning(msg.message);
      else toast.error(msg.message);
      setCurrencySelectedIds([]);
      refetchCurrencies();
    } finally {
      setDeleting(false);
    }
  };

  // ─── ستون‌های جدول ارزها ───
  const currencyColumns: Column<CurrencyRow>[] = useMemo(
    () => [
      {
        key: "code",
        header: "کد",
        render: (c) => (
          <span dir="ltr" className="font-bold">
            {c.code}
            {c.isBase && (
              <Badge variant="outline" className="mr-2 border-slate-300 text-slate-600">
                ارز پایه
              </Badge>
            )}
          </span>
        ),
      },
      { key: "name", header: "نام ارز" },
      {
        key: "symbol",
        header: "نماد",
        render: (c) => <span dir="ltr">{c.symbol || "—"}</span>,
      },
      { key: "sortOrder", header: "ترتیب" },
      {
        key: "isActive",
        header: "وضعیت",
        render: (c) => (
          <Badge
            variant="outline"
            className={BADGE_TONES[c.isActive ? "emerald" : "slate"]}
          >
            {c.isActive ? "فعال" : "غیرفعال"}
          </Badge>
        ),
      },
      {
        key: "actions",
        header: "عملیات",
        sortable: false,
        render: (c) =>
          canEdit ? (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => openEditCurrency(c)}
                aria-label={`ویرایش ارز ${c.code}`}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              {!c.isBase && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-rose-600 hover:text-rose-700"
                  onClick={() => setDeleteTarget(c)}
                  aria-label={`حذف ارز ${c.code}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
    ],
    [canEdit, currencies],
  );

  // ─── ستون‌های تاریخچه (جوړه اول = اطلاعات اصلی در سمت راست) ───
  const historyColumns: Column<RateRow>[] = useMemo(
    () => [
      {
        key: "pair",
        header: "جوړه ارز",
        render: (r) => (
          <span dir="ltr" className="font-semibold">
            {r.base} → {r.quote}
          </span>
        ),
      },
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
        render: (r) =>
          r.recordedByName || (isAutoSource(r.source) ? `سیستم (${sourceLabel(r.source)})` : "—"),
      },
    ],
    [],
  );

  // ─── وضعیت همگام‌سازی ───
  const syncStatus = settings?.lastSyncStatus;
  const syncBadge =
    syncStatus === "OK"
      ? {
          tone: "emerald" as const,
          icon: <CircleCheck className="h-4 w-4" />,
          label: "همگام‌سازی موفق",
        }
      : syncStatus === "FAILED"
        ? {
            tone: "rose" as const,
            icon: <CircleX className="h-4 w-4" />,
            label: "آخرین همگام‌سازی ناموفق",
          }
        : {
            tone: "slate" as const,
            icon: <CircleAlert className="h-4 w-4" />,
            label: "همگام‌سازی نشده",
          };

  const manualPairs = useMemo(
    () =>
      localCurrency
        ? activeCurrencies
            .filter((c) => c.code !== localCurrency.code)
            .map((c) => ({
              base: c.code,
              quote: localCurrency.code,
              label: `${c.name} → ${localCurrency.name}`,
            }))
        : [],
    [activeCurrencies, localCurrency],
  );

  return (
    <PermissionGate permission="currency.view">
      <div className="space-y-4">
        <PageHeader
          title="نرخ اسعار"
          description="نرخ خرید و فروش اسعار — دریافت خودکار از منبع معتبر انترنتی"
          actions={
            canEdit ? (
              <div className="flex flex-col items-end gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    onClick={() => void refreshFromApi()}
                    disabled={refreshing}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    <RefreshCw
                      className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
                    />
                    به‌روزرسانی از انترنت
                  </Button>
                  <Button variant="outline" onClick={openManual}>
                    <PenLine className="h-4 w-4" />
                    ثبت نرخ دستی
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  منبع: <span dir="ltr">{settings ? safeHost(settings.apiEndpoint) : "—"}</span>
                  {" / "}قابل تنظیم در بخش تنظیمات
                </p>
              </div>
            ) : null
          }
        />

        {/* نوار وضعیت همگام‌سازی */}
        <Card>
          <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={BADGE_TONES[syncBadge.tone]}
              >
                <span className="flex items-center gap-1">
                  {syncBadge.icon}
                  {syncBadge.label}
                </span>
              </Badge>
              {settings?.enabled ? (
                <Badge variant="outline" className={BADGE_TONES["slate"]}>
                  <span className="flex items-center gap-1">
                    <RefreshCw className="h-3 w-3" />
                    به‌روزرسانی خودکار فعال (هر{" "}
                    {formatNumber(refreshMinutes)} دقیقه)
                  </span>
                </Badge>
              ) : (
                <Badge variant="outline" className={BADGE_TONES["slate"]}>
                  به‌روزرسانی خودکار غیرفعال
                </Badge>
              )}
              {settings?.lastSyncAt && (
                <Badge
                  variant="outline"
                  className={
                    settings.lastSyncStatus === "OK"
                      ? BADGE_TONES["emerald"]
                      : BADGE_TONES["amber"]
                  }
                >
                  {settings.lastSyncStatus === "OK"
                    ? "نرخ‌های به‌روز"
                    : "آخرین نرخ به‌روزرسانی‌شده — دریافت جدید ناموفق"}
                </Badge>
              )}
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Globe className="h-3.5 w-3.5" />
                منبع: <span dir="ltr">{settings ? safeHost(settings.apiEndpoint) : "—"}</span>
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {settings?.lastSyncAt
                ? `آخرین به‌روزرسانی: ${formatHijriDateTime(settings.lastSyncAt)}`
                : "هنوز همگام‌سازی نشده — دکمهٔ به‌روزرسانی را بزنید"}
            </div>
          </CardContent>
          {settings?.lastSyncStatus === "FAILED" && settings.lastSyncError && (
            <CardContent className="pt-0">
              <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300">
                <p className="font-bold">خطای آخرین همگام‌سازی:</p>
                <p dir="auto" className="mt-1">
                  {settings.lastSyncError}
                </p>
                <p className="mt-1">
                  در این حالت آخرین نرخ‌های معتبر ذخیره‌شده نمایش داده می‌شوند و هیچ
                  نرخ اشتباهی ثبت نمی‌شود.
                </p>
              </div>
            </CardContent>
          )}
        </Card>

        {/* کارت‌های نرخ فعلی — هر ارز فعال نسبت به ارز محلی */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {manualPairs.map((p) => {
            const r = latestByPair.get(`${p.base}/${p.quote}`);
            return (
              <Card key={`${p.base}-${p.quote}`}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold">{p.label}</p>
                      <p dir="ltr" className="text-xs text-muted-foreground">
                        {p.base}/{p.quote}
                      </p>
                    </div>
                    {r && <SourceBadge source={r.source} />}
                  </div>
                  {r ? (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-md border bg-slate-50 p-2 text-center dark:bg-slate-900">
                          <p className="text-xs text-muted-foreground">خرید</p>
                          <p dir="ltr" className="text-lg font-bold">
                            {fmtRate(r.buyRate)}
                          </p>
                        </div>
                        <div className="rounded-md border border-brand/40 bg-brand-soft p-2 text-center dark:border-brand/40 dark:bg-brand-soft">
                          <p className="text-xs text-muted-foreground">فروش</p>
                          <p
                            dir="ltr"
                            className="text-lg font-bold text-brand-soft-foreground dark:text-brand-soft-foreground"
                          >
                            {fmtRate(r.sellRate)}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{formatHijriDateTime(r.createdAt)}</span>
                        {isStale(r) && (
                          <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                            نرخ قدیمی/ذخیره‌شده
                          </span>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      نرخی برای این جوړه ثبت نشده است
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* ماتریس تبدیل ارزها */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Coins className="h-4 w-4" />
              ماتریس تبدیل ارزها
            </CardTitle>
            <CardDescription>
              هر خانه نشان می‌دهد ۱ واحد ارز سطر، چند واحد ارز ستون می‌شود —
              محاسبه از نرخ منبع: <span dir="ltr" className="font-mono">rate(A→B) = rates[B] / rates[A]</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {activeCurrencies.length < 2 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                برای نمایش ماتریس، حداقل دو ارز فعال لازم است
              </p>
            ) : (
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="p-2 text-right font-semibold">از ↓ / به ←</th>
                    {activeCurrencies.map((c) => (
                      <th key={c.code} className="p-2 text-center font-semibold">
                        <span dir="ltr">{c.code}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeCurrencies.map((rowCur) => (
                    <tr key={rowCur.code} className="border-b last:border-0">
                      <td className="p-2 font-bold">
                        <span dir="ltr">{rowCur.code}</span>
                      </td>
                      {activeCurrencies.map((colCur) => {
                        const r =
                          rowCur.code === colCur.code
                            ? null
                            : latestByPair.get(`${rowCur.code}/${colCur.code}`);
                        return (
                          <td key={colCur.code} className="p-2 text-center">
                            {r ? (
                              <span dir="ltr" className={isStale(r) ? "text-amber-700 dark:text-amber-300" : ""}>
                                {fmtRate(r.sellRate)}
                              </span>
                            ) : rowCur.code === colCur.code ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <span className="text-xs text-muted-foreground">نرخ ثبت نشده</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {/* مدیریت ارزها */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Coins className="h-4 w-4" />
              مدیریت ارزها
            </CardTitle>
            <CardDescription>
              لیست ارزهای سیستم — قابل توسعه؛ ارز جدید اضافه کنید تا در فرم‌ها و
              نرخ‌های خودکار شامل شود
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable<CurrencyRow>
              columns={currencyColumns}
              rows={currencies}
              searchKeys={["code", "name"]}
              searchPlaceholder="جستجوی ارز..."
              loading={currenciesLoading}
              emptyText="ارزی ثبت نشده است"
              rowKey={(c) => c.id}
              maxHeightClass="max-h-80"
              selectable={canEdit}
              getRowId={(c) => c.id}
              selectedIds={currencySelectedIds}
              onSelectionChange={setCurrencySelectedIds}
              bulkActions={
                canEdit ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={deleting}
                      onClick={() => void bulkToggleCurrencies(true)}
                    >
                      فعال‌سازی گروهی
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={deleting}
                      onClick={() => setBulkDisableOpen(true)}
                    >
                      غیرفعال‌سازی گروهی
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={deleting}
                      onClick={() => setBulkDeleteOpen(true)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      حذف گروهی
                    </Button>
                  </>
                ) : null
              }
              toolbar={
                canEdit ? (
                  <Button
                    size="sm"
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                    onClick={() => setAddOpen(true)}
                  >
                    <Plus className="h-4 w-4" />
                    افزودن ارز
                  </Button>
                ) : null
              }
            />
          </CardContent>
        </Card>

        {/* تنظیمات */}
        {canEdit && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Settings2 className="h-4 w-4" />
                تنظیمات به‌روزرسانی خودکار
              </CardTitle>
              <CardDescription>
                منبع انترنتی نرخ اسعار و نقشهٔ فیلدهای پاسخ JSON — کلید API فقط در
                سرور ذخیره می‌شود و هرگز به مرورگر ارسال نمی‌گردد
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* انتخاب سریع منبع نرخ */}
              <div className="space-y-1.5">
                <Label>منبع نرخ (قابل تغییر از تنظیمات)</Label>
                <div className="flex flex-wrap gap-2">
                  {RATE_SOURCE_PRESETS.map((p) => {
                    const active = settingsForm.apiEndpoint.trim() === p.endpoint;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() =>
                          setSettingsForm((f) => ({ ...f, apiEndpoint: p.endpoint }))
                        }
                        className={cn(
                          "rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-muted",
                          active && "border-primary bg-brand-soft text-brand-soft-foreground font-medium"
                        )}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  با انتخاب هر منبع، آدرس API پایین به‌صورت خودکار پر می‌شود؛ برای منبع
                  دلخواه، آدرس را دستی ویرایش کنید.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>آدرس API منبع</Label>
                  <Input
                    dir="ltr"
                    className="font-mono text-xs"
                    value={settingsForm.apiEndpoint}
                    onChange={(e) =>
                      setSettingsForm((f) => ({
                        ...f,
                        apiEndpoint: e.target.value,
                      }))
                    }
                    placeholder="https://open.er-api.com/v6/latest/USD"
                  />
                  <p className="text-xs text-muted-foreground">
                    منبع پیش‌فرض نرخ‌های رسمی و بازاری را می‌دهد؛ نرخ USD/AFN مستقیماً
                    از همین منبع خوانده می‌شود.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>کلید API (اختیاری)</Label>
                  {settings?.apiKeySet ? (
                    <div className="flex items-center gap-2 rounded-md border bg-slate-50 px-3 py-2 dark:bg-slate-900">
                      <CircleCheck className="h-4 w-4 shrink-0 text-primary" />
                      <span className="flex-1 text-xs">
                        کلید API در سرور ذخیره شده است
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-rose-600 hover:text-rose-700"
                        onClick={() => void removeApiKey()}
                        disabled={savingSettings}
                      >
                        حذف کلید
                      </Button>
                    </div>
                  ) : (
                    <Input
                      dir="ltr"
                      type="password"
                      className="font-mono text-xs"
                      value={newApiKey}
                      onChange={(e) => setNewApiKey(e.target.value)}
                      placeholder="••••••••"
                    />
                  )}
                  <p className="text-xs text-muted-foreground">
                    کلید فقط در سرور نگهداری و فقط در درخواست‌های سمت سرور استفاده
                    می‌شود.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>بازه به‌روزرسانی (دقیقه)</Label>
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    value={settingsForm.refreshMinutes}
                    onChange={(e) =>
                      setSettingsForm((f) => ({
                        ...f,
                        refreshMinutes: e.target.value,
                      }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    سیستم در حال کار نرخ‌ها را خودکار به‌روز نگه می‌دارد؛ اگر آخرین
                    به‌روزرسانی قدیمی‌تر از دو برابر این بازه باشد، هشدار «نرخ قدیمی»
                    نمایش داده می‌شود.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>اسپرد خرید و فروش (٪)</Label>
                  <Input
                    type="number"
                    min="0"
                    max="50"
                    step="0.1"
                    value={settingsForm.spreadPercent}
                    onChange={(e) =>
                      setSettingsForm((f) => ({
                        ...f,
                        spreadPercent: e.target.value,
                      }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    منابع آنلاین نرخ میانگین بازار را می‌دهند؛ بر اساس این درصد، نرخ
                    خرید و فروش جداگانه ساخته می‌شود. مثال: ۱ یعنی خرید ۰٫۵٪ پایین‌تر
                    و فروش ۰٫۵٪ بالاتر از نرخ بازار.
                  </p>
                </div>
                <div className="flex items-center gap-3 sm:pt-6">
                  <Switch
                    id="currency-enabled"
                    checked={settingsForm.enabled}
                    onCheckedChange={(v) =>
                      setSettingsForm((f) => ({ ...f, enabled: v }))
                    }
                  />
                  <Label htmlFor="currency-enabled" className="font-normal">
                    به‌روزرسانی خودکار فعال باشد
                  </Label>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>نقشه فیلدها (mapping JSON — اختیاری، override)</Label>
                <Textarea
                  dir="ltr"
                  rows={2}
                  className="font-mono text-xs"
                  value={settingsForm.mapping}
                  onChange={(e) =>
                    setSettingsForm((f) => ({ ...f, mapping: e.target.value }))
                  }
                  placeholder={`{"USD/AFN":"rates.AFN","USD/PKR":"rates.PKR"}`}
                />
                <p className="text-xs text-muted-foreground">
                  اگر منبع شما فرمت متفاوتی دارد، مسیر فیلد هر جوړه را اینجا تعیین
                  کنید؛ مثال: <code dir="ltr" className="rounded bg-muted px-1 font-mono">{`{"USD/AFN":"rates.AFN"}`}</code>.
                  جوړه‌های بدون مسیر دستی، به‌صورت خودکار از ماتریس نرخ متقاطع محاسبه
                  می‌شوند.
                </p>
              </div>

              <Button
                onClick={() => void submitSettings()}
                disabled={savingSettings}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                ذخیره تنظیمات
              </Button>
            </CardContent>
          </Card>
        )}

        {/* تاریخچه نرخ‌ها */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowLeftRight className="h-4 w-4" />
              تاریخچه نرخ‌ها
            </CardTitle>
            <CardDescription>
              آخرین نرخ‌های ثبت‌شده خرید و فروش اسعار
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable<RateRow>
              columns={historyColumns}
              rows={history}
              searchKeys={["base", "quote", "recordedByName"]}
              searchPlaceholder="جستجو در تاریخچه..."
              loading={ratesLoading}
              emptyText="نرخی ثبت نشده است — از دکمه به‌روزرسانی یا ثبت دستی استفاده کنید"
              rowKey={(r, i) =>
                r.id ?? `${r.base}/${r.quote}/${r.createdAt ?? ""}/${i}`
              }
              maxHeightClass="max-h-96"
            />
          </CardContent>
        </Card>

        {/* دیالوگ ثبت نرخ دستی */}
        <FormDialog
          open={manualOpen}
          onOpenChange={setManualOpen}
          title="ثبت نرخ دستی"
          description="نرخ‌های دستی با نام شما در تاریخچه ثبت می‌شوند"
          onSubmit={() => void submitManual()}
          submitting={savingManual}
          submitLabel="ثبت نرخ‌ها"
        >
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
              <Wifi className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                اگر به‌روزرسانی از انترنت ممکن نباشد، نرخ‌های بازار (مثلاً سرای
                شهزاده) را دستی وارد کنید. هر رکورد با نام کاربری شما ثبت
                می‌گردد.
              </p>
            </div>
            {manualPairs.map((p) => {
              const key = `${p.base}/${p.quote}`;
              const v = manualRows[key] ?? { buy: "", sell: "" };
              return (
                <div key={key} className="space-y-2 rounded-md border p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold">{p.label}</p>
                    <span dir="ltr" className="text-xs text-muted-foreground">
                      {key}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">نرخ خرید</Label>
                      <Input
                        dir="ltr"
                        type="number"
                        min="0"
                        step="any"
                        value={v.buy}
                        onChange={(e) =>
                          setManualRows((m) => ({
                            ...m,
                            [key]: { ...v, buy: e.target.value },
                          }))
                        }
                        placeholder="0"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">نرخ فروش</Label>
                      <Input
                        dir="ltr"
                        type="number"
                        min="0"
                        step="any"
                        value={v.sell}
                        onChange={(e) =>
                          setManualRows((m) => ({
                            ...m,
                            [key]: { ...v, sell: e.target.value },
                          }))
                        }
                        placeholder="0"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
            <p className="text-xs text-muted-foreground">
              فقط جوړه‌های کامل‌شده ثبت می‌شوند. برای حذف یک جوړه، فیلدهای آن را
              خالی بگذارید.
            </p>
          </div>
        </FormDialog>

        {/* دیالوگ افزودن ارز */}
        <FormDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          title="افزودن ارز جدید"
          description="ارز جدید به فرم‌های اسناد و نرخ‌های خودکار اضافه می‌شود"
          onSubmit={() => void submitAddCurrency()}
          submitting={savingAdd}
          submitLabel="افزودن"
        >
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>کد ارز (ISO سه‌حرفی)</Label>
              <Input
                dir="ltr"
                value={addForm.code}
                onChange={(e) =>
                  setAddForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))
                }
                placeholder="CNY"
                maxLength={3}
              />
            </div>
            <div className="space-y-1.5">
              <Label>نام ارز</Label>
              <Input
                value={addForm.name}
                onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="یوان چین"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>نماد (اختیاری)</Label>
                <Input
                  dir="ltr"
                  value={addForm.symbol}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, symbol: e.target.value }))
                  }
                  placeholder="¥"
                />
              </div>
              <div className="space-y-1.5">
                <Label>ترتیب نمایش</Label>
                <Input
                  type="number"
                  min="0"
                  value={addForm.sortOrder}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, sortOrder: e.target.value }))
                  }
                />
              </div>
            </div>
          </div>
        </FormDialog>

        {/* دیالوگ ویرایش ارز */}
        <FormDialog
          open={editTarget !== null}
          onOpenChange={(open) => !open && setEditTarget(null)}
          title={`ویرایش ارز ${editTarget?.code ?? ""}`}
          description="کد ارز قابل تغییر نیست"
          onSubmit={() => void submitEditCurrency()}
          submitting={savingEdit}
          submitLabel="ذخیره"
        >
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>نام ارز</Label>
              <Input
                value={editForm.name}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, name: e.target.value }))
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>نماد</Label>
                <Input
                  dir="ltr"
                  value={editForm.symbol}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, symbol: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>ترتیب نمایش</Label>
                <Input
                  type="number"
                  min="0"
                  value={editForm.sortOrder}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, sortOrder: e.target.value }))
                  }
                />
              </div>
            </div>
            {!editTarget?.isBase && (
              <div className="flex items-center gap-3">
                <Switch
                  id="currency-active"
                  checked={editForm.isActive}
                  onCheckedChange={(v) =>
                    setEditForm((f) => ({ ...f, isActive: v }))
                  }
                />
                <Label htmlFor="currency-active" className="font-normal">
                  ارز فعال باشد
                </Label>
              </div>
            )}
          </div>
        </FormDialog>

        {/* تأیید حذف تک ارز */}
        <AlertDialog
          open={deleteTarget !== null}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>حذف ارز {deleteTarget?.code}؟</AlertDialogTitle>
              <AlertDialogDescription>
                اگر این ارز در اسناد قبلی استفاده شده باشد، به‌جای حذف، غیرفعال
                می‌شود. این عمل قابل بازگشت نیست.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>انصراف</AlertDialogCancel>
              <AlertDialogAction
                className="bg-rose-600 text-white hover:bg-rose-700"
                onClick={() => deleteTarget && void deleteCurrency(deleteTarget)}
              >
                حذف
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* تأیید حذف گروهی ارزها */}
        <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                حذف گروهی {currencySelectedIds.length.toLocaleString("en-US")} ارز؟
              </AlertDialogTitle>
              <AlertDialogDescription>
                ارزهای استفاده‌شده در اسناد به‌جای حذف، غیرفعال می‌شوند و ارز پایه
                (دالر) حذف نمی‌شود. این عمل قابل بازگشت نیست.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>انصراف</AlertDialogCancel>
              <AlertDialogAction
                className="bg-rose-600 text-white hover:bg-rose-700"
                onClick={() => void bulkDeleteCurrencies()}
              >
                حذف گروهی
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* تأیید غیرفعال‌سازی گروهی ارزها */}
        <AlertDialog open={bulkDisableOpen} onOpenChange={setBulkDisableOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                غیرفعال‌سازی گروهی {currencySelectedIds.length.toLocaleString("en-US")} ارز؟
              </AlertDialogTitle>
              <AlertDialogDescription>
                ارزهای غیرفعال در فرم‌ها، فاکتورها و به‌روزرسانی خودکار نرخ‌ها
                شامل نمی‌شوند. ارز پایه (دالر) غیرفعال نمی‌شود و می‌توانید بعداً
                دوباره فعالشان کنید.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>انصراف</AlertDialogCancel>
              <AlertDialogAction
                className="bg-amber-600 text-white hover:bg-amber-700"
                onClick={() => void bulkToggleCurrencies(false)}
              >
                غیرفعال‌سازی گروهی
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </PermissionGate>
  );
}
