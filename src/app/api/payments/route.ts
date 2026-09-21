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
import { createPayment } from "./_service";

// GET /api/payments — لیست رسیدهای پرداخت
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    requirePermission(user, "payments.view");

    const url = new URL(req.url);
    const { page, limit, skip, take } = getPagination(url);
    const type = url.searchParams.get("type")?.trim() ?? "";
    const customerId = url.searchParams.get("customerId")?.trim() ?? "";
    const supplierId = url.searchParams.get("supplierId")?.trim() ?? "";
    const saleId = url.searchParams.get("saleId")?.trim() ?? "";
    const purchaseId = url.searchParams.get("purchaseId")?.trim() ?? "";
    const q = url.searchParams.get("q")?.trim() ?? "";
    const branchIdParam = url.searchParams.get("branchId")?.trim() ?? "";
    const from = parseDate(url.searchParams.get("from"));
    const to = parseDate(url.searchParams.get("to"));

    const branchConds: string[] = [];
    if (branchIdParam) {
      assertBranchAccess(user, branchIdParam);
      branchConds.push(branchIdParam);
    }
    const allowed = allowedBranchIds(user);
    if (allowed) branchConds.push(...allowed);

    const where = {
      ...(branchConds.length > 0 ? { branchId: { in: branchConds } } : {}),
      ...(type ? { type } : {}),
      ...(customerId ? { customerId } : {}),
      ...(supplierId ? { supplierId } : {}),
      ...(saleId ? { saleId } : {}),
      ...(purchaseId ? { purchaseId } : {}),
      ...(from || to
        ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
      ...(q
        ? {
            OR: [
              { number: { contains: q } },
              { reference: { contains: q } },
              { notes: { contains: q } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      db.payment.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true } },
          sale: { select: { id: true, number: true } },
          purchase: { select: { id: true, number: true } },
          branch: { select: { id: true, name: true, code: true } },
        },
        orderBy: [{ date: "desc" as const }, { createdAt: "desc" as const }],
        skip,
        take,
      }),
      db.payment.count({ where }),
    ]);

    return ok({ items, total, page, limit });
  } catch (e) {
    return handleApiError(e);
  }
}

// POST /api/payments — ثبت پرداخت/دریافت
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await createPayment(user, body, getClientIp(req));
    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}
