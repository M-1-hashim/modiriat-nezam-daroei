import type { NextRequest } from "next/server";
import { getClientIp, handleApiError, ok } from "@/lib/api-utils";
import { destroySession, getSessionUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    const ip = getClientIp(req);
    await destroySession();
    // اگر دیتابیس در دسترس نباشد، logAudit نادیده گرفته می‌شود
    if (user && user.id !== "demo-admin") {
      try {
        const { db } = await import("@/lib/db");
        const { logAudit } = await import("@/lib/business");
        await logAudit(db, {
          userId: user.id,
          userName: user.fullName,
          branchId: user.branchId,
          action: "LOGOUT",
          entity: "User",
          entityId: user.id,
          summary: `خروج کاربر «${user.username}» از سیستم`,
          ip,
        });
      } catch {
        // نادیده گرفته شود — cookie پاک شده و کاربر خارج شده است
      }
    }
    return ok({});
  } catch (e) {
    return handleApiError(e);
  }
}
