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

const GROUPS = ["day", "month", "branch", "supplier", "product", "batch"] as const;
type GroupBy = (typeof GROUPS)[number];

// GET /api/reports/purchases?groupBy=...&branchId&supplierId&productId&warehouseId
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

    const supplierId = url.searchParams.get("supplierId") ?? undefined;
    const productId = url.searchParams.get("productId") ?? undefined;
    const warehouseId = url.searchParams.get("warehouseId") ?? undefined;

    const purchases = await db.purchase.findMany({
      where: {
        date: { gte: from, lte: to },
        status: { in: ["APPROVED", "COMPLETED"] },
        ...(branchIds ? { branchId: { in: branchIds } } : {}),
        ...(supplierId ? { supplierId } : {}),
        ...(warehouseId ? { warehouseId } : {}),
      },
      select: {
        id: true,
        branchId: true,
        supplierId: true,
        date: true,
        totalAfn: true,
        branch: { select: { name: true } },
        supplier: { select: { name: true } },
        items: {
          ...(productId ? { where: { productId } } : {}),
          select: {
            productId: true,
            batchId: true,
            batchNumber: true,
            quantity: true,
            freeQuantity: true,
            lineTotalAfn: true,
            product: { select: { name: true } },
          },
        },
      },
    });

    const map = new Map<string, ReportRow>();

    if (groupBy === "product" || groupBy === "batch") {
      for (const p of purchases) {
        for (const it of p.items) {
          const qty = it.quantity + it.freeQuantity;
          if (groupBy === "product") {
            bumpRow(map, it.productId, it.product.name, {
              count: 1,
              quantity: qty,
              totalAfn: it.lineTotalAfn,
              costAfn: 0,
            });
          } else {
            const key = it.batchId ?? `n-${it.productId}-${it.batchNumber}`;
            const label = `${it.product.name} — ${it.batchNumber}`;
            bumpRow(map, key, label, {
              count: 1,
              quantity: qty,
              totalAfn: it.lineTotalAfn,
              costAfn: 0,
            });
          }
        }
      }
    } else {
      for (const p of purchases) {
        let qty = 0;
        for (const it of p.items) qty += it.quantity + it.freeQuantity;
        switch (groupBy) {
          case "day": {
            const day = reportDayKey(p.date);
            bumpRow(map, day, reportDayLabel(p.date), { count: 1, quantity: qty, totalAfn: p.totalAfn, costAfn: 0 });
            break;
          }
          case "month": {
            const month = reportMonthKey(p.date);
            bumpRow(map, month, reportMonthLabel(p.date), { count: 1, quantity: qty, totalAfn: p.totalAfn, costAfn: 0 });
            break;
          }
          case "branch":
            bumpRow(map, p.branchId, p.branch.name, { count: 1, quantity: qty, totalAfn: p.totalAfn, costAfn: 0 });
            break;
          case "supplier":
            bumpRow(map, p.supplierId, p.supplier.name, { count: 1, quantity: qty, totalAfn: p.totalAfn, costAfn: 0 });
            break;
        }
      }
    }

    return ok({ groupBy, from, to, rows: finalizeRows(map, false) });
  } catch (e) {
    return handleApiError(e);
  }
}
