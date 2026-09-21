import "server-only";
import type { Promotion } from "@prisma/client";
import { ApiError, round2 } from "./api-utils";
import type { Tx } from "./auth";

/**
 * موتور پروموشن (طرح تشویقی) — کاملاً مستقل از تخفیف
 *
 * - تخفیف (Discount): کاهش مستقیم قیمت در قلم یا فاکتور — در سرویس‌های خرید/فروش
 * - پروموشن (Promotion): طرح تشویقی با شرایط و پاداش (کالای رایگان / درصد / مبلغ / ترکیبی)
 *
 * قواعد محاسبه:
 * - پاداش‌ها همیشه سرورمحور محاسبه و اعتبارسنجی می‌شوند (به کلاینت اعتماد نمی‌شود)
 * - مبالغ پروموشن به افغانی (AFN) تعریف می‌شوند و در سند غیرافغانی با نرخ تبدیل می‌شوند
 * - تعداد رایگان وارد موجودی می‌شود ولی مبلغی بابت آن پرداخت نمی‌شود
 */

export const PROMO_TYPES = ["FREE_QTY", "PERCENT", "AMOUNT", "COMBINED"] as const;
export const PROMO_SCOPES = ["LINE", "INVOICE"] as const;
export type PromoType = (typeof PROMO_TYPES)[number];
export type PromoScope = (typeof PROMO_SCOPES)[number];

export const PROMO_TYPE_LABELS: Record<string, string> = {
  FREE_QTY: "کالای رایگان (خرید X دریافت Y)",
  PERCENT: "پروموشن درصدی",
  AMOUNT: "پروموشن مبلغی",
  COMBINED: "ترکیبی (رایگان + تخفیف)",
};

export const PROMO_SCOPE_LABELS: Record<string, string> = {
  LINE: "هر قلم فاکتور",
  INVOICE: "کل فاکتور",
};

export type PromoStatus = "ACTIVE" | "SCHEDULED" | "EXPIRED" | "INACTIVE";

export const PROMO_STATUS_LABELS: Record<PromoStatus, string> = {
  ACTIVE: "فعال",
  SCHEDULED: "در انتظار شروع",
  EXPIRED: "منقضی‌شده",
  INACTIVE: "غیرفعال",
};

export type PromoWithProducts = Promotion & { products: { productId: string }[] };

/** وضعیت پروموشن در تاریخ مشخص */
export function promoStatus(
  p: { isActive: boolean; startDate: Date; endDate: Date },
  now = new Date()
): PromoStatus {
  if (!p.isActive) return "INACTIVE";
  if (now < p.startDate) return "SCHEDULED";
  if (now > p.endDate) return "EXPIRED";
  return "ACTIVE";
}

/** آیا پروموشن در تاریخ سند قابل استفاده است؟ */
export function isPromoUsableAt(p: { isActive: boolean; startDate: Date; endDate: Date }, date: Date): boolean {
  return p.isActive && date >= p.startDate && date <= p.endDate;
}

/** شرط حداقل خرید (تعداد و/یا مبلغ به افغانی) */
export function meetsCondition(
  p: { minQuantity: number; minAmount: number },
  quantity: number,
  amountAfn: number
): boolean {
  if (p.minQuantity > 0 && round2(quantity) + 0.009 < p.minQuantity) return false;
  if (p.minAmount > 0 && round2(amountAfn) + 0.009 < p.minAmount) return false;
  return true;
}

/** تطبیق محصول با محصولات مشمول طرح */
export function promoProductEligible(p: PromoWithProducts, productId: string): boolean {
  if (p.allProducts) return true;
  return p.products.some((pp) => pp.productId === productId);
}

export type PromoDocContext = {
  docType: "PURCHASE" | "SALE";
  date: Date;
  supplierId?: string | null;
  customerType?: string | null;
};

