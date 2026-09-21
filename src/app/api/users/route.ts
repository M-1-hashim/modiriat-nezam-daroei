import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  ApiError,
  getClientIp,
  handleApiError,
  ok,
  toNum,
} from "@/lib/api-utils";
import {
  allowedBranchIds,
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

// GET /api/users?branchId?&q? — لیست کاربران (admin.view) — غیرسوپرادمین فقط شعبهٔ خودش
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    requirePermission(user, "admin.view");

    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim();
    const branchParam = url.searchParams.get("branchId")?.trim();

    const where: Prisma.UserWhereInput = {};
    const scopes = allowedBranchIds(user);
    if (scopes) {
      where.branchId = { in: scopes };
    } else if (branchParam) {
      where.branchId = branchParam;
    }
    if (q) {
      where.OR = [
        { username: { contains: q } },
        { fullName: { contains: q } },
        { phone: { contains: q } },
      ];
    }

    const take = Math.min(500, Math.max(1, toNum(url.searchParams.get("limit"), 200)));
    const users = await db.user.findMany({
      where,
      include: {
        role: { select: { id: true, key: true, name: true } },
        branch: { select: { id: true, code: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take,
    });
    return ok(users.map((u) => stripFields(u, ["passwordHash"])));
  } catch (e) {
    return handleRouteError(e);
  }
}

// POST /api/users — ایجاد کاربر (admin.create)
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    requirePermission(user, "admin.create");

    const body = await readBody(req);
    const username = bodyStr(body, "username");
    const fullName = bodyStr(body, "fullName");
    const roleId = bodyStr(body, "roleId");
    const password = typeof body.password === "string" ? body.password : "";

    if (!username || !fullName || !roleId) {
      throw new ApiError(
        "نام کاربری، نام کامل و نقش کاربر الزامی است",
        422,
        "VALIDATION"
      );
    }
    if (password.length < 6) {
      throw new ApiError(
        "رمز عبور باید حداقل ۶ کاراکتر باشد",
        422,
        "VALIDATION"
      );
    }

    const branchId = effectiveBranchId(user, bodyOptStr(body, "branchId"));
    const branch = await db.branch.findUnique({ where: { id: branchId } });
    if (!branch) throw new ApiError("شعبهٔ انتخاب‌شده یافت نشد", 404, "NOT_FOUND");

    const role = await db.role.findUnique({ where: { id: roleId } });
    if (!role) throw new ApiError("نقش انتخاب‌شده یافت نشد", 404, "NOT_FOUND");

    const usernameTaken = await db.user.findUnique({ where: { username } });
    if (usernameTaken) {
      throw new ApiError("این نام کاربری قبلاً ثبت شده است", 409, "DUPLICATE");
    }

    const created = await db.user.create({
      data: {
        username,
        passwordHash: hashPassword(password),
        fullName,
        phone: bodyOptStr(body, "phone"),
        roleId,
        branchId,
        isActive: bodyBool(body, "isActive", true),
      },
    });

    const safe = stripFields(created, ["passwordHash"]);
    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "CREATE",
      entity: "User",
      entityId: created.id,
      summary: `ایجاد کاربر «${username}» در شعبهٔ ${branch.name}`,
      after: safe,
      ip: getClientIp(req),
    });
    return ok(safe, 201);
  } catch (e) {
    return handleRouteError(e, "این نام کاربری قبلاً ثبت شده است");
  }
}
