import { db } from "@/lib/db";
import { ApiError, handleApiError, ok, toNum } from "@/lib/api-utils";
import { requireUser, requirePermission } from "@/lib/auth";
import { logAudit } from "@/lib/business";

const DEFAULTS = {
  apiEndpoint: "https://open.er-api.com/v6/latest/USD",
  refreshMinutes: 15,
  mapping: '{"USD/AFN":"rates.AFN","USD/PKR":"rates.PKR"}',
  spreadPercent: 1,
  enabled: true,
};

// GET /api/exchange-rates/settings
// امنیتی: کلید API هرگز به Frontend ارسال نمی‌شود — فقط apiKeySet برمی‌گردد
export async function GET() {
  try {
    const user = await requireUser();
    requirePermission(user, "currency.view");
    const settings = await db.currencySettings.findUnique({ where: { id: "main" } });
    if (!settings) {
      return ok({
        id: "main",
        ...DEFAULTS,
        apiKey: null,
        apiKeySet: false,
        lastSyncAt: null,
        lastSyncStatus: null,
        lastSyncError: null,
      });
    }
    return ok({
      ...settings,
      apiKey: null, // هرگز لو نمی‌رود
      apiKeySet: Boolean(settings.apiKey),
    });
  } catch (e) {
    return handleApiError(e);
  }
}

// PUT /api/exchange-rates/settings
export async function PUT(req: Request) {
  try {
    const user = await requireUser();
    requirePermission(user, "currency.edit");
    const body = (await req.json()) as Record<string, unknown>;

    const data: {
      apiEndpoint?: string;
      apiKey?: string | null;
      refreshMinutes?: number;
      mapping?: string;
      spreadPercent?: number;
      enabled?: boolean;
    } = {};

    if (body.apiEndpoint !== undefined) {
      const endpoint = typeof body.apiEndpoint === "string" ? body.apiEndpoint.trim() : "";
      if (!endpoint || !/^https?:\/\//.test(endpoint)) {
        throw new ApiError("آدرس API باید با http یا https شروع شود", 422, "VALIDATION");
      }
      data.apiEndpoint = endpoint;
    }
    if (body.apiKey !== undefined) {
      data.apiKey =
        typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : null;
    }
    if (body.refreshMinutes !== undefined) {
      const minutes = Math.floor(toNum(body.refreshMinutes, 0));
      if (!(minutes >= 1)) {
        throw new ApiError("فاصله به‌روزرسانی باید حداقل ۱ دقیقه باشد", 422, "VALIDATION");
      }
      data.refreshMinutes = minutes;
    }
    if (body.spreadPercent !== undefined) {
      const spread = toNum(body.spreadPercent, NaN);
      if (!Number.isFinite(spread) || spread < 0 || spread > 50) {
        throw new ApiError(
          "اسپرد خرید/فروش باید عددی بین ۰ تا ۵۰ درصد باشد",
          422,
          "VALIDATION",
        );
      }
      data.spreadPercent = Math.round(spread * 100) / 100;
    }
    if (body.mapping !== undefined) {
      const mapping = typeof body.mapping === "string" ? body.mapping : "";
      try {
        const parsed = JSON.parse(mapping) as Record<string, unknown>;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new Error("not an object");
        }
        data.mapping = mapping;
      } catch {
        throw new ApiError("نقشه نرخ‌ها باید یک JSON معتبر باشد", 422, "VALIDATION");
      }
    }
    if (body.enabled !== undefined) data.enabled = Boolean(body.enabled);

    const updated = await db.$transaction(async (tx) => {
      const before = await tx.currencySettings.findUnique({ where: { id: "main" } });
      const row = await tx.currencySettings.upsert({
        where: { id: "main" },
        create: { id: "main", ...DEFAULTS, ...data },
        update: data,
      });
      await logAudit(tx, {
        userId: user.id,
        userName: user.fullName,
        branchId: user.branchId,
        action: "UPDATE",
        entity: "CurrencySettings",
        entityId: "main",
        summary: "به‌روزرسانی تنظیمات اسعار",
        before: before
          ? {
              apiEndpoint: before.apiEndpoint,
              refreshMinutes: before.refreshMinutes,
              spreadPercent: before.spreadPercent,
              mapping: before.mapping,
              enabled: before.enabled,
            }
          : null,
        after: data,
      });
      return row;
    });

    return ok(updated);
  } catch (e) {
    return handleApiError(e);
  }
}
