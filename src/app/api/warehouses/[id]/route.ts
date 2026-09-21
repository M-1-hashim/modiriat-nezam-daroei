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

// PUT /api/warehouses/[id] — ویرایش گدام (admin.edit)
export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    requirePermission(user, "admin.edit");
    const { id } = await ctx.params;

    const existing = await db.warehouse.findUnique({ where: { id } });
    if (!existing) throw new ApiError("گدام یافت نشد", 404, "NOT_FOUND");
    assertBranchAccess(user, existing.branchId);

    const body = await readBody(req);
    const data: { name?: string; location?: string | null; isMain?: boolean; isActive?: boolean } = {};
    if (body.name !== undefined) {
      const name = bodyStr(body, "name");
      if (!name) throw new ApiError("نام گدام نمی‌تواند خالی باشد", 422, "VALIDATION");
      data.name = name;
    }
    if (body.location !== undefined) data.location = bodyOptStr(body, "location");
    if (body.isMain !== undefined) data.isMain = bodyBool(body, "isMain", false);
    if (body.isActive !== undefined) data.isActive = bodyBool(body, "isActive", true);

    if (data.isMain) {
      await db.warehouse.updateMany({
        where: { branchId: existing.branchId, isMain: true, id: { not: id } },
        data: { isMain: false },
      });
    }

    const updated = await db.warehouse.update({ where: { id }, data });
    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "UPDATE",
      entity: "Warehouse",
      entityId: id,
      summary: `ویرایش گدام «${updated.name}»`,
      before: existing,
      after: updated,
      ip: getClientIp(req),
    });
    return ok(updated);
  } catch (e) {
    return handleRouteError(e);
  }
}

// DELETE /api/warehouses/[id] — حذف با موجودی ممنوع (admin.delete)
export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    requirePermission(user, "admin.delete");
    const { id } = await ctx.params;

    const existing = await db.warehouse.findUnique({ where: { id } });
    if (!existing) throw new ApiError("گدام یافت نشد", 404, "NOT_FOUND");
    assertBranchAccess(user, existing.branchId);

    const [nonEmptyStock, purchases, sales, salesReturns, purchaseReturns, movements] =
      await Promise.all([
        db.stockItem.count({ where: { warehouseId: id, quantity: { gt: 0 } } }),
        db.purchase.count({ where: { warehouseId: id } }),
        db.sale.count({ where: { warehouseId: id } }),
        db.salesReturn.count({ where: { warehouseId: id } }),
        db.purchaseReturn.count({ where: { warehouseId: id } }),
        db.stockMovement.count({
          where: { OR: [{ fromWarehouseId: id }, { toWarehouseId: id }] },
        }),
      ]);
    const hasData =
      nonEmptyStock + purchases + sales + salesReturns + purchaseReturns + movements > 0;

    if (hasData) {
      const updated = await db.warehouse.update({
        where: { id },
        data: { isActive: false },
      });
      await logAudit(db, {
        userId: user.id,
        userName: user.fullName,
        branchId: user.branchId,
        action: "UPDATE",
        entity: "Warehouse",
        entityId: id,
        summary: `گدام «${existing.name}» دارای موجودی/اسناد است؛ غیرفعال شد`,
        after: updated,
        ip: getClientIp(req),
      });
      return ok({
        softDeleted: true,
        warehouse: updated,
        message: "این گدام دارای موجودی یا اسناد است؛ به‌جای حذف، غیرفعال گردید",
      });
    }

    // آیتم‌های صفر-تعداد مانع حذف نیستند
    await db.stockItem.deleteMany({ where: { warehouseId: id } });
    await db.warehouse.delete({ where: { id } });
    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "DELETE",
      entity: "Warehouse",
      entityId: id,
      summary: `حذف گدام «${existing.name}»`,
      before: existing,
      ip: getClientIp(req),
    });
    return ok({ softDeleted: false });
  } catch (e) {
    return handleRouteError(e);
  }
}