/** تطبیق سند با طرح (نوع سند، تأمین‌کننده، نوع مشتری) */
export function promoDocEligible(p: Promotion, ctx: PromoDocContext): boolean {
  if (ctx.docType === "PURCHASE" && !p.appliesToPurchase) return false;
  if (ctx.docType === "SALE" && !p.appliesToSale) return false;
  if (ctx.docType === "PURCHASE" && p.supplierId && p.supplierId !== ctx.supplierId) return false;
  if (ctx.docType === "SALE" && p.customerType && p.customerType !== (ctx.customerType ?? "")) {
    return false;
  }
  return true;
}

/** بارگیری پروموشن‌های احتمالاً قابل استفاده برای یک سند (فعال + بازه تاریخ) */
export async function loadUsablePromotions(
  ctx: PromoDocContext
): Promise<PromoWithProducts[]> {
  const { db } = await import("./db");
  const rows = await db.promotion.findMany({
    where: {
      isActive: true,
      startDate: { lte: ctx.date },
      endDate: { gte: ctx.date },
    },
    include: { products: { select: { productId: true } } },
  });
  return rows.filter((p) => promoDocEligible(p, ctx));
}

// ─────────────────────── پاداش‌ها ───────────────────────

export type PromoBenefit = { freeQuantity: number; discountAfn: number };

/** پاداش یک قلم (مبنای درصد/مبلغ: مبلغ ناخالص قلم به افغانی) */
export function computeLineBenefit(p: Promotion, lineGrossAfn: number): PromoBenefit {
  const freeQuantity =
    p.type === "FREE_QTY" || p.type === "COMBINED" ? round2(p.freeQuantity) : 0;
  let discountAfn = 0;
  if (p.type === "PERCENT" || p.type === "COMBINED") {
    if (p.discountPct > 0) {
      discountAfn = round2((lineGrossAfn * p.discountPct) / 100);
    } else if (p.discountAmount > 0) {
      discountAfn = round2(Math.min(p.discountAmount, lineGrossAfn));
    }
  } else if (p.type === "AMOUNT") {
    discountAfn = round2(Math.min(p.discountAmount, lineGrossAfn));
  }
  return { freeQuantity, discountAfn };
}

/** پاداش سطح فاکتور (فقط تخفیف — کالای رایگان فقط در سطح قلم) */
export function computeInvoiceBenefit(p: Promotion, subtotalAfn: number): PromoBenefit {
  let discountAfn = 0;
  if (p.type === "PERCENT" || p.type === "COMBINED") {
    if (p.discountPct > 0) {
      discountAfn = round2((subtotalAfn * p.discountPct) / 100);
    } else if (p.discountAmount > 0) {
      discountAfn = round2(Math.min(p.discountAmount, subtotalAfn));
    }
  } else if (p.type === "AMOUNT") {
    discountAfn = round2(Math.min(p.discountAmount, subtotalAfn));
  }
  return { freeQuantity: 0, discountAfn };
}

// ─────────────────────── اعمال پروموشن روی قلم ───────────────────────

export type LinePromoInput = {
  promotionId: string;
  productId: string;
  quantity: number;
  /** مبلغ ناخالص قلم به افغانی (تعداد × قیمت واحد × نرخ) */
  lineGrossAfn: number;
  /** مبلغ خالص قلم پس از تخفیف کاربر به افغانی (برای شرط حداقل مبلغ) */
  lineNetAfn: number;
};

/**
 * اعتبارسنجی و محاسبه پاداش پروموشن یک قلم — خطاها دری با کد مناسب
 */
