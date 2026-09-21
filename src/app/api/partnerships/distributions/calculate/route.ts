import type { ProfitDistribution } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError, handleApiError, ok, round2, parseDate } from "@/lib/api-utils";
import { requireUser, requirePermission, effectiveBranchId } from "@/lib/auth";
import { computePeriodFinancials, getSetting, logAudit } from "@/lib/business";

// POST /api/partnerships/distributions/calculate {branchId, dateFrom, dateTo}
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    requirePermission(user, "partnerships.create");
    const body = (await req.json()) as Record<string, unknown>;

    // سوپرادمین باید شعبه را مشخص کند؛ کاربر عادی شعبه خودش
    const branchId = effectiveBranchId(
      user,
      typeof body.branchId === "string" && body.branchId ? body.branchId : null
    );

    const dateFrom = parseDate(body.dateFrom);
    const dateTo = parseDate(body.dateTo);
    if (!dateFrom || !dateTo) {
      throw new ApiError("تاریخ شروع و ختم دوره الزامی است", 422, "VALIDATION");
    }
    if (dateFrom > dateTo) {
      throw new ApiError("تاریخ شروع باید قبل از تاریخ ختم باشد", 422, "VALIDATION");
    }

    const financials = await computePeriodFinancials(dateFrom, dateTo, [branchId]);

    const baseKey = (await getSetting("profit_distribution_base", "NET_PROFIT")) || "NET_PROFIT";
    const validBases = ["NET_PROFIT", "GROSS_PROFIT", "REVENUE"];
    const distributionBase = validBases.includes(baseKey) ? baseKey : "NET_PROFIT";
    const baseAmount =
      distributionBase === "NET_PROFIT"
        ? financials.netProfitAfn
        : distributionBase === "GROSS_PROFIT"
          ? financials.grossProfitAfn
          : financials.netRevenueAfn;

    const partnerships = await db.partnership.findMany({
      where: { branchId, status: "ACTIVE" },
      include: { partner: { select: { name: true } } },
    });

    const lossNote = baseAmount < 0 ? "دوره زیان‌ده" : null;

    const result = await db.$transaction(async (tx) => {
      const rows: ProfitDistribution[] = [];
      for (const p of partnerships) {
        const row = await tx.profitDistribution.create({
          data: {
            partnershipId: p.id,
            periodFrom: dateFrom,
            periodTo: dateTo,
            revenueAfn: financials.revenueAfn,
            cogsAfn: financials.cogsAfn,
            grossProfitAfn: financials.grossProfitAfn,
            expensesAfn: financials.expensesAfn,
            netProfitAfn: financials.netProfitAfn,
            distributionBase,
            baseAmountAfn: round2(baseAmount),
            sharePct: p.profitSharePct,
            partnerShareAfn: round2((baseAmount * p.profitSharePct) / 100),
            status: "CALCULATED",
            notes: lossNote,
            createdBy: user.id,
          },
        });
        rows.push(row);
      }
      await logAudit(tx, {
        userId: user.id,
        userName: user.fullName,
        branchId,
        action: "CALCULATE",
        entity: "ProfitDistribution",
        summary: `محاسبه توزیع سود دوره برای ${rows.length} شراکت فعال (پایه: ${distributionBase}، مبلغ پایه: ${round2(baseAmount)} افغانی)`,
        after: { branchId, dateFrom, dateTo, distributionBase, baseAmountAfn: round2(baseAmount), created: rows.length },
      });
      return rows;
    });

    return ok(
      {
        created: result.length,
        financials,
        base: round2(baseAmount),
        distributionBase,
      },
      201
    );
  } catch (e) {
    return handleApiError(e);
  }
}
