import { db } from "@/lib/db";
import { ApiError, handleApiError, ok } from "@/lib/api-utils";
import { requireUser, requirePermission, assertBranchAccess } from "@/lib/auth";
import { logAudit } from "@/lib/business";

// POST /api/expenses/[id]/approve — PENDING → APPROVED
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    requirePermission(user, "expenses.approve");
    const { id } = await params;
    const expense = await db.expense.findUnique({ where: { id } });
    if (!expense) throw new ApiError("مصرف یافت نشد", 404, "NOT_FOUND");
    assertBranchAccess(user, expense.branchId);
    if (expense.status !== "PENDING") {
      throw new ApiError("فقط مصارف در انتظار تصویب قابل تصویب هستند", 422, "INVALID_STATUS");
    }

    const updated = await db.$transaction(async (tx) => {
      const row = await tx.expense.update({
        where: { id },
        data: { status: "APPROVED", approvedBy: user.fullName },
      });
      await logAudit(tx, {
        userId: user.id,
        userName: user.fullName,
        branchId: expense.branchId,
        action: "APPROVE",
        entity: "Expense",
        entityId: id,
        summary: `تصویب مصرف به مبلغ ${expense.amountAfn} افغانی`,
        before: { status: expense.status },
        after: { status: "APPROVED" },
      });
      return row;
    });

    return ok(updated);
  } catch (e) {
    return handleApiError(e);
  }
}
