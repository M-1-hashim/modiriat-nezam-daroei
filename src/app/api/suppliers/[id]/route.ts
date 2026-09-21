import { db } from "@/lib/db";
import { ApiError, getClientIp, handleApiError, ok } from "@/lib/api-utils";
import { requirePermission, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/business";

type Ctx = { params: Promise<{ id: string }> };

// PUT /api/suppliers/[id] — ویرایش تأمین‌کننده
export async function PUT(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    requirePermission(user, "suppliers.edit");
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const existing = await db.supplier.findUnique({ where: { id } });
    if (!existing) throw new ApiError("تأمین‌کننده یافت نشد", 404, "NOT_FOUND");

    const data: {
      name?: string;
      type?: string;
      country?: string | null;
      contactPerson?: string | null;
      phone?: string | null;
      email?: string | null;
      address?: string | null;
      isActive?: boolean;
    } = {};

    if ("name" in body) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) throw new ApiError("نام تأمین‌کننده الزامی است", 422, "VALIDATION");
      data.name = name;
    }
    if ("type" in body) {
      const type = typeof body.type === "string" ? body.type.trim().toUpperCase() : "";
      if (type !== "LOCAL" && type !== "FOREIGN") {
        throw new ApiError("نوع تأمین‌کننده باید محلی یا بیگانه باشد", 422, "VALIDATION");
      }
      data.type = type;
    }
    if ("country" in body)
      data.country = typeof body.country === "string" ? body.country.trim() || null : null;
    if ("contactPerson" in body)
      data.contactPerson =
        typeof body.contactPerson === "string" ? body.contactPerson.trim() || null : null;
    if ("phone" in body)
      data.phone = typeof body.phone === "string" ? body.phone.trim() || null : null;
    if ("email" in body)
      data.email = typeof body.email === "string" ? body.email.trim() || null : null;
    if ("address" in body)
      data.address = typeof body.address === "string" ? body.address.trim() || null : null;
    if ("isActive" in body) data.isActive = Boolean(body.isActive);

    await db.$transaction(async (tx) => {
      await tx.supplier.update({ where: { id }, data });
      await logAudit(tx, {
        userId: user.id,
        userName: user.fullName,
        branchId: null,
        action: "UPDATE",
        entity: "Supplier",
        entityId: id,
        summary: `ویرایش تأمین‌کننده ${existing.name}`,
        ip: getClientIp(req),
      });
    });

    const supplier = await db.supplier.findUnique({ where: { id } });
    return ok(supplier);
  } catch (e) {
    return handleApiError(e);
  }
}

// DELETE /api/suppliers/[id] — حذف یا غیرفعال‌سازی
export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser();
    requirePermission(user, "suppliers.delete");
    const { id } = await ctx.params;

    const existing = await db.supplier.findUnique({ where: { id } });
    if (!existing) throw new ApiError("تأمین‌کننده یافت نشد", 404, "NOT_FOUND");

    const purchasesCount = await db.purchase.count({ where: { supplierId: id } });
    const hasTransactions = purchasesCount > 0;

    await db.$transaction(async (tx) => {
      if (hasTransactions) {
        await tx.supplier.update({ where: { id }, data: { isActive: false } });
      } else {
        await tx.supplier.delete({ where: { id } });
      }
      await logAudit(tx, {
        userId: user.id,
        userName: user.fullName,
        branchId: null,
        action: "DELETE",
        entity: "Supplier",
        entityId: id,
        summary: hasTransactions
          ? `غیرفعال‌سازی تأمین‌کننده ${existing.name} (دارای خرید)`
          : `حذف تأمین‌کننده ${existing.name}`,
        ip: getClientIp(req),
      });
    });

    return ok(
      hasTransactions
        ? { id, deactivated: true, message: "تأمین‌کننده دارای خرید است؛ به‌صورت غیرفعال علامت شد" }
        : { id, deactivated: false, message: "تأمین‌کننده حذف شد" }
    );
  } catch (e) {
    return handleApiError(e);
  }
}
