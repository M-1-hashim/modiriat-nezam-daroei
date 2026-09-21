import { db } from "@/lib/db";
import { ApiError, handleApiError, ok } from "@/lib/api-utils";
import { requireUser } from "@/lib/auth";
import {
  resolveRange,
  resolveBranchIds,
  reportDayKey,
  reportDayLabel,
  reportMonthKey,
  reportMonthLabel,
  bumpRow,
  finalizeRows,
  type ReportRow,
} from "../_util";

const GROUPS = ["day", "month", "branch", "customer", "salesperson", "territory", "product", "batch"] as const;
type GroupBy = (typeof GROUPS)[number];

// GET /api/reports/sales?groupBy=...&branchId&customerId&salespersonId&territoryId&productId&warehouseId
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);

    const groupByRaw = url.searchParams.get("groupBy") ?? "day";
    if (!GROUPS.includes(groupByRaw as GroupBy)) {
      throw new ApiError("نوع گروه‌بندی نامعتبر است", 422, "VALIDATION");
    }
    const groupBy = groupByRaw as GroupBy;

    const { from, to } = resolveRange(url);
    const branchIds = resolveBranchIds(user, url);

    const customerId = url.searchParams.get("customerId") ?? undefined;
    const salespersonId = url.searchParams.get("salespersonId") ?? undefined;
    const territoryId = url.searchParams.get("territoryId") ?? undefined;
    const productId = url.searchParams.get("productId") ?? undefined;
    const warehouseId = url.searchParams.get("warehouseId") ?? undefined;

    const sales = await db.sale.findMany({
      where: {
        date: { gte: from, lte: to },
        status: { in: ["APPROVED", "COMPLETED"] },
        ...(branchIds ? { branchId: { in: branchIds } } : {}),
        ...(customerId ? { customerId } : {}),
        ...(salespersonId ? { salespersonId } : {}),
        ...(territoryId ? { territoryId } : {}),
        ...(warehouseId ? { warehouseId } : {}),
      },
      select: {
        id: true,
        branchId: true,
        customerId: true,
        salespersonId: true,
        territoryId: true,
        date: true,
        totalAfn: true,
        branch: { select: { name: true } },
        customer: { select: { name: true } },
        salesperson: { select: { name: true } },
        territory: { select: { name: true } },
        items: {
          ...(productId ? { where: { productId } } : {}),
          select: {
            productId: true,
            batchId: true,
            quantity: true,
            freeQuantity: true,
            costAtSale: true,
            lineTotalAfn: true,
            product: { select: { name: true } },
            batch: { select: { batchNumber: true } },
          },
        },
      },
    });

    const map = new Map<string, ReportRow>();
    const noSalesperson = "بدون فروشنده";
    const noTerritory = "بدون منطقه";

    if (groupBy === "product" || groupBy === "batch") {
      for (const s of sales) {
        for (const it of s.items) {
          const qty = it.quantity + it.freeQuantity;
          const cost = it.costAtSale * qty;
          if (groupBy === "product") {
            bumpRow(map, it.productId, it.product.name, {
              count: 1,
              quantity: qty,
              totalAfn: it.lineTotalAfn,
              costAfn: cost,
            });
          } else {
            const label = `${it.product.name} — ${it.batch.batchNumber}`;
            bumpRow(map, it.batchId, label, {
              count: 1,
              quantity: qty,
              totalAfn: it.lineTotalAfn,
              costAfn: cost,
            });
          }
        }
      }
    } else {
      for (const s of sales) {
        let cost = 0;
        let qty = 0;
        for (const it of s.items) {
          cost += it.costAtSale * (it.quantity + it.freeQuantity);
          qty += it.quantity + it.freeQuantity;
        }
        switch (groupBy) {
          case "day": {
            const day = reportDayKey(s.date);
            bumpRow(map, day, reportDayLabel(s.date), { count: 1, quantity: qty, totalAfn: s.totalAfn, costAfn: cost });
            break;
          }
          case "month": {
            const month = reportMonthKey(s.date);
            bumpRow(map, month, reportMonthLabel(s.date), { count: 1, quantity: qty, totalAfn: s.totalAfn, costAfn: cost });
            break;
          }
          case "branch":
            bumpRow(map, s.branchId, s.branch.name, { count: 1, quantity: qty, totalAfn: s.totalAfn, costAfn: cost });
            break;
          case "customer":
            bumpRow(map, s.customerId, s.customer.name, { count: 1, quantity: qty, totalAfn: s.totalAfn, costAfn: cost });
            break;
          case "salesperson":
            bumpRow(
              map,
              s.salespersonId ?? "none",
              s.salesperson?.name ?? noSalesperson,
              { count: 1, quantity: qty, totalAfn: s.totalAfn, costAfn: cost }
            );
            break;
          case "territory":
            bumpRow(
              map,
              s.territoryId ?? "none",
              s.territory?.name ?? noTerritory,
              { count: 1, quantity: qty, totalAfn: s.totalAfn, costAfn: cost }
            );
            break;
        }
      }
    }

    return ok({ groupBy, from, to, rows: finalizeRows(map, true) });
  } catch (e) {
    return handleApiError(e);
  }
}
