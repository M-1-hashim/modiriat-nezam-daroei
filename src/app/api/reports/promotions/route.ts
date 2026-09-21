import { db } from "@/lib/db";
import { ApiError, handleApiError, ok, round2 } from "@/lib/api-utils";
import { requireUser } from "@/lib/auth";
import {
  PROMO_SCOPE_LABELS,
  PROMO_TYPE_LABELS,
  promoStatus,
  type PromoStatus,
} from "@/lib/promotion";
import { resolveBranchIds, resolveRange, reportDayKey, reportDayLabel } from "../_util";

/**
 * راپور تخفیف‌ها و طرح‌های تشویقی — دو مفهوم مستقل اما در یک راپور مرکزی
 *
 * section:
 * - summary      : خلاصه کل (تخفیف صادرشده، تخفیف تأمین‌کننده، ارزش کالای رایگان، تأثیر بر منفعت)
 * - byDay        : تخفیف‌های فروش بر اساس روز (تقویم کابل)
 * - byProduct    : بر اساس محصول (تخفیف به مشتریان در برابر تخفیف از تأمین‌کنندگان)
 * - byCustomer   : بر اساس مشتری (تخفیف‌های فروش)
 * - bySupplier   : بر اساس تأمین‌کننده (تخفیف‌های خرید)
 * - byPromotion  : استفاده از هر طرح (از PromotionUsage)
 * - promotions   : فهرست طرح‌ها با وضعیت (فعال/در انتظار/منقضی/غیرفعال)
 *
 * قواعد محاسبه:
 * - تخفیف قلم کاربر (سند) = تعداد×قیمت − lineTotal − promoDiscountAmount
 * - تخفیف پروموشن قلم = promoDiscountAmount (سرورمحور ثبت می‌شود)
 * - مجموع تخفیف سند (سند) = discountTotal + invoiceDiscountAmount + promotionDiscountAmount
 * - ارزش کالای رایگان = promoFreeQuantity × (costAtSale در فروش | effectiveCost در خرید) به افغانی
 * - تأثیر منفعت: فروش → منفی (عاید از دست رفته)، خرید → مثبت (مصارف ذخیره‌شده)
 */

const SECTIONS = [
  "summary",
  "byDay",
  "byProduct",
  "byCustomer",
  "bySupplier",
  "byPromotion",
  "promotions",
] as const;
type Section = (typeof SECTIONS)[number];

export type PromoReportRow = {
  key: string;
  label: string;
  count: number;
  quantity?: number;
  totalAfn?: number;
  costAfn?: number;
  profitAfn?: number;
  docsCount?: number;
};

type Agg = {
  userItemAfn: number;
  invoiceAfn: number;
  promoLineAfn: number;
  promoInvoiceAfn: number;
  freeUnits: number;
  freeValueAfn: number;
};

function emptyAgg(): Agg {
  return {
    userItemAfn: 0,
    invoiceAfn: 0,
    promoLineAfn: 0,
    promoInvoiceAfn: 0,
    freeUnits: 0,
    freeValueAfn: 0,
  };
}

type ItemLike = {
  quantity: number;
  promoFreeQuantity: number;
  unitPrice: number;
  lineTotal: number;
  promoDiscountAmount: number;
  unitCostAfn: number;
};

type Counters = { itemsDisc: number; itemsPromo: number; freeItems: number };

function aggItem(acc: Agg, it: ItemLike, rate: number, counters: Counters): void {
  const gross = it.quantity * it.unitPrice;
  const promoDisc = it.promoDiscountAmount > 0 ? it.promoDiscountAmount : 0;
  const userDisc = gross - it.lineTotal - promoDisc;
  if (userDisc > 0.009) {
    acc.userItemAfn += userDisc * rate;
    counters.itemsDisc += 1;
  }
  if (promoDisc > 0.009) {
    acc.promoLineAfn += promoDisc * rate;
    counters.itemsPromo += 1;
  }
  if (it.promoFreeQuantity > 0.009) {
    counters.freeItems += 1;
    acc.freeUnits += it.promoFreeQuantity;
    acc.freeValueAfn += it.promoFreeQuantity * it.unitCostAfn;
  }
}

