import { randomUUID } from "crypto";
import type { Purchase, PurchaseItem } from "@prisma/client";
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
  allocExtraCost,
  applyStockMovement,
  createBatchIfMissing,
  getSettingBool,
  getSettingNum,
  logAudit,
  nextDocNumber,
  recalcPurchaseStatus,
  recalcSupplierBalance,
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
const PURCHASE_TYPES = ["LOCAL", "IMPORT", "FOREIGN"];
const EXTRA_BASES = ["VALUE", "QTY"];

// ─────────────────────────── انواع داخلی ───────────────────────────

type ComputedItem = {
  productId: string;
  batchNumber: string;
  mfgDate: Date | null;
  expiryDate: Date | null;
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
  effectiveCost: number;
};

type ComputedPurchase = {
  supplierId: string;
  warehouseId: string;
  type: string;
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
  extraCost: number;
  extraCostBasis: string;
  total: number;
  totalAfn: number;
  paidAmount: number;
  notes: string | null;
  items: ComputedItem[];
};

const itemProductSelect = { select: { id: true, name: true, unit: true } } as const;
const itemBatchSelect = {
  select: { id: true, batchNumber: true, expiryDate: true, costPrice: true },
} as const;

const purchaseDetailInclude = {
  items: { include: { product: itemProductSelect, batch: itemBatchSelect } },
  supplier: { select: { id: true, name: true, type: true, phone: true, email: true } },
  warehouse: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true, code: true } },
  payments: { orderBy: { date: "desc" as const } },
  returns: { include: { items: true }, orderBy: { date: "desc" as const } },
} as const;

// ─────────────────────────── اعتبارسنجی و محاسبه ورودی ───────────────────────────

