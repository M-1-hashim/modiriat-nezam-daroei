import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { handleApiError, ok, parseDate } from "@/lib/api-utils";
import { requireUser, requirePermission, allowedBranchIds } from "@/lib/auth";

// GET /api/partnerships/distributions?partnershipId&branchId&from&to
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    requirePermission(user, "partnerships.view");
    const url = new URL(req.url);

    const partnershipWhere: Prisma.PartnershipWhereInput = {};
    const allowed = allowedBranchIds(user);
    if (allowed) {
      partnershipWhere.branchId = { in: allowed };
    } else if (url.searchParams.get("branchId")) {
      partnershipWhere.branchId = url.searchParams.get("branchId") as string;
    }
    const partnershipId = url.searchParams.get("partnershipId");
    if (partnershipId) partnershipWhere.id = partnershipId;

    const where: Prisma.ProfitDistributionWhereInput = { partnership: partnershipWhere };
    const from = parseDate(url.searchParams.get("from"));
    const to = parseDate(url.searchParams.get("to"));
    if (from || to) {
      where.periodFrom = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    }

    const rows = await db.profitDistribution.findMany({
      where,
      include: {
        partnership: {
          select: {
            id: true,
            type: true,
            role: true,
            status: true,
            partner: { select: { id: true, name: true } },
            branch: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return ok(
      rows.map((d) => ({
        id: d.id,
        partnershipId: d.partnershipId,
        partnerName: d.partnership.partner.name,
        partnershipType: d.partnership.type,
        branchId: d.partnership.branch.id,
        branchName: d.partnership.branch.name,
        periodFrom: d.periodFrom,
        periodTo: d.periodTo,
        revenueAfn: d.revenueAfn,
        cogsAfn: d.cogsAfn,
        grossProfitAfn: d.grossProfitAfn,
        expensesAfn: d.expensesAfn,
        netProfitAfn: d.netProfitAfn,
        distributionBase: d.distributionBase,
        baseAmountAfn: d.baseAmountAfn,
        sharePct: d.sharePct,
        partnerShareAfn: d.partnerShareAfn,
        status: d.status,
        notes: d.notes,
        createdBy: d.createdBy,
        createdAt: d.createdAt,
      }))
    );
  } catch (e) {
    return handleApiError(e);
  }
}
