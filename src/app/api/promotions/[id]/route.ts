import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, getClientIp, handleApiError, ok } from "@/lib/api-utils";
import { requirePermission, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/business";
import { parsePromoBody } from "../route";

type Ctx = { params: Promise<{ id: string }> };

const promoInclude = {
  products: { select: { productId: true, product: { select: { id: true, name: true, unit: true } } } },
  supplier: { select: { id: true, name: true } },
} as const;

// GET /api/promotions/[id] — جزئیات طرح (promotions.view)
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    requirePermission(user, "promotions.view");
    const { id } = await ctx.params;

    const promo = await db.promotion.findUnique({
      where: { id },
      include: {
        ...promoInclude,
        usages: { orderBy: { usedAt: "desc" }, take: 25 },
      },
    });
    if (!promo) throw new ApiError("طرح تشویقی یافت نشد", 404, "NOT_FOUND");

    return ok({ ...promo, status: promoStatusSafe(promo) });
  } catch (e) {
    return handleApiError(e);
  }
}

function promoStatusSafe(p: { isActive: boolean; startDate: Date; endDate: Date }): string {
  if (!p.isActive) return "INACTIVE";
  const now = new Date();
  if (now < p.startDate) return "SCHEDULED";
  if (now > p.endDate) return "EXPIRED";
  return "ACTIVE";
}

// PUT /api/promotions/[id] — ویرایش طرح (promotions.edit)
export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    requirePermission(user, "promotions.edit");
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const existing = await db.promotion.findUnique({ where: { id } });
    if (!existing) throw new ApiError("طرح تشویقی یافت نشد", 404, "NOT_FOUND");

    const input = parsePromoBody(body);
    const dup = await db.promotion.findUnique({ where: { code: input.code } });
    if (dup && dup.id !== id) throw new ApiError("کد طرح تکراری است", 409, "DUPLICATE");

    if (input.supplierId) {
      const supplier = await db.supplier.findUnique({ where: { id: input.supplierId } });
      if (!supplier) throw new ApiError("تأمین‌کننده یافت نشد", 422, "VALIDATION");
    }

    await db.$transaction(async (tx) => {
      await tx.promotion.update({
        where: { id },
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
          products: { deleteMany: {} },
        },
      });
      if (!input.allProducts && input.productIds.length > 0) {
        await tx.promotionProduct.createMany({
          data: input.productIds.map((productId) => ({ promotionId: id, productId })),
        });
      }
      await logAudit(tx, {
        userId: user.id,
        userName: user.fullName,
        branchId: user.branchId,
        action: "UPDATE",
        entity: "Promotion",
        entityId: id,
        summary: `ویرایش طرح تشویقی «${input.name}» (${input.code})`,
        ip: getClientIp(req),
      });
    });

    const updated = await db.promotion.findUnique({ where: { id }, include: promoInclude });
    return ok(updated);
  } catch (e) {
    return handleApiError(e);
  }
}

// DELETE /api/promotions/[id] — حذف (promotions.delete) — اگر استفاده شده باشد فقط غیرفعال
export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    requirePermission(user, "promotions.delete");
    const { id } = await ctx.params;

    const existing = await db.promotion.findUnique({ where: { id } });
    if (!existing) throw new ApiError("طرح تشویقی یافت نشد", 404, "NOT_FOUND");

    const usages = await db.promotionUsage.count({ where: { promotionId: id } });
    const linkedDocs =
      (await db.purchase.count({ where: { promotionId: id } })) +
      (await db.sale.count({ where: { promotionId: id } }));

    if (usages > 0 || linkedDocs > 0) {
      await db.$transaction(async (tx) => {
        await tx.promotion.update({ where: { id }, data: { isActive: false } });
        await logAudit(tx, {
          userId: user.id,
          userName: user.fullName,
          branchId: user.branchId,
          action: "UPDATE",
          entity: "Promotion",
          entityId: id,
          summary: `غیرفعال‌سازی طرح تشویقی «${existing.name}» (دارای سابقه استفاده)`,
          ip: getClientIp(req),
        });
      });
      return ok({
        id,
        deactivated: true,
        message: "این طرح سابقه استفاده دارد و حذف نمی‌شود؛ غیرفعال شد",
      });
    }

    await db.$transaction(async (tx) => {
      await tx.promotion.delete({ where: { id } });
      await logAudit(tx, {
        userId: user.id,
        userName: user.fullName,
        branchId: user.branchId,
        action: "DELETE",
        entity: "Promotion",
        entityId: id,
        summary: `حذف طرح تشویقی «${existing.name}» (${existing.code})`,
        ip: getClientIp(req),
      });
    });
    return ok({ id, deactivated: false, message: "طرح تشویقی حذف شد" });
  } catch (e) {
    return handleApiError(e);
  }
}
