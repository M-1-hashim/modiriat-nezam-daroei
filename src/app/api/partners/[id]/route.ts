import { db } from "@/lib/db";
import { ApiError, handleApiError, ok } from "@/lib/api-utils";
import { requireUser, requirePermission } from "@/lib/auth";
import { logAudit } from "@/lib/business";

// PUT /api/partners/[id]
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    requirePermission(user, "partnerships.edit");
    const { id } = await params;
    const partner = await db.partner.findUnique({ where: { id } });
    if (!partner) throw new ApiError("شریک یافت نشد", 404, "NOT_FOUND");

    const body = (await req.json()) as Record<string, unknown>;
    const data: { name?: string; phone?: string | null; note?: string | null; isActive?: boolean } = {};
    if (body.name !== undefined) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) throw new ApiError("نام شریک الزامی است", 422, "VALIDATION");
      data.name = name;
    }
    if (body.phone !== undefined) {
      data.phone = typeof body.phone === "string" && body.phone.trim() ? body.phone.trim() : null;
    }
    if (body.note !== undefined) {
      data.note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;
    }
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);

    const updated = await db.$transaction(async (tx) => {
      const row = await tx.partner.update({ where: { id }, data });
      await logAudit(tx, {
        userId: user.id,
        userName: user.fullName,
        branchId: user.branchId,
        action: "UPDATE",
        entity: "Partner",
        entityId: id,
        summary: `ویرایش شریک «${partner.name}»`,
        before: { name: partner.name, phone: partner.phone, note: partner.note, isActive: partner.isActive },
        after: data,
      });
      return row;
    });

    return ok(updated);
  } catch (e) {
    return handleApiError(e);
  }
}

// DELETE /api/partners/[id] — اگر شراکت ثبت شده باشد ممنوع
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    requirePermission(user, "partnerships.delete");
    const { id } = await params;
    const partner = await db.partner.findUnique({
      where: { id },
      include: { _count: { select: { partnerships: true } } },
    });
    if (!partner) throw new ApiError("شریک یافت نشد", 404, "NOT_FOUND");
    if (partner._count.partnerships > 0) {
      throw new ApiError(
        "این شریک شراکت ثبت‌شده دارد و قابل حذف نیست",
        422,
        "IN_USE"
      );
    }

    await db.$transaction(async (tx) => {
      await tx.partner.delete({ where: { id } });
      await logAudit(tx, {
        userId: user.id,
        userName: user.fullName,
        branchId: user.branchId,
        action: "DELETE",
        entity: "Partner",
        entityId: id,
        summary: `حذف شریک «${partner.name}»`,
        before: { name: partner.name },
      });
    });

    return ok({ deleted: true });
  } catch (e) {
    return handleApiError(e);
  }
}
