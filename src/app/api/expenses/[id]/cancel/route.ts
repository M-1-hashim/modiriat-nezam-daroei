import { db } from "@/lib/db";
import { ApiError, handleApiError, ok } from "@/lib/api-utils";
import { requireUser, requirePermission, assertBranchAccess } from "@/lib/auth";
import { logAudit } from "@/lib/business";

// POST /api/expenses/[id]/cancel — فقط PENDING
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    requirePermission(user, "expenses.edit");
    const { id } = await params;
    const expense = await db.expense.findUnique({ where: { id } });
    if (!expense) throw new ApiError("مصرف یافت نشد", 404, "NOT_FOUND");
    assertBranchAccess(user, expense.branchId);
    if (expense.status !== "PENDING") {
      throw new ApiError("فقط مصارف در انتظار تصویب قابل لغو هستند", 422, "INVALID_STATUS");
    }

    const updated = await db.$transaction(async (tx) => {
      const row = await tx.expense.update({
        where: { id },
        data: { status: "CANCELLED" },
      });
      await logAudit(tx, {
        userId: user.id,
        userName: user.fullName,
        branchId: expense.branchId,
        action: "CANCEL",
        entity: "Expense",
        entityId: id,
        summary: `لغو مصرف به مبلغ ${expense.amountAfn} افغانی`,
        before: { status: expense.status },
        after: { status: "CANCELLED" },
      });
      return row;
    });

    return ok(updated);
  } catch (e) {
    return handleApiError(e);
  }
}
