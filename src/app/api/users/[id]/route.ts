import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError, getClientIp, handleApiError, ok } from "@/lib/api-utils";
import {
  effectiveBranchId,
  hashPassword,
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
  stripFields,
} from "@/app/api/users/_shared";

type Ctx = { params: Promise<{ id: string }> };

// PUT /api/users/[id] — ویرایش کاربر (admin.edit)
export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    requirePermission(user, "admin.edit");
    const { id } = await ctx.params;

    const target = await db.user.findUnique({ where: { id } });
    if (!target) throw new ApiError("کاربر یافت نشد", 404, "NOT_FOUND");

    const body = await readBody(req);
    const data: Prisma.UserUpdateInput = {};

    const username = bodyOptStr(body, "username");
    if (username && username !== target.username) {
      const taken = await db.user.findUnique({ where: { username } });
      if (taken) {
        throw new ApiError("این نام کاربری قبلاً ثبت شده است", 409, "DUPLICATE");
      }
      data.username = username;
    }

    if (body.fullName !== undefined) data.fullName = bodyStr(body, "fullName");
    if (body.phone !== undefined) data.phone = bodyOptStr(body, "phone");

    const roleId = bodyOptStr(body, "roleId");
    if (roleId) {
      const role = await db.role.findUnique({ where: { id: roleId } });
      if (!role) throw new ApiError("نقش انتخاب‌شده یافت نشد", 404, "NOT_FOUND");
      data.role = { connect: { id: roleId } };
    }

    const requestedBranch = bodyOptStr(body, "branchId");
    if (requestedBranch) {
      const branchId = effectiveBranchId(user, requestedBranch);
      const branch = await db.branch.findUnique({ where: { id: branchId } });
      if (!branch) throw new ApiError("شعبهٔ انتخاب‌شده یافت نشد", 404, "NOT_FOUND");
      data.branch = { connect: { id: branchId } };
    }

    const password = body.password;
    if (password !== undefined && password !== null && password !== "") {
      if (typeof password !== "string" || password.length < 6) {
        throw new ApiError(
          "رمز عبور باید حداقل ۶ کاراکتر باشد",
          422,
          "VALIDATION"
        );
      }
      data.passwordHash = hashPassword(password);
    }

    if (body.isActive !== undefined) {
      const nextActive = bodyBool(body, "isActive", true);
      if (!nextActive && target.id === user.id) {
        throw new ApiError(
          "نمی‌توانید حساب کاربری خودتان را غیرفعال کنید",
          400,
          "SELF_DEACTIVATE"
        );
      }
      data.isActive = nextActive;
    }

    const updated = await db.user.update({ where: { id }, data });
    const before = stripFields(target, ["passwordHash"]);
    const after = stripFields(updated, ["passwordHash"]);

    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "UPDATE",
      entity: "User",
      entityId: id,
      summary: `ویرایش کاربر «${updated.username}»`,
      before,
      after,
      ip: getClientIp(req),
    });
    return ok(after);
  } catch (e) {
    return handleRouteError(e, "این نام کاربری قبلاً ثبت شده است");
  }
}

// DELETE /api/users/[id] — حذف یا غیرفعال‌سازی کاربر (admin.delete)
export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    requirePermission(user, "admin.delete");
    const { id } = await ctx.params;

    const target = await db.user.findUnique({ where: { id } });
    if (!target) throw new ApiError("کاربر یافت نشد", 404, "NOT_FOUND");
    if (target.id === user.id) {
      throw new ApiError("نمی‌توانید حساب کاربری خودتان را حذف کنید", 400, "SELF_DELETE");
    }

    const [sessions, auditLogs, sales, payments, purchases, expenses] =
      await Promise.all([
        db.session.count({ where: { userId: id } }),
        db.auditLog.count({ where: { userId: id } }),
        db.sale.count({ where: { createdBy: id } }),
        db.payment.count({ where: { createdBy: id } }),
        db.purchase.count({ where: { createdBy: id } }),
        db.expense.count({ where: { createdBy: id } }),
      ]);
    const hasData =
      sessions + auditLogs + sales + payments + purchases + expenses > 0;

    if (hasData) {
      const updated = await db.user.update({
        where: { id },
        data: { isActive: false },
      });
      const after = stripFields(updated, ["passwordHash"]);
      await logAudit(db, {
        userId: user.id,
        userName: user.fullName,
        branchId: user.branchId,
        action: "UPDATE",
        entity: "User",
        entityId: id,
        summary: `کاربر «${target.username}» دارای سابقه است؛ به‌جای حذف، غیرفعال شد`,
        after,
        ip: getClientIp(req),
      });
      return ok({
        softDeleted: true,
        user: after,
        message: "این کاربر دارای سابقهٔ فعالیت است؛ به‌جای حذف، غیرفعال گردید",
      });
    }

    await db.user.delete({ where: { id } });
    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "DELETE",
      entity: "User",
      entityId: id,
      summary: `حذف کاربر «${target.username}»`,
      before: stripFields(target, ["passwordHash"]),
      ip: getClientIp(req),
    });
    return ok({ softDeleted: false });
  } catch (e) {
    return handleRouteError(e);
  }
}