async function parsePurchaseInput(
  user: AuthUser,
  body: Record<string, unknown>,
  branchId: string
): Promise<ComputedPurchase> {
  // تأمین‌کننده
  const supplierId = asStr(body.supplierId);
  if (!supplierId) throw new ApiError("انتخاب تأمین‌کننده الزامی است", 422, "VALIDATION");
  const supplier = await db.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) throw new ApiError("تأمین‌کننده یافت نشد", 422, "VALIDATION");

  // گدام — باید در شعبه مؤثر کاربر باشد
  const warehouseId = asStr(body.warehouseId);
  if (!warehouseId) throw new ApiError("انتخاب گدام الزامی است", 422, "VALIDATION");
  const warehouse = await db.warehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse) throw new ApiError("گدام یافت نشد", 422, "VALIDATION");
  assertBranchAccess(user, warehouse.branchId);
  if (warehouse.branchId !== branchId) {
    throw new ApiError("گدام انتخاب‌شده متعلق به شعبه سند نیست", 422, "VALIDATION");
  }

  // نوع خرید
  const type = asStr(body.type).toUpperCase() || "LOCAL";
  if (!PURCHASE_TYPES.includes(type)) {
    throw new ApiError("نوع خرید باید محلی، وارداتی یا بیگانه باشد", 422, "VALIDATION");
  }

  const date = parseDate(body.date) ?? new Date();

  // اسعار و نرخ تبدیل
  const currency = asStr(body.currency).toUpperCase() || "AFN";
  if (!CURRENCIES.includes(currency)) {
    throw new ApiError("اسعار باید افغانی، دالر یا کلدار باشد", 422, "VALIDATION");
  }
  let exchangeRate = round4(toNum(body.exchangeRate, 1));
  if (currency === "AFN") exchangeRate = 1;
  if (exchangeRate <= 0) {
    throw new ApiError("نرخ تبدیل باید بزرگ‌تر از صفر باشد", 422, "VALIDATION");
  }

  // مصارف اضافی
  const extraCost = round2(toNum(body.extraCost, 0));
  if (extraCost < 0) throw new ApiError("مصارف اضافی نمی‌تواند منفی باشد", 422, "VALIDATION");
  const extraCostBasis = asStr(body.extraCostBasis).toUpperCase() || "VALUE";
  if (!EXTRA_BASES.includes(extraCostBasis)) {
    throw new ApiError("مبنای توزیع مصارف باید مبلغ یا تعداد باشد", 422, "VALIDATION");
  }

  // پرداخت اولیه (همیشه به افغانی)
  const paidAmount = round2(toNum(body.paidAmount, 0));
  if (paidAmount < 0) throw new ApiError("مبلغ پرداختی نمی‌تواند منفی باشد", 422, "VALIDATION");

  const notes = asStr(body.notes) || null;

  // سقف درصد تخفیف مجاز برای کاربران عادی (تنظیم سیستم)
  const maxDiscountPct = await getSettingNum("max_discount_percent", 100);

  // اقلام
  const rawItems = body.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new ApiError("حداقل یک قلم فاکتور الزامی است", 422, "VALIDATION");
  }

  const productIds = [
    ...new Set(
      rawItems
        .map((r) => asStr((r as Record<string, unknown>).productId))
        .filter((s) => s.length > 0)
    ),
  ];
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true },
  });
  const productMap = new Map(products.map((p) => [p.id, p.name]));

  type DraftItem = Omit<ComputedItem, "effectiveCost">;
  const drafts: DraftItem[] = [];

  for (let idx = 0; idx < rawItems.length; idx++) {
    const rec = (rawItems[idx] ?? {}) as Record<string, unknown>;
    const productId = asStr(rec.productId);
    if (!productId) {
      throw new ApiError(`انتخاب محصول برای قلم ${idx + 1} الزامی است`, 422, "VALIDATION");
    }
    if (!productMap.has(productId)) {
      throw new ApiError(`محصول قلم ${idx + 1} یافت نشد`, 422, "VALIDATION");
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
    // تخفیف کاربر — نوع ورودی (PERCENT/AMOUNT) + دلیل
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

    // netUnitPrice = unitPrice × (1 − discountPct/100) − (discountAmount / quantity)
    const netUnitPrice = round2(
      unitPrice * (1 - discountPct / 100) - (quantity > 0 ? discountAmount / quantity : 0)
    );
    const lineTotal = round2(quantity * netUnitPrice);
    const lineTotalAfn = round2(lineTotal * exchangeRate);

    drafts.push({
      productId,
      batchNumber: asStr(rec.batchNumber) || "بدون-بچ",
      mfgDate: parseDate(rec.mfgDate) ?? null,
      expiryDate: parseDate(rec.expiryDate) ?? null,
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
    });
  }

  // ─── پروموشن‌های قابل استفاده برای این سند ───
  const promoCtx = { docType: "PURCHASE" as const, date, supplierId };
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

  // توزیع مصارف اضافی + تخفیف سطح فاکتور بین اقلام (برای بهای مؤثر درست)
  const extraCostAfn = round2(extraCost * exchangeRate);
  const invoiceDiscountsAfn = round2(
    (invoiceDiscountAmount + promotionDiscountAmount) * exchangeRate
  );
  const weightItems = promoItems.map((it) => ({
    lineTotalAfn: it.lineTotalAfn,
    quantity: round2(it.quantity + it.freeQuantity),
  }));
  const allocs = allocExtraCost(extraCostAfn, weightItems, extraCostBasis === "QTY" ? "QTY" : "VALUE");
  const invoiceAllocs = allocExtraCost(invoiceDiscountsAfn, weightItems, "VALUE");

  const items: ComputedItem[] = promoItems.map((it, i) => ({
    ...it,
    // بهای مؤثر = (مبلغ قلم − سهم تخفیف فاکتور + سهم مصارف اضافی) ÷ (تعداد + تعداد مجانی)
    effectiveCost:
      it.quantity + it.freeQuantity > 0
        ? round2(
            (it.lineTotalAfn - (invoiceAllocs[i] ?? 0) + (allocs[i] ?? 0)) /
              (it.quantity + it.freeQuantity)
          )
        : 0,
  }));

  const total = round2(subtotal - invoiceDiscountAmount - promotionDiscountAmount + extraCost);
  const totalAfn = round2(total * exchangeRate);

  return {
    supplierId,
    warehouseId,
    type,
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
    extraCost,
    extraCostBasis,
    total,
    totalAfn,
    paidAmount,
    notes,
    items,
  };
}

// ─────────────────────────── عواید تصویب (داخل تراکنش) ───────────────────────────

