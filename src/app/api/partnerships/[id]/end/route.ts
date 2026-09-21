import { db } from "@/lib/db";
import { ApiError, handleApiError, ok } from "@/lib/api-utils";
import { requireUser, requirePermission, assertBranchAccess } from "@/lib/auth";
import { logAudit } from "@/lib/business";

// POST /api/partnerships/[id]/end — خاتمه شراکت
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    requirePermission(user, "partnerships.edit");
    const { id } = await params;
    const partnership = await db.partnership.findUnique({ where: { id } });
    if (!partnership) throw new ApiError("شراکت یافت نشد", 404, "NOT_FOUND");
    assertBranchAccess(user, partnership.branchId);
    if (partnership.status === "ENDED") {
      throw new ApiError("این شراکت قبلاً خاتمه یافته است", 422, "INVALID_STATUS");
    }

    const now = new Date();
    const updated = await db.$transaction(async (tx) => {
      const row = await tx.partnership.update({
        where: { id },
        data: { status: "ENDED", endDate: now },
      });
      await logAudit(tx, {
        userId: user.id,
        userName: user.fullName,
        branchId: partnership.branchId,
        action: "END",
        entity: "Partnership",
        entityId: id,
        summary: `خاتمه شراکت (سهم سود ${partnership.profitSharePct}٪)`,
        before: { status: partnership.status },
        after: { status: "ENDED", endDate: now },
      });
      return row;
    });

    return ok(updated);
  } catch (e) {
    return handleApiError(e);
  }
}
