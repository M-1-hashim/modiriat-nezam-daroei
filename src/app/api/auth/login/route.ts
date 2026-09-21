import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, getClientIp, handleApiError, ok } from "@/lib/api-utils";
import {
  buildAuthUser,
  checkDemoCredentials,
  createDemoSession,
  createSession,
  DEMO_USER,
  verifyPassword,
} from "@/lib/auth";
import { logAudit } from "@/lib/business";
import { ensureBootstrap } from "@/lib/bootstrap";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!username || !password) {
      throw new ApiError("نام کاربری و رمز عبور الزامی است", 422, "VALIDATION");
    }

    const ip = getClientIp(req);
    const device =
      typeof body.device === "string" && body.device.trim()
        ? body.device.trim()
        : undefined;

    // ──── تلاش برای راه‌اندازی اولیه (در صورت موجود بودن دیتابیس) ────
    // اگر دیتابیس در دسترس نباشد، این مرحله نادیده گرفته می‌شود و demo mode فعال می‌شود
    let bootstrapDone = false;
    try {
      await ensureBootstrap();
      bootstrapDone = true;
    } catch (e) {
      console.warn(
        "[auth/login] ensureBootstrap failed — proceeding with demo mode:",
        e instanceof Error ? e.message : String(e),
      );
    }

    // ──── ۱) تلاش برای login از طریق دیتابیس ────
    if (bootstrapDone) {
      try {
        const user = await db.user.findUnique({
          where: { username },
          include: { role: true, branch: true },
        });
        if (user && user.isActive && verifyPassword(password, user.passwordHash)) {
          await createSession(user.id, device, ip);
          await db.user.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() },
          }).catch(() => undefined);
          await logAudit(db, {
            userId: user.id,
            userName: user.fullName,
            branchId: user.branchId,
            action: "LOGIN",
            entity: "User",
            entityId: user.id,
            summary: `ورود کاربر «${user.username}» به سیستم`,
            ip,
          }).catch(() => undefined);
          const authUser = await buildAuthUser(user.id);
          return ok({ user: authUser });
        }
      } catch (e) {
        console.warn(
          "[auth/login] DB user lookup failed — falling back to demo mode:",
          e instanceof Error ? e.message : String(e),
        );
      }
    }

    // ──── ۲) Demo Mode — بدون نیاز به دیتابیس ────
    // وقتی دیتابیس در دسترس نباشد یا هنوز کاربر admin ساخته نشده باشد،
    // این مسیر فعال می‌شود. credentials از env vars یا پیش‌فرض admin/admin123.
    if (checkDemoCredentials(username, password)) {
      await createDemoSession();
      return ok({ user: DEMO_USER });
    }

    throw new ApiError("نام کاربری یا رمز عبور نادرست است", 401, "INVALID_CREDENTIALS");
  } catch (e) {
    return handleApiError(e);
  }
}
