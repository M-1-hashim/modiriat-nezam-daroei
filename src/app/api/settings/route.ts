import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, getClientIp, handleApiError, ok } from "@/lib/api-utils";
import { requirePermission, requireUser } from "@/lib/auth";
import { logAudit, setSetting } from "@/lib/business";
import { handleRouteError, readBody } from "@/app/api/users/_shared";

/** کلیدهای مجاز تنظیمات — هر کلید دیگر نادیده گرفته می‌شود */
const ALLOWED_SETTING_KEYS: string[] = [
  "company_name",
  "company_address",
  "company_phone",
  "invoice_footer_note",
  "require_approval_purchases",
  "require_approval_sales",
  "require_approval_expenses",
  "require_approval_returns",
  "block_expired_sales",
  "allow_negative_stock",
  "expiry_warn_days",
  "max_discount_percent",
  "attendance_base_days",
  "profit_distribution_base",
  "default_currency",
  "invoice_template_default",
  "seq_prefix_PURCHASE",
  "seq_prefix_SALE",
  "seq_prefix_PAYMENT",
  "seq_prefix_PURCHASE_RETURN",
  "seq_prefix_SALES_RETURN",
];

// GET /api/settings — همه کلیدها به شکل {key:value} (settings.view)
export async function GET() {
  try {
    const user = await requireUser();
    requirePermission(user, "settings.view");

    const rows = await db.systemSetting.findMany();
    const settings: Record<string, string> = {};
    for (const r of rows) settings[r.key] = r.value;
    return ok(settings);
  } catch (e) {
    return handleApiError(e);
  }
}

// PUT /api/settings — بروزرسانی {key:value,...} (settings.edit)
export async function PUT(req: NextRequest) {
  try {
    const user = await requireUser();
    requirePermission(user, "settings.edit");

    const body = await readBody(req);
    const keys = Object.keys(body).filter((k) => ALLOWED_SETTING_KEYS.includes(k));
    if (keys.length === 0) {
      throw new ApiError("هیچ کلید معتبری برای بروزرسانی ارسال نشده است", 422, "VALIDATION");
    }

    const currentRows = await db.systemSetting.findMany();
    const current: Record<string, string> = {};
    for (const r of currentRows) current[r.key] = r.value;

    const before: Record<string, string> = {};
    const after: Record<string, string> = {};
    for (const key of keys) {
      const raw = body[key];
      if (raw === null || raw === undefined) continue;
      const value = typeof raw === "boolean" ? (raw ? "true" : "false") : String(raw);
      await setSetting(key, value);
      before[key] = current[key] ?? "";
      after[key] = value;
    }

    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "UPDATE",
      entity: "Settings",
      summary: `بروزرسانی ${Object.keys(after).length} تنظیم سیستم`,
      before,
      after,
      ip: getClientIp(req),
    });
    return ok({ updated: Object.keys(after), settings: after });
  } catch (e) {
    return handleRouteError(e);
  }
}
