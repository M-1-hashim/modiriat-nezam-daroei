import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  requireUser,
  requirePermission,
  allowedBranchIds,
  assertBranchAccess,
} from "@/lib/auth";
import { ok, handleApiError, toNum, parseDate, getPagination } from "@/lib/api-utils";

// ─────────────────────────── GET /api/stock/movements — سابقهٔ حرکت اجناس ───────────────────────────
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    requirePermission(user, "inventory.view");

    const url = new URL(req.url);
    const productId = url.searchParams.get("productId") || undefined;
    const batchId = url.searchParams.get("batchId") || undefined;
    const warehouseId = url.searchParams.get("warehouseId") || undefined;
    const type = url.searchParams.get("type") || undefined;
    const from = parseDate(url.searchParams.get("from"));
    const to = parseDate(url.searchParams.get("to"));
    const branchId = url.searchParams.get("branchId") || undefined;
    const { page, limit, skip, take } = getPagination(url, 50);

    // محدودهٔ شعبه — حرکت‌ها branchId دارند
    let branches = allowedBranchIds(user);
    if (branchId) {
      assertBranchAccess(user, branchId);
      branches = [branchId];
    }

    // مرزهای بازه را کلاینت با دقت کابل می‌فرستد (شروع/ختم روز شمسی)
    const where: Prisma.StockMovementWhereInput = {
      ...(branches === undefined ? {} : branches.length === 0 ? { id: { in: [] } } : { branchId: { in: branches } }),
      ...(productId ? { productId } : {}),
      ...(batchId ? { batchId } : {}),
      ...(type ? { type } : {}),
      ...(warehouseId
        ? { OR: [{ fromWarehouseId: warehouseId }, { toWarehouseId: warehouseId }] }
        : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    };

    const [rows, total] = await Promise.all([
      db.stockMovement.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: {
          batch: { select: { id: true, batchNumber: true } },
          fromWarehouse: { select: { name: true } },
          toWarehouse: { select: { name: true } },
        },
      }),
      db.stockMovement.count({ where }),
    ]);

    // StockMovement رابطهٔ مستقیم با Product ندارد — جداگانه وصل می‌شود
    const productIds = [...new Set(rows.map((m) => m.productId))];
    const products =
      productIds.length === 0
        ? []
        : await db.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, name: true, unit: true },
          });
    const productMap = new Map(products.map((p) => [p.id, p]));

    const items = rows.map((m) => {
      const product = productMap.get(m.productId);
      return {
        id: m.id,
        type: m.type,
        quantity: m.quantity,
        reason: m.reason,
        referenceType: m.referenceType,
        referenceId: m.referenceId,
        userName: m.userName,
        createdAt: m.createdAt,
        product: product ?? { id: m.productId, name: "", unit: "" },
        batchId: m.batch?.id ?? null,
        batchNumber: m.batch?.batchNumber ?? null,
        fromWarehouseName: m.fromWarehouse?.name ?? null,
        toWarehouseName: m.toWarehouse?.name ?? null,
      };
    });

    return ok({ items, total, page, limit });
  } catch (e) {
    return handleApiError(e);
  }
}
