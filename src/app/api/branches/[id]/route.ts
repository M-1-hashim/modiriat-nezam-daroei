import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError, getClientIp, handleApiError, ok } from "@/lib/api-utils";
import { requirePermission, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/business";
import {
  bodyBool,
  bodyOptStr,
  bodyStr,
  handleRouteError,
  readBody,
  requireSuperAdmin,
  stripFields,
} from "@/app/api/users/_shared";

// PUT /api/branches/[id] — ویرایش شعبه (admin.edit + مدیر ارشد)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    requirePermission(user, "admin.edit");
    requireSuperAdmin(user);
    const { id } = await params;

    const existing = await db.branch.findUnique({ where: { id } });
    if (!existing) throw new ApiError("شعبه یافت نشد", 404, "NOT_FOUND");

    const body = await readBody(req);
    const data: Prisma.BranchUpdateInput = {};
    if (body.code !== undefined) data.code = bodyStr(body, "code");
    if (body.name !== undefined) data.name = bodyStr(body, "name");
    if (body.city !== undefined) data.city = bodyOptStr(body, "city");
    if (body.address !== undefined) data.address = bodyOptStr(body, "address");
    if (body.phone !== undefined) data.phone = bodyOptStr(body, "phone");
    if (body.isHeadOffice !== undefined)
      data.isHeadOffice = bodyBool(body, "isHeadOffice", false);
    if (body.isActive !== undefined)
      data.isActive = bodyBool(body, "isActive", true);

    const updated = await db.branch.update({ where: { id }, data });

    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "UPDATE",
      entity: "Branch",
      entityId: id,
      summary: `ویرایش شعبه «${updated.name}»`,
      before: stripFields(existing, []),
      after: stripFields(updated, []),
      ip: getClientIp(req),
    });
    return ok(updated);
  } catch (e) {
    return handleRouteError(e, "این کد شعبه قبلاً ثبت شده است");
  }
}

// DELETE /api/branches/[id] — حذف یا غیرفعال‌سازی شعبه
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    requirePermission(user, "admin.delete");
    requireSuperAdmin(user);
    const { id } = await params;

    const existing = await db.branch.findUnique({ where: { id } });
    if (!existing) throw new ApiError("شعبه یافت نشد", 404, "NOT_FOUND");

    const [users, warehouses, purchases, sales, customers, expenses, movements] =
      await Promise.all([
        db.user.count({ where: { branchId: id } }),
        db.warehouse.count({ where: { branchId: id } }),
        db.purchase.count({ where: { branchId: id } }),
        db.sale.count({ where: { branchId: id } }),
        db.customer.count({ where: { branchId: id } }),
        db.expense.count({ where: { branchId: id } }),
        db.stockMovement.count({ where: { branchId: id } }),
      ]);
    const hasData =
      users + warehouses + purchases + sales + customers + expenses + movements > 0;

    if (hasData) {
      const updated = await db.branch.update({
        where: { id },
        data: { isActive: false },
      });
      await logAudit(db, {
        userId: user.id,
        userName: user.fullName,
        branchId: user.branchId,
        action: "UPDATE",
        entity: "Branch",
        entityId: id,
        summary: `شعبه «${existing.name}» به دلیل داشتن اطلاعات، غیرفعال شد`,
        before: stripFields(existing, []),
        after: stripFields(updated, []),
        ip: getClientIp(req),
      });
      return ok({
        softDeleted: true,
        branch: updated,
        message: "این شعبه دارای اطلاعات است؛ به‌جای حذف، غیرفعال گردید",
      });
    }

    await db.branch.delete({ where: { id } });
    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "DELETE",
      entity: "Branch",
      entityId: id,
      summary: `حذف شعبه «${existing.name}»`,
      before: stripFields(existing, []),
      ip: getClientIp(req),
    });
    return ok({ softDeleted: false });
  } catch (e) {
    return handleRouteError(e);
  }
}
