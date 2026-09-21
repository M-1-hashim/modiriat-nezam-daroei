import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, getClientIp } from "@/lib/api-utils";
import { requireUser, requirePermission } from "@/lib/auth";
import { logAudit } from "@/lib/business";
import { handleRouteError } from "@/app/api/users/_shared";
import { runAutoBackup } from "@/lib/auto-backup";

// POST /api/backups/auto — گرفتن فوری نسخهٔ خودکار (backup.create)
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    requirePermission(user, "backup.create");

    const result = await runAutoBackup({ enforce: true });

    if (!result.skipped) {
      await logAudit(db, {
        userId: user.id,
        userName: user.fullName,
        branchId: user.branchId,
        action: "BACKUP",
        entity: "Backup",
        entityId: result.filename ?? null,
        summary: `پشتیبان‌گیری خودکار دستی — ${result.filename} (${result.sizeKb} کیلوبایت)`,
        ip: getClientIp(req),
      });
    }

    return ok(result);
  } catch (e) {
    return handleRouteError(e);
  }
}
