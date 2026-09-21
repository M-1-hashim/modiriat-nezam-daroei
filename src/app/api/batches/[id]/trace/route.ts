import { db } from "@/lib/db";
import {
  requireUser,
  requirePermission,
  allowedBranchIds,
} from "@/lib/auth";
import { computeBatchStatus, getSettingNum } from "@/lib/business";
import { ok, handleApiError, ApiError } from "@/lib/api-utils";

// ─────────────────────────── GET /api/batches/[id]/trace — ردیابی کامل بچ ───────────────────────────
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    requirePermission(user, "batches.view");
    const { id } = await params;

    const batch = await db.batch.findUnique({
      where: { id },
      include: {
        product: {
          include: { manufacturer: { select: { name: true, country: true } } },
        },
      },
    });
    if (!batch) throw new ApiError("بچ یافت نشد", 404);

    const allowed = allowedBranchIds(user); // undefined = همه (سوپرادمین)
    const branchFilter = allowed === undefined ? {} : { branchId: { in: allowed } };
    const warnDays = await getSettingNum("expiry_warn_days", 90);

    // خرید منبع — از کجا و از چه تأمین‌کننده‌ای آمده
    const purchase = batch.purchaseId
      ? await db.purchase.findUnique({
          where: { id: batch.purchaseId },
          select: {
            number: true,
            date: true,
            currency: true,
            exchangeRate: true,
            supplier: { select: { name: true } },
            branch: { select: { name: true } },
          },
        })
      : null;

    // همهٔ حرکت‌های موجودی این بچ (در محدودهٔ شعبه‌های مجاز)
    const movements = await db.stockMovement.findMany({
      where: { batchId: batch.id, ...branchFilter },
      orderBy: { createdAt: "asc" },
      include: {
        fromWarehouse: { select: { name: true } },
        toWarehouse: { select: { name: true } },
      },
    });

    // فروش‌های تأییدشده — به کدام مشتریان رفته
    const saleItems = await db.saleItem.findMany({
      where: {
        batchId: batch.id,
        sale: { status: { in: ["APPROVED", "COMPLETED"] }, ...branchFilter },
      },
      include: {
        sale: {
          select: { number: true, date: true, customer: { select: { name: true } } },
        },
      },
    });
    const sales = saleItems
      .map((si) => ({
        saleId: si.saleId,
        number: si.sale.number,
        date: si.sale.date,
        customerName: si.sale.customer.name,
        quantity: si.quantity,
        freeQuantity: si.freeQuantity,
        unitPrice: si.netUnitPrice,
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    // موجودی فعلی — فقط گدام‌های شعبه‌های مجاز
    let whIds: string[] | undefined;
    if (allowed !== undefined) {
      if (allowed.length === 0) {
        whIds = [];
      } else {
        const whs = await db.warehouse.findMany({
          where: { branchId: { in: allowed } },
          select: { id: true },
        });
        whIds = whs.map((w) => w.id);
      }
    }
    const stockRows =
      whIds === undefined
        ? await db.stockItem.findMany({
            where: { batchId: batch.id },
            include: { warehouse: { select: { id: true, name: true } } },
          })
        : whIds.length === 0
          ? []
          : await db.stockItem.findMany({
              where: { batchId: batch.id, warehouseId: { in: whIds } },
              include: { warehouse: { select: { id: true, name: true } } },
            });
    const currentStock = stockRows
      .map((s) => ({
        warehouseId: s.warehouseId,
        warehouseName: s.warehouse.name,
        quantity: s.quantity,
      }))
      .sort((a, b) => a.warehouseName.localeCompare(b.warehouseName));

    return ok({
      batch: {
        id: batch.id,
        productId: batch.productId,
        batchNumber: batch.batchNumber,
        mfgDate: batch.mfgDate,
        expiryDate: batch.expiryDate,
        costPrice: batch.costPrice,
        status: computeBatchStatus(batch.expiryDate, warnDays),
      },
      product: {
        id: batch.product.id,
        name: batch.product.name,
        genericName: batch.product.genericName,
        strength: batch.product.strength,
        dosageForm: batch.product.dosageForm,
        unit: batch.product.unit,
        manufacturerName: batch.product.manufacturer?.name ?? null,
      },
      purchase: purchase
        ? {
            number: purchase.number,
            date: purchase.date,
            currency: purchase.currency,
            exchangeRate: purchase.exchangeRate,
            supplier: { name: purchase.supplier.name },
            branch: { name: purchase.branch.name },
          }
        : null,
      movements: movements.map((m) => ({
        id: m.id,
        type: m.type,
        quantity: m.quantity,
        reason: m.reason,
        referenceType: m.referenceType,
        referenceId: m.referenceId,
        userName: m.userName,
        createdAt: m.createdAt,
        fromWarehouseName: m.fromWarehouse?.name ?? null,
        toWarehouseName: m.toWarehouse?.name ?? null,
      })),
      sales,
      currentStock,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
