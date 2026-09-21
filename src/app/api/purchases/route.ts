import { db } from "@/lib/db";
import {
  getClientIp,
  getPagination,
  handleApiError,
  ok,
  parseDate,
} from "@/lib/api-utils";
import {
  allowedBranchIds,
  assertBranchAccess,
  requirePermission,
  requireUser,
} from "@/lib/auth";
import { createPurchase } from "./_service";

// GET /api/purchases — لیست فاکتورهای خرید (با فیلتر شعبه)
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    requirePermission(user, "purchases.view");

    const url = new URL(req.url);
    const { page, limit, skip, take } = getPagination(url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    const status = url.searchParams.get("status")?.trim() ?? "";
    const supplierId = url.searchParams.get("supplierId")?.trim() ?? "";
    const branchIdParam = url.searchParams.get("branchId")?.trim() ?? "";
    const dateFrom = parseDate(url.searchParams.get("dateFrom"));
    const dateTo = parseDate(url.searchParams.get("dateTo"));

    // فیلتر شعبه‌ای اجباری
    const branchConds: string[] = [];
    if (branchIdParam) {
      assertBranchAccess(user, branchIdParam);
      branchConds.push(branchIdParam);
    }
    const allowed = allowedBranchIds(user);
    if (allowed) branchConds.push(...allowed);

    const where = {
      ...(branchConds.length > 0 ? { branchId: { in: branchConds } } : {}),
      ...(status ? { status } : {}),
      ...(supplierId ? { supplierId } : {}),
      ...(dateFrom || dateTo
        ? { date: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } }
        : {}),
      ...(q
        ? {
            OR: [
              { number: { contains: q } },
              { supplier: { name: { contains: q } } },
              { notes: { contains: q } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      db.purchase.findMany({
        where,
        include: {
          supplier: { select: { id: true, name: true } },
          branch: { select: { id: true, name: true, code: true } },
          warehouse: { select: { id: true, name: true } },
        },
        orderBy: [{ date: "desc" as const }, { createdAt: "desc" as const }],
        skip,
        take,
      }),
      db.purchase.count({ where }),
    ]);

    return ok({ items, total, page, limit });
  } catch (e) {
    return handleApiError(e);
  }
}

// POST /api/purchases — ایجاد فاکتور خرید
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await createPurchase(user, body, getClientIp(req));
    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}