export async function applyPurchaseApprovalEffects(
  tx: Tx,
  purchase: Purchase & { items: PurchaseItem[] },
  user: AuthUser
): Promise<void> {
  for (const it of purchase.items) {
    const batch = await createBatchIfMissing(tx, {
      productId: it.productId,
      batchNumber: it.batchNumber,
      mfgDate: it.mfgDate,
      expiryDate: it.expiryDate,
      costPrice: it.effectiveCost,
      purchaseId: purchase.id,
    });
    // ورود موجودی شامل تعداد مجانی
    await applyStockMovement(tx, {
      type: "IN",
      toWarehouseId: purchase.warehouseId,
      productId: it.productId,
      batchId: batch.id,
      quantity: round2(it.quantity + it.freeQuantity),
      referenceType: "PURCHASE",
      referenceId: purchase.id,
      userId: user.id,
      userName: user.fullName,
      branchId: purchase.branchId,
    });
    await tx.purchaseItem.update({ where: { id: it.id }, data: { batchId: batch.id } });
  }

  // ثبت استفاده از پروموشن‌ها (کالای رایگان + تخفیف پروموشن) — فقط هنگام تصویب
  await recordDocPromotionUsage(
    tx,
    "PURCHASE",
    purchase,
    purchase.items.map((it) => ({
      promotionId: it.promotionId,
      productId: it.productId,
      quantity: it.quantity,
      promoFreeQuantity: it.promoFreeQuantity,
      promoDiscountAmount: it.promoDiscountAmount,
      unitCostAfn: it.effectiveCost,
    }))
  );

  // ثبت پرداخت اولیه در صورت وجود
  if (purchase.paidAmount > 0) {
    const payNumber = await nextDocNumber(tx, purchase.branchId, "PAYMENT");
    await tx.payment.create({
      data: {
        localId: randomUUID(),
        number: payNumber,
        type: "SUPPLIER",
        direction: "OUT",
        branchId: purchase.branchId,
        supplierId: purchase.supplierId,
        purchaseId: purchase.id,
        amount: round2(purchase.paidAmount),
        currency: purchase.currency,
        exchangeRate: purchase.exchangeRate,
        method: "CASH",
        date: purchase.date,
        createdBy: user.id,
        createdByName: user.fullName,
        status: "COMPLETED",
      },
    });
  }

  await recalcSupplierBalance(tx, purchase.supplierId);
  await recalcPurchaseStatus(tx, purchase.id);
}

// ─────────────────────────── خواندن ───────────────────────────

export async function getPurchaseDetail(id: string): Promise<unknown> {
  const purchase = await db.purchase.findUnique({
    where: { id },
    include: purchaseDetailInclude,
  });
  if (!purchase) throw new ApiError("فاکتور خرید یافت نشد", 404, "NOT_FOUND");
  return purchase;
}

// ─────────────────────────── ایجاد ───────────────────────────

export async function createPurchase(
  user: AuthUser,
  body: Record<string, unknown>,
  ip?: string
): Promise<unknown> {
  requirePermission(user, "purchases.create");

  // خاصیت idempotency: اگر localId تکراری باشد همان سند موجود برگردانده می‌شود
  const localId = asStr(body.localId) || randomUUID();
  const existing = await db.purchase.findUnique({
    where: { localId },
    include: purchaseDetailInclude,
  });
  if (existing) {
    assertBranchAccess(user, existing.branchId);
    return existing;
  }

  // برای سوپرادمین بدون شعبهٔ صریح، شعبهٔ سند از گدام انتخاب‌شده استخراج می‌شود
  let requestedBranch = typeof body.branchId === "string" ? body.branchId : null;
  if (!requestedBranch && user.isSuperAdmin && typeof body.warehouseId === "string" && body.warehouseId) {
    const wh = await db.warehouse.findUnique({ where: { id: body.warehouseId } });
    if (wh) requestedBranch = wh.branchId;
  }
  const branchId = effectiveBranchId(user, requestedBranch);
  const input = await parsePurchaseInput(user, body, branchId);

  const requireApproval = await getSettingBool("require_approval_purchases", true);
  const requested = asStr(body.status).toUpperCase();
  const finalStatus =
    requested === "DRAFT"
      ? "DRAFT"
      : requested === "APPROVED"
        ? "APPROVED"
        : !requireApproval
          ? "APPROVED"
          : "PENDING";

  try {
    const created = await db.$transaction(async (tx) => {
      const number = await nextDocNumber(tx, branchId, "PURCHASE");
      const purchase = await tx.purchase.create({
        data: {
          localId,
          number,
          branchId,
          supplierId: input.supplierId,
          warehouseId: input.warehouseId,
          type: input.type,
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
          extraCost: input.extraCost,
          extraCostBasis: input.extraCostBasis,
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
              batchNumber: it.batchNumber,
              mfgDate: it.mfgDate,
              expiryDate: it.expiryDate,
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
              effectiveCost: it.effectiveCost,
              promotionNote: it.promotionNote,
              lineTotal: it.lineTotal,
              lineTotalAfn: it.lineTotalAfn,
            })),
          },
        },
        include: { items: true },
      });

      if (finalStatus === "APPROVED") {
        await applyPurchaseApprovalEffects(tx, purchase, user);
      }

      await logAudit(tx, {
        userId: user.id,
        userName: user.fullName,
        branchId,
        action: finalStatus === "APPROVED" ? "APPROVE" : "CREATE",
        entity: "Purchase",
        entityId: purchase.id,
        summary: `${finalStatus === "APPROVED" ? "ثبت و تصویب" : "ثبت"} فاکتور خرید ${purchase.number} به مبلغ ${purchase.totalAfn} افغانی`,
        ip,
      });

      return purchase;
    });

    return await getPurchaseDetail(created.id);
  } catch (e) {
    if (isUniqueViolation(e)) {
      const dup = await db.purchase.findUnique({
        where: { localId },
        include: purchaseDetailInclude,
      });
      if (dup) {
        assertBranchAccess(user, dup.branchId);
        return dup;
      }
      throw new ApiError("فاکتور خرید با این مشخصات قبلاً ثبت شده است", 409, "DUPLICATE");
    }
    throw e;
  }
}

