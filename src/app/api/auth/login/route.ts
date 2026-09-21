import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, getClientIp, handleApiError, ok } from "@/lib/api-utils";
import { buildAuthUser, createSession, verifyPassword } from "@/lib/auth";
import { logAudit } from "@/lib/business";
import { ensureBootstrap } from "@/lib/bootstrap";

export async function POST(req: NextRequest) {
  try {
    // راه‌اندازی اولیه (idempotent) قبل از اولین ورود
    await ensureBootstrap();

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!username || !password) {
      throw new ApiError("نام کاربری و رمز عبور الزامی است", 422, "VALIDATION");
    }

    const user = await db.user.findUnique({
      where: { username },
      include: { role: true, branch: true },
    });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new ApiError("نام کاربری یا رمز عبور نادرست است", 401, "INVALID_CREDENTIALS");
    }
    if (!user.isActive) {
      throw new ApiError("حساب کاربری شما غیرفعال است", 403, "ACCOUNT_DISABLED");
    }

    const ip = getClientIp(req);
    const device =
      typeof body.device === "string" && body.device.trim()
        ? body.device.trim()
        : undefined;

    await createSession(user.id, device, ip);
    await db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "LOGIN",
      entity: "User",
      entityId: user.id,
      summary: `ورود کاربر «${user.username}» به سیستم`,
      ip,
    });

    const authUser = await buildAuthUser(user.id);
    return ok({ user: authUser });
  } catch (e) {
    return handleApiError(e);
  }
}
