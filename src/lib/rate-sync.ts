import "server-only";

/**
 * موتور دریافت و به‌روزرسانی نرخ اسعار
 *
 * منبع پیش‌فرض: open.er-api.com (ExchangeRate-API) — پاسخ آن USD-base است:
 *   { result: "success", base_code: "USD", rates: { AFN: 71.2, EUR: 0.92, ... } }
 *   یعنی rates[C] = تعداد واحد C که ۱ دالر آمریکا می‌خرد.
 *
 * محاسبهٔ نرخ‌های متقاطع (مستند):
 *   rate(A→B) یعنی به‌ازای ۱ واحد A چند واحد B می‌خرد:
 *     rate(A→B) = rates[B] / rates[A]
 *   مثال‌ها:
 *     USD/AFN = rates.AFN                    (مستقیم — دقیقاً نرخ منبع)
 *     EUR/AFN = rates.AFN / rates.EUR        (متقاطع)
 *     AFN/PKR = rates.PKR / rates.AFN        (متقاطع)
 *
 * mapping در تنظیمات به‌عنوان «override» عمل می‌کند:
 *   اگر برای یک جوړه مسیر دستی تعریف شده باشد، همان مسیر اولویت دارد و
 *   جوړهٔ مذکور از ماتریس محاسبه نمی‌شود.
 *
 * اسپرد خرید/فروش (spreadPercent در تنظیمات):
 *   منابع آنلاین معمولاً «نرخ میانگین بازار» می‌دهند؛ سیستم بر اساس اسپرد
 *   قابل‌تنظیم، نرخ خرید و فروش جداگانه می‌سازد:
 *     buy  = mid × (1 − spread/200)
 *     sell = mid × (1 + spread/200)
 *   مثال: spread=1 و USD/AFN=71.2 → خرید 70.84 و فروش 71.56
 *
 * رفتار آفلاین: اگر دریافت از انترنت ناموفق باشد، هیچ رکورد ناشی (ساختگی)
 * ثبت نمی‌شود؛ آخرین نرخ‌های معتبر قبلی در جدول می‌مانند و وضعیت
 * lastSyncStatus=FAILED با پیام خطا ذخیره می‌گردد.
 */

import { db } from "./db";
import { logAudit } from "./business";

const SYNC_LOCK_KEY = "__rateSyncBusy" as const;
const SCHEDULER_KEY = "__rateScheduler" as const;

/** ارزهای پیش‌فرض سیستم — لیست از بخش اسعار قابل توسعه است */
export const DEFAULT_CURRENCIES: {
  code: string;
  name: string;
  symbol?: string;
  isBase?: boolean;
  sortOrder: number;
}[] = [
  { code: "USD", name: "دالر امریکایی", symbol: "$", isBase: true, sortOrder: 1 },
  { code: "AFN", name: "افغانی", symbol: "؋", sortOrder: 2 },
  { code: "EUR", name: "یورو", symbol: "€", sortOrder: 3 },
  { code: "PKR", name: "کلدار پاکستانی", sortOrder: 4 },
  { code: "IRR", name: "ریال ایران", sortOrder: 5 },
];

/** درج ارزهای پیش‌فرض — idempotent و هر بار قابل فراخوانی */
export async function ensureCurrencies(): Promise<void> {
  const count = await db.currency.count();
  if (count === 0) {
    await db.currency.createMany({
      data: DEFAULT_CURRENCIES.map((c) => ({
        code: c.code,
        name: c.name,
        symbol: c.symbol ?? null,
        isBase: c.isBase ?? false,
        sortOrder: c.sortOrder,
      })),
    });
    return;
  }
  // اگر رکوردی وجود دارد ولی بعضی ارزهای پیش‌فرض غایب‌اند، آن‌ها را تکمیل کن
  const existing = await db.currency.findMany({ select: { code: true } });
  const have = new Set(existing.map((c) => c.code));
  const missing = DEFAULT_CURRENCIES.filter((c) => !have.has(c.code));
  if (missing.length > 0) {
    await db.currency.createMany({
      data: missing.map((c) => ({
        code: c.code,
        name: c.name,
        symbol: c.symbol ?? null,
        isBase: c.isBase ?? false,
        sortOrder: c.sortOrder,
      })),
    });
  }
}

