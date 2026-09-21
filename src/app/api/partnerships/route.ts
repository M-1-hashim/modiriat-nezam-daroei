import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError, handleApiError, ok, toNum, parseDate } from "@/lib/api-utils";
import { requireUser, requirePermission, allowedBranchIds, effectiveBranchId } from "@/lib/auth";
import { logAudit } from "@/lib/business";
import { PARTNERSHIP_TYPES, MUDARABAH_ROLES, validateEquityShareSum } from "./_util";

// GET /api/partnerships?branchId&status&type
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    requirePermission(user, "partnerships.view");
    const url = new URL(req.url);

    const where: Prisma.PartnershipWhereInput = {};
    const allowed = allowedBranchIds(user);
    if (allowed) {
      where.branchId = { in: allowed };
    } else if (url.searchParams.get("branchId")) {
      where.branchId = url.searchParams.get("branchId") as string;
    }
    const status = url.searchParams.get("status");
    if (status) where.status = status;
    const type = url.searchParams.get("type");
    if (type) where.type = type;

    const partnerships = await db.partnership.findMany({
      where,
      include: {
        partner: { select: { id: true, name: true, phone: true } },
        branch: { select: { id: true, name: true } },
        _count: { select: { distributions: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return ok(partnerships);
  } catch (e) {
    return handleApiError(e);
  }
}

// POST /api/partnerships
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    requirePermission(user, "partnerships.create");
    const body = (await req.json()) as Record<string, unknown>;

    const branchId = effectiveBranchId(
      user,
      typeof body.branchId === "string" && body.branchId ? body.branchId : null
    );

    const partnerId = typeof body.partnerId === "string" ? body.partnerId : "";
    if (!partnerId) throw new ApiError("انتخاب شریک الزامی است", 422, "VALIDATION");
    const partner = await db.partner.findUnique({ where: { id: partnerId } });
    if (!partner) throw new ApiError("شریک یافت نشد", 404, "NOT_FOUND");

    const type = typeof body.type === "string" ? body.type : "";
    if (!PARTNERSHIP_TYPES.includes(type as (typeof PARTNERSHIP_TYPES)[number])) {
      throw new ApiError("نوع شراکت باید سهامی (EQUITY) یا مضاربه (MUDARABAH) باشد", 422, "VALIDATION");
    }

    let role: string | null = null;
    if (type === "MUDARABAH") {
      role = typeof body.role === "string" ? body.role : "";
      if (!MUDARABAH_ROLES.includes(role as (typeof MUDARABAH_ROLES)[number])) {
        throw new ApiError(
          "برای مضاربه، نقش (تأمین‌کننده سرمایه یا شریک کار) الزامی است",
          422,
          "VALIDATION"
        );
      }
    }

    const capital = toNum(body.capital, 0);
    if (!(capital >= 0)) throw new ApiError("سرمایه نمی‌تواند منفی باشد", 422, "VALIDATION");

    const profitSharePct = toNum(body.profitSharePct, 0);
    const lossSharePct = toNum(body.lossSharePct, 0);
    if (profitSharePct < 0 || profitSharePct > 100) {
      throw new ApiError("سهم سود باید بین ۰ تا ۱۰۰ درصد باشد", 422, "VALIDATION");
    }
    if (lossSharePct < 0 || lossSharePct > 100) {
      throw new ApiError("سهم ضرر باید بین ۰ تا ۱۰۰ درصد باشد", 422, "VALIDATION");
    }

    const startDate = parseDate(body.startDate) ?? new Date();
    const endDate = parseDate(body.endDate) ?? null;
    const profitMethod =
      typeof body.profitMethod === "string" && body.profitMethod.trim()
        ? body.profitMethod.trim()
        : null;
    const terms =
      typeof body.terms === "string" && body.terms.trim() ? body.terms.trim() : null;

    const created = await db.$transaction(async (tx) => {
      if (type === "EQUITY") {
        await validateEquityShareSum(tx, branchId, null, profitSharePct);
      }
      const row = await tx.partnership.create({
        data: {
          branchId,
          partnerId,
          type,
          role,
          capital,
          profitSharePct,
          lossSharePct,
          profitMethod,
          startDate,
          endDate,
          terms,
          status: "ACTIVE",
        },
      });
      await logAudit(tx, {
        userId: user.id,
        userName: user.fullName,
        branchId,
        action: "CREATE",
        entity: "Partnership",
        entityId: row.id,
        summary: `ثبت ${type === "EQUITY" ? "شراکت سهامی" : "مضاربه"} با شریک «${partner.name}» (سهم سود ${profitSharePct}٪)`,
        after: { id: row.id, type, capital, profitSharePct },
      });
      return row;
    });

    return ok(
      await db.partnership.findUnique({
        where: { id: created.id },
        include: {
          partner: { select: { id: true, name: true, phone: true } },
          branch: { select: { id: true, name: true } },
        },
      }),
      201
    );
  } catch (e) {
    return handleApiError(e);
  }
}