function aggDoc(
  acc: Agg,
  doc: { invoiceDiscountAmount: number; promotionDiscountAmount: number },
  rate: number
): void {
  if (doc.invoiceDiscountAmount > 0.009) acc.invoiceAfn += doc.invoiceDiscountAmount * rate;
  if (doc.promotionDiscountAmount > 0.009)
    acc.promoInvoiceAfn += doc.promotionDiscountAmount * rate;
}

function roundAgg(acc: Agg) {
  return {
    userItemAfn: round2(acc.userItemAfn),
    invoiceAfn: round2(acc.invoiceAfn),
    promoLineAfn: round2(acc.promoLineAfn),
    promoInvoiceAfn: round2(acc.promoInvoiceAfn),
    freeUnits: round2(acc.freeUnits),
    freeValueAfn: round2(acc.freeValueAfn),
  };
}

// GET /api/reports/promotions?section=...&from&to&branchId&customerId&supplierId&productId&promotionId
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);

    const sectionRaw = url.searchParams.get("section") ?? "summary";
    if (!SECTIONS.includes(sectionRaw as Section)) {
      throw new ApiError("نوع بخش راپور نامعتبر است", 422, "VALIDATION");
    }
    const section = sectionRaw as Section;

    const { from, to } = resolveRange(url);
    const branchIds = resolveBranchIds(user, url);
    const customerId = url.searchParams.get("customerId") ?? undefined;
    const supplierId = url.searchParams.get("supplierId") ?? undefined;
    const productId = url.searchParams.get("productId") ?? undefined;
    const promotionId = url.searchParams.get("promotionId") ?? undefined;

    const noAccess = branchIds !== undefined && branchIds.length === 0;
    const branchFilter = noAccess
      ? { id: "__none__" }
      : branchIds
        ? { branchId: { in: branchIds } }
        : {};

    const dateFilter = { gte: from, lte: to };

    // ─── فهرست طرح‌ها (فعال/منقضی) ───
    if (section === "promotions") {
      const promos = await db.promotion.findMany({
        where: supplierId ? { supplierId } : undefined,
        include: { supplier: { select: { name: true } }, usages: true },
        orderBy: [{ isActive: "desc" }, { endDate: "desc" }],
      });
      const now = new Date();
      const rows = promos.map((p) => {
        const st: PromoStatus = promoStatus(p, now);
        const disc = round2(p.usages.reduce((a, u) => a + u.discountAfn, 0));
        const freeVal = round2(p.usages.reduce((a, u) => a + u.freeValueAfn, 0));
        const freeQty = round2(p.usages.reduce((a, u) => a + u.freeQuantity, 0));
        const impact = round2(
          p.usages.reduce(
            (a, u) =>
              a +
              (u.docType === "SALE"
                ? -(u.discountAfn + u.freeValueAfn)
                : u.discountAfn + u.freeValueAfn),
            0
          )
        );
        return {
          key: p.id,
          code: p.code,
          name: p.name,
          status: st,
          type: p.type,
          typeLabel: PROMO_TYPE_LABELS[p.type] ?? p.type,
          scope: p.scope,
          scopeLabel: PROMO_SCOPE_LABELS[p.scope] ?? p.scope,
          supplierName: p.supplier?.name ?? null,
          startDate: p.startDate,
          endDate: p.endDate,
          minQuantity: p.minQuantity,
          minAmount: p.minAmount,
          usageCount: p.usageCount,
          usageRecords: p.usages.length,
          discountAfn: disc,
          freeQuantity: freeQty,
          freeValueAfn: freeVal,
          profitImpactAfn: impact,
          isActive: p.isActive,
        };
      });
      return ok({ section, rows });
    }

    // ─── استفاده از طرح‌ها (PromotionUsage) ───
    if (section === "byPromotion") {
      const usages = await db.promotionUsage.findMany({
        where: {
          usedAt: dateFilter,
          ...(promotionId ? { promotionId } : {}),
          ...(noAccess
            ? { id: "__none__" }
            : branchIds
              ? { branchId: { in: branchIds } }
              : {}),
        },
        include: { promotion: { select: { code: true, name: true, type: true } } },
      });

      const map = new Map<
        string,
        {
          label: string;
          count: number;
          freeQty: number;
          freeValue: number;
          discount: number;
          impact: number;
          docs: Set<string>;
        }
      >();
      for (const u of usages) {
        const label = `${u.promotion.code} — ${u.promotion.name}`;
        let row = map.get(u.promotionId);
        if (!row) {
          row = {
            label,
            count: 0,
            freeQty: 0,
            freeValue: 0,
            discount: 0,
            impact: 0,
            docs: new Set(),
          };
          map.set(u.promotionId, row);
        }
        row.count += 1;
        row.freeQty += u.freeQuantity;
        row.freeValue += u.freeValueAfn;
        row.discount += u.discountAfn;
        row.impact +=
          u.docType === "SALE"
            ? -(u.discountAfn + u.freeValueAfn)
            : u.discountAfn + u.freeValueAfn;
        row.docs.add(u.docId);
      }

      const rows: PromoReportRow[] = [...map.entries()]
        .map(([key, r]) => ({
          key,
          label: r.label,
          count: r.count,
          docsCount: r.docs.size,
          quantity: round2(r.freeQty),
          totalAfn: round2(r.discount),
          costAfn: round2(r.freeValue),
          profitAfn: round2(r.impact),
        }))
        .sort((a, b) => (b.totalAfn ?? 0) - (a.totalAfn ?? 0));

      return ok({ section, from, to, rows });
    }

    // ─── بخش‌های مبتنی بر اسناد فروش/خرید ───
    const sales = noAccess
      ? []
      : await db.sale.findMany({
          where: {
            date: dateFilter,
            status: { in: ["APPROVED", "COMPLETED"] },
            ...branchFilter,
            ...(customerId ? { customerId } : {}),
          },
          select: {
            id: true,
            number: true,
            date: true,
            exchangeRate: true,
            discountTotal: true,
            invoiceDiscountAmount: true,
            promotionDiscountAmount: true,
            customerId: true,
            customer: { select: { name: true } },
            items: {
              ...(productId ? { where: { productId } } : {}),
              select: {
                productId: true,
                quantity: true,
                promoFreeQuantity: true,
                unitPrice: true,
                lineTotal: true,
                promoDiscountAmount: true,
                costAtSale: true,
                product: { select: { name: true } },
              },
            },
          },
        });

    const purchases = noAccess
      ? []
      : await db.purchase.findMany({
          where: {
            date: dateFilter,
            status: { in: ["APPROVED", "COMPLETED"] },
            ...branchFilter,
            ...(supplierId ? { supplierId } : {}),
          },
          select: {
            id: true,
            number: true,
            date: true,
            exchangeRate: true,
            discountTotal: true,
            invoiceDiscountAmount: true,
            promotionDiscountAmount: true,
            supplierId: true,
            supplier: { select: { name: true } },
            items: {
              ...(productId ? { where: { productId } } : {}),
              select: {
                productId: true,
                quantity: true,
                promoFreeQuantity: true,
                unitPrice: true,
                lineTotal: true,
                promoDiscountAmount: true,
                effectiveCost: true,
                product: { select: { name: true } },
              },
            },
          },
        });

    // ─── byDay: تخفیف‌های فروش بر اساس روز (تقویم شمسی کابل) ───
    if (section === "byDay") {
      const map = new Map<string, { acc: Agg; docs: number; label: string }>();
      for (const s of sales) {
        const day = reportDayKey(s.date);
        const row = map.get(day) ?? { acc: emptyAgg(), docs: 0, label: reportDayLabel(s.date) };
        const counters: Counters = { itemsDisc: 0, itemsPromo: 0, freeItems: 0 };
        for (const it of s.items) {
          aggItem(row.acc, { ...it, unitCostAfn: it.costAtSale }, s.exchangeRate, counters);
        }
        aggDoc(row.acc, s, s.exchangeRate);
        row.docs += 1;
        map.set(day, row);
      }
      const rows: PromoReportRow[] = [...map.entries()]
        .map(([day, r]) => {
          const f = roundAgg(r.acc);
          const total = round2(f.userItemAfn + f.invoiceAfn + f.promoLineAfn + f.promoInvoiceAfn);
          return {
            key: day,
            label: r.label,
            count: r.docs,
            quantity: f.freeUnits,
            totalAfn: total,
            costAfn: f.freeValueAfn,
            profitAfn: round2(-(total + f.freeValueAfn)),
          };
        })
        .filter((r) => (r.totalAfn ?? 0) > 0 || (r.costAfn ?? 0) > 0)
        .sort((a, b) => (a.key < b.key ? 1 : -1));
      return ok({ section, from, to, rows });
    }

    // ─── byProduct: تخفیف به مشتریان در برابر تخفیف از تأمین‌کنندگان ───
    if (section === "byProduct") {
      const map = new Map<
        string,
        { label: string; sale: Agg; purchase: Agg; saleCounters: Counters; purchCounters: Counters }
      >();
      const ensure = (key: string, label: string) => {
        let row = map.get(key);
        if (!row) {
          row = {
            label,
            sale: emptyAgg(),
            purchase: emptyAgg(),
            saleCounters: { itemsDisc: 0, itemsPromo: 0, freeItems: 0 },
            purchCounters: { itemsDisc: 0, itemsPromo: 0, freeItems: 0 },
          };
          map.set(key, row);
        }
        return row;
      };
      for (const s of sales) {
        for (const it of s.items) {
          const row = ensure(it.productId, it.product.name);
          aggItem(row.sale, { ...it, unitCostAfn: it.costAtSale }, s.exchangeRate, row.saleCounters);
        }
      }
      for (const p of purchases) {
        for (const it of p.items) {
          const row = ensure(it.productId, it.product.name);
          aggItem(
            row.purchase,
            { ...it, unitCostAfn: it.effectiveCost },
            p.exchangeRate,
            row.purchCounters
          );
        }
      }
      const rows: PromoReportRow[] = [...map.values()]
        .map((r) => {
          const s = roundAgg(r.sale);
          const pu = roundAgg(r.purchase);
          const saleTotal = round2(s.userItemAfn + s.invoiceAfn + s.promoLineAfn + s.promoInvoiceAfn);
          const purchTotal = round2(
            pu.userItemAfn + pu.invoiceAfn + pu.promoLineAfn + pu.promoInvoiceAfn
          );
          return {
            key: r.label,
            label: r.label,
            count:
              r.saleCounters.itemsDisc +
              r.saleCounters.itemsPromo +
              r.purchCounters.itemsDisc +
              r.purchCounters.itemsPromo,
            quantity: round2(s.freeUnits + pu.freeUnits),
            totalAfn: saleTotal,
            costAfn: purchTotal,
            profitAfn: round2(
              -(saleTotal + s.freeValueAfn) + (purchTotal + pu.freeValueAfn)
            ),
          };
        })
        .filter((r) => (r.totalAfn ?? 0) > 0 || (r.costAfn ?? 0) > 0 || (r.quantity ?? 0) > 0)
        .sort(
          (a, b) =>
            (b.totalAfn ?? 0) + (b.costAfn ?? 0) - ((a.totalAfn ?? 0) + (a.costAfn ?? 0))
        );
      return ok({ section, from, to, rows });
    }

    // ─── byCustomer ───
    if (section === "byCustomer") {
      const map = new Map<string, { label: string; acc: Agg; docs: number }>();
      for (const s of sales) {
        const row = map.get(s.customerId) ?? { label: s.customer.name, acc: emptyAgg(), docs: 0 };
        const counters: Counters = { itemsDisc: 0, itemsPromo: 0, freeItems: 0 };
        for (const it of s.items) {
          aggItem(row.acc, { ...it, unitCostAfn: it.costAtSale }, s.exchangeRate, counters);
        }
        aggDoc(row.acc, s, s.exchangeRate);
        row.docs += 1;
        map.set(s.customerId, row);
      }
      const rows: PromoReportRow[] = [...map.values()]
        .map((r) => {
          const f = roundAgg(r.acc);
          const total = round2(f.userItemAfn + f.invoiceAfn + f.promoLineAfn + f.promoInvoiceAfn);
          return {
            key: r.label,
            label: r.label,
            count: r.docs,
            quantity: f.freeUnits,
            totalAfn: total,
            costAfn: f.freeValueAfn,
            profitAfn: round2(-(total + f.freeValueAfn)),
          };
        })
        .filter((r) => (r.totalAfn ?? 0) > 0 || (r.costAfn ?? 0) > 0)
        .sort((a, b) => (b.totalAfn ?? 0) - (a.totalAfn ?? 0));
      return ok({ section, from, to, rows });
    }

    // ─── bySupplier ───
    if (section === "bySupplier") {
      const map = new Map<string, { label: string; acc: Agg; docs: number }>();
      for (const p of purchases) {
        const row = map.get(p.supplierId) ?? { label: p.supplier.name, acc: emptyAgg(), docs: 0 };
        const counters: Counters = { itemsDisc: 0, itemsPromo: 0, freeItems: 0 };
        for (const it of p.items) {
          aggItem(row.acc, { ...it, unitCostAfn: it.effectiveCost }, p.exchangeRate, counters);
        }
        aggDoc(row.acc, p, p.exchangeRate);
        row.docs += 1;
        map.set(p.supplierId, row);
      }
      const rows: PromoReportRow[] = [...map.values()]
        .map((r) => {
          const f = roundAgg(r.acc);
          const total = round2(f.userItemAfn + f.invoiceAfn + f.promoLineAfn + f.promoInvoiceAfn);
          return {
            key: r.label,
            label: r.label,
            count: r.docs,
            quantity: f.freeUnits,
            totalAfn: total,
            costAfn: f.freeValueAfn,
            profitAfn: round2(total + f.freeValueAfn),
          };
        })
        .filter((r) => (r.totalAfn ?? 0) > 0 || (r.costAfn ?? 0) > 0)
        .sort((a, b) => (b.totalAfn ?? 0) - (a.totalAfn ?? 0));
      return ok({ section, from, to, rows });
    }

    // ─── summary ───
    const saleAgg = emptyAgg();
    const purchAgg = emptyAgg();
    let salesWithDiscount = 0;
    let salesWithPromo = 0;
    let purchWithDiscount = 0;
    let purchWithPromo = 0;

    for (const s of sales) {
      const counters: Counters = { itemsDisc: 0, itemsPromo: 0, freeItems: 0 };
      for (const it of s.items) {
        aggItem(saleAgg, { ...it, unitCostAfn: it.costAtSale }, s.exchangeRate, counters);
      }
      aggDoc(saleAgg, s, s.exchangeRate);
      // سند مشمول تخفیف: تخفیف قلم کاربر، تخفیف سطح فاکتور، پروموشن یا کالای رایگان
      if (
        counters.itemsDisc > 0 ||
        counters.freeItems > 0 ||
        s.invoiceDiscountAmount > 0.009 ||
        s.promotionDiscountAmount > 0.009
      ) {
        salesWithDiscount += 1;
      }
      if (
        s.promotionDiscountAmount > 0.009 ||
        s.items.some((it) => it.promoDiscountAmount > 0.009 || it.promoFreeQuantity > 0.009)
      ) {
        salesWithPromo += 1;
      }
    }
    for (const p of purchases) {
      const counters: Counters = { itemsDisc: 0, itemsPromo: 0, freeItems: 0 };
      for (const it of p.items) {
        aggItem(purchAgg, { ...it, unitCostAfn: it.effectiveCost }, p.exchangeRate, counters);
      }
      aggDoc(purchAgg, p, p.exchangeRate);
      if (
        counters.itemsDisc > 0 ||
        counters.freeItems > 0 ||
        p.invoiceDiscountAmount > 0.009 ||
        p.promotionDiscountAmount > 0.009
      ) {
        purchWithDiscount += 1;
      }
      if (
        p.promotionDiscountAmount > 0.009 ||
        p.items.some((it) => it.promoDiscountAmount > 0.009 || it.promoFreeQuantity > 0.009)
      ) {
        purchWithPromo += 1;
      }
    }

    const s = roundAgg(saleAgg);
    const pu = roundAgg(purchAgg);
    const saleTotal = round2(s.userItemAfn + s.invoiceAfn + s.promoLineAfn + s.promoInvoiceAfn);
    const purchTotal = round2(
      pu.userItemAfn + pu.invoiceAfn + pu.promoLineAfn + pu.promoInvoiceAfn
    );
    const salesPromoAfn = round2(s.promoLineAfn + s.promoInvoiceAfn);
    const purchPromoAfn = round2(pu.promoLineAfn + pu.promoInvoiceAfn);

    const summary = {
      salesDocs: sales.length,
      salesWithDiscount,
      salesWithPromo,
      salesDiscountAfn: saleTotal,
      salesUserDiscountAfn: round2(s.userItemAfn + s.invoiceAfn),
      salesPromoDiscountAfn: salesPromoAfn,
      salesFreeUnits: s.freeUnits,
      salesFreeValueAfn: s.freeValueAfn,
      purchaseDocs: purchases.length,
      purchWithDiscount,
      purchWithPromo,
      purchaseDiscountAfn: purchTotal,
      purchasePromoDiscountAfn: purchPromoAfn,
      purchaseFreeUnits: pu.freeUnits,
      purchaseFreeValueAfn: pu.freeValueAfn,
      totalIssuedAfn: saleTotal,
      totalReceivedAfn: purchTotal,
      totalPromoDiscountAfn: round2(salesPromoAfn + purchPromoAfn),
      freeGoodsValueAfn: round2(s.freeValueAfn + pu.freeValueAfn),
      profitImpactAfn: round2(
        -(saleTotal + s.freeValueAfn) + (purchTotal + pu.freeValueAfn)
      ),
    };

    const rows: PromoReportRow[] = [
      {
        key: "sale_item",
        label: "تخفیف اقلام فروشات (کاربر)",
        count: salesWithDiscount,
        totalAfn: s.userItemAfn,
        profitAfn: round2(-s.userItemAfn),
      },
      {
        key: "sale_invoice",
        label: "تخفیف سطح فاکتور فروشات",
        count: salesWithDiscount,
        totalAfn: s.invoiceAfn,
        profitAfn: round2(-s.invoiceAfn),
      },
      {
        key: "sale_promo",
        label: "تخفیف پروموشن‌ها در فروشات",
        count: salesWithPromo,
        quantity: s.freeUnits,
        totalAfn: salesPromoAfn,
        costAfn: s.freeValueAfn,
        profitAfn: round2(-(salesPromoAfn + s.freeValueAfn)),
      },
      {
        key: "purch_item",
        label: "تخفیف اقلام خریدها (تأمین‌کننده)",
        count: purchWithDiscount,
        totalAfn: pu.userItemAfn,
        profitAfn: round2(pu.userItemAfn),
      },
      {
        key: "purch_invoice",
        label: "تخفیف سطح فاکتور خریدها",
        count: purchWithDiscount,
        totalAfn: pu.invoiceAfn,
        profitAfn: round2(pu.invoiceAfn),
      },
      {
        key: "purch_promo",
        label: "تخفیف پروموشن‌ها در خریدها",
        count: purchWithPromo,
        quantity: pu.freeUnits,
        totalAfn: purchPromoAfn,
        costAfn: pu.freeValueAfn,
        profitAfn: round2(purchPromoAfn + pu.freeValueAfn),
      },
    ];

    return ok({ section, from, to, summary, rows });
  } catch (e) {
    return handleApiError(e);
  }
}
