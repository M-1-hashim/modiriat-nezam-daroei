import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, getClientIp, handleApiError, ok } from "@/lib/api-utils";
import {
  allowedBranchIds,
  assertBranchAccess,
  hasPermission,
  requirePermission,
  requireUser,
} from "@/lib/auth";
import { logAudit } from "@/lib/business";
import { formatHijriShort } from "@/lib/hijri";
import { handleRouteError, readBody } from "@/app/api/users/_shared";

/** تبدیل رشتهٔ تاریخ (YYYY-MM-DD یا ISO) به Date نیمه‌شب UTC */
function parseDayDate(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
}

const ATT_STATUS = ["PRESENT", "ABSENT", "LEAVE"] as const;
type AttStatus = (typeof ATT_STATUS)[number];

// GET /api/attendance?date | from+to  &branchId?&employeeId?&status?
// — سوابق حاضری (hr.view) با محدودیت شعبه
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    requirePermission(user, "hr.view");

    const url = new URL(req.url);
    const sp = url.searchParams;
    const dateParam = sp.get("date")?.trim();
    const fromParam = sp.get("from")?.trim();
    const toParam = sp.get("to")?.trim();
    const employeeId = sp.get("employeeId")?.trim();
    const branchParam = sp.get("branchId")?.trim();
    const statusParam = sp.get("status")?.trim();

    let from: Date | null = null;
    let to: Date | null = null;

    if (dateParam) {
      from = parseDayDate(dateParam);
      if (!from) throw new ApiError("تاریخ نامعتبر است", 422, "VALIDATION");
      to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
    } else if (fromParam && toParam) {
      from = parseDayDate(fromParam);
      to = parseDayDate(toParam);
      if (!from || !to) throw new ApiError("بازهٔ تاریخ نامعتبر است", 422, "VALIDATION");
      if (to < from) throw new ApiError("تاریخ پایان قبل از شروع است", 422, "VALIDATION");
      if (to.getTime() - from.getTime() > 400 * 24 * 60 * 60 * 1000) {
        throw new ApiError("بازهٔ انتخابی بیش از حد بزرگ است (حداکثر ۴۰۰ روز)", 422, "VALIDATION");
      }
      to = new Date(to.getTime() + 24 * 60 * 60 * 1000); // شمول روز پایان
    } else {
      throw new ApiError("یکی از پارامترهای date یا from+to الزامی است", 422, "VALIDATION");
    }

    const where: {
      date?: { gte: Date; lt: Date };
      branchId?: string | { in: string[] };
      employeeId?: string;
      status?: string;
    } = { date: { gte: from, lt: to } };

    const scopes = allowedBranchIds(user);
    if (scopes) {
      where.branchId = { in: scopes };
    } else if (branchParam && branchParam !== "all") {
      where.branchId = branchParam;
    }
    if (employeeId && employeeId !== "all") {
      where.employeeId = employeeId;
      // محدودیت شعبه برای کارمند انتخابی
      const emp = await db.employee.findUnique({ where: { id: employeeId } });
      if (emp) assertBranchAccess(user, emp.branchId);
    }
    if (statusParam && (ATT_STATUS as readonly string[]).includes(statusParam)) {
      where.status = statusParam;
    }

    const records = await db.attendanceRecord.findMany({
      where,
      orderBy: [{ date: "desc" }, { employeeId: "asc" }],
      include: {
        employee: { select: { id: true, fullName: true, position: true, monthlySalary: true } },
        branch: { select: { id: true, name: true } },
      },
      take: 5000,
    });
    return ok(records);
  } catch (e) {
    return handleApiError(e);
  }
}

type IncomingRecord = {
  employeeId: string;
  date: string;
  status: string;
  leaveApproved?: boolean;
  note?: string | null;
};

// POST /api/attendance — ثبت/بروزرسانی حاضری یک یا چند روز (hr.edit)
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    requirePermission(user, "hr.edit");

    const body = await readBody(req);
    const rawList = Array.isArray(body.records) ? body.records : [body];
    if (rawList.length === 0) {
      throw new ApiError("هیچ رکورد حاضری ارسال نشده است", 422, "VALIDATION");
    }
    if (rawList.length > 500) {
      throw new ApiError("حداکثر ۵۰۰ رکورد در هر درخواست", 422, "VALIDATION");
    }

    const canApproveLeave = hasPermission(user, "hr.approve");

    const parsed: {
      employeeId: string;
      date: Date;
      status: AttStatus;
      leaveApproved: boolean;
      note: string | null;
    }[] = [];

    const empCache = new Map<string, { id: string; branchId: string; fullName: string }>();

    for (const raw of rawList as IncomingRecord[]) {
      const employeeId = typeof raw?.employeeId === "string" ? raw.employeeId.trim() : "";
      if (!employeeId) throw new ApiError("شناسهٔ کارمند الزامی است", 422, "VALIDATION");

      const date = parseDayDate(raw?.date);
      if (!date) throw new ApiError("تاریخ حاضری نامعتبر است", 422, "VALIDATION");
      if (date.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
        throw new ApiError("ثبت حاضری برای روز آینده مجاز نیست", 422, "VALIDATION");
      }

      const status = String(raw?.status ?? "").trim() as AttStatus;
      if (!(ATT_STATUS as readonly string[]).includes(status)) {
        throw new ApiError("وضعیت حاضری باید حاضر، غایب یا رخصتی باشد", 422, "VALIDATION");
      }

      let emp = empCache.get(employeeId);
      if (!emp) {
        const found = await db.employee.findUnique({ where: { id: employeeId } });
        if (!found) throw new ApiError("کارمند یافت نشد", 404, "NOT_FOUND");
        emp = { id: found.id, branchId: found.branchId, fullName: found.fullName };
        empCache.set(employeeId, emp);
      }
      assertBranchAccess(user, emp.branchId);

      parsed.push({
        employeeId,
        date,
        status,
        // رخصتی فقط با صلاحیت hr.approve قابل تأیید است
        leaveApproved:
          status === "LEAVE" && canApproveLeave ? raw?.leaveApproved !== false : false,
        note: typeof raw?.note === "string" && raw.note.trim() !== "" ? raw.note.trim() : null,
      });
    }

    const upserts = parsed.map((r) =>
      db.attendanceRecord.upsert({
        where: { employeeId_date: { employeeId: r.employeeId, date: r.date } },
        create: {
          employeeId: r.employeeId,
          branchId: empCache.get(r.employeeId)!.branchId,
          date: r.date,
          status: r.status,
          leaveApproved: r.leaveApproved,
          note: r.note,
          recordedById: user.id,
        },
        update: {
          status: r.status,
          leaveApproved: r.leaveApproved,
          note: r.note,
          recordedById: user.id,
        },
      })
    );
    await db.$transaction(upserts);

    const first = parsed[0];
    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "CREATE",
      entity: "AttendanceRecord",
      summary: `ثبت/بروزرسانی حاضری ${parsed.length} رکورد (اولین: «${empCache.get(first.employeeId)!.fullName}» — ${formatHijriShort(first.date)})`,
      ip: getClientIp(req),
    });
    return ok({ saved: parsed.length });
  } catch (e) {
    return handleRouteError(e);
  }
}
