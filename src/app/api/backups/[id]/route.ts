import { promises as fs } from "fs";
import path from "path";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, getClientIp, handleApiError, ok } from "@/lib/api-utils";
import { requirePermission, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/business";
import { handleRouteError } from "@/app/api/users/_shared";
import { resolveDbPaths } from "@/app/api/backups/_restore";

type Ctx = { params: Promise<{ id: string }> };

// DELETE /api/backups/[id] — حذف فایل + رکورد نسخهٔ احتیاطی (backup.delete)
export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    requirePermission(user, "backup.delete");
    const { id } = await ctx.params;

    const backup = await db.backup.findUnique({ where: { id } });
    if (!backup) throw new ApiError("نسخهٔ احتیاطی یافت نشد", 404, "NOT_FOUND");

    const { backupsDir } = resolveDbPaths();
    await fs.rm(path.join(backupsDir, backup.filename), { force: true });
    await db.backup.delete({ where: { id } });

    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "DELETE",
      entity: "Backup",
      entityId: id,
      summary: `حذف نسخهٔ احتیاطی ${backup.filename}`,
      ip: getClientIp(req),
    });
    return ok({ deleted: true });
  } catch (e) {
    return handleRouteError(e);
  }
}
