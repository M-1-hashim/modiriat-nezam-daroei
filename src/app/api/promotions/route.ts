import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, getClientIp, handleApiError, ok, parseDate, round2, toNum } from "@/lib/api-utils";
import { requirePermission, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/business";
import {
  PROMO_SCOPES,
  PROMO_TYPES,
  promoStatus,
  type PromoScope,
  type PromoType,
} from "@/lib/promotion";

// GET /api/promotions — فهرست طرح‌های تشویقی (promotions.view)
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    requirePermission(user, "promotions.view");

    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    const type = url.searchParams.get("type")?.trim() ?? "";
    const status = url.searchParams.get("status")?.trim().toUpperCase() ?? "";

    const rows = await db.promotion.findMany({
      where: q
        ? { OR: [{ name: { contains: q } }, { code: { contains: q } }] }
        : undefined,
      include: {
        products: { select: { productId: true, product: { select: { id: true, name: true, unit: true } } } },
        supplier: { select: { id: true, name: true } },
        _count: { select: { usages: true } },
      },
      orderBy: [{ isActive: "desc" }, { endDate: "desc" }],
    });

    const now = new Date();
    let items = rows.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      type: p.type,
      scope: p.scope,
      allProducts: p.allProducts,
      products: p.products.map((pp) => pp.product),
      supplier: p.supplier,
      customerType: p.customerType,
      appliesToSale: p.appliesToSale,
      appliesToPurchase: p.appliesToPurchase,
      minQuantity: p.minQuantity,
      minAmount: p.minAmount,
      freeQuantity: p.freeQuantity,
      discountPct: p.discountPct,
      discountAmount: p.discountAmount,
      startDate: p.startDate,
      endDate: p.endDate,
      terms: p.terms,
      description: p.description,
      isActive: p.isActive,
      usageCount: p.usageCount,
      status: promoStatus(p, now),
      createdAt: p.createdAt,
    }));

    if (type && PROMO_TYPES.includes(type as PromoType)) {
      items = items.filter((i) => i.type === type);
    }
    if (status) {
      items = items.filter((i) => i.status === status);
    }

    return ok({ items });
  } catch (e) {
    return handleApiError(e);
  }
}

type PromoInput = {
  code: string;
  name: string;
  type: PromoType;
  scope: PromoScope;
  allProducts: boolean;
  productIds: string[];
  supplierId: string | null;
  customerType: string | null;
  appliesToSale: boolean;
  appliesToPurchase: boolean;
  minQuantity: number;
  minAmount: number;
  freeQuantity: number;
  discountPct: number;
  discountAmount: number;
  startDate: Date;
  endDate: Date;
  terms: string | null;
  description: string | null;
  isActive: boolean;
};

