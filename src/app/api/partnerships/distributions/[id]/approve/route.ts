import { db } from "@/lib/db";
import { ApiError, handleApiError, ok } from "@/lib/api-utils";
import { requireUser, requirePermission, assertBranchAccess } from "@/lib/auth";
import { logAudit } from "@/lib/business";

// POST /api/partnerships/distributions/[id]/approve — CALCULATED → APPROVED
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    requirePermission(user, "partnerships.approve");
    const { id } = await params;
    const distribution = await db.profitDistribution.findUnique({
      where: { id },
      include: { partnership: { select: { branchId: true, partner: { select: { name: true } } } } },
    });
    if (!distribution) throw new ApiError("توزیع سود یافت نشد", 404, "NOT_FOUND");
    assertBranchAccess(user, distribution.partnership.branchId);
    if (distribution.status !== "CALCULATED") {
      throw new ApiError("فقط توزیع‌های محاسبه‌شده قابل تصویب هستند", 422, "INVALID_STATUS");
    }

    const updated = await db.$transaction(async (tx) => {
      const row = await tx.profitDistribution.update({
        where: { id },
        data: { status: "APPROVED" },
      });
      await logAudit(tx, {
        userId: user.id,
        userName: user.fullName,
        branchId: distribution.partnership.branchId,
        action: "APPROVE",
        entity: "ProfitDistribution",
        entityId: id,
        summary: `تصویب توزیع سود شریک «${distribution.partnership.partner.name}» به مبلغ ${distribution.partnerShareAfn} افغانی`,
        before: { status: distribution.status },
        after: { status: "APPROVED" },
      });
      return row;
    });

    return ok(updated);
  } catch (e) {
    return handleApiError(e);
  }
}
