import { db } from "@/lib/db";
import { ApiError, handleApiError, ok, round2, parseDate } from "@/lib/api-utils";
import { requireUser } from "@/lib/auth";
import { computeBatchStatus, getSettingNum } from "@/lib/business";
import { resolveBranchIds, limitParam } from "../_util";

const TYPES = ["current", "valuation", "batch", "expiry", "low", "movement"] as const;
type ReportType = (typeof TYPES)[number];

// GET /api/reports/inventory?type=current|valuation|batch|expiry|low|movement&warehouseId&branchId&from&to&limit
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);

    const typeRaw = url.searchParams.get("type") ?? "current";
    if (!TYPES.includes(typeRaw as ReportType)) {
      throw new ApiError("نوع راپور موجودی نامعتبر است", 422, "VALIDATION");
    }
    const type = typeRaw as ReportType;

    const branchIds = resolveBranchIds(user, url);
    const warehouseId = url.searchParams.get("warehouseId") ?? undefined;
    const warnDays = await getSettingNum("expiry_warn_days", 90);

    const warehouses = await db.warehouse.findMany({
      where: {
        ...(branchIds ? { branchId: { in: branchIds } } : {}),
        ...(warehouseId ? { id: warehouseId } : {}),
      },
      select: { id: true, name: true, branchId: true, branch: { select: { name: true } } },
    });
    const whIds = warehouses.map((w) => w.id);
    const whMap = new Map(warehouses.map((w) => [w.id, w]));

    // ─── حرکت موجودی ───
    if (type === "movement") {
      const from = parseDate(url.searchParams.get("from"));
      const to = parseDate(url.searchParams.get("to"));
      const limit = limitParam(url, 200);
      const movements = await db.stockMovement.findMany({
        where: {
          ...(branchIds ? { branchId: { in: branchIds } } : {}),
          ...(warehouseId ? { OR: [{ fromWarehouseId: warehouseId }, { toWarehouseId: warehouseId }] } : {}),
          ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
        },
        include: {
          batch: {
            select: {
              batchNumber: true,
              product: { select: { name: true } },
            },
          },
          fromWarehouse: { select: { name: true } },
          toWarehouse: { select: { name: true } },
          branch: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      return ok({
        type,
        rows: movements.map((m) => ({
          id: m.id,
          date: m.createdAt,
          type: m.type,
          productName: m.batch?.product.name ?? "—",
          batchNumber: m.batch?.batchNumber ?? null,
          quantity: m.quantity,
          fromWarehouseName: m.fromWarehouse?.name ?? null,
          toWarehouseName: m.toWarehouse?.name ?? null,
          branchName: m.branch.name,
          reason: m.reason,
          userName: m.userName,
        })),
      });
    }

    // ─── سایر راپورها روی StockItem ───
    const stockItems = await db.stockItem.findMany({
      where: { warehouseId: { in: whIds }, quantity: { gt: 0 } },
      select: {
        id: true,
        quantity: true,
        updatedAt: true,
        productId: true,
        warehouseId: true,
        product: { select: { id: true, name: true, unit: true, minStock: true } },
        batch: {
          select: {
            id: true,
            batchNumber: true,
            expiryDate: true,
            costPrice: true,
          },
        },
      },
    });

    if (type === "current") {
      const rows = stockItems
        .map((s) => ({
          productId: s.productId,
          productName: s.product.name,
          unit: s.product.unit,
          batchId: s.batch.id,
          batchNumber: s.batch.batchNumber,
          expiryDate: s.batch.expiryDate,
          warehouseId: s.warehouseId,
          warehouseName: whMap.get(s.warehouseId)?.name ?? "",
          branchId: whMap.get(s.warehouseId)?.branchId ?? "",
          branchName: whMap.get(s.warehouseId)?.branch.name ?? "",
          quantity: s.quantity,
          costPrice: s.batch.costPrice,
          valueAfn: round2(s.quantity * s.batch.costPrice),
        }))
        .sort((a, b) => b.valueAfn - a.valueAfn);
      return ok({ type, rows });
    }

    if (type === "valuation") {
      let totalValueAfn = 0;
      const perBranch = new Map<string, { branchId: string; branchName: string; totalValueAfn: number; totalItems: number }>();
      for (const s of stockItems) {
        const value = s.quantity * s.batch.costPrice;
        totalValueAfn += value;
        const wh = whMap.get(s.warehouseId);
        if (!wh) continue;
        const entry = perBranch.get(wh.branchId) ?? {
          branchId: wh.branchId,
          branchName: wh.branch.name,
          totalValueAfn: 0,
          totalItems: 0,
        };
        entry.totalValueAfn += value;
        entry.totalItems += 1;
        perBranch.set(wh.branchId, entry);
      }
      return ok({
        type,
        summary: { totalValueAfn: round2(totalValueAfn), totalItems: stockItems.length },
        branches: [...perBranch.values()]
          .map((b) => ({ ...b, totalValueAfn: round2(b.totalValueAfn) }))
          .sort((a, b) => b.totalValueAfn - a.totalValueAfn),
      });
    }

    if (type === "batch" || type === "expiry") {
      const perBatch = new Map<
        string,
        {
          batchId: string;
          batchNumber: string;
          productId: string;
          productName: string;
          expiryDate: Date | null;
          costPrice: number;
          quantity: number;
          valueAfn: number;
          warehouses: string[];
        }
      >();
      for (const s of stockItems) {
        const entry = perBatch.get(s.batch.id) ?? {
          batchId: s.batch.id,
          batchNumber: s.batch.batchNumber,
          productId: s.productId,
          productName: s.product.name,
          expiryDate: s.batch.expiryDate,
          costPrice: s.batch.costPrice,
          quantity: 0,
          valueAfn: 0,
          warehouses: [],
        };
        entry.quantity += s.quantity;
        entry.valueAfn += s.quantity * s.batch.costPrice;
        const whName = whMap.get(s.warehouseId)?.name ?? "";
        if (whName && !entry.warehouses.includes(whName)) entry.warehouses.push(whName);
        perBatch.set(s.batch.id, entry);
      }
      const nullsLast = (d: Date | null) => (d ? d.getTime() : Number.MAX_SAFE_INTEGER);
      let rows = [...perBatch.values()].map((b) => ({
        ...b,
        quantity: round2(b.quantity),
        valueAfn: round2(b.valueAfn),
        status: computeBatchStatus(b.expiryDate, warnDays),
      }));
      if (type === "expiry") {
        rows = rows.filter((b) => b.status === "EXPIRING_SOON" || b.status === "EXPIRED");
      }
      rows.sort((a, b) => nullsLast(a.expiryDate) - nullsLast(b.expiryDate));
      return ok({ type, warnDays, rows });
    }

    // ─── low: محصولات زیر حداقل موجودی ───
    const perProduct = new Map<
      string,
      { productId: string; productName: string; unit: string; minStock: number; quantity: number }
    >();
    for (const s of stockItems) {
      if (!(s.product.minStock > 0)) continue;
      const entry = perProduct.get(s.productId) ?? {
        productId: s.productId,
        productName: s.product.name,
        unit: s.product.unit,
        minStock: s.product.minStock,
        quantity: 0,
      };
      entry.quantity += s.quantity;
      perProduct.set(s.productId, entry);
    }
    const rows = [...perProduct.values()]
      .filter((p) => p.quantity < p.minStock)
      .map((p) => ({
        ...p,
        quantity: round2(p.quantity),
        shortage: round2(p.minStock - p.quantity),
      }))
      .sort((a, b) => b.shortage - a.shortage);
    return ok({ type, rows });
  } catch (e) {
    return handleApiError(e);
  }
}
