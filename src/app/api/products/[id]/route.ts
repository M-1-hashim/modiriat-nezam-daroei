import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser, requirePermission } from "@/lib/auth";
import { logAudit } from "@/lib/business";
import {
  ok,
  fail,
  handleApiError,
  ApiError,
  toNum,
  round2,
  getClientIp,
} from "@/lib/api-utils";

function isUniqueError(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

function strOrNull(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function optString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

function nonNeg(v: unknown, label: string): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = toNum(v);
  if (n < 0) throw new ApiError(`${label} نمی‌تواند منفی باشد`, 422, "VALIDATION");
  return round2(n);
}

// ─────────────────────────── PUT /api/products/[id] ───────────────────────────
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    requirePermission(user, "products.edit");
    const { id } = await params;
    const body = (await req.json()) as Record<string, unknown>;
    const ip = getClientIp(req);

    const before = await db.product.findUnique({ where: { id } });
    if (!before) throw new ApiError("محصول یافت نشد", 404);

    const data: Prisma.ProductUncheckedUpdateInput = {};

    if (body.name !== undefined) {
      const name = optString(body.name);
      if (!name) throw new ApiError("نام محصول نمی‌تواند خالی باشد", 422, "VALIDATION");
      data.name = name;
    }
    if (body.genericName !== undefined) data.genericName = strOrNull(body.genericName);
    if (body.country !== undefined) data.country = strOrNull(body.country);
    if (body.dosageForm !== undefined) data.dosageForm = strOrNull(body.dosageForm);
    if (body.strength !== undefined) data.strength = strOrNull(body.strength);
    if (body.unit !== undefined) {
      const unit = strOrNull(body.unit);
      if (unit) data.unit = unit;
    }
    if (body.packaging !== undefined) data.packaging = strOrNull(body.packaging);
    if (body.barcode !== undefined) data.barcode = strOrNull(body.barcode);
    if (body.storeCondition !== undefined) data.storeCondition = strOrNull(body.storeCondition);

    if (body.categoryId !== undefined) {
      const categoryId = optString(body.categoryId) ?? null;
      if (categoryId && !(await db.category.findUnique({ where: { id: categoryId } }))) {
        throw new ApiError("دستهٔ انتخاب شده یافت نشد", 422, "VALIDATION");
      }
      data.categoryId = categoryId;
    }
    if (body.manufacturerId !== undefined) {
      const manufacturerId = optString(body.manufacturerId) ?? null;
      if (manufacturerId && !(await db.manufacturer.findUnique({ where: { id: manufacturerId } }))) {
        throw new ApiError("شرکت تولیدکنندهٔ انتخاب شده یافت نشد", 422, "VALIDATION");
      }
      data.manufacturerId = manufacturerId;
    }

    const purchasePrice = nonNeg(body.purchasePrice, "قیمت خرید");
    if (purchasePrice !== undefined) data.purchasePrice = purchasePrice;
    const salePrice = nonNeg(body.salePrice, "قیمت فروش");
    if (salePrice !== undefined) data.salePrice = salePrice;
    const minStock = nonNeg(body.minStock, "حداقل موجودی");
    if (minStock !== undefined) data.minStock = minStock;
    const maxStock = nonNeg(body.maxStock, "حداکثر موجودی");
    if (maxStock !== undefined) data.maxStock = maxStock;

    const nextMin = minStock ?? before.minStock;
    const nextMax = maxStock ?? before.maxStock;
    if (nextMax > 0 && nextMax < nextMin) {
      throw new ApiError("حداکثر موجودی نمی‌تواند کمتر از حداقل موجودی باشد", 422, "VALIDATION");
    }

    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);

    const product = await db.product.update({
      where: { id },
      data,
      include: { category: true, manufacturer: true },
    });

    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "UPDATE",
      entity: "Product",
      entityId: id,
      summary: `ویرایش محصول «${product.name}»`,
      before,
      after: product,
      ip,
    });

    return ok(product);
  } catch (e) {
    if (isUniqueError(e)) return fail("این مقدار قبلاً ثبت شده است", 409, "DUPLICATE");
    return handleApiError(e);
  }
}

// ─────────────────────────── DELETE /api/products/[id] ───────────────────────────
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    requirePermission(user, "products.delete");
    const { id } = await params;
    const ip = getClientIp(req);

    const product = await db.product.findUnique({ where: { id } });
    if (!product) throw new ApiError("محصول یافت نشد", 404);

    const [purchaseCount, saleCount, batchCount, stockRow] = await Promise.all([
      db.purchaseItem.count({ where: { productId: id } }),
      db.saleItem.count({ where: { productId: id } }),
      db.batch.count({ where: { productId: id } }),
      db.stockItem.findFirst({ where: { productId: id, quantity: { gt: 0 } }, select: { id: true } }),
    ]);
    const hasTransactions =
      purchaseCount > 0 || saleCount > 0 || batchCount > 0 || stockRow !== null;

    if (hasTransactions) {
      const updated = await db.product.update({
        where: { id },
        data: { isActive: false },
      });
      await logAudit(db, {
        userId: user.id,
        userName: user.fullName,
        branchId: user.branchId,
        action: "DELETE",
        entity: "Product",
        entityId: id,
        summary: `محصول «${product.name}» دارای تراکنش است — غیرفعال شد`,
        before: product,
        after: updated,
        ip,
      });
      return ok({ id, isActive: false, message: "محصول دارای تراکنش است — غیرفعال شد" });
    }

    await db.product.delete({ where: { id } });
    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "DELETE",
      entity: "Product",
      entityId: id,
      summary: `حذف محصول «${product.name}»`,
      before: product,
      ip,
    });
    return ok({ id, deleted: true, message: "محصول حذف شد" });
  } catch (e) {
    return handleApiError(e);
  }
}
