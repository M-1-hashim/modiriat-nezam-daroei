import { ApiError, handleApiError, ok } from "@/lib/api-utils";
import { assertBranchAccess, requirePermission, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSaleDetail, updateSale } from "../_service";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/sales/[id] — جزئیات فاکتور فروش
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    requirePermission(user, "sales.view");
    const { id } = await ctx.params;

    const sale = await db.sale.findUnique({ where: { id }, select: { branchId: true } });
    if (!sale) throw new ApiError("فاکتور فروش یافت نشد", 404, "NOT_FOUND");
    assertBranchAccess(user, sale.branchId);

    return ok(await getSaleDetail(id));
  } catch (e) {
    return handleApiError(e);
  }
}

// PUT /api/sales/[id] — ویرایش (فقط پیش‌نویس)
export async function PUT(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await updateSale(user, id, body);
    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}
