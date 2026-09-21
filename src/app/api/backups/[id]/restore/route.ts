import { promises as fs } from "fs";
import type { NextRequest } from "next/server";
import path from "path";
import { db } from "@/lib/db";
import { ApiError, getClientIp, handleApiError, ok } from "@/lib/api-utils";
import { createSession, requirePermission, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/business";
import { bodyBool, handleRouteError, readBody } from "@/app/api/users/_shared";
import { resolveDbPaths, restoreFromBackupFile } from "@/app/api/backups/_restore";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/backups/[id]/restore {confirm:true} — بازیابی کامل دیتابیس
// (backup.delete + فقط مدیر ارشد سیستم)
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    requirePermission(user, "backup.delete");
    if (!user.isSuperAdmin) {
      throw new ApiError("فقط مدیر ارشد سیستم مجاز است", 403, "SUPER_ADMIN_ONLY");
    }
    const { id } = await ctx.params;

    const body = await readBody(req);
    if (bodyBool(body, "confirm") !== true) {
      throw new ApiError(
        "برای بازیابی، تأیید صریح لازم است",
        400,
        "CONFIRM_REQUIRED"
      );
    }

    const backup = await db.backup.findUnique({ where: { id } });
    if (!backup) throw new ApiError("نسخهٔ احتیاطی یافت نشد", 404, "NOT_FOUND");

    const { dbPath, backupsDir } = resolveDbPaths();
    const backupPath = path.join(backupsDir, backup.filename);
    try {
      await fs.access(backupPath);
    } catch {
      throw new ApiError("فایل نسخهٔ احتیاطی در دیسک یافت نشد", 404, "FILE_MISSING");
    }

    // ─── بکاپ موقت خودکار از معلومات فعلی، پیش از هرگونه جایگزینی ───
    // اگر این کپی شکست بخورد، بازیابی آغاز نمی‌شود تا معلومات فعلی همیشه
    // قابل بازگشت باشد.
    await fs.access(dbPath);
    const safetyStamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
    const safetyName = `pre-restore-${safetyStamp}.db`;
    const safetyDest = path.join(backupsDir, safetyName);
    try {
      await fs.copyFile(dbPath, safetyDest);
    } catch {
      throw new ApiError(
        "ایجاد نسخهٔ احتیاطی موقت از معلومات فعلی ناموفق بود — بازیابی برای حفاظت معلومات متوقف شد",
        500,
        "SAFETY_BACKUP_FAILED",
      );
    }
    const safetyStat = await fs.stat(safetyDest);

    // بازیابی همهٔ جدول‌ها داخل تراکنش
    const rows = await restoreFromBackupFile(backupPath);

    // جدول Backup هم توسط بازیابی بازسازی شده است؛ نسخهٔ موقتِ پیش از بازیابی
    // را دوباره در فهرست ثبت می‌کنیم تا کاربر بتواند در صورت نیاز به حالت
    // قبل از بازیابی برگردد.
    const safety = await db.backup.create({
      data: {
        filename: safetyName,
        size: safetyStat.size,
        type: "AUTO",
        status: "OK",
        note: `خودکار — پیش از بازیابی «${backup.filename}»`,
        createdBy: user.id,
        createdByName: user.fullName,
      },
    });

    // جدول Session نیز بازیابی می‌شود؛ برای جلوگیری از خروج ناگهانی کاربر فعلی،
    // در صورت وجود او در داده‌های بازیابی‌شده، یک نشست تازه ساخته می‌شود.
    const me = await db.user.findUnique({ where: { id: user.id } });
    if (me && me.isActive) {
      await createSession(me.id, "restore", getClientIp(req));
    }

    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "RESTORE",
      entity: "Backup",
      entityId: backup.id,
      summary: `بازیابی کامل سیستم از نسخهٔ احتیاطی ${backup.filename} (${rows} ردیف) — بکاپ موقت پیش از بازیابی: ${safetyName}`,
      ip: getClientIp(req),
    });
    return ok({
      restored: true,
      rows,
      filename: backup.filename,
      safetyBackup: { id: safety.id, filename: safetyName },
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
