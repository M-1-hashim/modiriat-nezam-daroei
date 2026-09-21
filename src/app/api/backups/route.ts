import { promises as fs } from "fs";
import path from "path";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getClientIp, handleApiError, ok } from "@/lib/api-utils";
import { requirePermission, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/business";
import { handleRouteError, bodyOptStr, readBody } from "@/app/api/users/_shared";
import { resolveDbPaths } from "@/app/api/backups/_restore";

// GET /api/backups — لیست نسخه‌های احتیاطی (backup.view)
export async function GET() {
  try {
    const user = await requireUser();
    requirePermission(user, "backup.view");
    const rows = await db.backup.findMany({ orderBy: { createdAt: "desc" } });
    return ok(rows);
  } catch (e) {
    return handleApiError(e);
  }
}

// POST /api/backups {note?} — ایجاد نسخهٔ احتیاطی از فایل دیتابیس (backup.create)
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    requirePermission(user, "backup.create");

    const body = await readBody(req);
    const { dbPath, backupsDir } = resolveDbPaths();

    await fs.access(dbPath);
    await fs.mkdir(backupsDir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
    const filename = `backup-${stamp}.db`;
    const dest = path.join(backupsDir, filename);
    await fs.copyFile(dbPath, dest);
    const stat = await fs.stat(dest);

    const row = await db.backup.create({
      data: {
        filename,
        size: stat.size,
        type: "MANUAL",
        status: "OK",
        note: bodyOptStr(body, "note"),
        createdBy: user.id,
        createdByName: user.fullName,
      },
    });

    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "BACKUP",
      entity: "Backup",
      entityId: row.id,
      summary: `ایجاد نسخهٔ احتیاطی ${filename} (${Math.round(stat.size / 1024)} کیلوبایت)`,
      ip: getClientIp(req),
    });
    return ok(row, 201);
  } catch (e) {
    return handleRouteError(e);
  }
}
