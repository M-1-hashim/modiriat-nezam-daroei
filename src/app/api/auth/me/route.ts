import { handleApiError, ok } from "@/lib/api-utils";
import { getSessionUser } from "@/lib/auth";
import { ensureBootstrap } from "@/lib/bootstrap";

export async function GET() {
  try {
    await ensureBootstrap();
    const user = await getSessionUser();
    // هرگز 401 نمی‌دهد — کاربر نشسته ممکن است null باشد
    return ok({ user });
  } catch (e) {
    return handleApiError(e);
  }
}
