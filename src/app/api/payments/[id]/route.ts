import { getClientIp, handleApiError, ok } from "@/lib/api-utils";
import { requireUser } from "@/lib/auth";
import { deletePayment } from "../_service";

// DELETE /api/payments/[id] — لغو نرم رسید + معکوس‌سازی کامل اثر
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const result = await deletePayment(user, id, getClientIp(req));
    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}
