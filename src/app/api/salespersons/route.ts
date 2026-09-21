import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, getClientIp, handleApiError, ok, toNum } from "@/lib/api-utils";
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

function parseTerritoryIds(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter((x) => x !== "");
}

// GET /api/salespersons?branchId? — لیست فروشندگان (personnel.view) شامل مناطق
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

    const salespersons = await db.salesperson.findMany({
      where,
      orderBy: { name: "asc" },
      include: {
        branch: { select: { id: true, code: true, name: true } },
        territories: { select: { id: true, name: true, branchId: true } },
        _count: { select: { customers: true, sales: true } },
      },
    });
    return ok(salespersons);
  } catch (e) {
    return handleApiError(e);
  }
}

// POST /api/salespersons — ایجاد فروشنده (personnel.create)
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    requirePermission(user, "personnel.create");

    const body = await readBody(req);
    const name = bodyStr(body, "name");
    if (!name) throw new ApiError("نام فروشنده الزامی است", 422, "VALIDATION");

    const branchId = effectiveBranchId(user, bodyOptStr(body, "branchId"));
    const branch = await db.branch.findUnique({ where: { id: branchId } });
    if (!branch) throw new ApiError("شعبهٔ انتخاب‌شده یافت نشد", 404, "NOT_FOUND");

    const commission = toNum(body.commission, 0);
    if (commission < 0 || commission > 100) {
      throw new ApiError("کمیسیون باید بین ۰ تا ۱۰۰ درصد باشد", 422, "VALIDATION");
    }

    const territoryIds = parseTerritoryIds(body.territoryIds);
    if (territoryIds.length > 0) {
      const found = await db.territory.count({ where: { id: { in: territoryIds } } });
      if (found !== territoryIds.length) {
        throw new ApiError("یک یا چند منطقهٔ انتخابی یافت نشد", 404, "NOT_FOUND");
      }
    }

    const userId = bodyOptStr(body, "userId");
    if (userId) {
      const linked = await db.user.findUnique({ where: { id: userId } });
      if (!linked) throw new ApiError("کاربر مربوط یافت نشد", 404, "NOT_FOUND");
    }

    const created = await db.salesperson.create({
      data: {
        branchId,
        name,
        phone: bodyOptStr(body, "phone"),
        commission,
        userId,
        ...(territoryIds.length > 0
          ? { territories: { connect: territoryIds.map((id) => ({ id })) } }
          : {}),
      },
      include: { territories: { select: { id: true, name: true } } },
    });

    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "CREATE",
      entity: "Salesperson",
      entityId: created.id,
      summary: `ایجاد فروشندهٔ «${name}» با ${created.territories.length} منطقه`,
      after: created,
      ip: getClientIp(req),
    });
    return ok(created, 201);
  } catch (e) {
    return handleRouteError(e);
  }
}
