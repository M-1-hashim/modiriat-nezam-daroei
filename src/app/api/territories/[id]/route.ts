import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, getClientIp, handleApiError, ok } from "@/lib/api-utils";
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

// PUT /api/territories/[id] — ویرایش منطقه (personnel.edit)
export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    requirePermission(user, "personnel.edit");
    const { id } = await ctx.params;

    const existing = await db.territory.findUnique({ where: { id } });
    if (!existing) throw new ApiError("منطقه یافت نشد", 404, "NOT_FOUND");
    assertBranchAccess(user, existing.branchId);

    const body = await readBody(req);
    const data: { name?: string; description?: string | null; isActive?: boolean } = {};
    if (body.name !== undefined) {
      const name = bodyStr(body, "name");
      if (!name) throw new ApiError("نام منطقه نمی‌تواند خالی باشد", 422, "VALIDATION");
      data.name = name;
    }
    if (body.description !== undefined)
      data.description = bodyOptStr(body, "description");
    if (body.isActive !== undefined) data.isActive = bodyBool(body, "isActive", true);

    const updated = await db.territory.update({ where: { id }, data });
    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "UPDATE",
      entity: "Territory",
      entityId: id,
      summary: `ویرایش منطقهٔ «${updated.name}»`,
      before: existing,
      after: updated,
      ip: getClientIp(req),
    });
    return ok(updated);
  } catch (e) {
    return handleRouteError(e);
  }
}

// DELETE /api/territories/[id] — حذف منطقه (personnel.delete)
export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    requirePermission(user, "personnel.delete");
    const { id } = await ctx.params;

    const existing = await db.territory.findUnique({ where: { id } });
    if (!existing) throw new ApiError("منطقه یافت نشد", 404, "NOT_FOUND");
    assertBranchAccess(user, existing.branchId);

    const [customers, sales, salespersons] = await Promise.all([
      db.customer.count({ where: { territoryId: id } }),
      db.sale.count({ where: { territoryId: id } }),
      db.salesperson.count({ where: { territories: { some: { id } } } }),
    ]);
    const hasData = customers + sales + salespersons > 0;

    if (hasData) {
      const updated = await db.territory.update({
        where: { id },
        data: { isActive: false },
      });
      await logAudit(db, {
        userId: user.id,
        userName: user.fullName,
        branchId: user.branchId,
        action: "UPDATE",
        entity: "Territory",
        entityId: id,
        summary: `منطقهٔ «${existing.name}» دارای ارجاع است؛ غیرفعال شد`,
        after: updated,
        ip: getClientIp(req),
      });
      return ok({
        softDeleted: true,
        territory: updated,
        message: "این منطقه دارای مشتری/فروشنده/فروش است؛ به‌جای حذف، غیرفعال گردید",
      });
    }

    await db.territory.delete({ where: { id } });
    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "DELETE",
      entity: "Territory",
      entityId: id,
      summary: `حذف منطقهٔ «${existing.name}»`,
      before: existing,
      ip: getClientIp(req),
    });
    return ok({ softDeleted: false });
  } catch (e) {
    return handleRouteError(e);
  }
}
