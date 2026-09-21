import { db } from "@/lib/db";
import { handleApiError, ok } from "@/lib/api-utils";
import { requireUser } from "@/lib/auth";
import { ensureRateScheduler, maybeAutoSync } from "@/lib/rate-sync";

// GET /api/exchange-rates/latest?base=USD — برای پرکردن خودکار نرخ در فرم‌ها
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    ensureRateScheduler();
    void maybeAutoSync(); // اگر نرخ‌ها کهنه باشند در پس‌زمینه به‌روزرسانی می‌شوند
    const url = new URL(req.url);
    const base = (url.searchParams.get("base") ?? "USD").trim().toUpperCase();

    const settings = await db.currencySettings.findUnique({ where: { id: "main" } });
    const refreshMinutes = settings?.refreshMinutes ?? 15;

    const rows = await db.exchangeRate.findMany({
      where: { base },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    // جدیدترین رکورد هر جفت
    const seen = new Set<string>();
    const latest: {
      base: string;
      quote: string;
      buyRate: number;
      sellRate: number;
      source: string;
      isOffline: boolean;
      createdAt: Date;
    }[] = [];
    for (const r of rows) {
      if (seen.has(r.quote)) continue;
      seen.add(r.quote);
      latest.push({
        base: r.base,
        quote: r.quote,
        buyRate: r.buyRate,
        sellRate: r.sellRate,
        source: r.source,
        isOffline: r.isOffline,
        createdAt: r.createdAt,
      });
    }

    // stale اگر جدیدترین رکورد قدیمی‌تر از ۲ برابر refreshMinutes باشد
    const staleAfterMs = 2 * refreshMinutes * 60 * 1000;
    const newest = latest.reduce<Date | null>(
      (acc, r) => (!acc || r.createdAt > acc ? r.createdAt : acc),
      null
    );
    const stale = !newest || Date.now() - newest.getTime() > staleAfterMs;

    return ok({
      latest,
      stale,
      refreshMinutes,
      base,
      lastSyncAt: settings?.lastSyncAt ?? null,
      lastSyncStatus: settings?.lastSyncStatus ?? null,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
