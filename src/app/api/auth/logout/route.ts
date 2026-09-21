import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getClientIp, handleApiError, ok } from "@/lib/api-utils";
import { destroySession, getSessionUser } from "@/lib/auth";
import { logAudit } from "@/lib/business";

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    const ip = getClientIp(req);
    await destroySession();
    if (user) {
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
    }
    return ok({});
  } catch (e) {
    return handleApiError(e);
  }
}
