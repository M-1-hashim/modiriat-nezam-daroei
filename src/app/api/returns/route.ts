import { db } from "@/lib/db";
import { ApiError, getPagination, handleApiError, ok, parseDate } from "@/lib/api-utils";
import {
  allowedBranchIds,
  assertBranchAccess,
  requirePermission,
  requireUser,
} from "@/lib/auth";

// GET /api/returns — لیست برگشتی‌های فروش و خرید
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    requirePermission(user, "returns.view");

    const url = new URL(req.url);
    const { page, limit, skip, take } = getPagination(url, 50);
    const type = url.searchParams.get("type")?.trim().toUpperCase() ?? "";
    const status = url.searchParams.get("status")?.trim() ?? "";
    const branchIdParam = url.searchParams.get("branchId")?.trim() ?? "";
    const from = parseDate(url.searchParams.get("from"));
    const to = parseDate(url.searchParams.get("to"));

    if (type && type !== "SALES" && type !== "PURCHASE") {
      throw new ApiError("نوع برگشتی باید فروش یا خرید باشد", 422, "VALIDATION");
    }

    const branchConds: string[] = [];
    if (branchIdParam) {
      assertBranchAccess(user, branchIdParam);
      branchConds.push(branchIdParam);
    }
    const allowed = allowedBranchIds(user);
    if (allowed) branchConds.push(...allowed);

    const baseFilter = {
      ...(branchConds.length > 0 ? { branchId: { in: branchConds } } : {}),
      ...(status ? { status } : {}),
      ...(from || to
        ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    };

    const wantSales = type !== "PURCHASE";
    const wantPurchases = type !== "SALES";

    const [salesReturns, purchaseReturns] = await Promise.all([
      wantSales
        ? db.salesReturn.findMany({
            where: baseFilter,
            include: {
              sale: { select: { id: true, number: true, date: true } },
              customer: { select: { id: true, name: true } },
              warehouse: { select: { id: true, name: true } },
              branch: { select: { id: true, name: true, code: true } },
              _count: { select: { items: true } },
            },
            orderBy: [{ date: "desc" as const }, { createdAt: "desc" as const }],
            skip,
            take,
          })
        : Promise.resolve([]),
      wantPurchases
        ? db.purchaseReturn.findMany({
            where: baseFilter,
            include: {
              purchase: { select: { id: true, number: true, date: true } },
              supplier: { select: { id: true, name: true } },
              warehouse: { select: { id: true, name: true } },
              branch: { select: { id: true, name: true, code: true } },
              _count: { select: { items: true } },
            },
            orderBy: [{ date: "desc" as const }, { createdAt: "desc" as const }],
            skip,
            take,
          })
        : Promise.resolve([]),
    ]);

    return ok({ salesReturns, purchaseReturns });
  } catch (e) {
    return handleApiError(e);
  }
}
