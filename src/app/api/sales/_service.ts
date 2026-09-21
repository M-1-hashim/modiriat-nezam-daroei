import { randomUUID } from "crypto";
import type { Sale } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError, parseDate, round2, round4, toNum } from "@/lib/api-utils";
import {
  assertBranchAccess,
  effectiveBranchId,
  requirePermission,
  type AuthUser,
  type Tx,
} from "@/lib/auth";
import {
  applyStockMovement,
  computeBatchStatus,
  getSetting,
  getSettingBool,
  getSettingNum,
  logAudit,
  nextDocNumber,
  recalcCustomerBalance,
  recalcSaleStatus,
  type MovementInput,
} from "@/lib/business";
import {
  applyInvoicePromotion,
  applyLinePromotion,
  assertDiscountWithinLimit,
  loadUsablePromotions,
  recordDocPromotionUsage,
  type PromoWithProducts,
} from "@/lib/promotion";

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

const CURRENCIES = ["AFN", "USD", "PKR"];
const SALE_TYPES = ["WHOLESALE", "CASH", "CREDIT"];
const INVOICE_TEMPLATES = ["SIMPLE", "DETAILED"];

// ─────────────────────────── انواع داخلی ───────────────────────────

type ComputedItem = {
  productId: string;
  batchId: string;
  quantity: number;
  freeQuantity: number;
  promoFreeQuantity: number;
  unitPrice: number;
  discountType: string;
  discountPct: number;
  discountAmount: number;
  discountReason: string | null;
  promotionId: string | null;
  promoDiscountAmount: number;
  netUnitPrice: number;
  promotionNote: string | null;
  lineTotal: number;
  lineTotalAfn: number;
  batchCostPrice: number;
};

type ComputedSale = {
  customerId: string;
  warehouseId: string;
  salespersonId: string | null;
  territoryId: string | null;
  type: string;
  invoiceTemplate: string;
  date: Date;
  currency: string;
  exchangeRate: number;
  subtotal: number;
  discountTotal: number;
  invoiceDiscountType: string | null;
  invoiceDiscountValue: number;
  invoiceDiscountAmount: number;
  discountReason: string | null;
  promotionId: string | null;
  promotionCode: string | null;
  promotionDiscountAmount: number;
  total: number;
  totalAfn: number;
  paidAmount: number;
  notes: string | null;
  items: ComputedItem[];
};

type ApprovalLine = {
  id: string;
  productId: string;
  batchId: string;
  quantity: number;
  freeQuantity: number;
  costPrice: number;
  promotionId: string | null;
  promoFreeQuantity: number;
  promoDiscountAmount: number;
};

const itemProductSelect = { select: { id: true, name: true, unit: true } } as const;
const itemBatchSelect = {
  select: { id: true, batchNumber: true, expiryDate: true, costPrice: true },
} as const;

const saleDetailInclude = {
  items: { include: { product: itemProductSelect, batch: itemBatchSelect } },
  customer: {
    select: {
      id: true,
      name: true,
      type: true,
      phone: true,
      address: true,
      creditLimit: true,
      balance: true,
    },
  },
  warehouse: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true, code: true } },
  salesperson: { select: { id: true, name: true } },
  territory: { select: { id: true, name: true } },
  payments: { orderBy: { date: "desc" as const } },
  returns: { include: { items: true }, orderBy: { date: "desc" as const } },
} as const;

// ─────────────────────────── حرکت خروج با اجازهٔ موجودی منفی ───────────────────────────

