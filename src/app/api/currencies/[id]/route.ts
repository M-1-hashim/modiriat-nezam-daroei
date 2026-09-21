import { db } from "@/lib/db";
import { requireUser, requirePermission } from "@/lib/auth";
import { logAudit } from "@/lib/business";
import { ok, handleApiError, ApiError } from "@/lib/api-utils";

function optString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

/** آیا این ارز در اسناد سیستم استفاده شده است؟ */
async function isCurrencyInUse(code: string): Promise<boolean> {
  const [p, s, pay, e] = await Promise.all([
    db.purchase.count({ where: { currency: code } }),
    db.sale.count({ where: { currency: code } }),
    db.payment.count({ where: { currency: code } }),
    db.expense.count({ where: { currency: code } }),
  ]);
  return p + s + pay + e > 0;
}

// ─── PUT /api/currencies/[id] — ویرایش نام/نماد/فعال/ترتیب (کد تغییر نمی‌کند) ───
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    requirePermission(user, "currency.edit");
    const { id } = await ctx.params;
    const body = (await req.json()) as Record<string, unknown>;

    const existing = await db.currency.findUnique({ where: { id } });
    if (!existing) throw new ApiError("ارز یافت نشد", 404, "NOT_FOUND");

    const data: {
      name?: string;
      symbol?: string | null;
      isActive?: boolean;
      sortOrder?: number;
    } = {};

    const name = optString(body.name);
    if (name !== undefined) {
      if (!name) throw new ApiError("نام ارز نمی‌تواند خالی باشد", 422, "VALIDATION");
      data.name = name;
    }
    if (body.symbol !== undefined) data.symbol = optString(body.symbol) ?? null;
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
    if (body.sortOrder !== undefined) {
      data.sortOrder = Math.max(0, Math.floor(Number(body.sortOrder) || 0));
    }

    // ارز پایهٔ منبع API (دلر) نباید غیرفعال شود — ماتریس نرخ به آن وابسته است
    if (existing.isBase && data.isActive === false) {
      throw new ApiError(
        "ارز پایهٔ منبع نرخ (دالر) قابل غیرفعال‌سازی نیست",
        422,
        "VALIDATION",
      );
    }

    const updated = await db.currency.update({ where: { id }, data });
    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "UPDATE",
      entity: "Currency",
      entityId: id,
      summary: `ویرایش ارز ${existing.code}`,
      before: { name: existing.name, isActive: existing.isActive },
      after: data,
    });
    return ok({ item: updated });
  } catch (e) {
    return handleApiError(e);
  }
}

// ─── DELETE /api/currencies/[id] — حذف؛ اگر در اسناد استفاده شده باشد غیرفعال می‌شود ───
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    requirePermission(user, "currency.edit");
    const { id } = await ctx.params;

    const existing = await db.currency.findUnique({ where: { id } });
    if (!existing) throw new ApiError("ارز یافت نشد", 404, "NOT_FOUND");

    if (existing.isBase) {
      throw new ApiError("ارز پایهٔ منبع نرخ (دالر) قابل حذف نیست", 422, "VALIDATION");
    }

    const inUse = await isCurrencyInUse(existing.code);
    if (inUse) {
      const updated = await db.currency.update({
        where: { id },
        data: { isActive: false },
      });
      await logAudit(db, {
        userId: user.id,
        userName: user.fullName,
        branchId: user.branchId,
        action: "UPDATE",
        entity: "Currency",
        entityId: id,
        summary: `ارز ${existing.code} در اسناد استفاده شده — غیرفعال شد (حذف نشد)`,
      });
      return ok({
        softDeleted: true,
        message: `ارز ${existing.code} در اسناد استفاده شده است و غیرفعال شد`,
        item: updated,
      });
    }

    await db.currency.delete({ where: { id } });
    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "DELETE",
      entity: "Currency",
      entityId: id,
      summary: `حذف ارز ${existing.code}`,
      before: { code: existing.code, name: existing.name },
    });
    return ok({ deleted: true });
  } catch (e) {
    return handleApiError(e);
  }
}
