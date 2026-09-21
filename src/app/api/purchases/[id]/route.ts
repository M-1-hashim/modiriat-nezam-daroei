import { ApiError, handleApiError, ok } from "@/lib/api-utils";
import { assertBranchAccess, requirePermission, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getPurchaseDetail, updatePurchase } from "../_service";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/purchases/[id] — جزئیات فاکتور خرید
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    requirePermission(user, "purchases.view");
    const { id } = await ctx.params;

    const purchase = await db.purchase.findUnique({ where: { id }, select: { branchId: true } });
    if (!purchase) throw new ApiError("فاکتور خرید یافت نشد", 404, "NOT_FOUND");
    assertBranchAccess(user, purchase.branchId);

    return ok(await getPurchaseDetail(id));
  } catch (e) {
    return handleApiError(e);
  }
}

// PUT /api/purchases/[id] — ویرایش (فقط پیش‌نویس)
export async function PUT(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await updatePurchase(user, id, body);
    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}
