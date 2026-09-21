/** GET/POST /api/host-connection — وضعیت و ذخیرهٔ مشخصات اتصال به هاست */
import type { NextRequest } from "next/server";
import { ok, handleApiError } from "@/lib/api-utils";
import { requireUser, requirePermission } from "@/lib/auth";
import {
  getMaskedSettings,
  getStatus,
  saveSettings,
} from "@/lib/host-connection";
import { handleRouteError, requireSuperAdmin, readBody } from "@/app/api/users/_shared";

export async function GET() {
  try {
    const user = await requireUser();
    requirePermission(user, "host.view");
    const [settings, status] = await Promise.all([getMaskedSettings(), Promise.resolve(getStatus())]);
    return ok({ settings, status });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    requirePermission(user, "host.view");
    requireSuperAdmin(user, "ذخیرهٔ مشخصات هاست فقط توسط مدیر ارشد سیستم مجاز است");
    const body = await readBody(req);
    const settings = await saveSettings({
      sshHost: typeof body.sshHost === "string" ? body.sshHost : undefined,
      sshPort: body.sshPort !== undefined ? Number(body.sshPort) : undefined,
      sshUser: typeof body.sshUser === "string" ? body.sshUser : undefined,
      dbName: typeof body.dbName === "string" ? body.dbName : undefined,
      dbUser: typeof body.dbUser === "string" ? body.dbUser : undefined,
      dbPassword: typeof body.dbPassword === "string" ? body.dbPassword : undefined,
      localPort: body.localPort !== undefined ? Number(body.localPort) : undefined,
    });
    const { dbPassword, ...masked } = settings;
    void dbPassword;
    return ok({ settings: { ...masked, hasPassword: Boolean(dbPassword), configPath: "" }, status: getStatus() });
  } catch (e) {
    return handleRouteError(e);
  }
}
