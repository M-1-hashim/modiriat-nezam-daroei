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

// ─────────────────────────── GET /api/batches ───────────────────────────
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    requirePermission(user, "batches.view");

    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim() || "";
    const productId = url.searchParams.get("productId") || undefined;
    const statusFilter = url.searchParams.get("status") || "";
    const warehouseId = url.searchParams.get("warehouseId") || undefined;
    const expiryWithinDays = url.searchParams.get("expiryWithinDays");
    const branchId = url.searchParams.get("branchId") || undefined;
    const page = Math.max(1, toNum(url.searchParams.get("page"), 1));
    const limit = Math.min(200, Math.max(1, toNum(url.searchParams.get("limit"), 50)));

    // محدودهٔ شعبه‌ها — غیرسوپرادمین فقط شعبه‌های خودش
    let branches = allowedBranchIds(user);
    if (branchId) {
      assertBranchAccess(user, branchId);
      branches = [branchId];
    }

    // گدام‌های در دسترس — undefined یعنی همه (سوپرادمین بدون فیلتر شعبه)
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

    const warnDays = await getSettingNum("expiry_warn_days", 90);

    const where: Prisma.BatchWhereInput = {
      ...(productId ? { productId } : {}),
      ...(q
        ? {
            OR: [
              { batchNumber: { contains: q } },
              { product: { name: { contains: q } } },
            ],
          }
        : {}),
    };

    // جدول بچ‌ها کوچک است — تا ۱۰۰۰ ردیف بارگیری و فیلتر/صفحه‌بندی در حافظه
    const batches = await db.batch.findMany({
      where,
      include: {
        product: { select: { id: true, name: true, strength: true, unit: true } },
      },
      orderBy: [{ expiryDate: "asc" }, { batchNumber: "asc" }],
      take: 1000,
    });

    const batchIds = batches.map((b) => b.id);
    const sums =
      batchIds.length === 0
        ? []
        : await db.stockItem.groupBy({
            by: ["batchId"],
            where: {
              batchId: { in: batchIds },
              ...(whIds === undefined ? {} : { warehouseId: { in: whIds } }),
            },
            _sum: { quantity: true },
          });
    const qtyMap = new Map(sums.map((s) => [s.batchId, s._sum.quantity ?? 0]));

    const now = Date.now();
    const expDays = expiryWithinDays !== null && expiryWithinDays !== "" ? toNum(expiryWithinDays, -1) : null;

    let items = batches.map((b) => ({
      id: b.id,
      productId: b.productId,
      batchNumber: b.batchNumber,
      mfgDate: b.mfgDate,
      expiryDate: b.expiryDate,
      costPrice: b.costPrice,
      quantity: qtyMap.get(b.id) ?? 0,
      status: computeBatchStatus(b.expiryDate, warnDays),
      product: b.product,
    }));

    // فیلتر وضعیت محاسبه‌شده (VALID | EXPIRING_SOON | EXPIRED)
    if (statusFilter && ["VALID", "EXPIRING_SOON", "EXPIRED"].includes(statusFilter)) {
      items = items.filter((i) => i.status === statusFilter);
    }

    // فقط بچ‌هایی که در N روز آینده (یا منقضی‌شده) تمام می‌شوند
    if (expDays !== null && expDays >= 0) {
      items = items.filter((i) => {
        if (!i.expiryDate) return false;
        const diffDays = (i.expiryDate.getTime() - now) / DAY_MS;
        return diffDays <= expDays;
      });
    }

    // غیرسوپرادمین: تنها بچ‌های دارای موجودی در گدام‌های مجاز
    if (branches !== undefined) {
      items = items.filter((i) => i.quantity > 0);
    }

    // مرتب‌سازی: نزدیک‌ترین انقضا اول — بدون تاریخ در انتها
    items.sort((a, b) => {
      if (!a.expiryDate && !b.expiryDate) return a.batchNumber.localeCompare(b.batchNumber);
      if (!a.expiryDate) return 1;
      if (!b.expiryDate) return -1;
      return a.expiryDate.getTime() - b.expiryDate.getTime();
    });

    const total = items.length;
    const start = (page - 1) * limit;
    return ok({ items: items.slice(start, start + limit), total, page, limit });
  } catch (e) {
    return handleApiError(e);
  }
}
