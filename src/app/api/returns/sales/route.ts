import { getClientIp, handleApiError, ok } from "@/lib/api-utils";
import { requireUser } from "@/lib/auth";
import { createSalesReturn } from "../_service";

// POST /api/returns/sales — ثبت برگشتی فروش
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await createSalesReturn(user, body, getClientIp(req));
    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}
