import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, getClientIp, handleApiError, ok } from "@/lib/api-utils";
import { assertBranchAccess, requirePermission, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/business";
import {
  bodyBool,
  bodyNum,
  bodyOptStr,
  bodyStr,
  handleRouteError,
  readBody,
} from "@/app/api/users/_shared";

/** تبدیل رشتهٔ تاریخ (YYYY-MM-DD یا ISO) به Date نیمه‌شب UTC */
function parseDayDate(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
}

type Ctx = { params: Promise<{ id: string }> };

// GET /api/employees/[id] — جزئیات کارمند + آخرین حاضری‌ها (hr.view)
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    requirePermission(user, "hr.view");
    const { id } = await ctx.params;

    const employee = await db.employee.findUnique({
      where: { id },
      include: {
        branch: { select: { id: true, code: true, name: true } },
        attendance: {
          orderBy: { date: "desc" },
          take: 60,
        },
      },
    });
    if (!employee) throw new ApiError("کارمند یافت نشد", 404, "NOT_FOUND");
    assertBranchAccess(user, employee.branchId);

    return ok(employee);
  } catch (e) {
    return handleApiError(e);
  }
}

// PUT /api/employees/[id] — ویرایش کارمند (hr.edit)
export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    requirePermission(user, "hr.edit");
    const { id } = await ctx.params;

    const existing = await db.employee.findUnique({ where: { id } });
    if (!existing) throw new ApiError("کارمند یافت نشد", 404, "NOT_FOUND");
    assertBranchAccess(user, existing.branchId);

    const body = await readBody(req);
    const data: {
      fullName?: string;
      fatherName?: string | null;
      phone?: string | null;
      position?: string | null;
      monthlySalary?: number;
      startDate?: Date;
      isActive?: boolean;
      note?: string | null;
      branchId?: string;
    } = {};

    if (body.fullName !== undefined) {
      const fullName = bodyStr(body, "fullName");
      if (!fullName) throw new ApiError("نام کارمند نمی‌تواند خالی باشد", 422, "VALIDATION");
      data.fullName = fullName;
    }
    if (body.fatherName !== undefined) data.fatherName = bodyOptStr(body, "fatherName");
    if (body.phone !== undefined) data.phone = bodyOptStr(body, "phone");
    if (body.position !== undefined) data.position = bodyOptStr(body, "position");
    if (body.note !== undefined) data.note = bodyOptStr(body, "note");
    if (body.monthlySalary !== undefined) {
      const salary = bodyNum(body, "monthlySalary", existing.monthlySalary);
      if (salary < 0) throw new ApiError("معاش ماهانه نمی‌تواند منفی باشد", 422, "VALIDATION");
      data.monthlySalary = salary;
    }
    if (body.startDate !== undefined && body.startDate !== null && body.startDate !== "") {
      const parsed = parseDayDate(body.startDate);
      if (!parsed) throw new ApiError("تاریخ شروع به کار نامعتبر است", 422, "VALIDATION");
      data.startDate = parsed;
    }
    if (body.isActive !== undefined) data.isActive = bodyBool(body, "isActive", true);

    // انتقال شعبه فقط توسط سوپرادمین
    if (body.branchId !== undefined && body.branchId !== null && body.branchId !== "") {
      const requested = bodyOptStr(body, "branchId");
      if (user.isSuperAdmin && requested && requested !== existing.branchId) {
        const branch = await db.branch.findUnique({ where: { id: requested } });
        if (!branch) throw new ApiError("شعبهٔ مقصد یافت نشد", 404, "NOT_FOUND");
        data.branchId = requested;
      }
    }

    const updated = await db.employee.update({ where: { id }, data });
    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "UPDATE",
      entity: "Employee",
      entityId: id,
      summary: `ویرایش کارمند «${updated.fullName}»`,
      before: existing,
      after: updated,
      ip: getClientIp(req),
    });
    return ok(updated);
  } catch (e) {
    return handleRouteError(e);
  }
}

// DELETE /api/employees/[id] — حذف کارمند و سوابق حاضری (hr.delete)
export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireUser();
    requirePermission(user, "hr.delete");
    const { id } = await ctx.params;

    const existing = await db.employee.findUnique({ where: { id } });
    if (!existing) throw new ApiError("کارمند یافت نشد", 404, "NOT_FOUND");
    assertBranchAccess(user, existing.branchId);

    await db.employee.delete({ where: { id } });
    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "DELETE",
      entity: "Employee",
      entityId: id,
      summary: `حذف کارمند «${existing.fullName}» به‌همراه سوابق حاضری`,
      before: existing,
      ip: getClientIp(req),
    });
    return ok({ deleted: true });
  } catch (e) {
    return handleRouteError(e);
  }
}
