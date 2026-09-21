import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { ApiError, parseDate, round2, toNum } from "@/lib/api-utils";
import { assertBranchAccess, requirePermission, type AuthUser, type Tx } from "@/lib/auth";
import {
  applyStockMovement,
  getSettingBool,
  logAudit,
  nextDocNumber,
  recalcCustomerBalance,
  recalcPurchaseStatus,
  recalcSaleStatus,
  recalcSupplierBalance,
} from "@/lib/business";

// ─────────────────────────── کمکی‌ها ───────────────────────────

function asStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002"
  );
}

export type ReturnKind = "sales" | "purchase";

const salesReturnDetailInclude = {
  items: { include: { batch: { include: { product: { select: { id: true, name: true, unit: true } } } } } },
  sale: { select: { id: true, number: true, date: true } },
  customer: { select: { id: true, name: true } },
  warehouse: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true, code: true } },
} as const;

const purchaseReturnDetailInclude = {
  items: { include: { batch: { include: { product: { select: { id: true, name: true, unit: true } } } } } },
  purchase: { select: { id: true, number: true, date: true } },
  supplier: { select: { id: true, name: true } },
  warehouse: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true, code: true } },
} as const;

// ─────────────────────────── عواید تصویب برگشتی فروش ───────────────────────────

async function applySalesReturnEffects(
  tx: Tx,
  ret: { id: string; number: string; saleId: string; customerId: string; warehouseId: string; branchId: string; totalAfn: number },
  user: AuthUser
): Promise<void> {
  const items = await tx.salesReturnItem.findMany({ where: { returnId: ret.id } });
  for (const it of items) {
    await applyStockMovement(tx, {
      type: "RETURN_IN",
      toWarehouseId: ret.warehouseId,
      productId: it.productId,
      batchId: it.batchId,
      quantity: it.quantity,
      referenceType: "SALES_RETURN",
      referenceId: ret.id,
      userId: user.id,
      userName: user.fullName,
      branchId: ret.branchId,
    });
  }

  const sale = await tx.sale.findUnique({ where: { id: ret.saleId } });
  if (sale) {
    await tx.sale.update({
      where: { id: sale.id },
      data: { returnedAfn: round2(sale.returnedAfn + ret.totalAfn) },
    });
    await recalcSaleStatus(tx, sale.id);
  }
  await recalcCustomerBalance(tx, ret.customerId);
}

// ─────────────────────────── عواید تصویب برگشتی خرید ───────────────────────────

async function applyPurchaseReturnEffects(
  tx: Tx,
  ret: { id: string; number: string; purchaseId: string; supplierId: string; warehouseId: string; branchId: string; totalAfn: number },
  user: AuthUser
): Promise<void> {
  const items = await tx.purchaseReturnItem.findMany({ where: { returnId: ret.id } });
  for (const it of items) {
    await applyStockMovement(tx, {
      type: "RETURN_OUT",
      fromWarehouseId: ret.warehouseId,
      productId: it.productId,
      batchId: it.batchId,
      quantity: it.quantity,
      referenceType: "PURCHASE_RETURN",
      referenceId: ret.id,
      userId: user.id,
      userName: user.fullName,
      branchId: ret.branchId,
    });
  }

  const purchase = await tx.purchase.findUnique({ where: { id: ret.purchaseId } });
  if (purchase) {
    await tx.purchase.update({
      where: { id: purchase.id },
      data: { returnedAfn: round2(purchase.returnedAfn + ret.totalAfn) },
    });
    await recalcPurchaseStatus(tx, purchase.id);
  }
  await recalcSupplierBalance(tx, ret.supplierId);
}

// ─────────────────────────── ایجاد برگشتی فروش ───────────────────────────

