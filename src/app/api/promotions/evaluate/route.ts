import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handleApiError, ok, parseDate, round2, toNum } from "@/lib/api-utils";
import { requireUser } from "@/lib/auth";
import {
  computeInvoiceBenefit,
  computeLineBenefit,
  isPromoUsableAt,
  loadUsablePromotions,
  meetsCondition,
  promoDocEligible,
  promoProductEligible,
  type PromoDocContext,
  type PromoWithProducts,
} from "@/lib/promotion";

/**
 * POST /api/promotions/evaluate
 * پیشنهاد پروموشن‌های قابل اعمال برای سبد اقلام — پیش از ثبت فاکتور
 * بدنه: { docType: "SALE"|"PURCHASE", date?, supplierId?, customerId?,
 *          items: [{productId, quantity, unitPrice, discountPct?, discountAmount?}] }
 *
 * خروجی برای هر قلم شامل:
 * - options: پروموشن‌های واجد شرایط (قابل اعمال فوری)
 * - unavailable: پروموشن‌های مشمول محصول ولی نامعتبر با دلیل (برای نمایش در انتخاب‌کننده)
 */
export async function POST(req: NextRequest) {
  try {
    await requireUser();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const docType = String(body.docType ?? "").toUpperCase() === "PURCHASE" ? "PURCHASE" : "SALE";
    const date = parseDate(body.date) ?? new Date();

    const supplierId =
      typeof body.supplierId === "string" && body.supplierId.trim() ? body.supplierId.trim() : null;
    const customerId =
      typeof body.customerId === "string" && body.customerId.trim() ? body.customerId.trim() : null;

    let customerType: string | null = null;
    if (docType === "SALE" && customerId) {
      const customer = await db.customer.findUnique({
        where: { id: customerId },
        select: { type: true },
      });
      customerType = customer?.type ?? null;
    }

    const ctx: PromoDocContext = { docType, date, supplierId, customerType };
    const usable = await loadUsablePromotions(ctx);

    const rawItems = Array.isArray(body.items) ? body.items : [];
    type EvalItem = {
      productId: string;
      quantity: number;
      unitPrice: number;
      discountPct: number;
      discountAmount: number;
    };
    const items: EvalItem[] = rawItems.map((r) => {
      const rec = (r ?? {}) as Record<string, unknown>;
      return {
        productId: String(rec.productId ?? "").trim(),
        quantity: round2(toNum(rec.quantity, 0)),
        unitPrice: round2(toNum(rec.unitPrice, 0)),
        discountPct: round2(toNum(rec.discountPct, 0)),
        discountAmount: round2(toNum(rec.discountAmount, 0)),
      };
    });

    const productIds = [...new Set(items.map((i) => i.productId).filter(Boolean))];
    const products = productIds.length
      ? await db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } })
      : [];
    const nameMap = new Map(products.map((p) => [p.id, p.name]));

    /** دلیل نامعتبر بودن یک طرح برای قلم/فاکتور فعلی */
    const whyNot = (
      p: PromoWithProducts,
      quantity: number,
      netAfn: number
    ): string | null => {
      if (!isPromoUsableAt(p, date)) return "در تاریخ سند فعال نیست";
      if (!promoDocEligible(p, ctx)) {
        if (docType === "PURCHASE" && !p.appliesToPurchase) return "برای خرید فعال نشده است";
        if (docType === "SALE" && !p.appliesToSale) return "برای فروش فعال نشده است";
        if (docType === "PURCHASE" && p.supplierId && p.supplierId !== supplierId)
          return "مخصوص تأمین‌کننده دیگری است";
        if (docType === "SALE" && p.customerType && p.customerType !== (customerType ?? ""))
          return "مخصوص نوع مشتری دیگری است";
        return "برای این سند قابل استفاده نیست";
      }
      if (!meetsCondition(p, quantity, netAfn)) {
        const parts: string[] = [];
        if (p.minQuantity > 0) parts.push(`حداقل ${p.minQuantity} عدد`);
        if (p.minAmount > 0) parts.push(`حداقل ${round2(p.minAmount)} افغانی`);
        return `شرط خرید: ${parts.join(" و ")}`;
      }
      return null;
    };

    const itemSuggestions = items.map((it, index) => {
      const grossAfn = round2(it.quantity * it.unitPrice);
      const netAfn = round2(grossAfn * (1 - it.discountPct / 100) - it.discountAmount);
      const candidates = usable
        .filter((p) => p.scope === "LINE")
        .filter((p) => promoProductEligible(p, it.productId));

      const options = candidates
        .filter((p) => whyNot(p, it.quantity, netAfn) === null)
        .map((p: PromoWithProducts) => {
          const benefit = computeLineBenefit(p, grossAfn);
          return {
            promotionId: p.id,
            code: p.code,
            name: p.name,
            type: p.type,
            scope: p.scope,
            freeQuantity: benefit.freeQuantity,
            discountAfn: benefit.discountAfn,
            estimatedValueAfn: round2(benefit.freeQuantity * it.unitPrice + benefit.discountAfn),
            eligible: true as const,
          };
        })
        .sort((a, b) => b.estimatedValueAfn - a.estimatedValueAfn);

      const unavailable = candidates
        .map((p: PromoWithProducts) => {
          const reason = whyNot(p, it.quantity, netAfn);
          if (!reason) return null;
          const benefit = computeLineBenefit(p, grossAfn);
          return {
            promotionId: p.id,
            code: p.code,
            name: p.name,
            type: p.type,
            scope: p.scope,
            freeQuantity: benefit.freeQuantity,
            discountAfn: benefit.discountAfn,
            estimatedValueAfn: round2(benefit.freeQuantity * it.unitPrice + benefit.discountAfn),
            eligible: false as const,
            reason,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .sort((a, b) => b.estimatedValueAfn - a.estimatedValueAfn);

      return {
        index,
        productId: it.productId,
        productName: nameMap.get(it.productId) ?? null,
        options,
        unavailable,
      };
    });

    // پروموشن‌های سطح فاکتور
    const subtotalAfn = round2(
      items.reduce(
        (a, it) => a + it.quantity * it.unitPrice * (1 - it.discountPct / 100) - it.discountAmount,
        0
      )
    );
    const invoiceCandidates = usable.filter((p) => p.scope === "INVOICE" && p.type !== "FREE_QTY");
    const invoiceOptions = invoiceCandidates
      .filter((p) => {
        const eligibleQty = items
          .filter((it) => promoProductEligible(p, it.productId))
          .reduce((a, it) => a + it.quantity, 0);
        return whyNot(p, eligibleQty, subtotalAfn) === null;
      })
      .map((p: PromoWithProducts) => {
        const benefit = computeInvoiceBenefit(p, subtotalAfn);
        return {
          promotionId: p.id,
          code: p.code,
          name: p.name,
          type: p.type,
          scope: p.scope,
          discountAfn: benefit.discountAfn,
          eligible: true as const,
        };
      })
      .sort((a, b) => b.discountAfn - a.discountAfn);

    const invoiceUnavailable = invoiceCandidates
      .map((p: PromoWithProducts) => {
        const eligibleQty = items
          .filter((it) => promoProductEligible(p, it.productId))
          .reduce((a, it) => a + it.quantity, 0);
        const reason = whyNot(p, eligibleQty, subtotalAfn);
        if (!reason) return null;
        const benefit = computeInvoiceBenefit(p, subtotalAfn);
        return {
          promotionId: p.id,
          code: p.code,
          name: p.name,
          type: p.type,
          scope: p.scope,
          discountAfn: benefit.discountAfn,
          eligible: false as const,
          reason,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.discountAfn - a.discountAfn);

    const activeCount = usable.filter((p) => isPromoUsableAt(p, date)).length;

    return ok({
      docType,
      date,
      items: itemSuggestions,
      invoice: { options: invoiceOptions, unavailable: invoiceUnavailable },
      stats: { usablePromotions: activeCount },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
