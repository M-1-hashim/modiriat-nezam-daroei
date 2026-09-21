import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getPagination, handleApiError, ok, parseDate } from "@/lib/api-utils";
import { allowedBranchIds, requirePermission, requireUser } from "@/lib/auth";

// GET /api/audit?q?&action?&branchId?&from?&to?&page?&limit? — سابقه فعالیت‌ها (audit.view)
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    requirePermission(user, "audit.view");

    const url = new URL(req.url);
    const { page, limit, skip, take } = getPagination(url);
    const q = url.searchParams.get("q")?.trim();
    const action = url.searchParams.get("action")?.trim();
    const from = parseDate(url.searchParams.get("from"));
    const to = parseDate(url.searchParams.get("to"));

    const where: Prisma.AuditLogWhereInput = {};

    // غیرسوپرادمین همیشه محدود به شعبهٔ خودش است
    const scopes = allowedBranchIds(user);
    if (scopes) {
      where.branchId = { in: scopes };
    } else {
      const branchParam = url.searchParams.get("branchId")?.trim();
      if (branchParam) where.branchId = branchParam;
    }

    if (action) where.action = action;
    if (from || to) {
      where.createdAt = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };
    }
    if (q) {
      where.OR = [
        { userName: { contains: q } },
        { summary: { contains: q } },
        { entity: { contains: q } },
        { action: { contains: q } },
      ];
    }

    const [items, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: {
          user: { select: { id: true, username: true, fullName: true } },
        },
      }),
      db.auditLog.count({ where }),
    ]);

    return ok({ items, total, page, limit });
  } catch (e) {
    return handleApiError(e);
  }
}
