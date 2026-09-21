import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, getClientIp, handleApiError, ok } from "@/lib/api-utils";
import { requirePermission, requireUser } from "@/lib/auth";
import { getSettingBool, logAudit, setSetting } from "@/lib/business";
import { bodyStr, handleRouteError, readBody } from "@/app/api/users/_shared";
import { runDemoSeed } from "@/app/api/seed/_demo";

// POST /api/seed {mode:"demo"} — بارگذاری داده‌های نمایشی (settings.edit + مدیر ارشد)
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    requirePermission(user, "settings.edit");
    if (!user.isSuperAdmin) {
      throw new ApiError("فقط مدیر ارشد سیستم مجاز است", 403, "SUPER_ADMIN_ONLY");
    }

    const body = await readBody(req);
    if (bodyStr(body, "mode") !== "demo") {
      throw new ApiError("حالت پشتیبانی‌شده تنها «demo» است", 422, "VALIDATION");
    }
    if (await getSettingBool("demo_data_loaded")) {
      throw new ApiError(
        "داده‌های نمایشی قبلاً بارگذاری شده است",
        409,
        "ALREADY_SEEDED"
      );
    }

    const ip = getClientIp(req);

    const counts = await db.$transaction((tx) => runDemoSeed(tx, user));

    await setSetting("demo_data_loaded", "true");
    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "SEED",
      entity: "System",
      summary: "بارگذاری داده‌های نمایشی (۳ شعبه، ۱۲ محصول، خرید/فروش/مصارف نمونه)",
      ip,
    });
    return ok(counts);
  } catch (e) {
    return handleRouteError(e);
  }
}
