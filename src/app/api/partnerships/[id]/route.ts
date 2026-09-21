import { db } from "@/lib/db";
import { ApiError, handleApiError, ok, toNum, parseDate } from "@/lib/api-utils";
import { requireUser, requirePermission, assertBranchAccess } from "@/lib/auth";
import { logAudit } from "@/lib/business";
import { PARTNERSHIP_TYPES, MUDARABAH_ROLES, PARTNERSHIP_STATUSES, validateEquityShareSum } from "../_util";

// PUT /api/partnerships/[id] — بازاعتبارسنجی مجموع سهم‌ها با استثناکردن خود رکورد
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    requirePermission(user, "partnerships.edit");
    const { id } = await params;
    const partnership = await db.partnership.findUnique({ where: { id } });
    if (!partnership) throw new ApiError("شراکت یافت نشد", 404, "NOT_FOUND");
    assertBranchAccess(user, partnership.branchId);

    const body = (await req.json()) as Record<string, unknown>;

    const branchId =
      typeof body.branchId === "string" && body.branchId
        ? (() => {
            if (!user.isSuperAdmin && body.branchId !== user.branchId) {
              throw new ApiError("شما به معلومات شعبه دیگر دسترسی ندارید", 403, "BRANCH_FORBIDDEN");
            }
            return body.branchId;
          })()
        : partnership.branchId;

    const data: {
      branchId?: string;
      partnerId?: string;
      type?: string;
      role?: string | null;
      capital?: number;
      profitSharePct?: number;
      lossSharePct?: number;
      profitMethod?: string | null;
      startDate?: Date;
      endDate?: Date | null;
      terms?: string | null;
      status?: string;
    } = { branchId };

    if (body.partnerId !== undefined) {
      const partnerId = typeof body.partnerId === "string" ? body.partnerId : "";
      if (!partnerId) throw new ApiError("انتخاب شریک الزامی است", 422, "VALIDATION");
      const partner = await db.partner.findUnique({ where: { id: partnerId } });
      if (!partner) throw new ApiError("شریک یافت نشد", 404, "NOT_FOUND");
      data.partnerId = partnerId;
    }

    if (body.type !== undefined) {
      const type = typeof body.type === "string" ? body.type : "";
      if (!PARTNERSHIP_TYPES.includes(type as (typeof PARTNERSHIP_TYPES)[number])) {
        throw new ApiError("نوع شراکت باید سهامی (EQUITY) یا مضاربه (MUDARABAH) باشد", 422, "VALIDATION");
      }
      data.type = type;
    }
    const effectiveType = data.type ?? partnership.type;

    if (body.role !== undefined) {
      data.role = typeof body.role === "string" && body.role.trim() ? body.role.trim() : null;
    }
    const effectiveRole = body.role !== undefined ? data.role : partnership.role;
    if (effectiveType === "MUDARABAH") {
      if (!effectiveRole || !MUDARABAH_ROLES.includes(effectiveRole as (typeof MUDARABAH_ROLES)[number])) {
        throw new ApiError(
          "برای مضاربه، نقش (تأمین‌کننده سرمایه یا شریک کار) الزامی است",
          422,
          "VALIDATION"
        );
      }
    }

    if (body.capital !== undefined) {
      const capital = toNum(body.capital, 0);
      if (!(capital >= 0)) throw new ApiError("سرمایه نمی‌تواند منفی باشد", 422, "VALIDATION");
      data.capital = capital;
    }
    if (body.profitSharePct !== undefined) {
      const pct = toNum(body.profitSharePct, 0);
      if (pct < 0 || pct > 100) throw new ApiError("سهم سود باید بین ۰ تا ۱۰۰ درصد باشد", 422, "VALIDATION");
      data.profitSharePct = pct;
    }
    if (body.lossSharePct !== undefined) {
      const pct = toNum(body.lossSharePct, 0);
      if (pct < 0 || pct > 100) throw new ApiError("سهم ضرر باید بین ۰ تا ۱۰۰ درصد باشد", 422, "VALIDATION");
      data.lossSharePct = pct;
    }
    if (body.profitMethod !== undefined) {
      data.profitMethod =
        typeof body.profitMethod === "string" && body.profitMethod.trim() ? body.profitMethod.trim() : null;
    }
    if (body.startDate !== undefined) {
      const d = parseDate(body.startDate);
      if (!d) throw new ApiError("تاریخ شروع نامعتبر است", 422, "VALIDATION");
      data.startDate = d;
    }
    if (body.endDate !== undefined) {
      data.endDate = parseDate(body.endDate) ?? null;
    }
    if (body.terms !== undefined) {
      data.terms = typeof body.terms === "string" && body.terms.trim() ? body.terms.trim() : null;
    }
    if (body.status !== undefined) {
      const status = typeof body.status === "string" ? body.status : "";
      if (!PARTNERSHIP_STATUSES.includes(status as (typeof PARTNERSHIP_STATUSES)[number])) {
        throw new ApiError("وضعیت شراکت نامعتبر است", 422, "VALIDATION");
      }
      data.status = status;
    }

    const updated = await db.$transaction(async (tx) => {
      if (effectiveType === "EQUITY" && data.profitSharePct !== undefined) {
        await validateEquityShareSum(tx, branchId, id, data.profitSharePct);
      }
      const row = await tx.partnership.update({ where: { id }, data });
      await logAudit(tx, {
        userId: user.id,
        userName: user.fullName,
        branchId,
        action: "UPDATE",
        entity: "Partnership",
        entityId: id,
        summary: "ویرایش شراکت",
        before: {
          type: partnership.type,
          role: partnership.role,
          capital: partnership.capital,
          profitSharePct: partnership.profitSharePct,
          lossSharePct: partnership.lossSharePct,
          status: partnership.status,
        },
        after: data,
      });
      return row;
    });

    return ok(updated);
  } catch (e) {
    return handleApiError(e);
  }
}
