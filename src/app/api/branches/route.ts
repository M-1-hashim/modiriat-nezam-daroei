import type { NextRequest } from "next/server";
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
} from "@/app/api/users/_shared";

// GET /api/branches — دیدن لیست شعبه‌ها برای هر کاربر وارد (برای منوها)
export async function GET() {
  try {
    await requireUser();
    const branches = await db.branch.findMany({
      orderBy: [{ isHeadOffice: "desc" }, { name: "asc" }],
      include: { _count: { select: { users: true, warehouses: true } } },
    });
    return ok(branches);
  } catch (e) {
    return handleApiError(e);
  }
}

// POST /api/branches — ایجاد شعبه (admin.create + مدیر ارشد)
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    requirePermission(user, "admin.create");
    requireSuperAdmin(user);

    const body = await readBody(req);
    const code = bodyStr(body, "code");
    const name = bodyStr(body, "name");
    if (!code || !name) {
      throw new ApiError("کد و نام شعبه الزامی است", 422, "VALIDATION");
    }

    const branch = await db.branch.create({
      data: {
        code,
        name,
        city: bodyOptStr(body, "city"),
        address: bodyOptStr(body, "address"),
        phone: bodyOptStr(body, "phone"),
        isHeadOffice: bodyBool(body, "isHeadOffice", false),
      },
    });

    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "CREATE",
      entity: "Branch",
      entityId: branch.id,
      summary: `ایجاد شعبه «${branch.name}» با کد ${branch.code}`,
      after: branch,
      ip: getClientIp(req),
    });
    return ok(branch, 201);
  } catch (e) {
    return handleRouteError(e, "این کد شعبه قبلاً ثبت شده است");
  }
}
