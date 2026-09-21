import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, getClientIp, handleApiError, ok, toNum } from "@/lib/api-utils";
import { assertBranchAccess, requirePermission, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/business";
import {
  bodyBool,
  bodyOptStr,
  bodyStr,
  handleRouteError,
  readBody,
} from "@/app/api/users/_shared";

type Ctx = { params: Promise<{ id: string }> };

function parseTerritoryIds(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter((x) => x !== "");
}

// PUT /api/salespersons/[id] — ویرایش فروشنده (personnel.edit)
export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    requirePermission(user, "personnel.edit");
    const { id } = await ctx.params;

    const existing = await db.salesperson.findUnique({ where: { id } });
    if (!existing) throw new ApiError("فروشنده یافت نشد", 404, "NOT_FOUND");
    assertBranchAccess(user, existing.branchId);

    const body = await readBody(req);
    const data: {
      name?: string;
      phone?: string | null;
      commission?: number;
      userId?: string | null;
      isActive?: boolean;
      territories?: { set: { id: string }[] };
    } = {};

    if (body.name !== undefined) {
      const name = bodyStr(body, "name");
      if (!name) throw new ApiError("نام فروشنده نمی‌تواند خالی باشد", 422, "VALIDATION");
      data.name = name;
    }
    if (body.phone !== undefined) data.phone = bodyOptStr(body, "phone");
    if (body.commission !== undefined) {
      const commission = toNum(body.commission, 0);
      if (commission < 0 || commission > 100) {
        throw new ApiError("کمیسیون باید بین ۰ تا ۱۰۰ درصد باشد", 422, "VALIDATION");
      }
      data.commission = commission;
    }
    if (body.userId !== undefined) {
      const userId = bodyOptStr(body, "userId");
      if (userId) {
        const linked = await db.user.findUnique({ where: { id: userId } });
        if (!linked) throw new ApiError("کاربر مربوط یافت نشد", 404, "NOT_FOUND");
      }
      data.userId = userId ?? null;
    }
    if (body.isActive !== undefined) data.isActive = bodyBool(body, "isActive", true);
    if (body.territoryIds !== undefined) {
      const territoryIds = parseTerritoryIds(body.territoryIds);
      if (territoryIds.length > 0) {
        const found = await db.territory.count({ where: { id: { in: territoryIds } } });
        if (found !== territoryIds.length) {
          throw new ApiError("یک یا چند منطقهٔ انتخابی یافت نشد", 404, "NOT_FOUND");
        }
      }
      data.territories = { set: territoryIds.map((tid) => ({ id: tid })) };
    }

    const updated = await db.salesperson.update({
      where: { id },
      data,
      include: { territories: { select: { id: true, name: true } } },
    });

    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "UPDATE",
      entity: "Salesperson",
      entityId: id,
      summary: `ویرایش فروشندهٔ «${updated.name}»`,
      before: existing,
      after: updated,
      ip: getClientIp(req),
    });
    return ok(updated);
  } catch (e) {
    return handleRouteError(e);
  }
}

// DELETE /api/salespersons/[id] — حذف فروشنده (personnel.delete)
export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    requirePermission(user, "personnel.delete");
    const { id } = await ctx.params;

    const existing = await db.salesperson.findUnique({ where: { id } });
    if (!existing) throw new ApiError("فروشنده یافت نشد", 404, "NOT_FOUND");
    assertBranchAccess(user, existing.branchId);

    const [sales, customers] = await Promise.all([
      db.sale.count({ where: { salespersonId: id } }),
      db.customer.count({ where: { salespersonId: id } }),
    ]);
    const hasData = sales + customers > 0;

    if (hasData) {
      const updated = await db.salesperson.update({
        where: { id },
        data: { isActive: false },
      });
      await logAudit(db, {
        userId: user.id,
        userName: user.fullName,
        branchId: user.branchId,
        action: "UPDATE",
        entity: "Salesperson",
        entityId: id,
        summary: `فروشندهٔ «${existing.name}» دارای اسناد است؛ غیرفعال شد`,
        after: updated,
        ip: getClientIp(req),
      });
      return ok({
        softDeleted: true,
        salesperson: updated,
        message: "این فروشنده دارای فاکتور/مشتری است؛ به‌جای حذف، غیرفعال گردید",
      });
    }

    await db.salesperson.delete({ where: { id } });
    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "DELETE",
      entity: "Salesperson",
      entityId: id,
      summary: `حذف فروشندهٔ «${existing.name}»`,
      before: existing,
      ip: getClientIp(req),
    });
    return ok({ softDeleted: false });
  } catch (e) {
    return handleRouteError(e);
  }
}
