import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  requireUser,
  requirePermission,
  allowedBranchIds,
  assertBranchAccess,
} from "@/lib/auth";
import { computeBatchStatus, getSettingNum } from "@/lib/business";
import { ok, handleApiError, ApiError, toNum } from "@/lib/api-utils";

const DAY_MS = 24 * 60 * 60 * 1000;

// ─────────────────────────── GET /api/stock — موجودی گدام ───────────────────────────
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    requirePermission(user, "inventory.view");

    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim() || "";
    const productId = url.searchParams.get("productId") || undefined;
    const warehouseId = url.searchParams.get("warehouseId") || undefined;
    const belowMin = url.searchParams.get("belowMin") === "true";
    const expiringDays = url.searchParams.get("expiringDays");
    const branchId = url.searchParams.get("branchId") || undefined;
    const page = Math.max(1, toNum(url.searchParams.get("page"), 1));
    const limit = Math.min(200, Math.max(1, toNum(url.searchParams.get("limit"), 50)));

    // محدودهٔ شعبه‌ها
    let branches = allowedBranchIds(user);
    if (branchId) {
      assertBranchAccess(user, branchId);
      branches = [branchId];
    }

    // گدام‌های در دسترس — undefined یعنی همه
    let whIds: string[] | undefined;
    if (branches !== undefined) {
      if (branches.length === 0) {
        whIds = [];
      } else {
        const whs = await db.warehouse.findMany({
          where: { branchId: { in: branches } },
          select: { id: true },
        });
        whIds = whs.map((w) => w.id);
      }
    }
    if (warehouseId) {
      const wh = await db.warehouse.findUnique({ where: { id: warehouseId } });
      if (!wh) throw new ApiError("گدام یافت نشد", 404);
      assertBranchAccess(user, wh.branchId);
      whIds = [warehouseId];
    }

    // لیست گدام‌ها برای فیلتر UI
    const warehouses = await db.warehouse.findMany({
      where: {
        isActive: true,
        ...(branches === undefined ? {} : branches.length === 0 ? { id: { in: [] } } : { branchId: { in: branches } }),
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    const warnDays = await getSettingNum("expiry_warn_days", 90);

    if (whIds !== undefined && whIds.length === 0) {
      return ok({ items: [], total: 0, page, limit, warehouses });
    }

    const where: Prisma.StockItemWhereInput = {
      ...(whIds === undefined ? {} : { warehouseId: { in: whIds } }),
      ...(productId ? { productId } : {}),
      ...(q
        ? {
            OR: [
              { product: { name: { contains: q } } },
              { batch: { batchNumber: { contains: q } } },
            ],
          }
        : {}),
      // حالت عادی فقط ردیف‌های دارای موجودی؛ belowMin ردیف‌های صفر را هم می‌گیرد (زیر حداقل‌اند)
      ...(belowMin ? {} : { quantity: { gt: 0 } }),
    };

    const rows = await db.stockItem.findMany({
      where,
      include: {
        product: { select: { id: true, name: true, unit: true, minStock: true } },
        batch: { select: { id: true, batchNumber: true, expiryDate: true } },
        warehouse: { select: { id: true, name: true, branchId: true } },
      },
    });

    const now = Date.now();
    const expDays = expiringDays !== null && expiringDays !== "" ? toNum(expiringDays, -1) : null;

    let items = rows.map((r) => ({
      id: r.id,
      quantity: r.quantity,
      updatedAt: r.updatedAt,
      product: r.product,
      batch: {
        ...r.batch,
        status: computeBatchStatus(r.batch.expiryDate, warnDays),
      },
      warehouse: r.warehouse,
    }));

    // زیر حداقل موجودی
    if (belowMin) {
      items = items.filter((i) => i.product.minStock > 0 && i.quantity < i.product.minStock);
    }

    // در حال انقضا در N روز (یا منقضی)
    if (expDays !== null && expDays >= 0) {
      items = items.filter((i) => {
        if (!i.batch.expiryDate) return false;
        const diffDays = (i.batch.expiryDate.getTime() - now) / DAY_MS;
        return diffDays <= expDays;
      });
    }

    // مرتب‌سازی بر اساس نام محصول
    items.sort((a, b) => {
      const cmp = a.product.name.localeCompare(b.product.name, "fa");
      if (cmp !== 0) return cmp;
      if (!a.batch.expiryDate && !b.batch.expiryDate) return 0;
      if (!a.batch.expiryDate) return 1;
      if (!b.batch.expiryDate) return -1;
      return a.batch.expiryDate.getTime() - b.batch.expiryDate.getTime();
    });

    const total = items.length;
    const start = (page - 1) * limit;
    return ok({ items: items.slice(start, start + limit), total, page, limit, warehouses });
  } catch (e) {
    return handleApiError(e);
  }
}