// ─────────────────────────── ویرایش (فقط پیش‌نویس) ───────────────────────────

export async function updatePurchase(
  user: AuthUser,
  id: string,
  body: Record<string, unknown>,
  ip?: string
): Promise<unknown> {
  requirePermission(user, "purchases.edit");

  const existing = await db.purchase.findUnique({ where: { id } });
  if (!existing) throw new ApiError("فاکتور خرید یافت نشد", 404, "NOT_FOUND");
  assertBranchAccess(user, existing.branchId);
  if (existing.status !== "DRAFT") {
    throw new ApiError("فقط پیش‌نویس قابل ویرایش است", 422, "INVALID_STATUS");
  }

  const input = await parsePurchaseInput(user, body, existing.branchId);

  await db.$transaction(async (tx) => {
    await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
    await tx.purchase.update({
      where: { id },
      data: {
        supplierId: input.supplierId,
        warehouseId: input.warehouseId,
        type: input.type,
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
        extraCost: input.extraCost,
        extraCostBasis: input.extraCostBasis,
        total: input.total,
        totalAfn: input.totalAfn,
        paidAmount: input.paidAmount,
        notes: input.notes,
        items: {
          create: input.items.map((it) => ({
            productId: it.productId,
            batchNumber: it.batchNumber,
            mfgDate: it.mfgDate,
            expiryDate: it.expiryDate,
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
            effectiveCost: it.effectiveCost,
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
      entity: "Purchase",
      entityId: id,
      summary: `ویرایش پیش‌نویس فاکتور خرید ${existing.number}`,
      ip,
    });
  });

  return getPurchaseDetail(id);
}

// ─────────────────────────── تصویب ───────────────────────────

export async function approvePurchase(
  user: AuthUser,
  id: string,
  ip?: string
): Promise<unknown> {
  requirePermission(user, "purchases.approve");

  const existing = await db.purchase.findUnique({ where: { id } });
  if (!existing) throw new ApiError("فاکتور خرید یافت نشد", 404, "NOT_FOUND");
  assertBranchAccess(user, existing.branchId);

  await db.$transaction(async (tx) => {
    const upd = await tx.purchase.updateMany({
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
    const doc = await tx.purchase.findUnique({ where: { id }, include: { items: true } });
    if (!doc) throw new ApiError("فاکتور خرید یافت نشد", 404, "NOT_FOUND");

    await applyPurchaseApprovalEffects(tx, doc, user);

    await logAudit(tx, {
      userId: user.id,
      userName: user.fullName,
      branchId: doc.branchId,
      action: "APPROVE",
      entity: "Purchase",
      entityId: id,
      summary: `تصویب فاکتور خرید ${doc.number} به مبلغ ${doc.totalAfn} افغانی`,
      ip,
    });
  });

  return getPurchaseDetail(id);
}

// ─────────────────────────── لغو ───────────────────────────

export async function cancelPurchase(
  user: AuthUser,
  id: string,
  ip?: string
): Promise<unknown> {
  requirePermission(user, "purchases.approve");

  const existing = await db.purchase.findUnique({ where: { id } });
  if (!existing) throw new ApiError("فاکتور خرید یافت نشد", 404, "NOT_FOUND");
  assertBranchAccess(user, existing.branchId);

  await db.$transaction(async (tx) => {
    const upd = await tx.purchase.updateMany({
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
      entity: "Purchase",
      entityId: id,
      summary: `لغو فاکتور خرید ${existing.number}`,
      ip,
    });
  });

  return getPurchaseDetail(id);
}
