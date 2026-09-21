import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, getClientIp, handleApiError, ok } from "@/lib/api-utils";
import {
  allowedBranchIds,
  effectiveBranchId,
  requirePermission,
  requireUser,
} from "@/lib/auth";
import { logAudit } from "@/lib/business";
import {
  bodyNum,
  bodyOptStr,
  bodyStr,
  handleRouteError,
  readBody,
} from "@/app/api/users/_shared";

/** تبدیل رشتهٔ تاریخ (YYYY-MM-DD یا ISO) به Date نیمه‌شب UTC */
export function parseDayDate(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
}

// GET /api/employees?branchId?&active? — فهرست کارکنان (hr.view) با محدودیت شعبه
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    requirePermission(user, "hr.view");

    const url = new URL(req.url);
    const branchParam = url.searchParams.get("branchId")?.trim();
    const activeParam = url.searchParams.get("active")?.trim();

    const where: {
      branchId?: string | { in: string[] };
      isActive?: boolean;
    } = {};
    const scopes = allowedBranchIds(user);
    if (scopes) {
      where.branchId = { in: scopes };
    } else if (branchParam && branchParam !== "all") {
      where.branchId = branchParam;
    }
    if (activeParam === "true") where.isActive = true;
    else if (activeParam === "false") where.isActive = false;

    const employees = await db.employee.findMany({
      where,
      orderBy: [{ fullName: "asc" }],
      include: {
        branch: { select: { id: true, code: true, name: true } },
        _count: { select: { attendance: true } },
      },
    });
    return ok(employees);
  } catch (e) {
    return handleApiError(e);
  }
}

// POST /api/employees — ثبت کارمند جدید (hr.create)
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    requirePermission(user, "hr.create");

    const body = await readBody(req);
    const fullName = bodyStr(body, "fullName");
    if (!fullName) throw new ApiError("نام و نام خانوادگی کارمند الزامی است", 422, "VALIDATION");

    const branchId = effectiveBranchId(user, bodyOptStr(body, "branchId"));
    const branch = await db.branch.findUnique({ where: { id: branchId } });
    if (!branch) throw new ApiError("شعبهٔ انتخاب‌شده یافت نشد", 404, "NOT_FOUND");

    const monthlySalary = bodyNum(body, "monthlySalary", 0);
    if (monthlySalary < 0) {
      throw new ApiError("معاش ماهانه نمی‌تواند منفی باشد", 422, "VALIDATION");
    }

    let startDate = new Date();
    const sdRaw = body.startDate;
    if (sdRaw !== undefined && sdRaw !== null && sdRaw !== "") {
      const parsed = parseDayDate(sdRaw);
      if (!parsed) throw new ApiError("تاریخ شروع به کار نامعتبر است", 422, "VALIDATION");
      startDate = parsed;
    }

    const created = await db.employee.create({
      data: {
        branchId,
        fullName,
        fatherName: bodyOptStr(body, "fatherName"),
        phone: bodyOptStr(body, "phone"),
        position: bodyOptStr(body, "position"),
        monthlySalary,
        startDate,
        note: bodyOptStr(body, "note"),
      },
      include: {
        branch: { select: { id: true, code: true, name: true } },
      },
    });

    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "CREATE",
      entity: "Employee",
      entityId: created.id,
      summary: `ثبت کارمند جدید «${fullName}» در شعبهٔ ${branch.name}`,
      after: created,
      ip: getClientIp(req),
    });
    return ok(created, 201);
  } catch (e) {
    return handleRouteError(e);
  }
}
