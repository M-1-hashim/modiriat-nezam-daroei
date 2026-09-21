import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, getClientIp, handleApiError, ok } from "@/lib/api-utils";
import {
  allowedBranchIds,
  effectiveBranchId,
  requirePermission,
  requireUser,
} from "@/lib/auth";
import { logAudit } from "@/lib/business";
import {
  bodyOptStr,
  bodyStr,
  handleRouteError,
  readBody,
} from "@/app/api/users/_shared";

// GET /api/territories?branchId? — لیست مناطق (personnel.view)
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    requirePermission(user, "personnel.view");

    const url = new URL(req.url);
    const branchParam = url.searchParams.get("branchId")?.trim();

    const where: { branchId?: string | { in: string[] } } = {};
    const scopes = allowedBranchIds(user);
    if (scopes) {
      where.branchId = { in: scopes };
    } else if (branchParam) {
      where.branchId = branchParam;
    }

    const territories = await db.territory.findMany({
      where,
      orderBy: { name: "asc" },
      include: {
        branch: { select: { id: true, code: true, name: true } },
        _count: { select: { customers: true, salespersons: true } },
      },
    });
    return ok(territories);
  } catch (e) {
    return handleApiError(e);
  }
}

// POST /api/territories — ایجاد منطقه (personnel.create)
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    requirePermission(user, "personnel.create");

    const body = await readBody(req);
    const name = bodyStr(body, "name");
    if (!name) throw new ApiError("نام منطقه الزامی است", 422, "VALIDATION");

    const branchId = effectiveBranchId(user, bodyOptStr(body, "branchId"));
    const branch = await db.branch.findUnique({ where: { id: branchId } });
    if (!branch) throw new ApiError("شعبهٔ انتخاب‌شده یافت نشد", 404, "NOT_FOUND");

    const created = await db.territory.create({
      data: { branchId, name, description: bodyOptStr(body, "description") },
    });

    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "CREATE",
      entity: "Territory",
      entityId: created.id,
      summary: `ایجاد منطقهٔ «${created.name}» در شعبهٔ ${branch.name}`,
      after: created,
      ip: getClientIp(req),
    });
    return ok(created, 201);
  } catch (e) {
    return handleRouteError(e);
  }
}
