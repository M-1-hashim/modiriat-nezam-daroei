import { ApiError, handleApiError, ok } from "@/lib/api-utils";
import { assertBranchAccess, requirePermission, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { deleteCustomer, updateCustomer } from "../_service";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/customers/[id] — صورت‌حساب مشتری
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    requirePermission(user, "customers.view");
    const { id } = await ctx.params;

    const customer = await db.customer.findUnique({
      where: { id },
      include: {
        territory: { select: { id: true, name: true } },
        salesperson: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true, code: true } },
      },
    });
    if (!customer) throw new ApiError("مشتری یافت نشد", 404, "NOT_FOUND");
    assertBranchAccess(user, customer.branchId);

    const [sales, payments, returns] = await Promise.all([
      db.sale.findMany({
        where: { customerId: id },
        orderBy: [{ date: "desc" as const }],
        take: 50,
        include: {
          items: { include: { product: { select: { id: true, name: true, unit: true } } } },
        },
      }),
      db.payment.findMany({
        where: { customerId: id },
        orderBy: [{ date: "desc" as const }],
        take: 50,
      }),
      db.salesReturn.findMany({
        where: { customerId: id },
        orderBy: [{ date: "desc" as const }],
        take: 20,
        include: { items: true },
      }),
    ]);

    return ok({ customer, sales, payments, returns });
  } catch (e) {
    return handleApiError(e);
  }
}

// PUT /api/customers/[id] — ویرایش مشتری
export async function PUT(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await updateCustomer(user, id, body);
    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}

// DELETE /api/customers/[id] — حذف یا غیرفعال‌سازی
export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const result = await deleteCustomer(user, id);
    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}
