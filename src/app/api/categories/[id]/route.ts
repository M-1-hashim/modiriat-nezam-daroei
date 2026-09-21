import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser, requirePermission } from "@/lib/auth";
import { logAudit } from "@/lib/business";
import { ok, fail, handleApiError, ApiError, getClientIp } from "@/lib/api-utils";

function isUniqueError(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

function optString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

// ─────────────────────────── PUT /api/categories/[id] ───────────────────────────
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

    const before = await db.category.findUnique({ where: { id } });
    if (!before) throw new ApiError("دسته یافت نشد", 404);

    const name = optString(body.name);
    if (!name) throw new ApiError("نام دسته الزامی است", 422, "VALIDATION");

    const category = await db.category.update({ where: { id }, data: { name } });

    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "UPDATE",
      entity: "Category",
      entityId: id,
      summary: `ویرایش دستهٔ «${category.name}»`,
      before,
      after: category,
      ip,
    });

    return ok(category);
  } catch (e) {
    if (isUniqueError(e)) return fail("این مقدار قبلاً ثبت شده است", 409, "DUPLICATE");
    return handleApiError(e);
  }
}

// ─────────────────────────── DELETE /api/categories/[id] ───────────────────────────
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    requirePermission(user, "products.delete");
    const { id } = await params;
    const ip = getClientIp(req);

    const category = await db.category.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });
    if (!category) throw new ApiError("دسته یافت نشد", 404);

    if (category._count.products > 0) {
      throw new ApiError(
        `دستهٔ «${category.name}» دارای ${category._count.products} محصول است و قابل حذف نیست`,
        409,
        "HAS_PRODUCTS"
      );
    }

    await db.category.delete({ where: { id } });
    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "DELETE",
      entity: "Category",
      entityId: id,
      summary: `حذف دستهٔ «${category.name}»`,
      before: category,
      ip,
    });

    return ok({ id, deleted: true, message: "دسته حذف شد" });
  } catch (e) {
    return handleApiError(e);
  }
}
