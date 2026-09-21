import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, getClientIp, handleApiError, ok } from "@/lib/api-utils";
import { requirePermission, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/business";
import {
  bodyStr,
  handleRouteError,
  readBody,
  stripFields,
} from "@/app/api/users/_shared";

type Ctx = { params: Promise<{ id: string }> };

// PUT /api/roles/[id] — ویرایش نام و صلاحیت‌ها (کد نقش قابل تغییر نیست)
export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    requirePermission(user, "admin.edit");
    const { id } = await ctx.params;

    const existing = await db.role.findUnique({ where: { id } });
    if (!existing) throw new ApiError("نقش یافت نشد", 404, "NOT_FOUND");

    const body = await readBody(req);
    const data: { name?: string; permissions?: string } = {};
    if (body.name !== undefined) {
      const name = bodyStr(body, "name");
      if (!name) throw new ApiError("نام نقش نمی‌تواند خالی باشد", 422, "VALIDATION");
      data.name = name;
    }
    if (body.permissions !== undefined) {
      if (!Array.isArray(body.permissions)) {
        throw new ApiError("لیست صلاحیت‌ها نامعتبر است", 422, "VALIDATION");
      }
      const permissions = (body.permissions as unknown[])
        .map((p) => String(p).trim())
        .filter((p) => p !== "");
      data.permissions = JSON.stringify(permissions);
    }

    const updated = await db.role.update({ where: { id }, data });

    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "UPDATE",
      entity: "Role",
      entityId: id,
      summary: `ویرایش نقش «${updated.name}»`,
      before: stripFields(existing, []),
      after: stripFields(updated, []),
      ip: getClientIp(req),
    });
    return ok(updated);
  } catch (e) {
    return handleRouteError(e);
  }
}

// DELETE /api/roles/[id] — نقش سیستمی یا دارای کاربر قابل حذف نیست
export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    requirePermission(user, "admin.delete");
    const { id } = await ctx.params;

    const existing = await db.role.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!existing) throw new ApiError("نقش یافت نشد", 404, "NOT_FOUND");
    if (existing.isSystem) {
      throw new ApiError("نقش‌های سیستمی قابل حذف نیستند", 400, "SYSTEM_ROLE");
    }
    if (existing._count.users > 0) {
      throw new ApiError(
        `این نقش به ${existing._count.users} کاربر تخصیص یافته؛ ابتدا نقش کاربران را تغییر دهید`,
        400,
        "ROLE_IN_USE"
      );
    }

    await db.role.delete({ where: { id } });
    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "DELETE",
      entity: "Role",
      entityId: id,
      summary: `حذف نقش «${existing.name}»`,
      before: stripFields(existing, []),
      ip: getClientIp(req),
    });
    return ok({ deleted: true });
  } catch (e) {
    return handleRouteError(e);
  }
}
