import { promises as fs } from "fs";
import path from "path";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ApiError, getClientIp } from "@/lib/api-utils";
import { requireUser, requirePermission } from "@/lib/auth";
import { logAudit } from "@/lib/business";
import { handleRouteError } from "@/app/api/users/_shared";
import { resolveDbPaths } from "@/app/api/backups/_restore";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/backups/[id]/download — دانلود فایل نسخهٔ احتیاطی روی کامپیوتر کاربر
 * فایل با Content-Disposition: attachment فرستاده می‌شود تا مرورگر «ذخیره در...»
 * را نشان دهد و کاربر محل ذخیره را خودش انتخاب کند.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    requirePermission(user, "backup.view");
    const { id } = await ctx.params;

    const backup = await db.backup.findUnique({ where: { id } });
    if (!backup) throw new ApiError("نسخهٔ احتیاطی یافت نشد", 404, "NOT_FOUND");

    const { backupsDir } = resolveDbPaths();
    const filePath = path.join(backupsDir, backup.filename);

    let content: Buffer;
    try {
      content = await fs.readFile(filePath);
    } catch {
      throw new ApiError("فایل نسخهٔ احتیاطی در دیسک یافت نشد", 404, "FILE_MISSING");
    }

    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "DOWNLOAD",
      entity: "Backup",
      entityId: backup.id,
      summary: `دانلود نسخهٔ احتیاطی ${backup.filename} (${Math.round(content.length / 1024)} کیلوبایت)`,
      ip: getClientIp(req),
    });

    // نام فایل دانلودی — بدون کاراکترهای خطرناک و با پسوند .db
    const safeBase = backup.filename.replace(/[^A-Za-z0-9._-]/g, "_");
    const downloadName = safeBase.endsWith(".db") ? safeBase : `${safeBase}.db`;

    return new NextResponse(new Uint8Array(content), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(content.length),
        "Content-Disposition": `attachment; filename="${downloadName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
