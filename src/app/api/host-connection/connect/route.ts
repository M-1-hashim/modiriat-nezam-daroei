/** POST /api/host-connection/connect — ذخیره + برقراری تونل SSH و آزمایش MySQL */
import { ok, handleApiError } from "@/lib/api-utils";
import { requireUser, requirePermission } from "@/lib/auth";
import { connectHost, getStatus } from "@/lib/host-connection";
import { handleRouteError, requireSuperAdmin, readBody } from "@/app/api/users/_shared";

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    requirePermission(user, "host.view");
    requireSuperAdmin(user, "اتصال به هاست فقط توسط مدیر ارشد سیستم مجاز است");
    let input: Record<string, unknown> = {};
    try {
      input = await readBody(req);
    } catch {
      input = {};
    }
    const result = await connectHost({
      sshHost: typeof input.sshHost === "string" ? input.sshHost : undefined,
      sshPort: input.sshPort !== undefined ? Number(input.sshPort) : undefined,
      sshUser: typeof input.sshUser === "string" ? input.sshUser : undefined,
      dbName: typeof input.dbName === "string" ? input.dbName : undefined,
      dbUser: typeof input.dbUser === "string" ? input.dbUser : undefined,
      dbPassword: typeof input.dbPassword === "string" ? input.dbPassword : undefined,
      localPort: input.localPort !== undefined ? Number(input.localPort) : undefined,
    });
    return ok({ result, status: getStatus() });
  } catch (e) {
    return handleRouteError(e);
  }
}
