/** POST /api/host-connection/disconnect — بازگشت به دیتابیس محلی (بستن تونل) */
import { ok, handleApiError } from "@/lib/api-utils";
import { requireUser, requirePermission } from "@/lib/auth";
import { getStatus, stopTunnel } from "@/lib/host-connection";
import { handleRouteError, requireSuperAdmin } from "@/app/api/users/_shared";

export async function POST() {
  try {
    const user = await requireUser();
    requirePermission(user, "host.view");
    requireSuperAdmin(user, "قطع اتصال هاست فقط توسط مدیر ارشد سیستم مجاز است");
    const result = await stopTunnel();
    return ok({ result, status: getStatus() });
  } catch (e) {
    return handleRouteError(e);
  }
}
