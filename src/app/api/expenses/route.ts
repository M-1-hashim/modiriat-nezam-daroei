import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { handleApiError, ok, getPagination, parseDate, getClientIp } from "@/lib/api-utils";
import { requireUser, requirePermission, allowedBranchIds } from "@/lib/auth";
import { createExpense } from "./_service";

// GET /api/expenses?branchId&categoryId&status&from&to&page&limit
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    requirePermission(user, "expenses.view");
    const url = new URL(req.url);
    const { page, limit, skip, take } = getPagination(url);

    const where: Prisma.ExpenseWhereInput = {};

    const allowed = allowedBranchIds(user);
    if (allowed) {
      where.branchId = { in: allowed };
    } else if (url.searchParams.get("branchId")) {
      where.branchId = url.searchParams.get("branchId") as string;
    }

    const categoryId = url.searchParams.get("categoryId");
    if (categoryId) where.categoryId = categoryId;

    const status = url.searchParams.get("status");
    if (status) where.status = status;

    const from = parseDate(url.searchParams.get("from"));
    const to = parseDate(url.searchParams.get("to"));
    if (from || to) where.date = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };

    const [items, total] = await Promise.all([
      db.expense.findMany({
        where,
        include: {
          category: { select: { id: true, name: true } },
          branch: { select: { id: true, name: true } },
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        skip,
        take,
      }),
      db.expense.count({ where }),
    ]);

    return ok({ items, total, page, limit });
  } catch (e) {
    return handleApiError(e);
  }
}

// POST /api/expenses
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as Record<string, unknown>;
    const data = await createExpense(user, body, getClientIp(req));
    return ok(data, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