export async function createSalesReturn(
  user: AuthUser,
  body: Record<string, unknown>,
  ip?: string
): Promise<unknown> {
  requirePermission(user, "returns.create");

  // خاصیت idempotency
  const localId = asStr(body.localId) || randomUUID();
  const existing = await db.salesReturn.findUnique({
    where: { localId },
    include: salesReturnDetailInclude,
  });
  if (existing) {
    assertBranchAccess(user, existing.branchId);
    return existing;
  }

  const saleId = asStr(body.saleId);
  if (!saleId) throw new ApiError("انتخاب فاکتور فروش الزامی است", 422, "VALIDATION");
  const sale = await db.sale.findUnique({ where: { id: saleId }, include: { items: true } });
  if (!sale) throw new ApiError("فاکتور فروش یافت نشد", 404, "NOT_FOUND");
  assertBranchAccess(user, sale.branchId);
  if (!["APPROVED", "COMPLETED"].includes(sale.status)) {
    throw new ApiError("فقط فاکتور تأییدشده قابل برگشت است", 422, "INVALID_STATUS");
  }

  const rawItems = body.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new ApiError("حداقل یک قلم برگشتی الزامی است", 422, "VALIDATION");
  }

  // برگشتی‌های قبلی هر قلم
  const saleItemIds = [
    ...new Set(rawItems.map((r) => asStr((r as Record<string, unknown>).saleItemId)).filter(Boolean)),
  ];
  const previous = await db.salesReturnItem.groupBy({
    by: ["saleItemId"],
    where: {
      saleItemId: { in: saleItemIds },
      return: { saleId: sale.id, status: { not: "CANCELLED" } },
    },
    _sum: { quantity: true },
  });
  const returnedMap = new Map(previous.map((p) => [p.saleItemId, round2(p._sum.quantity ?? 0)]));
  const consumed = new Map<string, number>();

  type Line = {
    saleItemId: string;
    productId: string;
    batchId: string;
    quantity: number;
    unitPriceAfn: number;
    lineTotalAfn: number;
  };
  const lines: Line[] = [];
  let totalAfn = 0;

  for (let idx = 0; idx < rawItems.length; idx++) {
    const rec = (rawItems[idx] ?? {}) as Record<string, unknown>;
    const saleItemId = asStr(rec.saleItemId);
    if (!saleItemId) {
      throw new ApiError(`شناسه قلم فاکتور برای قلم ${idx + 1} الزامی است`, 422, "VALIDATION");
    }
    const si = sale.items.find((i) => i.id === saleItemId);
    if (!si) {
      throw new ApiError(`قلم ${idx + 1} متعلق به این فاکتور نیست`, 422, "VALIDATION");
    }
    const quantity = round2(toNum(rec.quantity, 0));
    if (quantity <= 0) {
      throw new ApiError(`تعداد برگشتی قلم ${idx + 1} باید بزرگ‌تر از صفر باشد`, 422, "VALIDATION");
    }
    const already = round2((returnedMap.get(saleItemId) ?? 0) + (consumed.get(saleItemId) ?? 0));
    if (quantity > round2(si.quantity - already) + 0.009) {
      throw new ApiError("مقدار برگشتی بیش از مقدار فاکتور است", 422, "RETURN_QUANTITY_EXCEEDED");
    }
    consumed.set(saleItemId, round2((consumed.get(saleItemId) ?? 0) + quantity));

    // قیمت واحد خالص به افغانی = netUnitPrice × نرخ فاکتور
    const unitPriceAfn = round2(si.netUnitPrice * sale.exchangeRate);
    const lineTotalAfn = round2(quantity * unitPriceAfn);
    totalAfn += lineTotalAfn;

    lines.push({
      saleItemId,
      productId: si.productId,
      batchId: si.batchId,
      quantity,
      unitPriceAfn,
      lineTotalAfn,
    });
  }
  totalAfn = round2(totalAfn);

  const requireApproval = await getSettingBool("require_approval_returns", true);
  const status = requireApproval ? "REQUESTED" : "APPROVED";

  try {
    const created = await db.$transaction(async (tx) => {
      const number = await nextDocNumber(tx, sale.branchId, "SALES_RETURN");
      const ret = await tx.salesReturn.create({
        data: {
          localId,
          number,
          saleId: sale.id,
          branchId: sale.branchId,
          customerId: sale.customerId,
          warehouseId: sale.warehouseId,
          date: parseDate(body.date) ?? new Date(),
          totalAfn,
          status,
          reason: asStr(body.reason) || null,
          createdBy: user.id,
          createdByName: user.fullName,
          approvedBy: status === "APPROVED" ? user.fullName : null,
          items: { create: lines },
        },
        include: { items: true },
      });

      if (status === "APPROVED") {
        await applySalesReturnEffects(tx, ret, user);
      }

      await logAudit(tx, {
        userId: user.id,
        userName: user.fullName,
        branchId: sale.branchId,
        action: status === "APPROVED" ? "APPROVE" : "CREATE",
        entity: "SalesReturn",
        entityId: ret.id,
        summary: `${status === "APPROVED" ? "ثبت و تصویب" : "ثبت درخواست"} برگشتی فروش ${ret.number} به مبلغ ${ret.totalAfn} افغانی`,
        ip,
      });

      return ret;
    });

    return db.salesReturn.findUnique({ where: { id: created.id }, include: salesReturnDetailInclude });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const dup = await db.salesReturn.findUnique({
        where: { localId },
        include: salesReturnDetailInclude,
      });
      if (dup) {
        assertBranchAccess(user, dup.branchId);
        return dup;
      }
      throw new ApiError("برگشتی با این مشخصات قبلاً ثبت شده است", 409, "DUPLICATE");
    }
    throw e;
  }
}

