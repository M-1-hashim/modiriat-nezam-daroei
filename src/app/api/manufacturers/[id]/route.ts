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

function strOrNull(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// ─────────────────────────── PUT /api/manufacturers/[id] ───────────────────────────
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

    const before = await db.manufacturer.findUnique({ where: { id } });
    if (!before) throw new ApiError("شرکت تولیدکننده یافت نشد", 404);

    const data: Prisma.ManufacturerUpdateInput = {};
    if (body.name !== undefined) {
      const name = optString(body.name);
      if (!name) throw new ApiError("نام شرکت تولیدکننده الزامی است", 422, "VALIDATION");
      data.name = name;
    }
    if (body.country !== undefined) data.country = strOrNull(body.country);

    const manufacturer = await db.manufacturer.update({ where: { id }, data });

    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "UPDATE",
      entity: "Manufacturer",
      entityId: id,
      summary: `ویرایش شرکت تولیدکنندهٔ «${manufacturer.name}»`,
      before,
      after: manufacturer,
      ip,
    });

    return ok(manufacturer);
  } catch (e) {
    if (isUniqueError(e)) return fail("این مقدار قبلاً ثبت شده است", 409, "DUPLICATE");
    return handleApiError(e);
  }
}

// ─────────────────────────── DELETE /api/manufacturers/[id] ───────────────────────────
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    requirePermission(user, "products.delete");
    const { id } = await params;
    const ip = getClientIp(req);

    const manufacturer = await db.manufacturer.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });
    if (!manufacturer) throw new ApiError("شرکت تولیدکننده یافت نشد", 404);

    if (manufacturer._count.products > 0) {
      throw new ApiError(
        `شرکت «${manufacturer.name}» دارای ${manufacturer._count.products} محصول است و قابل حذف نیست`,
        409,
        "HAS_PRODUCTS"
      );
    }

    await db.manufacturer.delete({ where: { id } });
    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "DELETE",
      entity: "Manufacturer",
      entityId: id,
      summary: `حذف شرکت تولیدکنندهٔ «${manufacturer.name}»`,
      before: manufacturer,
      ip,
    });

    return ok({ id, deleted: true, message: "شرکت تولیدکننده حذف شد" });
  } catch (e) {
    return handleApiError(e);
  }
}
