import { db } from "@/lib/db";
import { handleApiError, ok, round2 } from "@/lib/api-utils";
import { requireUser } from "@/lib/auth";
import { computePeriodFinancials, type PeriodFinancials } from "@/lib/business";
import { resolveRange, resolveBranchIds } from "../_util";

const ZERO_FINANCIALS: PeriodFinancials = {
  revenueAfn: 0,
  salesReturnsAfn: 0,
  netRevenueAfn: 0,
  cogsAfn: 0,
  grossProfitAfn: 0,
  expensesAfn: 0,
  netProfitAfn: 0,
  salesCount: 0,
};

// GET /api/reports/financial?from&to&branchId
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const { from, to } = resolveRange(url);
    const branchIds = resolveBranchIds(user, url);

    // کاربر بدون شعبه: هیچ داده‌ای
    const noAccess = branchIds !== undefined && branchIds.length === 0;
    const financials = noAccess ? ZERO_FINANCIALS : await computePeriodFinancials(from, to, branchIds);

    const branchFilter = branchIds ? { branchId: { in: branchIds } } : {};

    const receivables = noAccess
      ? { _sum: { balance: null as number | null } }
      : await db.customer.aggregate({
          where: { balance: { gt: 0 }, ...branchFilter },
          _sum: { balance: true },
        });

    const payables = noAccess
      ? { _sum: { balance: null as number | null } }
      : await db.supplier.aggregate({ where: { balance: { gt: 0 } }, _sum: { balance: true } });

    let inventoryValueAfn = 0;
    if (!noAccess) {
      const warehouses = await db.warehouse.findMany({
        where: branchIds ? { branchId: { in: branchIds } } : {},
        select: { id: true },
      });
      const whIds = warehouses.map((w) => w.id);
      if (whIds.length > 0) {
        const items = await db.stockItem.findMany({
          where: { warehouseId: { in: whIds }, quantity: { gt: 0 } },
          select: { quantity: true, batch: { select: { costPrice: true } } },
        });
        for (const it of items) inventoryValueAfn += it.quantity * it.batch.costPrice;
      }
    }

    return ok({
      from,
      to,
      ...financials,
      receivablesAfn: round2(receivables._sum.balance ?? 0),
      payablesAfn: round2(payables._sum.balance ?? 0),
      inventoryValueAfn: round2(inventoryValueAfn),
    });
  } catch (e) {
    return handleApiError(e);
  }
}
