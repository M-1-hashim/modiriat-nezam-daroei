import { db } from "@/lib/db";
import { ApiError, handleApiError, ok } from "@/lib/api-utils";
import { requireUser, requirePermission } from "@/lib/auth";
import { logAudit } from "@/lib/business";

// PUT /api/expense-categories/[id]
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    requirePermission(user, "expenses.edit");
    const { id } = await params;
    const category = await db.expenseCategory.findUnique({ where: { id } });
    if (!category) throw new ApiError("کتگوری مصرف یافت نشد", 404, "NOT_FOUND");

    const body = (await req.json()) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw new ApiError("نام کتگوری الزامی است", 422, "VALIDATION");

    const duplicate = await db.expenseCategory.findUnique({ where: { name } });
    if (duplicate && duplicate.id !== id) {
      throw new ApiError("کتگوری با این نام قبلاً ثبت شده است", 422, "DUPLICATE");
    }

    const updated = await db.$transaction(async (tx) => {
      const row = await tx.expenseCategory.update({ where: { id }, data: { name } });
      await logAudit(tx, {
        userId: user.id,
        userName: user.fullName,
        branchId: user.branchId,
        action: "UPDATE",
        entity: "ExpenseCategory",
        entityId: id,
        summary: `ویرایش کتگوری مصرف «${category.name}» به «${name}»`,
        before: { name: category.name },
        after: { name },
      });
      return row;
    });

    return ok(updated);
  } catch (e) {
    return handleApiError(e);
  }
}

// DELETE /api/expense-categories/[id] — اگر استفاده شده باشد ممنوع
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    requirePermission(user, "expenses.delete");
    const { id } = await params;
    const category = await db.expenseCategory.findUnique({
      where: { id },
      include: { _count: { select: { expenses: true } } },
    });
    if (!category) throw new ApiError("کتگوری مصرف یافت نشد", 404, "NOT_FOUND");
    if (category._count.expenses > 0) {
      throw new ApiError(
        "این کتگوری در مصارف استفاده شده است و قابل حذف نیست",
        422,
        "IN_USE"
      );
    }

    await db.$transaction(async (tx) => {
      await tx.expenseCategory.delete({ where: { id } });
      await logAudit(tx, {
        userId: user.id,
        userName: user.fullName,
        branchId: user.branchId,
        action: "DELETE",
        entity: "ExpenseCategory",
        entityId: id,
        summary: `حذف کتگوری مصرف «${category.name}»`,
        before: { name: category.name },
      });
    });

    return ok({ deleted: true });
  } catch (e) {
    return handleApiError(e);
  }
}
