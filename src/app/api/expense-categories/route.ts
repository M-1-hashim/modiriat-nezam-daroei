import { db } from "@/lib/db";
import { ApiError, handleApiError, ok } from "@/lib/api-utils";
import { requireUser, requirePermission } from "@/lib/auth";
import { logAudit } from "@/lib/business";

// GET /api/expense-categories — هر کاربر واردشده
export async function GET() {
  try {
    const user = await requireUser();
    const categories = await db.expenseCategory.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { expenses: true } } },
    });
    return ok(categories);
  } catch (e) {
    return handleApiError(e);
  }
}

// POST /api/expense-categories
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    requirePermission(user, "expenses.create");
    const body = (await req.json()) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw new ApiError("نام کتگوری الزامی است", 422, "VALIDATION");

    const existing = await db.expenseCategory.findUnique({ where: { name } });
    if (existing) throw new ApiError("کتگوری با این نام قبلاً ثبت شده است", 422, "DUPLICATE");

    const created = await db.$transaction(async (tx) => {
      const row = await tx.expenseCategory.create({ data: { name } });
      await logAudit(tx, {
        userId: user.id,
        userName: user.fullName,
        branchId: user.branchId,
        action: "CREATE",
        entity: "ExpenseCategory",
        entityId: row.id,
        summary: `ایجاد کتگوری مصرف «${name}»`,
        after: { id: row.id, name },
      });
      return row;
    });

    return ok(created, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
