import { ApiError, getClientIp, handleApiError, ok } from "@/lib/api-utils";
import { requireUser } from "@/lib/auth";
import { approveReturn, type ReturnKind } from "../../../_service";

function parseKind(raw: string): ReturnKind {
  const k = raw.toLowerCase();
  if (k.startsWith("sale")) return "sales";
  if (k.startsWith("purchase")) return "purchase";
  throw new ApiError("نوع برگشتی نامعتبر است", 404, "NOT_FOUND");
}

// POST /api/returns/[type]/[id]/approve — تصویب برگشتی (فقط REQUESTED)
export async function POST(
  req: Request,
  ctx: { params: Promise<{ type: string; id: string }> }
) {
  try {
    const user = await requireUser();
    const { type, id } = await ctx.params;
    const result = await approveReturn(user, parseKind(type), id, getClientIp(req));
    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}
