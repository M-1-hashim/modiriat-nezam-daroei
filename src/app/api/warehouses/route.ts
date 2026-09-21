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
  bodyBool,
  bodyOptStr,
  bodyStr,
  handleRouteError,
  readBody,
} from "@/app/api/users/_shared";

// GET /api/warehouses?branchId? — لیست گدام‌ها (personnel.view) با فیلتر شعبه
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

    const warehouses = await db.warehouse.findMany({
      where,
      orderBy: [{ isMain: "desc" }, { name: "asc" }],
      include: {
        branch: { select: { id: true, code: true, name: true } },
        _count: { select: { stockItems: true } },
      },
    });
    return ok(warehouses);
  } catch (e) {
    return handleApiError(e);
  }
}

// POST /api/warehouses — ایجاد گدام (مدیریت پرسونل/گدام از admin.create استفاده می‌کند)
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    requirePermission(user, "admin.create");

    const body = await readBody(req);
    const name = bodyStr(body, "name");
    if (!name) throw new ApiError("نام گدام الزامی است", 422, "VALIDATION");

    const branchId = effectiveBranchId(user, bodyOptStr(body, "branchId"));
    const branch = await db.branch.findUnique({ where: { id: branchId } });
    if (!branch) throw new ApiError("شعبهٔ انتخاب‌شده یافت نشد", 404, "NOT_FOUND");

    const isMain = bodyBool(body, "isMain", false);
    if (isMain) {
      // در هر شعبه فقط یک گدام اصلی
      await db.warehouse.updateMany({
        where: { branchId, isMain: true },
        data: { isMain: false },
      });
    }

    const created = await db.warehouse.create({
      data: {
        branchId,
        name,
        location: bodyOptStr(body, "location"),
        isMain,
      },
    });

    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "CREATE",
      entity: "Warehouse",
      entityId: created.id,
      summary: `ایجاد گدام «${created.name}» در شعبهٔ ${branch.name}`,
      after: created,
      ip: getClientIp(req),
    });
    return ok(created, 201);
  } catch (e) {
    return handleRouteError(e);
  }
}
