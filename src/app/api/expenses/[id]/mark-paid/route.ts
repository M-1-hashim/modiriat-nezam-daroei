import { db } from "@/lib/db";
import { ApiError, handleApiError, ok } from "@/lib/api-utils";
import { requireUser, requirePermission, assertBranchAccess } from "@/lib/auth";
import { logAudit } from "@/lib/business";

// POST /api/expenses/[id]/mark-paid — APPROVED → PAID
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    requirePermission(user, "expenses.approve");
    const { id } = await params;
    const expense = await db.expense.findUnique({ where: { id } });
    if (!expense) throw new ApiError("مصرف یافت نشد", 404, "NOT_FOUND");
    assertBranchAccess(user, expense.branchId);
    if (expense.status !== "APPROVED") {
      throw new ApiError("فقط مصارف تأییدشده قابل پرداخت‌شده علامت‌گذاری هستند", 422, "INVALID_STATUS");
    }

    const updated = await db.$transaction(async (tx) => {
      const row = await tx.expense.update({
        where: { id },
        data: { status: "PAID", approvedBy: expense.approvedBy ?? user.fullName },
      });
      await logAudit(tx, {
        userId: user.id,
        userName: user.fullName,
        branchId: expense.branchId,
        action: "MARK_PAID",
        entity: "Expense",
        entityId: id,
        summary: `علامت‌گذاری مصرف به عنوان پرداخت‌شده (${expense.amountAfn} افغانی)`,
        before: { status: expense.status },
        after: { status: "PAID" },
      });
      return row;
    });

    return ok(updated);
  } catch (e) {
    return handleApiError(e);
  }
}
