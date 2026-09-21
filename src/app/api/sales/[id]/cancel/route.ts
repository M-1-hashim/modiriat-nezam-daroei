import { getClientIp, handleApiError, ok } from "@/lib/api-utils";
import { requireUser } from "@/lib/auth";
import { cancelSale } from "../../_service";

// POST /api/sales/[id]/cancel — لغو فاکتور فروش (فقط پیش‌نویس/در انتظار)
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const result = await cancelSale(user, id, getClientIp(req));
    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}
