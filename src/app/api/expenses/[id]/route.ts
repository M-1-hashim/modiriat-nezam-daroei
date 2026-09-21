import { db } from "@/lib/db";
import { ApiError, handleApiError, ok, round2, round4, toNum, parseDate } from "@/lib/api-utils";
import { requireUser, requirePermission, assertBranchAccess } from "@/lib/auth";
import { logAudit } from "@/lib/business";

function parseBody(body: Record<string, unknown>) {
  const update: {
    categoryId?: string;
    amount?: number;
    currency?: string;
    exchangeRate?: number;
    amountAfn?: number;
    date?: Date;
    description?: string | null;
  } = {};

  if (body.categoryId !== undefined) {
    if (typeof body.categoryId !== "string" || !body.categoryId) {
      throw new ApiError("کتگوری مصرف نامعتبر است", 422, "VALIDATION");
    }
    update.categoryId = body.categoryId;
  }
  if (body.amount !== undefined) {
    const amount = toNum(body.amount, 0);
    if (!(amount > 0)) throw new ApiError("مبلغ مصرف باید بزرگ‌تر از صفر باشد", 422, "VALIDATION");
    update.amount = amount;
  }
  if (body.currency !== undefined) {
    if (typeof body.currency !== "string" || !body.currency.trim()) {
      throw new ApiError("واحد پولی نامعتبر است", 422, "VALIDATION");
    }
    update.currency = body.currency.trim().toUpperCase();
  }
  if (body.exchangeRate !== undefined) {
    const rate = round4(toNum(body.exchangeRate, 1));
    if (!(rate > 0)) throw new ApiError("نرخ تبدیل باید بزرگ‌تر از صفر باشد", 422, "VALIDATION");
    update.exchangeRate = rate;
  }
  if (body.date !== undefined) {
    const date = parseDate(body.date);
    if (!date) throw new ApiError("تاریخ مصرف نامعتبر است", 422, "VALIDATION");
    update.date = date;
  }
  if (body.description !== undefined) {
    update.description =
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim()
        : null;
  }
  return update;
}

// GET /api/expenses/[id]
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    requirePermission(user, "expenses.view");
    const { id } = await params;
    const expense = await db.expense.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
      },
    });
    if (!expense) throw new ApiError("مصرف یافت نشد", 404, "NOT_FOUND");
    assertBranchAccess(user, expense.branchId);
    return ok(expense);
  } catch (e) {
    return handleApiError(e);
  }
}

// PUT /api/expenses/[id] — فقط PENDING
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    requirePermission(user, "expenses.edit");
    const { id } = await params;
    const expense = await db.expense.findUnique({ where: { id } });
    if (!expense) throw new ApiError("مصرف یافت نشد", 404, "NOT_FOUND");
    assertBranchAccess(user, expense.branchId);
    if (expense.status !== "PENDING") {
      throw new ApiError("فقط مصارف در انتظار تصویب قابل ویرایش هستند", 422, "INVALID_STATUS");
    }

    const body = (await req.json()) as Record<string, unknown>;
    const update = parseBody(body);

    if (update.categoryId) {
      const category = await db.expenseCategory.findUnique({ where: { id: update.categoryId } });
      if (!category) throw new ApiError("کتگوری مصرف یافت نشد", 404, "NOT_FOUND");
    }

    const amount = update.amount ?? expense.amount;
    const currency = update.currency ?? expense.currency;
    let rate = update.exchangeRate ?? expense.exchangeRate;
    if (currency === "AFN") rate = 1;
    update.exchangeRate = rate;
    update.amountAfn = round2(amount * rate);

    const updated = await db.$transaction(async (tx) => {
      const row = await tx.expense.update({ where: { id }, data: update });
      await logAudit(tx, {
        userId: user.id,
        userName: user.fullName,
        branchId: expense.branchId,
        action: "UPDATE",
        entity: "Expense",
        entityId: id,
        summary: `ویرایش مصرف «${expense.description ?? expense.id}»`,
        before: {
          amount: expense.amount,
          currency: expense.currency,
          exchangeRate: expense.exchangeRate,
          amountAfn: expense.amountAfn,
          date: expense.date,
          description: expense.description,
        },
        after: update,
      });
      return row;
    });

    return ok(updated);
  } catch (e) {
    return handleApiError(e);
  }
}