export function applyLinePromotion(
  promo: PromoWithProducts | undefined,
  input: LinePromoInput,
  ctx: PromoDocContext
): PromoBenefit {
  const { promotionId, productId, quantity, lineGrossAfn, lineNetAfn } = input;
  if (!promo) {
    throw new ApiError("پروموشن انتخاب‌شده یافت نشد یا غیرفعال است", 422, "PROMO_INVALID");
  }
  if (promo.scope !== "LINE") {
    throw new ApiError(
      `پروموشن «${promo.name}» در سطح کل فاکتور است — آن را در بخش پروموشن فاکتور انتخاب کنید`,
      422,
      "PROMO_SCOPE"
    );
  }
  if (!isPromoUsableAt(promo, ctx.date)) {
    throw new ApiError(
      `پروموشن «${promo.name}» در تاریخ سند فعال نیست`,
      422,
      "PROMO_NOT_ACTIVE"
    );
  }
  if (!promoDocEligible(promo, ctx)) {
    throw new ApiError(
      `پروموشن «${promo.name}» برای این نوع سند/تأمین‌کننده/مشتری قابل استفاده نیست`,
      422,
      "PROMO_NOT_ELIGIBLE"
    );
  }
  if (!promoProductEligible(promo, productId)) {
    throw new ApiError(
      `محصول انتخابی مشمول پروموشن «${promo.name}» نیست`,
      422,
      "PROMO_PRODUCT"
    );
  }
  if (!meetsCondition(promo, quantity, lineNetAfn)) {
    const parts: string[] = [];
    if (promo.minQuantity > 0) parts.push(`حداقل تعداد ${promo.minQuantity}`);
    if (promo.minAmount > 0) parts.push(`حداقل مبلغ ${round2(promo.minAmount)} افغانی`);
    throw new ApiError(
      `شرایط پروموشن «${promo.name}» برآورده نشد (${parts.join(" و ")})`,
      422,
      "PROMO_CONDITION"
    );
  }
  return computeLineBenefit(promo, lineGrossAfn);
}

// ─────────────────────── اعتبارسنجی پروموشن فاکتور ───────────────────────

export type InvoicePromoInput = {
  promotionId: string;
  /** جمع خالص فاکتور پس از تخفیف سطح فاکتور کاربر، به افغانی */
  subtotalAfn: number;
  /** مجموع تعداد اقلام مشمول طرح (برای شرط حداقل تعداد) */
  eligibleQuantity: number;
};

export function applyInvoicePromotion(
  promo: PromoWithProducts | undefined,
  input: InvoicePromoInput,
  ctx: PromoDocContext
): PromoBenefit {
  const { promotionId, subtotalAfn, eligibleQuantity } = input;
  if (!promo) {
    throw new ApiError("پروموشن فاکتور یافت نشد یا غیرفعال است", 422, "PROMO_INVALID");
  }
  if (promo.scope !== "INVOICE") {
    throw new ApiError(
      `پروموشن «${promo.name}» در سطح قلم است — آن را روی اقلام اعمال کنید`,
      422,
      "PROMO_SCOPE"
    );
  }
  if (promo.type === "FREE_QTY") {
    throw new ApiError(
      "کالای رایگان در سطح فاکتور قابل اعمال نیست — دامنه طرح باید «هر قلم» باشد",
      422,
      "PROMO_SCOPE"
    );
  }
  if (!isPromoUsableAt(promo, ctx.date)) {
    throw new ApiError(
      `پروموشن «${promo.name}» در تاریخ سند فعال نیست`,
      422,
      "PROMO_NOT_ACTIVE"
    );
  }
  if (!promoDocEligible(promo, ctx)) {
    throw new ApiError(
      `پروموشن «${promo.name}» برای این نوع سند/تأمین‌کننده/مشتری قابل استفاده نیست`,
      422,
      "PROMO_NOT_ELIGIBLE"
    );
  }
  if (!meetsCondition(promo, eligibleQuantity, subtotalAfn)) {
    const parts: string[] = [];
    if (promo.minQuantity > 0) parts.push(`حداقل تعداد ${promo.minQuantity}`);
    if (promo.minAmount > 0) parts.push(`حداقل مبلغ ${round2(promo.minAmount)} افغانی`);
    throw new ApiError(
      `شرایط پروموشن «${promo.name}» برآورده نشد (${parts.join(" و ")})`,
      422,
      "PROMO_CONDITION"
    );
  }
  return computeInvoiceBenefit(promo, subtotalAfn);
}

// ─────────────────────── ثبت استفاده (هنگام تصویب) ───────────────────────

