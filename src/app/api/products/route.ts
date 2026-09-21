import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  requireUser,
  requirePermission,
  allowedBranchIds,
  type AuthUser,
} from "@/lib/auth";
import { logAudit } from "@/lib/business";
import {
  ok,
  fail,
  handleApiError,
  ApiError,
  toNum,
  round2,
  getPagination,
  getClientIp,
} from "@/lib/api-utils";

/** آی‌دی گدام‌های مجاز کاربر — undefined یعنی همهٔ گدام‌ها (سوپرادمین) */
async function scopeWarehouseIds(user: AuthUser): Promise<string[] | undefined> {
  const allowed = allowedBranchIds(user);
  if (allowed === undefined) return undefined;
  if (allowed.length === 0) return [];
  const whs = await db.warehouse.findMany({
    where: { branchId: { in: allowed } },
    select: { id: true },
  });
  return whs.map((w) => w.id);
}

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

/** اعداد قیمت/موجودی — در صورت ارسال باید ≥ ۰ باشد */
function nonNeg(v: unknown, label: string): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = toNum(v);
  if (n < 0) throw new ApiError(`${label} نمی‌تواند منفی باشد`, 422, "VALIDATION");
  return round2(n);
}

// ─────────────────────────── GET /api/products ───────────────────────────
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    requirePermission(user, "products.view");

    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim() || "";
    const categoryId = url.searchParams.get("categoryId") || undefined;
    const manufacturerId = url.searchParams.get("manufacturerId") || undefined;
    const includeInactive = url.searchParams.get("includeInactive") === "true";
    const { page, limit, skip, take } = getPagination(url);

    const where: Prisma.ProductWhereInput = {
      ...(includeInactive ? {} : { isActive: true }),
      ...(categoryId ? { categoryId } : {}),
      ...(manufacturerId ? { manufacturerId } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { genericName: { contains: q } },
              { barcode: { contains: q } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      db.product.findMany({
        where,
        include: { category: true, manufacturer: true },
        orderBy: { name: "asc" },
        skip,
        take,
      }),
      db.product.count({ where }),
    ]);

    // مجموع موجودی هر محصول (فقط گدام‌های شعبه‌های مجاز برای غیرسوپرادمین)
    const whIds = await scopeWarehouseIds(user);
    const ids = rows.map((r) => r.id);
    const sums =
      ids.length === 0
        ? []
        : await db.stockItem.groupBy({
            by: ["productId"],
            where: {
              productId: { in: ids },
              ...(whIds === undefined ? {} : { warehouseId: { in: whIds } }),
            },
            _sum: { quantity: true },
          });
    const qtyMap = new Map(sums.map((s) => [s.productId, s._sum.quantity ?? 0]));

    const items = rows.map((r) => ({ ...r, stockTotal: qtyMap.get(r.id) ?? 0 }));
    return ok({ items, total, page, limit });
  } catch (e) {
    return handleApiError(e);
  }
}

// ─────────────────────────── POST /api/products ───────────────────────────
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    requirePermission(user, "products.create");
    const body = (await req.json()) as Record<string, unknown>;
    const ip = getClientIp(req);

    // همگام‌سازی آفلاین: localId تکراری → همان رکورد موجود
    const localId = optString(body.localId);
    if (localId) {
      const existing = await db.product.findUnique({
        where: { localId },
        include: { category: true, manufacturer: true },
      });
      if (existing) return ok(existing);
    }

    const name = optString(body.name);
    if (!name) throw new ApiError("نام محصول الزامی است", 422, "VALIDATION");

    const purchasePrice = nonNeg(body.purchasePrice, "قیمت خرید");
    const salePrice = nonNeg(body.salePrice, "قیمت فروش");
    const minStock = nonNeg(body.minStock, "حداقل موجودی");
    const maxStock = nonNeg(body.maxStock, "حداکثر موجودی");
    if (minStock !== undefined && maxStock !== undefined && maxStock > 0 && maxStock < minStock) {
      throw new ApiError("حداکثر موجودی نمی‌تواند کمتر از حداقل موجودی باشد", 422, "VALIDATION");
    }

    const categoryId = optString(body.categoryId) ?? null;
    const manufacturerId = optString(body.manufacturerId) ?? null;
    if (categoryId && !(await db.category.findUnique({ where: { id: categoryId } }))) {
      throw new ApiError("دستهٔ انتخاب شده یافت نشد", 422, "VALIDATION");
    }
    if (manufacturerId && !(await db.manufacturer.findUnique({ where: { id: manufacturerId } }))) {
      throw new ApiError("شرکت تولیدکنندهٔ انتخاب شده یافت نشد", 422, "VALIDATION");
    }

    const product = await db.product.create({
      data: {
        localId,
        name,
        genericName: strOrNull(body.genericName),
        categoryId,
        manufacturerId,
        country: strOrNull(body.country),
        dosageForm: strOrNull(body.dosageForm),
        strength: strOrNull(body.strength),
        unit: strOrNull(body.unit) ?? "عدد",
        packaging: strOrNull(body.packaging),
        barcode: strOrNull(body.barcode),
        storeCondition: strOrNull(body.storeCondition),
        purchasePrice: purchasePrice ?? 0,
        salePrice: salePrice ?? 0,
        minStock: minStock ?? 0,
        maxStock: maxStock ?? 0,
        isActive: body.isActive === undefined ? true : Boolean(body.isActive),
      },
      include: { category: true, manufacturer: true },
    });

    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "CREATE",
      entity: "Product",
      entityId: product.id,
      summary: `ایجاد محصول «${product.name}»`,
      after: product,
      ip,
    });

    return ok(product, 201);
  } catch (e) {
    if (isUniqueError(e)) return fail("این مقدار قبلاً ثبت شده است", 409, "DUPLICATE");
    return handleApiError(e);
  }
}
