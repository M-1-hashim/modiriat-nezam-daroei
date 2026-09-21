import type { ExchangeRate } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError, handleApiError, ok, round4, toNum } from "@/lib/api-utils";
import { requireUser, requirePermission } from "@/lib/auth";
import { logAudit } from "@/lib/business";
import {
  ensureRateScheduler,
  maybeAutoSync,
  syncRates,
} from "@/lib/rate-sync";

// GET /api/exchange-rates?limit=50
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    requirePermission(user, "currency.view");
    ensureRateScheduler();
    void maybeAutoSync(); // اگر نرخ‌ها کهنه باشند در پس‌زمینه به‌روزرسانی می‌شوند
    const url = new URL(req.url);
    const limit = Math.min(500, Math.max(1, toNum(url.searchParams.get("limit"), 50)));

    // برای dedupe جفت‌ها به رکوردهای بیشتری نیاز است
    const fetchCount = Math.min(2000, Math.max(limit, 500));
    const rows = await db.exchangeRate.findMany({
      orderBy: { createdAt: "desc" },
      take: fetchCount,
    });

    // جدیدترین رکورد هر جفت ارز (dedupe در JS)
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
      const pairKey = `${r.base}/${r.quote}`;
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);
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

    return ok({ latest, history: rows.slice(0, limit) });
  } catch (e) {
    return handleApiError(e);
  }
}

// POST /api/exchange-rates — {source:"MANUAL", rates:[...]} یا {source:"API"}
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    requirePermission(user, "currency.edit");
    const body = (await req.json()) as Record<string, unknown>;
    const source = typeof body.source === "string" ? body.source.toUpperCase() : "";

    if (source === "MANUAL") {
      const rates = Array.isArray(body.rates) ? body.rates : [];
      const parsed: { base: string; quote: string; buyRate: number; sellRate: number }[] = [];
      for (const raw of rates) {
        const r = raw as Record<string, unknown>;
        const base = typeof r.base === "string" ? r.base.trim().toUpperCase() : "";
        const quote = typeof r.quote === "string" ? r.quote.trim().toUpperCase() : "";
        const buyRate = round4(toNum(r.buyRate, 0));
        const sellRate = round4(toNum(r.sellRate, buyRate));
        if (!base || !quote || !(buyRate > 0)) continue;
        parsed.push({ base, quote, buyRate, sellRate: sellRate > 0 ? sellRate : buyRate });
      }
      if (parsed.length === 0) {
        throw new ApiError("لیست نرخ‌ها خالی یا نامعتبر است", 422, "VALIDATION");
      }

      const created = await db.$transaction(async (tx) => {
        const rows: ExchangeRate[] = [];
        for (const r of parsed) {
          rows.push(
            await tx.exchangeRate.create({
              data: {
                base: r.base,
                quote: r.quote,
                buyRate: r.buyRate,
                sellRate: r.sellRate,
                source: "MANUAL",
                isOffline: false,
                recordedBy: user.id,
                recordedByName: user.fullName,
              },
            })
          );
        }
        await logAudit(tx, {
          userId: user.id,
          userName: user.fullName,
          branchId: user.branchId,
          action: "RATE_MANUAL",
          entity: "ExchangeRate",
          summary: `ثبت دستی نرخ اسعار: ${parsed.map((r) => `${r.base}/${r.quote}=${r.buyRate}`).join("، ")}`,
          after: parsed,
        });
        return rows;
      });

      return ok({ created: created.length, rates: created }, 201);
    }

    if (source === "API") {
      // موتور همگام‌سازی: mapping به‌عنوان override + ماتریس متقاطع بین ارزهای فعال
      const result = await syncRates("MANUAL", user);
      if (!result.ok) {
        if (result.skipped === "disabled") {
          throw new ApiError("همگام‌سازی خودکار اسعار غیرفعال است", 422, "SYNC_DISABLED");
        }
        throw new ApiError(
          `دریافت نرخ از انترنت ناموفق بود — نرخ دستی وارد کنید (${result.error ?? "خطای نامشخص"})`,
          502,
          "RATE_SYNC_FAILED",
        );
      }
      const settings = await db.currencySettings.findUniqueOrThrow({ where: { id: "main" } });
      return ok(
        { created: result.created, syncedAt: result.syncedAt, lastSyncAt: settings.lastSyncAt },
        201,
      );
    }

    throw new ApiError('حالت ثبت نامعتبر است — source باید "MANUAL" یا "API" باشد', 422, "VALIDATION");
  } catch (e) {
    return handleApiError(e);
  }
}
