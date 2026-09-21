import { db } from "@/lib/db";
import { getClientIp, getPagination, handleApiError, ok } from "@/lib/api-utils";
import {
  allowedBranchIds,
  assertBranchAccess,
  requirePermission,
  requireUser,
} from "@/lib/auth";
import { createCustomer } from "./_service";

// GET /api/customers — لیست مشتریان (با فیلتر شعبه)
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    requirePermission(user, "customers.view");

    const url = new URL(req.url);
    const { page, limit, skip, take } = getPagination(url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    const type = url.searchParams.get("type")?.trim() ?? "";
    const territoryId = url.searchParams.get("territoryId")?.trim() ?? "";
    const salespersonId = url.searchParams.get("salespersonId")?.trim() ?? "";
    const branchIdParam = url.searchParams.get("branchId")?.trim() ?? "";

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
      ...(territoryId ? { territoryId } : {}),
      ...(salespersonId ? { salespersonId } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { phone: { contains: q } },
              { address: { contains: q } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      db.customer.findMany({
        where,
        include: {
          territory: { select: { id: true, name: true } },
          salesperson: { select: { id: true, name: true } },
        },
        orderBy: [{ name: "asc" as const }],
        skip,
        take,
      }),
      db.customer.count({ where }),
    ]);

    return ok({ items, total, page, limit });
  } catch (e) {
    return handleApiError(e);
  }
}

// POST /api/customers — ثبت مشتری جدید
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await createCustomer(user, body, getClientIp(req));
    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}
