import { getClientIp, handleApiError, ok } from "@/lib/api-utils";
import { requireUser } from "@/lib/auth";
import { approveSale } from "../../_service";

// POST /api/sales/[id]/approve — تصویب فاکتور فروش
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const result = await approveSale(user, id, getClientIp(req));
    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}
