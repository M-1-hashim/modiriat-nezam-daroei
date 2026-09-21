import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, handleApiError, ok } from "@/lib/api-utils";
import { allowedBranchIds, requirePermission, requireUser } from "@/lib/auth";
import { getSetting } from "@/lib/business";

function parseDayDate(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * GET /api/attendance/summary?from=YYYY-MM-DD&to=YYYY-MM-DD&branchId?&employeeId?
 * — خلاصهٔ حاضری و کسر معاش هر کارمند در بازه (hr.view)
 *
 * فرمول: کسر روزانه = معاش ماهانه ÷ روز مبنای محاسبه (تنظیمات attendance_base_days، پیش‌فرض ۳۰)
 * روزهای کسر = غایب + رخصتی تأییدنشده
 * معاش قابل پرداخت = معاش ماهانه − مبلغ کسر
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    requirePermission(user, "hr.view");

    const url = new URL(req.url);
    const sp = url.searchParams;
    const from = parseDayDate(sp.get("from")?.trim());
    const to = parseDayDate(sp.get("to")?.trim());
    if (!from || !to) {
      throw new ApiError("بازهٔ از تاریخ و تا تاریخ الزامی است", 422, "VALIDATION");
    }
    if (to < from) throw new ApiError("تاریخ پایان قبل از شروع است", 422, "VALIDATION");
    if (to.getTime() - from.getTime() > 400 * 24 * 60 * 60 * 1000) {
      throw new ApiError("بازهٔ انتخابی بیش از حد بزرگ است (حداکثر ۴۰۰ روز)", 422, "VALIDATION");
    }
    const toExclusive = new Date(to.getTime() + 24 * 60 * 60 * 1000);

    const branchParam = sp.get("branchId")?.trim();
    const employeeParam = sp.get("employeeId")?.trim();

    // روز مبنای محاسبه از تنظیمات
    const baseDaysRaw = await getSetting("attendance_base_days");
    const baseDays = Math.max(1, Number(baseDaysRaw) || 30);

    const whereEmp: {
      branchId?: string | { in: string[] };
      isActive?: boolean;
      id?: string;
    } = { isActive: true };
    const scopes = allowedBranchIds(user);
    if (scopes) {
      whereEmp.branchId = { in: scopes };
    } else if (branchParam && branchParam !== "all") {
      whereEmp.branchId = branchParam;
    }
    if (employeeParam && employeeParam !== "all") {
      whereEmp.id = employeeParam;
    }

    const employees = await db.employee.findMany({
      where: whereEmp,
      orderBy: { fullName: "asc" },
      include: { branch: { select: { id: true, name: true } } },
    });

    const ids = employees.map((e) => e.id);
    const records =
      ids.length > 0
        ? await db.attendanceRecord.findMany({
            where: { employeeId: { in: ids }, date: { gte: from, lt: toExclusive } },
            select: { employeeId: true, status: true, leaveApproved: true },
          })
        : [];

    const agg = new Map<string, { present: number; absent: number; leaveApproved: number; leaveUnapproved: number }>();
    for (const r of records) {
      let a = agg.get(r.employeeId);
      if (!a) {
        a = { present: 0, absent: 0, leaveApproved: 0, leaveUnapproved: 0 };
        agg.set(r.employeeId, a);
      }
      if (r.status === "PRESENT") a.present += 1;
      else if (r.status === "ABSENT") a.absent += 1;
      else if (r.status === "LEAVE") {
        if (r.leaveApproved) a.leaveApproved += 1;
        else a.leaveUnapproved += 1;
      }
    }

    const rows = employees.map((e) => {
      const a = agg.get(e.id) ?? { present: 0, absent: 0, leaveApproved: 0, leaveUnapproved: 0 };
      const deductableDays = a.absent + a.leaveUnapproved;
      const dailyRate = baseDays > 0 ? e.monthlySalary / baseDays : 0;
      const deduction = round2(deductableDays * dailyRate);
      const payable = round2(e.monthlySalary - deduction);
      return {
        employeeId: e.id,
        fullName: e.fullName,
        position: e.position,
        branchId: e.branchId,
        branchName: e.branch?.name ?? "—",
        monthlySalary: e.monthlySalary,
        present: a.present,
        absent: a.absent,
        leaveApproved: a.leaveApproved,
        leaveUnapproved: a.leaveUnapproved,
        deductableDays,
        dailyRate: round2(dailyRate),
        deduction,
        payable,
      };
    });

    const totals = rows.reduce(
      (t, r) => ({
        monthlySalary: round2(t.monthlySalary + r.monthlySalary),
        present: t.present + r.present,
        absent: t.absent + r.absent,
        leaveApproved: t.leaveApproved + r.leaveApproved,
        leaveUnapproved: t.leaveUnapproved + r.leaveUnapproved,
        deduction: round2(t.deduction + r.deduction),
        payable: round2(t.payable + r.payable),
      }),
      {
        monthlySalary: 0,
        present: 0,
        absent: 0,
        leaveApproved: 0,
        leaveUnapproved: 0,
        deduction: 0,
        payable: 0,
      }
    );

    return ok({
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      baseDays,
      rows,
      totals,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