type SyncResult = {
  ok: boolean;
  created?: number;
  skipped?: "disabled" | "fresh";
  error?: string;
  syncedAt?: Date;
  sourceHost?: string;
};

function resolvePath(obj: unknown, path: string): unknown {
  const parts = path.split(".").filter(Boolean);
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object")
      return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function toNum(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/**
 * استخراج نرخ‌های USD-base از پاسخ JSON منبع.
 * فرمت‌های پشتیبانی‌شده:
 *  ۱) er-api و مشابه: { base_code: "USD", rates: { AFN: 71.2, ... } }
 *  ۲) currency-api.pages.dev و مشابه: { usd: { afn: 71.2, ... } } (شیء سه‌حرفی در ریشه)
 */
function extractUsdRates(json: unknown): Record<string, number> | null {
  if (!json || typeof json !== "object") return null;
  const obj = json as Record<string, unknown>;
  const rates = obj["rates"];
  if (rates && typeof rates === "object") return normalizeUsdRates(rates);
  // فرمت ۲: کلید ریشهٔ سه‌حرفی (مثلاً "usd") که شیء نرخ‌هاست
  for (const [key, val] of Object.entries(obj)) {
    if (/^[a-z]{3}$/.test(key) && val && typeof val === "object") {
      const normalized = normalizeUsdRates(val);
      if (normalized) return normalized;
    }
  }
  return null;
}

function normalizeUsdRates(rates: unknown): Record<string, number> | null {
  if (!rates || typeof rates !== "object") return null;
  const out: Record<string, number> = {};
  let count = 0;
  for (const [code, val] of Object.entries(rates as Record<string, unknown>)) {
    const n = toNum(val);
    if (n > 0 && /^[A-Z]{3}$/.test(code.toUpperCase())) {
      out[code.toUpperCase()] = n;
      count++;
    }
  }
  return count > 0 ? out : null;
}

// ─────────────────────── منبع sarafi.af ───────────────────────

/** منبع پیش‌فرض جدید — بازار واقعی افغانستان */
const SARAFI_ENDPOINT = "https://sarafi.af/";
/** پیش‌فرض قدیمی — برای مهاجرت خودکار تنظیمات موجود */
const LEGACY_DEFAULT_ENDPOINT = "https://open.er-api.com/v6/latest/USD";

type SarafiPair = {
  base: string;
  quote: string;
  buyRate: number;
  sellRate: number;
};

/** آیا منبع، صفحهٔ HTML سایت sarafi.af است؟ */
function isSarafiEndpoint(endpoint: string): boolean {
  try {
    const host = new URL(endpoint).host.toLowerCase();
    return host === "sarafi.af" || host.endsWith(".sarafi.af");
  } catch {
    return false;
  }
}

function parseNum(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number(raw.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

/**
 * استخراج جوړه‌های نرخ از صفحهٔ HTML sarafi.af
 * ساختار هر ردیف:
 *   <a href="/exchange-rates/{market}/{BASE}-{QUOTE}">…</a></td>
 *   <td><b class="buyRate">64.55</b></td>
 *   <td><b class="sellRate">64.60</b></td>
 * صفحه چند بازار دارد (سرای شهزاده، خورشید، …) — برای هر جوړه فقط
 * اولین رخداد (بازار مرجع بالای صفحه) گرفته می‌شود.
 */
export function parseSarafiRows(html: string): SarafiPair[] {
  const out = new Map<string, SarafiPair>();
  const rowRe = /<tr[\s\S]*?<\/tr>/gi;
  const hrefRe = /\/exchange-rates\/[^"']*\/([A-Za-z]{3})-([A-Za-z]{3})/;
  const buyRe = /class="buyRate"[^>]*>\s*([\d.,]+)/i;
  const sellRe = /class="sellRate"[^>]*>\s*([\d.,]+)/i;

  for (const row of html.match(rowRe) ?? []) {
    const href = hrefRe.exec(row);
    if (!href) continue;
    const base = href[1].toUpperCase();
    const quote = href[2].toUpperCase();
    const buyRate = parseNum(buyRe.exec(row)?.[1]);
    const sellRate = parseNum(sellRe.exec(row)?.[1]);
    if (buyRate <= 0 || sellRate <= 0) continue;
    const key = `${base}/${quote}`;
    if (!out.has(key)) out.set(key, { base, quote, buyRate, sellRate });
  }
  return [...out.values()];
}

/**
 * ساخت ماتریس نرخ از جوړه‌های sarafi:
 *  ۱) جوړهٔ مستقیم — خرید/فروش واقعی بازار (بدون اسپرد اضافی)
 *  ۲) معکوس هر جوړه — خرید = ۱/فروش و فروش = ۱/خرید
 *  ۳) نرخ‌های متقاطع از مسیر افغانی — rate(A→B) = mid(A→AFN)/mid(B→AFN) با اسپرد
 */
export function buildSarafiRows(
  pairs: SarafiPair[],
  codes: string[],
  spread: number
): { base: string; quote: string; buyRate: number; sellRate: number }[] {
  const codeSet = new Set(codes);
  const rowsMap = new Map<string, { base: string; quote: string; buyRate: number; sellRate: number }>();
  // میانگین بازار هر ارز نسبت به افغانی — برای محاسبات متقاطع
  const mids = new Map<string, number>();

  for (const p of pairs) {
    if (!codeSet.has(p.base) || !codeSet.has(p.quote)) continue;
    rowsMap.set(`${p.base}/${p.quote}`, { ...p });
    if (p.quote === "AFN") mids.set(p.base, (p.buyRate + p.sellRate) / 2);
  }

  // معکوس جوړه‌های مستقیم
  for (const p of pairs) {
    if (!codeSet.has(p.base) || !codeSet.has(p.quote)) continue;
    const inv = {
      base: p.quote,
      quote: p.base,
      buyRate: roundRate(1 / p.sellRate),
      sellRate: roundRate(1 / p.buyRate),
    };
    if (inv.buyRate > 0 && inv.sellRate > 0) {
      rowsMap.set(`${inv.base}/${inv.quote}`, inv);
    }
  }

  // نرخ‌های متقاطع از مسیر افغانی
  for (const a of codes) {
    for (const b of codes) {
      if (a === b) continue;
      const key = `${a}/${b}`;
      if (rowsMap.has(key)) continue;
      const ma = mids.get(a);
      const mb = mids.get(b);
      if (!(ma > 0) || !(mb > 0)) continue;
      const mid = ma / mb;
      const buyRate = roundRate(mid * (1 - spread / 200));
      const sellRate = roundRate(mid * (1 + spread / 200));
      if (buyRate > 0 && sellRate > 0) {
        rowsMap.set(key, { base: a, quote: b, buyRate, sellRate });
      }
    }
  }

  return [...rowsMap.values()];
}

/** همگام‌سازی نرخ‌ها از منبع انترنتی — از نقشه و ماتریس متقاطع */
export async function syncRates(
  triggeredBy: "AUTO" | "MANUAL" | "SCHEDULER",
  user?: { id: string; fullName: string; branchId: string | null },
): Promise<SyncResult> {
  // جلوگیری از اجرای هم‌زمان چند sync
  const g = globalThis as Record<string, unknown>;
  if (g[SYNC_LOCK_KEY] === true) return { ok: false, error: "sync در حال اجراست" };
  g[SYNC_LOCK_KEY] = true;

  try {
    const settings = await db.currencySettings.upsert({
      where: { id: "main" },
      // رکورد تازه: بازهٔ پیش‌فرض ۱۵ دقیقه (هماهنگ با schema و تنظیمات)
      create: { id: "main", refreshMinutes: 15, apiEndpoint: SARAFI_ENDPOINT },
      update: {},
    });
    if (!settings.enabled) return { ok: false, skipped: "disabled" };

    // مهاجرت منبع قدیمی پیش‌فرض به sarafi.af — فقط وقتی کاربر منبع دستی تنظیم نکرده باشد
    if (
      !settings.apiEndpoint ||
      settings.apiEndpoint === LEGACY_DEFAULT_ENDPOINT
    ) {
      await db.currencySettings.update({
        where: { id: settings.id },
        data: { apiEndpoint: SARAFI_ENDPOINT },
      });
      settings.apiEndpoint = SARAFI_ENDPOINT;
    }

    // ─── دریافت از منبع ───
    const useSarafi = isSarafiEndpoint(settings.apiEndpoint);
    let json: unknown;
    let sarafiPairs: SarafiPair[] = [];
    try {
      const res = await fetch(settings.apiEndpoint, {
        headers: settings.apiKey
          ? { Authorization: settings.apiKey, apikey: settings.apiKey }
          : {},
        signal: AbortSignal.timeout(15000),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`پاسخ سرور با کد ${res.status}`);
      if (useSarafi) {
        sarafiPairs = parseSarafiRows(await res.text());
        if (sarafiPairs.length === 0) {
          throw new Error("صفحهٔ منبع شامل هیچ نرخ قابل استفاده‌ای نبود");
        }
      } else {
        json = await res.json();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "خطای ناشناختهٔ شبکه";
      await db.currencySettings.update({
        where: { id: settings.id },
        data: { lastSyncStatus: "FAILED", lastSyncError: `دریافت از منبع ناموفق: ${msg}` },
      });
      return { ok: false, error: msg };
    }

    // ─── ارزهای فعال سیستم ───
    await ensureCurrencies();
    const currencies = await db.currency.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
    });
    const codes = currencies.map((c) => c.code);

    // اسپرد خرید/فروش: نرخ خرید کمی پایین‌تر و نرخ فروش کمی بالاتر از نرخ بازار
    // (برای منبع sarafi جوړه‌های مستقیم خرید/فروش واقعی خود را دارند)
    const spreadRaw = Number(settings.spreadPercent);
    const spread = Number.isFinite(spreadRaw) ? Math.min(50, Math.max(0, spreadRaw)) : 1;

    // ─── ساخت لیست نرخ‌ها ───
    let rows: { base: string; quote: string; buyRate: number; sellRate: number }[] = [];

    if (useSarafi) {
      rows = buildSarafiRows(sarafiPairs, codes, spread)
        .map((p) => ({ ...p }))
        .filter((r) => r.buyRate > 0 && r.sellRate > 0); // نرخ صفر بی‌معناست — هرگز ثبت نمی‌شود
    } else {
      // ─── استخراج نرخ‌ها از پاسخ JSON ───
      const usdRates = extractUsdRates(json);

      // mapping دستی (override)
      let mapping: Record<string, string> = {};
      try {
        const parsed = JSON.parse(settings.mapping) as Record<string, unknown>;
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "string") mapping[k] = v;
        }
      } catch {
        mapping = {};
      }
      const overridePairs: { base: string; quote: string; rate: number }[] = [];
      for (const [pair, path] of Object.entries(mapping)) {
        const [base, quote] = pair.split("/").map((p) => p?.trim().toUpperCase());
        if (!base || !quote) continue;
        const rate = toNum(resolvePath(json, path));
        if (rate > 0) overridePairs.push({ base, quote, rate });
      }

      const usdRatesCount = usdRates ? Object.keys(usdRates).length : 0;
      if (usdRatesCount === 0 && overridePairs.length === 0) {
        const msg = "پاسخ منبع قابل تفسیر نبود (نه rates معتبر و نه mapping معتبر)";
        await db.currencySettings.update({
          where: { id: settings.id },
          data: { lastSyncStatus: "FAILED", lastSyncError: msg },
        });
        return { ok: false, error: msg };
      }

      const rowsMap = new Map<string, { base: string; quote: string; rate: number }>();
      // ۱) override های mapping (اولویت اول)
      for (const p of overridePairs) rowsMap.set(`${p.base}/${p.quote}`, p);

      // ۲) ماتریس متقاطع بین ارزهای فعال (اولویت دوم)
      //    rate(A→B) = rates[B] / rates[A] — فقط اگر نرخ USD-base هر دو موجود باشد
      if (usdRates) {
        for (const a of codes) {
          for (const b of codes) {
            if (a === b) continue;
            const key = `${a}/${b}`;
            if (rowsMap.has(key)) continue; // override اولویت دارد
            const ra = usdRates[a];
            const rb = usdRates[b];
            if (!(ra > 0) || !(rb > 0)) continue;
            rowsMap.set(key, { base: a, quote: b, rate: rb / ra });
          }
        }
      }

      if (rowsMap.size === 0) {
        const msg = "هیچ نرخ قابل استفاده‌ای برای ارزهای فعال استخراج نشد";
        await db.currencySettings.update({
          where: { id: settings.id },
          data: { lastSyncStatus: "FAILED", lastSyncError: msg },
        });
        return { ok: false, error: msg };
      }

      rows = [...rowsMap.values()]
        .map((p) => {
          const buyRate = roundRate(p.rate * (1 - spread / 200));
          const sellRate = roundRate(p.rate * (1 + spread / 200));
          return { base: p.base, quote: p.quote, buyRate, sellRate };
        })
        .filter((r) => r.buyRate > 0 && r.sellRate > 0); // نرخ صفر بی‌معناست — هرگز ثبت نمی‌شود
    }

    if (rows.length === 0) {
      const msg = "هیچ نرخ قابل استفاده‌ای برای ارزهای فعال استخراج نشد";
      await db.currencySettings.update({
        where: { id: settings.id },
        data: { lastSyncStatus: "FAILED", lastSyncError: msg },
      });
      return { ok: false, error: msg };
    }

    // ─── ثبت در دیتابیس ───
    const source = useSarafi ? "SARAFI" : "API";
    const now = new Date();
    const sourceHost = safeHost(settings.apiEndpoint);
    await db.$transaction(async (tx) => {
      await tx.exchangeRate.createMany({
        data: rows.map((r) => ({ ...r, source, isOffline: false })),
      });
      await tx.currencySettings.update({
        where: { id: settings.id },
        data: { lastSyncAt: now, lastSyncStatus: "OK", lastSyncError: null },
      });
      const summary = `نرخ اسعار از منبع ${sourceHost} به‌روزرسانی شد (${rows.length} جوړه — ${triggeredBy === "AUTO" || triggeredBy === "SCHEDULER" ? "خودکار" : "دستی"})`;
      await logAudit(tx, {
        userId: user?.id,
        userName: user?.fullName ?? "سیستم (همگام‌سازی خودکار)",
        branchId: user?.branchId ?? null,
        action: "RATE_UPDATE",
        entity: "ExchangeRate",
        summary,
        after: rows.slice(0, 12),
      });
    });

    return { ok: true, created: rows.length, syncedAt: now, sourceHost };
  } finally {
    g[SYNC_LOCK_KEY] = false;
  }
}

function safeHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

/**
 * گرد کردن نرخ با حفظ دقتِ کافی برای نرخ‌های خیلی کوچک:
 * نرخ‌های درشت ۴ رقم اعشار، متوسط ۵ رقم و نرخ‌های ریز (مثل IRR→AFN ≈ 0.00003)
 * تا ۸ رقم اعشار نگهداری می‌شوند تا هرگز صفرِ بی‌معنا ذخیره نشود.
 */
export function roundRate(r: number): number {
  if (r >= 1) return Math.round(r * 10000) / 10000;
  if (r >= 0.01) return Math.round(r * 100000) / 100000;
  return Math.round(r * 1e8) / 1e8;
}

/** آیا همگام‌سازی خودکار لازم است؟ (بر اساس refreshMinutes) */
async function isSyncDue(): Promise<boolean> {
  const settings = await db.currencySettings.findUnique({ where: { id: "main" } });
  if (!settings || !settings.enabled) return false;
  if (!settings.lastSyncAt) return true;
  const elapsed = Date.now() - settings.lastSyncAt.getTime();
  return elapsed >= settings.refreshMinutes * 60_000;
}

/**
 * اگر نرخ‌ها کهنه باشند، sync را در پس‌زمینه آغاز می‌کند (fire-and-forget).
 * خطاها در CurrencySettings.lastSyncError ثبت می‌شوند و هرگز به caller نمی‌رسند.
 */
export async function maybeAutoSync(): Promise<void> {
  try {
    if (!(await isSyncDue())) return;
    const g = globalThis as Record<string, unknown>;
    if (g[SYNC_LOCK_KEY] === true) return;
    void syncRates("AUTO").catch(() => undefined);
  } catch {
    // هرگز مسیر درخواست را خراب نمی‌کنیم
  }
}

/**
 * زمان‌بند همگام‌سازی خودکار — هر ۶۰ ثانیه بررسی می‌کند که آیا نرخ‌ها
 * کهنه شده‌اند یا نه. فقط یک نمونه در طول عمر پروسه ساخته می‌شود.
 */
export function ensureRateScheduler(): void {
  const g = globalThis as Record<string, unknown>;
  if (g[SCHEDULER_KEY]) return;
  const timer = setInterval(() => {
    void maybeAutoSync();
  }, 60_000);
  // نباید پروسه را زنده نگه دارد
  (timer as unknown as { unref?: () => void }).unref?.();
  g[SCHEDULER_KEY] = timer;
}
