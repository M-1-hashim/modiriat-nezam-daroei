import "server-only";
import { db } from "./db";
import { round2, ApiError } from "./api-utils";
import type { Tx } from "./auth";

// ─────────────────────── شماره‌گذاری اسناد ───────────────────────

export type DocType =
  | "PURCHASE"
  | "SALE"
  | "PAYMENT"
  | "PURCHASE_RETURN"
  | "SALES_RETURN";

const DEFAULT_PREFIX: Record<DocType, string> = {
  PURCHASE: "PUR",
  SALE: "SEL",
  PAYMENT: "PAY",
  PURCHASE_RETURN: "PRN",
  SALES_RETURN: "SRN",
};

export async function getSetting(key: string, def = ""): Promise<string> {
  const row = await db.systemSetting.findUnique({ where: { key } });
  return row?.value ?? def;
}

export async function getSettingBool(key: string, def = false): Promise<boolean> {
  const v = await getSetting(key, def ? "true" : "false");
  return v === "true";
}

export async function getSettingNum(key: string, def = 0): Promise<number> {
  const v = await getSetting(key, String(def));
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.systemSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

/** شماره سند بعدی برای یک شعبه — داخل تراکنش صدا زده شود */
export async function nextDocNumber(tx: Tx, branchId: string, docType: DocType): Promise<string> {
  const branch = await tx.branch.findUnique({ where: { id: branchId } });
  if (!branch) throw new ApiError("شعبه یافت نشد", 404);
  const prefixSettingKey = `seq_prefix_${docType}`;
  let prefix = await tx.systemSetting.findUnique({ where: { key: prefixSettingKey } }).then((r) => r?.value);
  if (!prefix) prefix = DEFAULT_PREFIX[docType];

  const seq = await tx.numberSequence.upsert({
    where: { branchId_docType: { branchId, docType } },
    create: { branchId, docType, prefix, current: 1 },
    update: { current: { increment: 1 } },
  });
  const seqNum = docType && seq.current < 1 ? 1 : seq.current;
  return `${prefix}-${branch.code}-${String(seqNum).padStart(5, "0")}`;
}

// ─────────────────────── بچ و موجودی ───────────────────────

export function computeBatchStatus(
  expiryDate: Date | null,
  warnDays = 90
): "VALID" | "EXPIRING_SOON" | "EXPIRED" {
  if (!expiryDate) return "VALID";
  const today = new Date();
  if (expiryDate < today) return "EXPIRED";
  const diffDays = (expiryDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000);
  return diffDays <= warnDays ? "EXPIRING_SOON" : "VALID";
}

/** ساخت بچ در صورت عدم وجود (unique: productId+batchNumber) و به‌روزرسانی بهای آن */
export async function createBatchIfMissing(
  tx: Tx,
  data: {
    productId: string;
    batchNumber: string;
    mfgDate?: Date | null;
    expiryDate?: Date | null;
    costPrice?: number;
    purchaseId?: string | null;
  }
) {
  const batchNumber = data.batchNumber?.trim() || "بدون-بچ";
  const existing = await tx.batch.findUnique({
    where: { productId_batchNumber: { productId: data.productId, batchNumber } },
  });
  if (existing) {
    // بهای بچ با جدیدترین خرید به‌روزرسانی می‌شود (روش میانگین‌گیری ساده: آخرین بهای خرید)
    const costPrice = data.costPrice !== undefined && data.costPrice > 0 ? data.costPrice : existing.costPrice;
    return tx.batch.update({
      where: { id: existing.id },
      data: {
        costPrice,
        mfgDate: data.mfgDate ?? existing.mfgDate,
        expiryDate: data.expiryDate ?? existing.expiryDate,
        purchaseId: data.purchaseId ?? existing.purchaseId,
      },
    });
  }
  return tx.batch.create({
    data: {
      productId: data.productId,
      batchNumber,
      mfgDate: data.mfgDate ?? null,
      expiryDate: data.expiryDate ?? null,
      costPrice: data.costPrice ?? 0,
      purchaseId: data.purchaseId ?? null,
    },
  });
}

export type MovementInput = {
  productId: string;
  batchId: string;
  fromWarehouseId?: string | null;
  toWarehouseId?: string | null;
  type:
    | "IN"
    | "OUT"
    | "TRANSFER"
    | "ADJUSTMENT"
    | "RETURN_IN"
    | "RETURN_OUT"
    | "DAMAGE"
    | "EXPIRED";
  quantity: number;
  reason?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  userId: string;
  userName: string;
  branchId: string;
  localId?: string | null;
};

/** ثبت حرکت موجودی + به‌روزرسانی اتمیک StockItem — همیشه داخل تراکنش */
export async function applyStockMovement(tx: Tx, m: MovementInput) {
  const qty = round2(m.quantity);
  if (qty <= 0 && m.type !== "ADJUSTMENT") {
    throw new ApiError("تعداد باید بزرگ‌تر از صفر باشد", 422);
  }

  const ensureStock = async (warehouseId: string) => {
    const existing = await tx.stockItem.findUnique({
      where: {
        productId_batchId_warehouseId: {
          productId: m.productId,
          batchId: m.batchId,
          warehouseId,
        },
      },
    });
    return existing;
  };

  const increase = async (warehouseId: string, amount: number) => {
    const existing = await ensureStock(warehouseId);
    if (existing) {
      await tx.stockItem.update({
        where: { id: existing.id },
        data: { quantity: round2(existing.quantity + amount) },
      });
    } else {
      await tx.stockItem.create({
        data: {
          productId: m.productId,
          batchId: m.batchId,
          warehouseId,
          quantity: amount,
        },
      });
    }
  };

  const decrease = async (warehouseId: string, amount: number, label: string) => {
    const existing = await ensureStock(warehouseId);
    const available = existing?.quantity ?? 0;
    if (existing && available < amount - 0.009) {
      throw new ApiError(
        `موجودی کافی در گدام موجود نیست (${label}). موجودی فعلی: ${available}`,
        422,
        "INSUFFICIENT_STOCK"
      );
    }
    if (existing) {
      await tx.stockItem.update({
        where: { id: existing.id },
        data: { quantity: round2(available - amount) },
      });
    } else if (amount > 0) {
      throw new ApiError(
        `موجودی کافی در گدام موجود نیست (${label})`,
        422,
        "INSUFFICIENT_STOCK"
      );
    }
  };

  switch (m.type) {
    case "IN":
    case "RETURN_IN":
      if (!m.toWarehouseId) throw new ApiError("گدام مقصد مشخص نیست", 422);
      await increase(m.toWarehouseId, qty);
      break;
    case "OUT":
    case "RETURN_OUT":
    case "DAMAGE":
    case "EXPIRED":
      if (!m.fromWarehouseId) throw new ApiError("گدام مبدأ مشخص نیست", 422);
      await decrease(m.fromWarehouseId, qty, "خروج");
      break;
    case "TRANSFER": {
      if (!m.fromWarehouseId || !m.toWarehouseId)
        throw new ApiError("گدام مبدأ و مقصد باید مشخص باشند", 422);
      if (m.fromWarehouseId === m.toWarehouseId)
        throw new ApiError("گدام مبدأ و مقصد نمی‌توانند یکسان باشند", 422);
      await decrease(m.fromWarehouseId, qty, "انتقال");
      await increase(m.toWarehouseId, qty);
      break;
    }
    case "ADJUSTMENT": {
      if (!m.toWarehouseId) throw new ApiError("گدام مشخص نیست", 422);
      const existing = await ensureStock(m.toWarehouseId);
      const current = existing?.quantity ?? 0;
      const delta = round2(qty - current);
      if (delta !== 0) {
        if (delta > 0) await increase(m.toWarehouseId, delta);
        else await decrease(m.toWarehouseId, -delta, "تعدیل");
      }
      break;
    }
  }

  return tx.stockMovement.create({
    data: {
      productId: m.productId,
      batchId: m.batchId,
      fromWarehouseId: m.fromWarehouseId ?? null,
      toWarehouseId: m.toWarehouseId ?? null,
      type: m.type,
      quantity: qty,
      reason: m.reason ?? null,
      referenceType: m.referenceType ?? null,
      referenceId: m.referenceId ?? null,
      userId: m.userId,
      userName: m.userName,
      branchId: m.branchId,
      localId: m.localId ?? null,
    },
  });
}

// ─────────────────────── محاسبات مالی ───────────────────────

/** بهای مؤثر هر واحد = مبلغ پرداخت‌شده ÷ کل مقدار دریافتی (شامل تعداد مجانی) */
export function computeEffectiveCost(
  lineTotalAfn: number,
  quantity: number,
  freeQuantity: number
): number {
  const totalQty = quantity + freeQuantity;
  if (totalQty <= 0) return 0;
  return round2(lineTotalAfn / totalQty);
}

/** توزیع مصارف اضافی (ترانسپورت/گمرک) بین اقلام بر مبنای مبلغ یا تعداد */
export function allocExtraCost(
  extraCostAfn: number,
  items: { lineTotalAfn: number; quantity: number }[],
  basis: "VALUE" | "QTY" = "VALUE"
): number[] {
  if (items.length === 0) return [];
  const weights =
    basis === "QTY"
      ? items.map((i) => Math.max(0, i.quantity))
      : items.map((i) => Math.max(0, i.lineTotalAfn));
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return items.map(() => 0);
  return weights.map((w) => round2((w / sum) * extraCostAfn));
}

// ─────────────────────── توازن‌ها و وضعیت فاکتورها ───────────────────────

/**
 * توازن مشتری = Σ فروش‌های تأییدشده (مبلغ فاکتور − برگشتی − پرداخت‌ها) − پرداخت‌های مستقل
 * مثبت = مشتری به ما بدهکار است
 */
export async function recalcCustomerBalance(tx: Tx, customerId: string) {
  const sales = await tx.sale.aggregate({
    where: { customerId, status: { in: ["APPROVED", "COMPLETED"] } },
    _sum: { totalAfn: true, returnedAfn: true },
  });
  const payments = await tx.payment.aggregate({
    where: { customerId, status: "COMPLETED", type: "CUSTOMER" },
    _sum: { amount: true },
  });
  const total = round2((sales._sum.totalAfn ?? 0) - (sales._sum.returnedAfn ?? 0));
  const paid = round2(payments._sum.amount ?? 0);
  const balance = round2(total - paid);
  await tx.customer.update({ where: { id: customerId }, data: { balance } });
  return balance;
}

/** توازن تأمین‌کننده = Σ خریدهای تأییدشده (− برگشتی − پرداخت‌ها). مثبت = ما به تأمین‌کننده بدهکاریم */
export async function recalcSupplierBalance(tx: Tx, supplierId: string) {
  const purchases = await tx.purchase.aggregate({
    where: { supplierId, status: { in: ["APPROVED", "COMPLETED"] } },
    _sum: { totalAfn: true, returnedAfn: true },
  });
  const payments = await tx.payment.aggregate({
    where: { supplierId, status: "COMPLETED", type: "SUPPLIER" },
    _sum: { amount: true },
  });
  const total = round2((purchases._sum.totalAfn ?? 0) - (purchases._sum.returnedAfn ?? 0));
  const paid = round2(payments._sum.amount ?? 0);
  const balance = round2(total - paid);
  await tx.supplier.update({ where: { id: supplierId }, data: { balance } });
  return balance;
}

export async function recalcSaleStatus(tx: Tx, saleId: string) {
  const sale = await tx.sale.findUnique({ where: { id: saleId } });
  if (!sale) return sale;
  if (!["APPROVED", "COMPLETED"].includes(sale.status)) return sale;
  const outstanding = round2(sale.totalAfn - sale.returnedAfn - sale.paidAmount);
  const status = outstanding <= 0.009 ? "COMPLETED" : "APPROVED";
  if (status !== sale.status) {
    return tx.sale.update({ where: { id: saleId }, data: { status } });
  }
  return sale;
}

export async function recalcPurchaseStatus(tx: Tx, purchaseId: string) {
  const purchase = await tx.purchase.findUnique({ where: { id: purchaseId } });
  if (!purchase) return purchase;
  if (!["APPROVED", "COMPLETED"].includes(purchase.status)) return purchase;
  const outstanding = round2(
    purchase.totalAfn - purchase.returnedAfn - purchase.paidAmount
  );
  const status = outstanding <= 0.009 ? "COMPLETED" : "APPROVED";
  if (status !== purchase.status) {
    return tx.purchase.update({ where: { id: purchaseId }, data: { status } });
  }
  return purchase;
}

// ─────────────────────── ثبت فعالیت‌ها (Audit) ───────────────────────

export type AuditInput = {
  userId?: string | null;
  userName?: string | null;
  branchId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  summary?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
};

export async function logAudit(tx: Tx, a: AuditInput) {
  return tx.auditLog.create({
    data: {
      userId: a.userId ?? null,
      userName: a.userName ?? null,
      branchId: a.branchId ?? null,
      action: a.action,
      entity: a.entity,
      entityId: a.entityId ?? null,
      summary: a.summary ?? null,
      before: a.before ? JSON.stringify(a.before) : null,
      after: a.after ? JSON.stringify(a.after) : null,
      ip: a.ip ?? null,
    },
  });
}

// ─────────────────────── آمار مالی دورهٔ یک شعبه ───────────────────────

export type PeriodFinancials = {
  revenueAfn: number;
  salesReturnsAfn: number;
  netRevenueAfn: number;
  cogsAfn: number;
  grossProfitAfn: number;
  expensesAfn: number;
  netProfitAfn: number;
  salesCount: number;
};

/**
 * محاسبه مالی یک دوره برای شعبه/شعبه‌ها:
 * عواید = فروش‌های تأییدشده − برگشتی فروش
 * COGS = بهای تمام‌شده ثبت‌شده هنگام فروش (costAtSale × کل مقدار شامل مجانی)
 * ناخالص = عواید خالص − COGS
 * خالص = ناخالص − مصارف تأییدشده/پرداخت‌شده
 */
export async function computePeriodFinancials(
  from: Date,
  to: Date,
  branchIds?: string[]
): Promise<PeriodFinancials> {
  const branchFilter =
    branchIds && branchIds.length > 0
      ? { branchId: { in: branchIds } }
      : {};

  const sales = await db.sale.findMany({
    where: {
      date: { gte: from, lte: to },
      status: { in: ["APPROVED", "COMPLETED"] },
      ...branchFilter,
    },
    select: { id: true, totalAfn: true, returnedAfn: true, items: { select: { quantity: true, freeQuantity: true, costAtSale: true } } },
  });

  let revenueAfn = 0;
  let returnsAfn = 0;
  let cogsAfn = 0;
  for (const s of sales) {
    revenueAfn += s.totalAfn;
    returnsAfn += s.returnedAfn;
    for (const it of s.items) {
      cogsAfn += it.costAtSale * (it.quantity + it.freeQuantity);
    }
  }
  const netRevenueAfn = round2(revenueAfn - returnsAfn);
  cogsAfn = round2(cogsAfn);
  const grossProfitAfn = round2(netRevenueAfn - cogsAfn);

  const expenses = await db.expense.aggregate({
    where: {
      date: { gte: from, lte: to },
      status: { in: ["APPROVED", "PAID"] },
      ...branchFilter,
    },
    _sum: { amountAfn: true },
  });
  const expensesAfn = round2(expenses._sum.amountAfn ?? 0);
  const netProfitAfn = round2(grossProfitAfn - expensesAfn);

  return {
    revenueAfn: round2(revenueAfn),
    salesReturnsAfn: round2(returnsAfn),
    netRevenueAfn,
    cogsAfn,
    grossProfitAfn,
    expensesAfn,
    netProfitAfn,
    salesCount: sales.length,
  };
}

/** خریدهای تأییدشدهٔ دوره (برای راپورها) */
export async function computePeriodPurchases(
  from: Date,
  to: Date,
  branchIds?: string[]
): Promise<{ totalAfn: number; count: number }> {
  const agg = await db.purchase.aggregate({
    where: {
      date: { gte: from, lte: to },
      status: { in: ["APPROVED", "COMPLETED"] },
      ...(branchIds && branchIds.length > 0 ? { branchId: { in: branchIds } } : {}),
    },
    _sum: { totalAfn: true, returnedAfn: true },
    _count: true,
  });
  return {
    totalAfn: round2((agg._sum.totalAfn ?? 0) - (agg._sum.returnedAfn ?? 0)),
    count: agg._count,
  };
}
