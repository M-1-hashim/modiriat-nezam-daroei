import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, getClientIp, handleApiError, ok } from "@/lib/api-utils";
import { requirePermission, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/business";
import {
  bodyStr,
  handleRouteError,
  parsePermsField,
  readBody,
  stripFields,
} from "@/app/api/users/_shared";

// GET /api/roles — هر کاربر وارد (برای دراپ‌داون‌ها)
export async function GET() {
  try {
    await requireUser();
    const roles = await db.role.findMany({
      include: { _count: { select: { users: true } } },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    });
    return ok(
      roles.map((r) => ({
        ...r,
        permissions: parsePermsField(r.permissions),
      }))
    );
  } catch (e) {
    return handleApiError(e);
  }
}

// POST /api/roles — ایجاد نقش (admin.create)
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    requirePermission(user, "admin.create");

    const body = await readBody(req);
    const name = bodyStr(body, "name");
    const key = bodyStr(body, "key").toUpperCase().replace(/\s+/g, "_");
    if (!name || !key) {
      throw new ApiError("نام و کد نقش الزامی است", 422, "VALIDATION");
    }
    if (!Array.isArray(body.permissions)) {
      throw new ApiError("لیست صلاحیت‌ها نامعتبر است", 422, "VALIDATION");
    }
    const permissions = (body.permissions as unknown[])
      .map((p) => String(p).trim())
      .filter((p) => p !== "");

    const created = await db.role.create({
      data: { name, key, permissions: JSON.stringify(permissions) },
    });

    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "CREATE",
      entity: "Role",
      entityId: created.id,
      summary: `ایجاد نقش «${name}» با ${permissions.length} صلاحیت`,
      after: stripFields(created, []),
      ip: getClientIp(req),
    });
    return ok({ ...created, permissions }, 201);
  } catch (e) {
    return handleRouteError(e, "این کد نقش قبلاً ثبت شده است");
  }
}
