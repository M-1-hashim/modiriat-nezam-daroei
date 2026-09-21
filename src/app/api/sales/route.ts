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
import { createSale } from "./_service";

// GET /api/sales — لیست فاکتورهای فروش (با فیلتر شعبه)
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    requirePermission(user, "sales.view");

    const url = new URL(req.url);
    const { page, limit, skip, take } = getPagination(url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    const status = url.searchParams.get("status")?.trim() ?? "";
    const customerId = url.searchParams.get("customerId")?.trim() ?? "";
    const branchIdParam = url.searchParams.get("branchId")?.trim() ?? "";
    const dateFrom = parseDate(url.searchParams.get("dateFrom"));
    const dateTo = parseDate(url.searchParams.get("dateTo"));

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
      ...(customerId ? { customerId } : {}),
      ...(dateFrom || dateTo
        ? { date: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } }
        : {}),
      ...(q
        ? {
            OR: [
              { number: { contains: q } },
              { customer: { name: { contains: q } } },
              { notes: { contains: q } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      db.sale.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true } },
          branch: { select: { id: true, name: true, code: true } },
          warehouse: { select: { id: true, name: true } },
          salesperson: { select: { id: true, name: true } },
        },
        orderBy: [{ date: "desc" as const }, { createdAt: "desc" as const }],
        skip,
        take,
      }),
      db.sale.count({ where }),
    ]);

    return ok({ items, total, page, limit });
  } catch (e) {
    return handleApiError(e);
  }
}

// POST /api/sales — ایجاد فاکتور فروش
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await createSale(user, body, getClientIp(req));
    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}