// ─────────────────────────── ایجاد برگشتی خرید ───────────────────────────

export async function createPurchaseReturn(
  user: AuthUser,
  body: Record<string, unknown>,
  ip?: string
): Promise<unknown> {
  requirePermission(user, "returns.create");

  const localId = asStr(body.localId) || randomUUID();
  const existing = await db.purchaseReturn.findUnique({
    where: { localId },
    include: purchaseReturnDetailInclude,
  });
  if (existing) {
    assertBranchAccess(user, existing.branchId);
    return existing;
  }

  const purchaseId = asStr(body.purchaseId);
  if (!purchaseId) throw new ApiError("انتخاب فاکتور خرید الزامی است", 422, "VALIDATION");
  const purchase = await db.purchase.findUnique({
    where: { id: purchaseId },
    include: { items: true },
  });
  if (!purchase) throw new ApiError("فاکتور خرید یافت نشد", 404, "NOT_FOUND");
  assertBranchAccess(user, purchase.branchId);
  if (!["APPROVED", "COMPLETED"].includes(purchase.status)) {
    throw new ApiError("فقط فاکتور تأییدشده قابل برگشت است", 422, "INVALID_STATUS");
  }

  const rawItems = body.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new ApiError("حداقل یک قلم برگشتی الزامی است", 422, "VALIDATION");
  }

  const purchaseItemIds = [
    ...new Set(
      rawItems.map((r) => asStr((r as Record<string, unknown>).purchaseItemId)).filter(Boolean)
    ),
  ];
  const previous = await db.purchaseReturnItem.groupBy({
    by: ["purchaseItemId"],
    where: {
      purchaseItemId: { in: purchaseItemIds },
      return: { purchaseId: purchase.id, status: { not: "CANCELLED" } },
    },
    _sum: { quantity: true },
  });
  const returnedMap = new Map(previous.map((p) => [p.purchaseItemId, round2(p._sum.quantity ?? 0)]));
  const consumed = new Map<string, number>();

  type Line = {
    purchaseItemId: string;
    productId: string;
    batchId: string;
    quantity: number;
    unitCostAfn: number;
    lineTotalAfn: number;
  };
  const lines: Line[] = [];
  let totalAfn = 0;

  for (let idx = 0; idx < rawItems.length; idx++) {
    const rec = (rawItems[idx] ?? {}) as Record<string, unknown>;
    const purchaseItemId = asStr(rec.purchaseItemId);
    if (!purchaseItemId) {
      throw new ApiError(`شناسه قلم فاکتور برای قلم ${idx + 1} الزامی است`, 422, "VALIDATION");
    }
    const pi = purchase.items.find((i) => i.id === purchaseItemId);
    if (!pi) {
      throw new ApiError(`قلم ${idx + 1} متعلق به این فاکتور نیست`, 422, "VALIDATION");
    }
    if (!pi.batchId) {
      throw new ApiError(
        `قلم ${idx + 1} هنوز بچ فعال ندارد (فاکتور تأیید نشده است)`,
        422,
        "VALIDATION"
      );
    }
    const quantity = round2(toNum(rec.quantity, 0));
    if (quantity <= 0) {
      throw new ApiError(`تعداد برگشتی قلم ${idx + 1} باید بزرگ‌تر از صفر باشد`, 422, "VALIDATION");
    }
    const already = round2((returnedMap.get(purchaseItemId) ?? 0) + (consumed.get(purchaseItemId) ?? 0));
    if (quantity > round2(pi.quantity - already) + 0.009) {
      throw new ApiError("مقدار برگشتی بیش از مقدار فاکتور است", 422, "RETURN_QUANTITY_EXCEEDED");
    }
    consumed.set(purchaseItemId, round2((consumed.get(purchaseItemId) ?? 0) + quantity));

    const unitCostAfn = round2(pi.netUnitPrice * purchase.exchangeRate);
    const lineTotalAfn = round2(quantity * unitCostAfn);
    totalAfn += lineTotalAfn;

    lines.push({
      purchaseItemId,
      productId: pi.productId,
      batchId: pi.batchId,
      quantity,
      unitCostAfn,
      lineTotalAfn,
    });
  }
  totalAfn = round2(totalAfn);

  const requireApproval = await getSettingBool("require_approval_returns", true);
  const status = requireApproval ? "REQUESTED" : "APPROVED";

  try {
    const created = await db.$transaction(async (tx) => {
      const number = await nextDocNumber(tx, purchase.branchId, "PURCHASE_RETURN");
      const ret = await tx.purchaseReturn.create({
        data: {
          localId,
          number,
          purchaseId: purchase.id,
          branchId: purchase.branchId,
          supplierId: purchase.supplierId,
          warehouseId: purchase.warehouseId,
          date: parseDate(body.date) ?? new Date(),
          totalAfn,
          status,
          reason: asStr(body.reason) || null,
          createdBy: user.id,
          createdByName: user.fullName,
          approvedBy: status === "APPROVED" ? user.fullName : null,
          items: { create: lines },
        },
        include: { items: true },
      });

      if (status === "APPROVED") {
        await applyPurchaseReturnEffects(tx, ret, user);
      }

      await logAudit(tx, {
        userId: user.id,
        userName: user.fullName,
        branchId: purchase.branchId,
        action: status === "APPROVED" ? "APPROVE" : "CREATE",
        entity: "PurchaseReturn",
        entityId: ret.id,
        summary: `${status === "APPROVED" ? "ثبت و تصویب" : "ثبت درخواست"} برگشتی خرید ${ret.number} به مبلغ ${ret.totalAfn} افغانی`,
        ip,
      });

      return ret;
    });

    return db.purchaseReturn.findUnique({
      where: { id: created.id },
      include: purchaseReturnDetailInclude,
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const dup = await db.purchaseReturn.findUnique({
        where: { localId },
        include: purchaseReturnDetailInclude,
      });
      if (dup) {
        assertBranchAccess(user, dup.branchId);
        return dup;
      }
      throw new ApiError("برگشتی با این مشخصات قبلاً ثبت شده است", 409, "DUPLICATE");
    }
    throw e;
  }
}