async function applyOutMovement(
  tx: Tx,
  m: MovementInput,
  allowNegative: boolean
): Promise<void> {
  if (!allowNegative || !m.fromWarehouseId) {
    await applyStockMovement(tx, m);
    return;
  }
  const existing = await tx.stockItem.findUnique({
    where: {
      productId_batchId_warehouseId: {
        productId: m.productId,
        batchId: m.batchId,
        warehouseId: m.fromWarehouseId,
      },
    },
  });
  const available = existing?.quantity ?? 0;
  if (existing && available >= m.quantity - 0.009) {
    await applyStockMovement(tx, m);
    return;
  }
  // فروش با موجودی منفی مجاز است (تنظیم allow_negative_stock)
  const newQty = round2(available - m.quantity);
  if (existing) {
    await tx.stockItem.update({ where: { id: existing.id }, data: { quantity: newQty } });
  } else {
    await tx.stockItem.create({
      data: {
        productId: m.productId,
        batchId: m.batchId,
        warehouseId: m.fromWarehouseId,
        quantity: newQty,
      },
    });
  }
  await tx.stockMovement.create({
    data: {
      productId: m.productId,
      batchId: m.batchId,
      fromWarehouseId: m.fromWarehouseId,
      toWarehouseId: m.toWarehouseId ?? null,
      type: m.type,
      quantity: round2(m.quantity),
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

// ─────────────────────────── اعتبارسنجی و محاسبه ورودی ───────────────────────────

async function parseSaleInput(
  user: AuthUser,
  body: Record<string, unknown>,
  branchId: string,
  warnings: string[]
): Promise<ComputedSale> {
  // مشتری
  const customerId = asStr(body.customerId);
  if (!customerId) throw new ApiError("انتخاب مشتری الزامی است", 422, "VALIDATION");
  const customer = await db.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new ApiError("مشتری یافت نشد", 422, "VALIDATION");
  assertBranchAccess(user, customer.branchId);
  if (customer.branchId !== branchId) {
    throw new ApiError("مشتری انتخاب‌شده متعلق به شعبه سند نیست", 422, "VALIDATION");
  }

  // گدام
  const warehouseId = asStr(body.warehouseId);
  if (!warehouseId) throw new ApiError("انتخاب گدام الزامی است", 422, "VALIDATION");
  const warehouse = await db.warehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse) throw new ApiError("گدام یافت نشد", 422, "VALIDATION");
  assertBranchAccess(user, warehouse.branchId);
  if (warehouse.branchId !== branchId) {
    throw new ApiError("گدام انتخاب‌شده متعلق به شعبه سند نیست", 422, "VALIDATION");
  }

  // نوع فروش و تمپلیت
  const type = asStr(body.type).toUpperCase() || "WHOLESALE";
  if (!SALE_TYPES.includes(type)) {
    throw new ApiError("نوع فروش باید عمده، نقدی یا قرضه باشد", 422, "VALIDATION");
  }
  let invoiceTemplate = asStr(body.invoiceTemplate).toUpperCase();
  if (invoiceTemplate) {
    if (!INVOICE_TEMPLATES.includes(invoiceTemplate)) {
      throw new ApiError("تمپلیت فاکتور باید ساده یا مفصل باشد", 422, "VALIDATION");
    }
  } else {
    invoiceTemplate = (await getSetting("invoice_template_default", "DETAILED")) || "DETAILED";
  }

  const date = parseDate(body.date) ?? new Date();

  const currency = asStr(body.currency).toUpperCase() || "AFN";
  if (!CURRENCIES.includes(currency)) {
    throw new ApiError("اسعار باید افغانی، دالر یا کلدار باشد", 422, "VALIDATION");
  }
  let exchangeRate = round4(toNum(body.exchangeRate, 1));
  if (currency === "AFN") exchangeRate = 1;
  if (exchangeRate <= 0) {
    throw new ApiError("نرخ تبدیل باید بزرگ‌تر از صفر باشد", 422, "VALIDATION");
  }

  const paidAmount = round2(toNum(body.paidAmount, 0));
  if (paidAmount < 0) throw new ApiError("مبلغ پرداختی نمی‌تواند منفی باشد", 422, "VALIDATION");

  const notes = asStr(body.notes) || null;

  // سقف درصد تخفیف مجاز برای کاربران عادی (تنظیم سیستم)
  const maxDiscountPct = await getSettingNum("max_discount_percent", 100);

  // فروشنده و ولسوالی — اگر کاربر تعیین نکرده باشد از مشتری برداشته می‌شود
  let salespersonId = asStr(body.salespersonId) || customer.salespersonId || null;
  let territoryId = asStr(body.territoryId) || customer.territoryId || null;
  if (salespersonId) {
    const sp = await db.salesperson.findUnique({ where: { id: salespersonId } });
    if (!sp) throw new ApiError("فروشنده یافت نشد", 422, "VALIDATION");
    if (sp.branchId !== branchId) {
      throw new ApiError("فروشنده انتخاب‌شده متعلق به شعبه سند نیست", 422, "VALIDATION");
    }
  }
  if (territoryId) {
    const ter = await db.territory.findUnique({ where: { id: territoryId } });
    if (!ter) throw new ApiError("ولسوالی یافت نشد", 422, "VALIDATION");
    if (ter.branchId !== branchId) {
      throw new ApiError("ولسوالی انتخاب‌شده متعلق به شعبه سند نیست", 422, "VALIDATION");
    }
  }

  // اقلام
  const rawItems = body.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new ApiError("حداقل یک قلم فاکتور الزامی است", 422, "VALIDATION");
  }

  const allowNegative = await getSettingBool("allow_negative_stock", false);
  const blockExpired = await getSettingBool("block_expired_sales", true);
  const warnDays = await getSettingNum("expiry_warn_days", 90);

  // بارگیری بچ‌ها و موجودی
  const batchIds = [
    ...new Set(rawItems.map((r) => asStr((r as Record<string, unknown>).batchId)).filter(Boolean)),
  ];
  const batches = await db.batch.findMany({
    where: { id: { in: batchIds } },
    include: { product: { select: { id: true, name: true } } },
  });
  const batchMap = new Map(batches.map((b) => [b.id, b]));
  const stockItems = await db.stockItem.findMany({
    where: { batchId: { in: batchIds }, warehouseId },
    select: { batchId: true, quantity: true },
  });
  const stockMap = new Map(stockItems.map((s) => [s.batchId, s.quantity]));

  type DraftItem = ComputedItem;
  const drafts: DraftItem[] = [];
  const neededByBatch = new Map<string, number>();

  for (let idx = 0; idx < rawItems.length; idx++) {
    const rec = (rawItems[idx] ?? {}) as Record<string, unknown>;
    const batchId = asStr(rec.batchId);
    if (!batchId) {
      throw new ApiError(`انتخاب بچ برای قلم ${idx + 1} الزامی است`, 422, "VALIDATION");
    }
    const batch = batchMap.get(batchId);
    if (!batch) {
      throw new ApiError(`بچ قلم ${idx + 1} یافت نشد`, 422, "VALIDATION");
    }
    const productId = asStr(rec.productId) || batch.productId;
    if (productId !== batch.productId) {
      throw new ApiError(
        `بچ قلم ${idx + 1} متعلق به محصول انتخاب‌شده نیست`,
        422,
        "VALIDATION"
      );
    }

    const quantity = round2(toNum(rec.quantity, 0));
    if (quantity <= 0) {
      throw new ApiError(`تعداد قلم ${idx + 1} باید بزرگ‌تر از صفر باشد`, 422, "VALIDATION");
    }
    const freeQuantity = round2(toNum(rec.freeQuantity, 0));
    if (freeQuantity < 0) {
      throw new ApiError(`تعداد مجانی قلم ${idx + 1} نمی‌تواند منفی باشد`, 422, "VALIDATION");
    }
    const unitPrice = round2(toNum(rec.unitPrice, 0));
    if (unitPrice < 0) {
      throw new ApiError(`قیمت واحد قلم ${idx + 1} نمی‌تواند منفی باشد`, 422, "VALIDATION");
    }
    // تخفیف کاربر — نوع ورودی (PERCENT/AMOUNT) + دلیل + سقف مجاز
    const discountType =
      asStr(rec.discountType).toUpperCase() === "AMOUNT" ? "AMOUNT" : "PERCENT";
    const discountPct = round2(toNum(rec.discountPct, 0));
    if (discountPct < 0 || discountPct > 100) {
      throw new ApiError(`درصد تخفیف قلم ${idx + 1} باید بین ۰ تا ۱۰۰ باشد`, 422, "VALIDATION");
    }
    const discountAmount = round2(toNum(rec.discountAmount, 0));
    if (discountAmount < 0) {
      throw new ApiError(`مبلغ تخفیف قلم ${idx + 1} نمی‌تواند منفی باشد`, 422, "VALIDATION");
    }
    assertDiscountWithinLimit(user, discountPct, maxDiscountPct, `درصد تخفیف قلم ${idx + 1}`);
    const itemPromotionId = asStr(rec.promotionId) || null;

    // چک بچ منقضی
    const batchStatus = computeBatchStatus(batch.expiryDate, warnDays);
    if (blockExpired && batchStatus === "EXPIRED") {
      throw new ApiError(
        `بچ منقضی‌شده قابل فروش نیست: ${batch.product.name} (بچ ${batch.batchNumber})`,
        422,
        "EXPIRED_BATCH"
      );
    }
    if (batchStatus === "EXPIRING_SOON") {
      warnings.push(
        `بچ نزدیک به انقضا: ${batch.product.name} (بچ ${batch.batchNumber})`
      );
    }

    // جمع تقاضا برای هر بچ
    const needed = round2(quantity + freeQuantity);
    neededByBatch.set(batchId, round2((neededByBatch.get(batchId) ?? 0) + needed));

    const netUnitPrice = round2(
      unitPrice * (1 - discountPct / 100) - (quantity > 0 ? discountAmount / quantity : 0)
    );
    const lineTotal = round2(quantity * netUnitPrice);
    const lineTotalAfn = round2(lineTotal * exchangeRate);

    drafts.push({
      productId,
      batchId,
      quantity,
      freeQuantity,
      promoFreeQuantity: 0,
      unitPrice,
      discountType,
      discountPct,
      discountAmount,
      discountReason: asStr(rec.discountReason) || null,
      promotionId: itemPromotionId,
      promoDiscountAmount: 0,
      netUnitPrice,
      promotionNote: asStr(rec.promotionNote) || null,
      lineTotal,
      lineTotalAfn,
      batchCostPrice: batch.costPrice,
    });
  }

  // چک موجودی — مجموع اقلام یک بچ با هم مقایسه می‌شود
  if (!allowNegative) {
    for (const [batchId, needed] of neededByBatch) {
      const batch = batchMap.get(batchId);
      if (!batch) continue;
      const available = round2(stockMap.get(batchId) ?? 0);
      if (needed > available + 0.009) {
        throw new ApiError(
          `موجودی کافی نیست: ${batch.product.name} (بچ ${batch.batchNumber}) — موجودی فعلی: ${available}، درخواستی: ${needed}`,
          422,
          "INSUFFICIENT_STOCK"
        );
      }
    }
  }

  // ─── پروموشن‌های قابل استفاده برای این سند ───
  const promoCtx = { docType: "SALE" as const, date, customerType: customer.type };
  const promoMap = new Map<string, PromoWithProducts>();
  const docPromoId = asStr(body.promotionId) || null;
  const requestedPromoIds = [
    ...new Set([
      ...drafts.map((d) => d.promotionId).filter((x): x is string => !!x),
      ...(docPromoId ? [docPromoId] : []),
    ]),
  ];
  if (requestedPromoIds.length > 0) {
    const usable = await loadUsablePromotions(promoCtx);
    for (const p of usable) promoMap.set(p.id, p);
  }

  // اعمال پروموشن روی اقلام (سرورمحور — پاداش محاسبه و اعتبارسنجی می‌شود)
  const promoItems = drafts.map((d) => {
    if (!d.promotionId) return d;
    const promo = promoMap.get(d.promotionId);
    const benefit = applyLinePromotion(
      promo,
      {
        promotionId: d.promotionId,
        productId: d.productId,
        quantity: d.quantity,
        lineGrossAfn: round2(d.quantity * d.unitPrice * exchangeRate),
        lineNetAfn: d.lineTotalAfn,
      },
      promoCtx
    );
    const promoFreeQuantity = benefit.freeQuantity;
    const promoDiscountAmount = round2(benefit.discountAfn / exchangeRate);
    const netUnitPrice = round2(
      d.netUnitPrice - (d.quantity > 0 ? promoDiscountAmount / d.quantity : 0)
    );
    const lineTotal = round2(d.quantity * netUnitPrice);
    const lineTotalAfn = round2(lineTotal * exchangeRate);
    return {
      ...d,
      freeQuantity: round2(d.freeQuantity + promoFreeQuantity),
      promoFreeQuantity,
      promoDiscountAmount,
      netUnitPrice,
      lineTotal,
      lineTotalAfn,
      promotionNote:
        d.promotionNote ?? `پروموشن: ${promo?.code ?? ""} — ${promo?.name ?? ""}`,
    };
  });

  const subtotal = round2(promoItems.reduce((a, it) => a + it.lineTotal, 0));
  const discountTotal = round2(
    promoItems.reduce((a, it) => a + (it.quantity * it.unitPrice - it.lineTotal), 0)
  );

  // ─── تخفیف سطح فاکتور (کاربر) — مستقل از پروموشن ───
  const invoiceDiscountTypeRaw = asStr(body.invoiceDiscountType).toUpperCase();
  let invoiceDiscountType: string | null = null;
  let invoiceDiscountValue = 0;
  let invoiceDiscountAmount = 0;
  if (invoiceDiscountTypeRaw === "PERCENT" || invoiceDiscountTypeRaw === "AMOUNT") {
    invoiceDiscountType = invoiceDiscountTypeRaw;
    invoiceDiscountValue = round2(toNum(body.invoiceDiscountValue, 0));
    if (invoiceDiscountType === "PERCENT") {
      if (invoiceDiscountValue < 0 || invoiceDiscountValue > 100) {
        throw new ApiError("درصد تخفیف فاکتور باید بین ۰ تا ۱۰۰ باشد", 422, "VALIDATION");
      }
      assertDiscountWithinLimit(user, invoiceDiscountValue, maxDiscountPct, "درصد تخفیف فاکتور");
      invoiceDiscountAmount = round2((subtotal * invoiceDiscountValue) / 100);
    } else {
      if (invoiceDiscountValue < 0) {
        throw new ApiError("مبلغ تخفیف فاکتور نمی‌تواند منفی باشد", 422, "VALIDATION");
      }
      if (invoiceDiscountValue > subtotal) {
        throw new ApiError("مبلغ تخفیف فاکتور نمی‌تواند از جمع فاکتور بیشتر باشد", 422, "VALIDATION");
      }
      invoiceDiscountAmount = invoiceDiscountValue;
    }
  }
  const discountReason = asStr(body.discountReason) || null;

  // ─── پروموشن سطح فاکتور (فقط scope=INVOICE) ───
  let promotionId: string | null = null;
  let promotionCode: string | null = null;
  let promotionDiscountAmount = 0;
  if (docPromoId) {
    const promo = promoMap.get(docPromoId);
    const afterInvoiceAfn = round2((subtotal - invoiceDiscountAmount) * exchangeRate);
    const eligibleQty = promo
      ? round2(
          promoItems
            .filter(
              (it) =>
                promo.allProducts ||
                promo.products.some((pp) => pp.productId === it.productId)
            )
            .reduce((a, it) => a + it.quantity, 0)
        )
      : 0;
    const benefit = applyInvoicePromotion(
      promo,
      { promotionId: docPromoId, subtotalAfn: afterInvoiceAfn, eligibleQuantity: eligibleQty },
      promoCtx
    );
    promotionId = docPromoId;
    promotionCode = promo?.code ?? null;
    promotionDiscountAmount = round2(benefit.discountAfn / exchangeRate);
  }

  const total = round2(subtotal - invoiceDiscountAmount - promotionDiscountAmount); // فروش مصارف اضافی ندارد
  const totalAfn = round2(total * exchangeRate);

  // سقف اعتبار مشتری
  if (customer.creditLimit > 0) {
    const remaining = round2(totalAfn - paidAmount);
    if (round2(customer.balance + remaining) > round2(customer.creditLimit) + 0.009) {
      throw new ApiError(
        `سقف اعتبار مشتری تجاوز می‌کند — بدهی فعلی: ${round2(customer.balance)} افغانی، سقف: ${round2(customer.creditLimit)} افغانی`,
        422,
        "CREDIT_LIMIT_EXCEEDED"
      );
    }
  }

  return {
    customerId,
    warehouseId,
    salespersonId,
    territoryId,
    type,
    invoiceTemplate,
    date,
    currency,
    exchangeRate,
    subtotal,
    discountTotal,
    invoiceDiscountType,
    invoiceDiscountValue,
    invoiceDiscountAmount,
    discountReason,
    promotionId,
    promotionCode,
    promotionDiscountAmount,
    total,
    totalAfn,
    paidAmount,
    notes,
    items: promoItems,
  };
}

// ─────────────────────────── عواید تصویب (داخل تراکنش) ───────────────────────────

export async function applySaleApprovalEffects(
  tx: Tx,
  sale: Sale,
  lines: ApprovalLine[],
  user: AuthUser,
  allowNegative: boolean
): Promise<void> {
  for (const l of lines) {
    // بهای تمام‌شده تاریخی — هرگز بعداً تغییر نمی‌کند
    await tx.saleItem.update({ where: { id: l.id }, data: { costAtSale: round2(l.costPrice) } });
    await applyOutMovement(tx, {
      type: "OUT",
      fromWarehouseId: sale.warehouseId,
      productId: l.productId,
      batchId: l.batchId,
      quantity: round2(l.quantity + l.freeQuantity),
      referenceType: "SALE",
      referenceId: sale.id,
      userId: user.id,
      userName: user.fullName,
      branchId: sale.branchId,
    }, allowNegative);
  }

  // ثبت استفاده از پروموشن‌ها (کالای رایگان + تخفیف پروموشن) — فقط هنگام تصویب
  await recordDocPromotionUsage(
    tx,
    "SALE",
    sale,
    lines.map((l) => ({
      promotionId: l.promotionId,
      productId: l.productId,
      quantity: l.quantity,
      promoFreeQuantity: l.promoFreeQuantity,
      promoDiscountAmount: l.promoDiscountAmount,
      unitCostAfn: l.costPrice,
    }))
  );

  if (sale.paidAmount > 0) {
    const payNumber = await nextDocNumber(tx, sale.branchId, "PAYMENT");
    await tx.payment.create({
      data: {
        localId: randomUUID(),
        number: payNumber,
        type: "CUSTOMER",
        direction: "IN",
        branchId: sale.branchId,
        customerId: sale.customerId,
        saleId: sale.id,
        amount: round2(sale.paidAmount),
        currency: sale.currency,
        exchangeRate: sale.exchangeRate,
        method: "CASH",
        date: sale.date,
        createdBy: user.id,
        createdByName: user.fullName,
        status: "COMPLETED",
      },
    });
  }

  await recalcCustomerBalance(tx, sale.customerId);
  await recalcSaleStatus(tx, sale.id);
}

// ─────────────────────────── خواندن ───────────────────────────

export async function getSaleDetail(id: string): Promise<unknown> {
  const sale = await db.sale.findUnique({ where: { id }, include: saleDetailInclude });
  if (!sale) throw new ApiError("فاکتور فروش یافت نشد", 404, "NOT_FOUND");
  return sale;
}

// ─────────────────────────── ایجاد ───────────────────────────

export async function createSale(
  user: AuthUser,
  body: Record<string, unknown>,
  ip?: string
): Promise<unknown> {
  requirePermission(user, "sales.create");

  // خاصیت idempotency
  const localId = asStr(body.localId) || randomUUID();
  const existing = await db.sale.findUnique({ where: { localId }, include: saleDetailInclude });
  if (existing) {
    assertBranchAccess(user, existing.branchId);
    return { ...existing, warnings: [] };
  }

  // برای سوپرادمین بدون شعبهٔ صریح، شعبهٔ سند از گدام انتخاب‌شده استخراج می‌شود
  let requestedBranch = typeof body.branchId === "string" ? body.branchId : null;
  if (!requestedBranch && user.isSuperAdmin && typeof body.warehouseId === "string" && body.warehouseId) {
    const wh = await db.warehouse.findUnique({ where: { id: body.warehouseId } });
    if (wh) requestedBranch = wh.branchId;
  }
  const branchId = effectiveBranchId(user, requestedBranch);
  const warnings: string[] = [];
  const input = await parseSaleInput(user, body, branchId, warnings);

  const requireApproval = await getSettingBool("require_approval_sales", true);
  const requested = asStr(body.status).toUpperCase();
  const finalStatus =
    requested === "DRAFT"
      ? "DRAFT"
      : requested === "APPROVED"
        ? "APPROVED"
        : !requireApproval
          ? "APPROVED"
          : "PENDING";

  const allowNegative = await getSettingBool("allow_negative_stock", false);

  try {
    const created = await db.$transaction(async (tx) => {
      const number = await nextDocNumber(tx, branchId, "SALE");
      const sale = await tx.sale.create({
        data: {
          localId,
          number,
          branchId,
          customerId: input.customerId,
          warehouseId: input.warehouseId,
          salespersonId: input.salespersonId,
          territoryId: input.territoryId,
          type: input.type,
          invoiceTemplate: input.invoiceTemplate,
          date: input.date,
          currency: input.currency,
          exchangeRate: input.exchangeRate,
          subtotal: input.subtotal,
          discountTotal: input.discountTotal,
          invoiceDiscountType: input.invoiceDiscountType,
          invoiceDiscountValue: input.invoiceDiscountValue,
          invoiceDiscountAmount: input.invoiceDiscountAmount,
          discountReason: input.discountReason,
          promotionId: input.promotionId,
          promotionCode: input.promotionCode,
          promotionDiscountAmount: input.promotionDiscountAmount,
          total: input.total,
          totalAfn: input.totalAfn,
          paidAmount: input.paidAmount,
          status: finalStatus,
          notes: input.notes,
          createdBy: user.id,
          createdByName: user.fullName,
          approvedBy: finalStatus === "APPROVED" ? user.fullName : null,
          approvedAt: finalStatus === "APPROVED" ? new Date() : null,
          items: {
            create: input.items.map((it) => ({
              productId: it.productId,
              batchId: it.batchId,
              quantity: it.quantity,
              freeQuantity: it.freeQuantity,
              promoFreeQuantity: it.promoFreeQuantity,
              unitPrice: it.unitPrice,
              discountType: it.discountType,
              discountPct: it.discountPct,
              discountAmount: it.discountAmount,
              discountReason: it.discountReason,
              promotionId: it.promotionId,
              promoDiscountAmount: it.promoDiscountAmount,
              netUnitPrice: it.netUnitPrice,
              promotionNote: it.promotionNote,
              lineTotal: it.lineTotal,
              lineTotalAfn: it.lineTotalAfn,
            })),
          },
        },
        include: { items: true },
      });

      if (finalStatus === "APPROVED") {
        await applySaleApprovalEffects(
          tx,
          sale,
          sale.items.map((it, i) => ({
            id: it.id,
            productId: it.productId,
            batchId: it.batchId,
            quantity: it.quantity,
            freeQuantity: it.freeQuantity,
            costPrice: input.items[i]?.batchCostPrice ?? 0,
            promotionId: it.promotionId,
            promoFreeQuantity: it.promoFreeQuantity,
            promoDiscountAmount: it.promoDiscountAmount,
          })),
          user,
          allowNegative
        );
      }

      await logAudit(tx, {
        userId: user.id,
        userName: user.fullName,
        branchId,
        action: finalStatus === "APPROVED" ? "APPROVE" : "CREATE",
        entity: "Sale",
        entityId: sale.id,
        summary: `${finalStatus === "APPROVED" ? "ثبت و تصویب" : "ثبت"} فاکتور فروش ${sale.number} به مبلغ ${sale.totalAfn} افغانی`,
        ip,
      });

      return sale;
    });

    const detail = await db.sale.findUnique({ where: { id: created.id }, include: saleDetailInclude });
    return { ...(detail ?? created), warnings };
  } catch (e) {
    if (isUniqueViolation(e)) {
      const dup = await db.sale.findUnique({ where: { localId }, include: saleDetailInclude });
      if (dup) {
        assertBranchAccess(user, dup.branchId);
        return { ...dup, warnings: [] };
      }
      throw new ApiError("فاکتور فروش با این مشخصات قبلاً ثبت شده است", 409, "DUPLICATE");
    }
    throw e;
  }
}

// ─────────────────────────── ویرایش (فقط پیش‌نویس) ───────────────────────────

export async function updateSale(
  user: AuthUser,
  id: string,
  body: Record<string, unknown>,
  ip?: string
): Promise<unknown> {
  requirePermission(user, "sales.edit");

  const existing = await db.sale.findUnique({ where: { id } });
  if (!existing) throw new ApiError("فاکتور فروش یافت نشد", 404, "NOT_FOUND");
  assertBranchAccess(user, existing.branchId);
  if (existing.status !== "DRAFT") {
    throw new ApiError("فقط پیش‌نویس قابل ویرایش است", 422, "INVALID_STATUS");
  }

  const warnings: string[] = [];
  const input = await parseSaleInput(user, body, existing.branchId, warnings);

  await db.$transaction(async (tx) => {
    await tx.saleItem.deleteMany({ where: { saleId: id } });
    await tx.sale.update({
      where: { id },
      data: {
        customerId: input.customerId,
        warehouseId: input.warehouseId,
        salespersonId: input.salespersonId,
        territoryId: input.territoryId,
        type: input.type,
        invoiceTemplate: input.invoiceTemplate,
        date: input.date,
        currency: input.currency,
        exchangeRate: input.exchangeRate,
        subtotal: input.subtotal,
        discountTotal: input.discountTotal,
        invoiceDiscountType: input.invoiceDiscountType,
        invoiceDiscountValue: input.invoiceDiscountValue,
        invoiceDiscountAmount: input.invoiceDiscountAmount,
        discountReason: input.discountReason,
        promotionId: input.promotionId,
        promotionCode: input.promotionCode,
        promotionDiscountAmount: input.promotionDiscountAmount,
        total: input.total,
        totalAfn: input.totalAfn,
        paidAmount: input.paidAmount,
        notes: input.notes,
        items: {
          create: input.items.map((it) => ({
            productId: it.productId,
            batchId: it.batchId,
            quantity: it.quantity,
            freeQuantity: it.freeQuantity,
            promoFreeQuantity: it.promoFreeQuantity,
            unitPrice: it.unitPrice,
            discountType: it.discountType,
            discountPct: it.discountPct,
            discountAmount: it.discountAmount,
            discountReason: it.discountReason,
            promotionId: it.promotionId,
            promoDiscountAmount: it.promoDiscountAmount,
            netUnitPrice: it.netUnitPrice,
            promotionNote: it.promotionNote,
            lineTotal: it.lineTotal,
            lineTotalAfn: it.lineTotalAfn,
          })),
        },
      },
    });
    await logAudit(tx, {
      userId: user.id,
      userName: user.fullName,
      branchId: existing.branchId,
      action: "UPDATE",
      entity: "Sale",
      entityId: id,
      summary: `ویرایش پیش‌نویس فاکتور فروش ${existing.number}`,
      ip,
    });
  });

  const detail = await db.sale.findUnique({ where: { id }, include: saleDetailInclude });
  return { ...(detail ?? {}), warnings };
}

// ─────────────────────────── تصویب ───────────────────────────

export async function approveSale(
  user: AuthUser,
  id: string,
  ip?: string
): Promise<unknown> {
  requirePermission(user, "sales.approve");

  const existing = await db.sale.findUnique({ where: { id } });
  if (!existing) throw new ApiError("فاکتور فروش یافت نشد", 404, "NOT_FOUND");
  assertBranchAccess(user, existing.branchId);

  const allowNegative = await getSettingBool("allow_negative_stock", false);
  const blockExpired = await getSettingBool("block_expired_sales", true);
  const warnDays = await getSettingNum("expiry_warn_days", 90);

  await db.$transaction(async (tx) => {
    const upd = await tx.sale.updateMany({
      where: { id, status: { in: ["DRAFT", "PENDING"] } },
      data: { status: "APPROVED", approvedBy: user.fullName, approvedAt: new Date() },
    });
    if (upd.count === 0) {
      throw new ApiError(
        "فقط فاکتورهای پیش‌نویس یا در انتظار تأیید قابل تصویب هستند",
        422,
        "INVALID_STATUS"
      );
    }
    const doc = await tx.sale.findUnique({
      where: { id },
      include: { items: { include: { batch: true } } },
    });
    if (!doc) throw new ApiError("فاکتور فروش یافت نشد", 404, "NOT_FOUND");

    // چک دوبارهٔ بچ‌های منقضی هنگام تصویب
    if (blockExpired) {
      for (const it of doc.items) {
        if (computeBatchStatus(it.batch?.expiryDate ?? null, warnDays) === "EXPIRED") {
          throw new ApiError(
            "بچ منقضی‌شده قابل فروش نیست؛ فاکتور را ویرایش کنید",
            422,
            "EXPIRED_BATCH"
          );
        }
      }
    }

    await applySaleApprovalEffects(
      tx,
      doc,
      doc.items.map((it) => ({
        id: it.id,
        productId: it.productId,
        batchId: it.batchId,
        quantity: it.quantity,
        freeQuantity: it.freeQuantity,
        costPrice: it.batch?.costPrice ?? 0,
        promotionId: it.promotionId,
        promoFreeQuantity: it.promoFreeQuantity,
        promoDiscountAmount: it.promoDiscountAmount,
      })),
      user,
      allowNegative
    );

    await logAudit(tx, {
      userId: user.id,
      userName: user.fullName,
      branchId: doc.branchId,
      action: "APPROVE",
      entity: "Sale",
      entityId: id,
      summary: `تصویب فاکتور فروش ${doc.number} به مبلغ ${doc.totalAfn} افغانی`,
      ip,
    });
  });

  return getSaleDetail(id);
}

// ─────────────────────────── لغو ───────────────────────────

export async function cancelSale(
  user: AuthUser,
  id: string,
  ip?: string
): Promise<unknown> {
  requirePermission(user, "sales.approve");

  const existing = await db.sale.findUnique({ where: { id } });
  if (!existing) throw new ApiError("فاکتور فروش یافت نشد", 404, "NOT_FOUND");
  assertBranchAccess(user, existing.branchId);

  await db.$transaction(async (tx) => {
    const upd = await tx.sale.updateMany({
      where: { id, status: { in: ["DRAFT", "PENDING"] } },
      data: { status: "CANCELLED" },
    });
    if (upd.count === 0) {
      throw new ApiError(
        "فقط فاکتورهای پیش‌نویس یا در انتظار قابل لغو هستند؛ فاکتور تأییدشده باید با برگشتی مدیریت شود",
        422,
        "INVALID_STATUS"
      );
    }
    await logAudit(tx, {
      userId: user.id,
      userName: user.fullName,
      branchId: existing.branchId,
      action: "CANCEL",
      entity: "Sale",
      entityId: id,
      summary: `لغو فاکتور فروش ${existing.number}`,
      ip,
    });
  });

  return getSaleDetail(id);
}