/** اعتبارسنجی مشترک ورودی طرح */
export function parsePromoBody(body: Record<string, unknown>): PromoInput {
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  if (!code) throw new ApiError("کد طرح الزامی است", 422, "VALIDATION");
  if (!/^[\w-]{2,30}$/.test(code)) {
    throw new ApiError("کد طرح باید ۲ تا ۳۰ نویسه لاتین/عدد یا خط تیره باشد", 422, "VALIDATION");
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) throw new ApiError("نام طرح الزامی است", 422, "VALIDATION");

  const type = (typeof body.type === "string" ? body.type.trim().toUpperCase() : "") as PromoType;
  if (!PROMO_TYPES.includes(type)) {
    throw new ApiError("نوع طرح باید رایگان، درصدی، مبلغی یا ترکیبی باشد", 422, "VALIDATION");
  }
  const scope = (typeof body.scope === "string" ? body.scope.trim().toUpperCase() : "LINE") as PromoScope;
  if (!PROMO_SCOPES.includes(scope)) {
    throw new ApiError("دامنه طرح باید هر قلم یا کل فاکتور باشد", 422, "VALIDATION");
  }
  if (
    scope === "INVOICE" &&
    (type === "FREE_QTY" || (type === "COMBINED" && toNum(body.freeQuantity, 0) > 0))
  ) {
    throw new ApiError("کالای رایگان فقط در دامنه «هر قلم» قابل اعمال است", 422, "VALIDATION");
  }

  const allProducts = Boolean(body.allProducts);
  const productIds = Array.isArray(body.productIds)
    ? [...new Set(body.productIds.map((x) => String(x).trim()).filter(Boolean))]
    : [];
  if (!allProducts && productIds.length === 0) {
    throw new ApiError(
      "حداقل یک محصول مشمول طرح انتخاب کنید یا «همه محصولات» را فعال کنید",
      422,
      "VALIDATION"
    );
  }

  const supplierId =
    typeof body.supplierId === "string" && body.supplierId.trim() ? body.supplierId.trim() : null;
  const customerType =
    typeof body.customerType === "string" && body.customerType.trim()
      ? body.customerType.trim().toUpperCase()
      : null;

  const appliesToSale = body.appliesToSale === undefined ? true : Boolean(body.appliesToSale);
  const appliesToPurchase = Boolean(body.appliesToPurchase);
  if (!appliesToSale && !appliesToPurchase) {
    throw new ApiError("طرح باید برای فروش یا خرید (حداقل یکی) فعال باشد", 422, "VALIDATION");
  }

  const minQuantity = round2(toNum(body.minQuantity, 0));
  const minAmount = round2(toNum(body.minAmount, 0));
  const freeQuantity = round2(toNum(body.freeQuantity, 0));
  const discountPct = round2(toNum(body.discountPct, 0));
  const discountAmount = round2(toNum(body.discountAmount, 0));

  if (minQuantity < 0 || minAmount < 0) {
    throw new ApiError("شرایط حداقل خرید نمی‌تواند منفی باشد", 422, "VALIDATION");
  }
  if (minQuantity === 0 && minAmount === 0) {
    throw new ApiError("حداقل یک شرط خرید (تعداد یا مبلغ) تعیین کنید", 422, "VALIDATION");
  }

  if (type === "FREE_QTY" && freeQuantity <= 0) {
    throw new ApiError("برای طرح کالای رایگان، مقدار رایگان باید بزرگ‌تر از صفر باشد", 422, "VALIDATION");
  }
  if (type === "PERCENT" && discountPct <= 0) {
    throw new ApiError("برای طرح درصدی، درصد تخفیف باید بزرگ‌تر از صفر باشد", 422, "VALIDATION");
  }
  if (type === "AMOUNT" && discountAmount <= 0) {
    throw new ApiError("برای طرح مبلغی، مبلغ تخفیف باید بزرگ‌تر از صفر باشد", 422, "VALIDATION");
  }
  if (type === "COMBINED" && freeQuantity <= 0) {
    throw new ApiError("برای طرح ترکیبی، مقدار کالای رایگان الزامی است", 422, "VALIDATION");
  }
  if ((type === "COMBINED" || type === "PERCENT") && discountPct <= 0 && discountAmount <= 0) {
    throw new ApiError("برای این نوع طرح، درصد یا مبلغ تخفیف الزامی است", 422, "VALIDATION");
  }
  if (discountPct < 0 || discountPct > 100) {
    throw new ApiError("درصد تخفیف باید بین ۰ تا ۱۰۰ باشد", 422, "VALIDATION");
  }
  if (discountAmount < 0) {
    throw new ApiError("مبلغ تخفیف نمی‌تواند منفی باشد", 422, "VALIDATION");
  }

  const startDate = parseDate(body.startDate);
  const endDate = parseDate(body.endDate);
  if (!startDate) throw new ApiError("تاریخ شروع طرح الزامی است", 422, "VALIDATION");
  if (!endDate) throw new ApiError("تاریخ ختم طرح الزامی است", 422, "VALIDATION");
  if (startDate > endDate) {
    throw new ApiError("تاریخ شروع باید قبل از تاریخ ختم باشد", 422, "VALIDATION");
  }

  const terms = typeof body.terms === "string" ? body.terms.trim() || null : null;
  const description = typeof body.description === "string" ? body.description.trim() || null : null;
  const isActive = body.isActive === undefined ? true : Boolean(body.isActive);

  return {
    code,
    name,
    type,
    scope,
    allProducts,
    productIds,
    supplierId,
    customerType,
    appliesToSale,
    appliesToPurchase,
    minQuantity,
    minAmount,
    freeQuantity,
    discountPct,
    discountAmount,
    startDate,
    endDate,
    terms,
    description,
    isActive,
  };
}

// POST /api/promotions — ایجاد طرح (promotions.create)
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    requirePermission(user, "promotions.create");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const input = parsePromoBody(body);

    const dup = await db.promotion.findUnique({ where: { code: input.code } });
    if (dup) throw new ApiError("کد طرح تکراری است", 409, "DUPLICATE");

    if (input.supplierId) {
      const supplier = await db.supplier.findUnique({ where: { id: input.supplierId } });
      if (!supplier) throw new ApiError("تأمین‌کننده یافت نشد", 422, "VALIDATION");
    }
    if (!input.allProducts && input.productIds.length > 0) {
      const found = await db.product.count({ where: { id: { in: input.productIds } } });
      if (found !== input.productIds.length) {
        throw new ApiError("برخی محصولات انتخاب‌شده یافت نشدند", 422, "VALIDATION");
      }
    }

    const created = await db.$transaction(async (tx) => {
      const promo = await tx.promotion.create({
        data: {
          code: input.code,
          name: input.name,
          type: input.type,
          scope: input.scope,
          allProducts: input.allProducts,
          supplierId: input.supplierId,
          customerType: input.customerType,
          appliesToSale: input.appliesToSale,
          appliesToPurchase: input.appliesToPurchase,
          minQuantity: input.minQuantity,
          minAmount: input.minAmount,
          freeQuantity: input.freeQuantity,
          discountPct: input.discountPct,
          discountAmount: input.discountAmount,
          startDate: input.startDate,
          endDate: input.endDate,
          terms: input.terms,
          description: input.description,
          isActive: input.isActive,
          products: input.allProducts
            ? undefined
            : { create: input.productIds.map((productId) => ({ productId })) },
        },
      });
      await logAudit(tx, {
        userId: user.id,
        userName: user.fullName,
        branchId: user.branchId,
        action: "CREATE",
        entity: "Promotion",
        entityId: promo.id,
        summary: `ایجاد طرح تشویقی «${promo.name}» (${promo.code})`,
        ip: getClientIp(req),
      });
      return promo;
    });

    return ok({ id: created.id, message: "طرح تشویقی ایجاد شد" }, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