// ─────────────────────────── تصویب برگشتی ───────────────────────────

export async function approveReturn(
  user: AuthUser,
  kind: ReturnKind,
  id: string,
  ip?: string
): Promise<unknown> {
  requirePermission(user, "returns.approve");

  if (kind === "sales") {
    const existing = await db.salesReturn.findUnique({ where: { id } });
    if (!existing) throw new ApiError("برگشتی یافت نشد", 404, "NOT_FOUND");
    assertBranchAccess(user, existing.branchId);

    await db.$transaction(async (tx) => {
      const upd = await tx.salesReturn.updateMany({
        where: { id, status: "REQUESTED" },
        data: { status: "APPROVED", approvedBy: user.fullName },
      });
      if (upd.count === 0) {
        throw new ApiError("فقط برگشتی‌های در انتظار قابل تصویب هستند", 422, "INVALID_STATUS");
      }
      const ret = await tx.salesReturn.findUnique({ where: { id } });
      if (!ret) throw new ApiError("برگشتی یافت نشد", 404, "NOT_FOUND");

      await applySalesReturnEffects(tx, ret, user);

      await logAudit(tx, {
        userId: user.id,
        userName: user.fullName,
        branchId: ret.branchId,
        action: "APPROVE",
        entity: "SalesReturn",
        entityId: id,
        summary: `تصویب برگشتی فروش ${ret.number} به مبلغ ${ret.totalAfn} افغانی`,
        ip,
      });
    });

    const ret = await db.salesReturn.findUnique({ where: { id }, include: salesReturnDetailInclude });
    if (!ret) throw new ApiError("برگشتی یافت نشد", 404, "NOT_FOUND");
    return ret;
  }

  // purchase
  const existing = await db.purchaseReturn.findUnique({ where: { id } });
  if (!existing) throw new ApiError("برگشتی یافت نشد", 404, "NOT_FOUND");
  assertBranchAccess(user, existing.branchId);

  await db.$transaction(async (tx) => {
    const upd = await tx.purchaseReturn.updateMany({
      where: { id, status: "REQUESTED" },
      data: { status: "APPROVED", approvedBy: user.fullName },
    });
    if (upd.count === 0) {
      throw new ApiError("فقط برگشتی‌های در انتظار قابل تصویب هستند", 422, "INVALID_STATUS");
    }
    const ret = await tx.purchaseReturn.findUnique({ where: { id } });
    if (!ret) throw new ApiError("برگشتی یافت نشد", 404, "NOT_FOUND");

    await applyPurchaseReturnEffects(tx, ret, user);

    await logAudit(tx, {
      userId: user.id,
      userName: user.fullName,
      branchId: ret.branchId,
      action: "APPROVE",
      entity: "PurchaseReturn",
      entityId: id,
      summary: `تصویب برگشتی خرید ${ret.number} به مبلغ ${ret.totalAfn} افغانی`,
      ip,
    });
  });

  const ret = await db.purchaseReturn.findUnique({
    where: { id },
    include: purchaseReturnDetailInclude,
  });
  if (!ret) throw new ApiError("برگشتی یافت نشد", 404, "NOT_FOUND");
  return ret;
}

