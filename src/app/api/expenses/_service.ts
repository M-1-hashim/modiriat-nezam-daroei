import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { ApiError, round2, round4, toNum, parseDate } from "@/lib/api-utils";
import { effectiveBranchId, requirePermission, type AuthUser } from "@/lib/auth";
import { getSettingBool, logAudit } from "@/lib/business";

/**
 * ایجاد مصرف — قرارداد سرویس مشترک برای /api/sync/push و route handler
 * body: { categoryId, amount>0, currency, exchangeRate?, date?, description?, localId?, branchId? }
 */
export async function createExpense(
  user: AuthUser,
  body: Record<string, unknown>,
  ip?: string
): Promise<unknown> {
  requirePermission(user, "expenses.create");

  const localId =
    typeof body.localId === "string" && body.localId.trim()
      ? body.localId.trim()
      : randomUUID();

  // idempotency — localId تکراری همان رکورد موجود را برمی‌گرداند
  const existing = await db.expense.findUnique({
    where: { localId },
    include: {
      category: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
    },
  });
  if (existing) return existing;

  const branchId = effectiveBranchId(
    user,
    typeof body.branchId === "string" && body.branchId ? body.branchId : null
  );

  const categoryId = typeof body.categoryId === "string" ? body.categoryId : "";
  if (!categoryId) throw new ApiError("انتخاب کتگوری مصرف الزامی است", 422, "VALIDATION");
  const category = await db.expenseCategory.findUnique({ where: { id: categoryId } });
  if (!category) throw new ApiError("کتگوری مصرف یافت نشد", 404, "NOT_FOUND");

  const amount = toNum(body.amount, 0);
  if (!(amount > 0)) throw new ApiError("مبلغ مصرف باید بزرگ‌تر از صفر باشد", 422, "VALIDATION");

  const currency =
    typeof body.currency === "string" && body.currency.trim()
      ? body.currency.trim().toUpperCase()
      : "AFN";
  let exchangeRate = currency === "AFN" ? 1 : round4(toNum(body.exchangeRate, 1));
  if (!(exchangeRate > 0)) exchangeRate = 1;
  const amountAfn = round2(amount * exchangeRate);

  const date = parseDate(body.date) ?? new Date();
  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : null;

  const requireApproval = await getSettingBool("require_approval_expenses", false);
  const status = requireApproval ? "PENDING" : "APPROVED";

  const created = await db.$transaction(async (tx) => {
    const row = await tx.expense.create({
      data: {
        localId,
        branchId,
        categoryId,
        amount,
        currency,
        exchangeRate,
        amountAfn,
        date,
        description,
        status,
        createdBy: user.id,
        createdByName: user.fullName,
      },
    });
    await logAudit(tx, {
      userId: user.id,
      userName: user.fullName,
      branchId,
      action: "CREATE",
      entity: "Expense",
      entityId: row.id,
      summary: `ثبت مصرف «${category.name}» به مبلغ ${amountAfn} افغانی (${status === "PENDING" ? "در انتظار تصویب" : "تأییدشده"})`,
      after: { id: row.id, amountAfn, status, date },
      ip,
    });
    return row;
  });

  return db.expense.findUnique({
    where: { id: created.id },
    include: {
      category: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
    },
  });
}
