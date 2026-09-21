import { db } from "@/lib/db";
import { handleApiError, ok } from "@/lib/api-utils";
import { ensureBootstrap } from "@/lib/bootstrap";

export async function GET() {
  try {
    const { created } = await ensureBootstrap();
    const hasUsers = (await db.user.count()) > 0;
    return ok({
      hasUsers,
      ...(created ? { defaultHint: "admin / admin123" } : {}),
    });
  } catch (e) {
    return handleApiError(e);
  }
}