export type UsageItemInput = {
  promotionId?: string | null;
  productId: string;
  quantity: number;
  promoFreeQuantity?: number;
  /** تخفیف پروموشن قلم به اسعار سند */
  promoDiscountAmount?: number;
  /** بهای هر واحد به افغانی (effectiveCost در خرید / costAtSale در فروش) برای ارزش کالای رایگان */
  unitCostAfn?: number;
};

/**
 * ثبت استفاده از پروموشن‌های یک سند (داخل تراکنش تصویب)
 * - یک رکورد برای هر قلم دارای پروموشن (scope=LINE)
 * - یک رکورد برای پروموشن سطح فاکتور (scope=INVOICE)
 * - شمارنده usageCount هر طرح افزایش می‌یابد
 */
export async function recordDocPromotionUsage(
  tx: Tx,
  docType: "PURCHASE" | "SALE",
  doc: {
    id: string;
    number: string;
    branchId: string;
    exchangeRate: number;
    promotionId?: string | null;
    promotionDiscountAmount?: number;
  },
  items: UsageItemInput[]
): Promise<void> {
  const linePromoIds = [
    ...new Set(items.map((i) => i.promotionId).filter((x): x is string => !!x)),
  ];
  const invoicePromoId = doc.promotionId ?? null;
  const allIds = [...new Set([...linePromoIds, ...(invoicePromoId ? [invoicePromoId] : [])])];
  if (allIds.length === 0) return;

  const productIds = [...new Set(items.filter((i) => i.promotionId).map((i) => i.productId))];
  const products = productIds.length
    ? await tx.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } })
    : [];
  const nameMap = new Map(products.map((p) => [p.id, p.name]));

  for (const it of items) {
    if (!it.promotionId) continue;
    const freeQty = round2(it.promoFreeQuantity ?? 0);
    const discDoc = round2(it.promoDiscountAmount ?? 0);
    if (freeQty <= 0 && discDoc <= 0) continue;
    await tx.promotionUsage.create({
      data: {
        promotionId: it.promotionId,
        docType,
        docId: doc.id,
        docNumber: doc.number,
        branchId: doc.branchId,
        scope: "LINE",
        productId: it.productId,
        productName: nameMap.get(it.productId) ?? null,
        quantity: round2(it.quantity),
        freeQuantity: freeQty,
        freeValueAfn: round2((it.unitCostAfn ?? 0) * freeQty),
        discountAfn: round2(discDoc * doc.exchangeRate),
      },
    });
    await tx.promotion.update({
      where: { id: it.promotionId },
      data: { usageCount: { increment: 1 } },
    });
  }

  if (invoicePromoId && round2(doc.promotionDiscountAmount ?? 0) > 0) {
    await tx.promotionUsage.create({
      data: {
        promotionId: invoicePromoId,
        docType,
        docId: doc.id,
        docNumber: doc.number,
        branchId: doc.branchId,
        scope: "INVOICE",
        quantity: 0,
        freeQuantity: 0,
        freeValueAfn: 0,
        discountAfn: round2(round2(doc.promotionDiscountAmount ?? 0) * doc.exchangeRate),
      },
    });
    await tx.promotion.update({
      where: { id: invoicePromoId },
      data: { usageCount: { increment: 1 } },
    });
  }
}

// ─────────────────────── سقف تخفیف (تنظیم سیستم) ───────────────────────

/**
 * بررسی سقف درصد تخفیف مجاز برای کاربران عادی
 * - سوپرادمین همیشه مجاز است
 * - کلید تنظیم: max_discount_percent (پیش‌فرض 100 = بدون محدودیت)
 */
export function assertDiscountWithinLimit(
  user: { isSuperAdmin: boolean },
  pct: number,
  maxPct: number,
  label = "تخفیف"
): void {
  if (user.isSuperAdmin) return;
  if (maxPct >= 100) return;
  if (pct > maxPct + 0.009) {
    throw new ApiError(
      `${label} بیش از حد مجاز است — حداکثر درصد تخفیف مجاز برای شما ${maxPct}٪ است`,
      422,
      "DISCOUNT_LIMIT"
    );
  }
}
