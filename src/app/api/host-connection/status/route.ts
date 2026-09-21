/** GET /api/host-connection/status — وضعیت واقعی اتصال به هاست برای نشانگر هدر */
import { ok, handleApiError } from "@/lib/api-utils";
import { requireUser } from "@/lib/auth";
import { getStatus } from "@/lib/host-connection";

/**
 * برخلاف GET /api/host-connection (که مجوز host.view می‌خواهد)، این مسیر
 * فقط ورود کاربر را می‌خواهد تا «چراغک وضعیت» هدر برای همهٔ کاربران کار کند.
 * برای جلوگیری از افشای مشخصات سرور، فقط وضعیت خلاصه برمی‌گردد.
 */
export async function GET() {
  try {
    await requireUser();
    const s = getStatus();
    return ok({
      online: s.online,
      since: s.since,
      localPort: s.localPort,
      mysqlVersion: s.mysqlVersion,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