// ─────────────────────────── لغو برگشتی ───────────────────────────

export async function cancelReturn(
  user: AuthUser,
  kind: ReturnKind,
  id: string,
  ip?: string
): Promise<unknown> {
  requirePermission(user, "returns.approve");

  if (kind === "sales") {
    const existing = await db.salesReturn.findUnique({ where: { id } });
    if (!existing) throw new ApiError("برگشتی یافت نشد", 404, "NOT_FOUND");
    assertBranchAccess(user, existing.branchId);

    await db.$transaction(async (tx) => {
      const upd = await tx.salesReturn.updateMany({
        where: { id, status: "REQUESTED" },
        data: { status: "CANCELLED" },
      });
      if (upd.count === 0) {
        throw new ApiError("فقط برگشتی‌های در انتظار قابل لغو هستند", 422, "INVALID_STATUS");
      }
      await logAudit(tx, {
        userId: user.id,
        userName: user.fullName,
        branchId: existing.branchId,
        action: "CANCEL",
        entity: "SalesReturn",
        entityId: id,
        summary: `لغو برگشتی فروش ${existing.number}`,
        ip,
      });
    });

    const ret = await db.salesReturn.findUnique({ where: { id }, include: salesReturnDetailInclude });
    if (!ret) throw new ApiError("برگشتی یافت نشد", 404, "NOT_FOUND");
    return ret;
  }

  const existing = await db.purchaseReturn.findUnique({ where: { id } });
  if (!existing) throw new ApiError("برگشتی یافت نشد", 404, "NOT_FOUND");
  assertBranchAccess(user, existing.branchId);

  await db.$transaction(async (tx) => {
    const upd = await tx.purchaseReturn.updateMany({
      where: { id, status: "REQUESTED" },
      data: { status: "CANCELLED" },
    });
    if (upd.count === 0) {
      throw new ApiError("فقط برگشتی‌های در انتظار قابل لغو هستند", 422, "INVALID_STATUS");
    }
    await logAudit(tx, {
      userId: user.id,
      userName: user.fullName,
      branchId: existing.branchId,
      action: "CANCEL",
      entity: "PurchaseReturn",
      entityId: id,
      summary: `لغو برگشتی خرید ${existing.number}`,
      ip,
    });
  });

  const ret = await db.purchaseReturn.findUnique({
    where: { id },
    include: purchaseReturnDetailInclude,
  });
  if (!ret) throw new ApiError("برگشتی یافت نشد", 404, "NOT_FOUND");
  return ret;
}
