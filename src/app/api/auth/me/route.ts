import { handleApiError, ok } from "@/lib/api-utils";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
  try {
    // بدون صدا زدن ensureBootstrap — این مسیر فقط session را چک می‌کند
    // اگر دیتابیس در دسترس نباشد، getSessionUser در صورت demo session
    // کاربر را برمی‌گرداند؛ وگرنه null برمی‌گرداند (که باعث صفحه login می‌شود)
    const user = await getSessionUser();
    // هرگز 401 نمی‌دهد — کاربر نشسته ممکن است null باشد
    return ok({ user });
  } catch (e) {
    return handleApiError(e);
  }
}
