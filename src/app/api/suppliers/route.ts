import { db } from "@/lib/db";
import { ApiError, getClientIp, getPagination, handleApiError, ok } from "@/lib/api-utils";
import { requirePermission, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/business";

// GET /api/suppliers — لیست تأمین‌کنندگان (سراسری، بدون فیلتر شعبه)
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    requirePermission(user, "suppliers.view");

    const url = new URL(req.url);
    const { page, limit, skip, take } = getPagination(url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    const type = url.searchParams.get("type")?.trim() ?? "";

    const where = {
      ...(type ? { type } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { phone: { contains: q } },
              { email: { contains: q } },
              { country: { contains: q } },
              { contactPerson: { contains: q } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      db.supplier.findMany({
        where,
        orderBy: [{ name: "asc" as const }],
        skip,
        take,
      }),
      db.supplier.count({ where }),
    ]);

    return ok({ items, total, page, limit });
  } catch (e) {
    return handleApiError(e);
  }
}

// POST /api/suppliers — ثبت تأمین‌کننده جدید
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    requirePermission(user, "suppliers.create");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw new ApiError("نام تأمین‌کننده الزامی است", 422, "VALIDATION");
    const type = typeof body.type === "string" && body.type.trim() ? body.type.trim().toUpperCase() : "LOCAL";
    if (type !== "LOCAL" && type !== "FOREIGN") {
      throw new ApiError("نوع تأمین‌کننده باید محلی یا بیگانه باشد", 422, "VALIDATION");
    }

    const created = await db.$transaction(async (tx) => {
      const supplier = await tx.supplier.create({
        data: {
          name,
          type,
          country: typeof body.country === "string" ? body.country.trim() || null : null,
          contactPerson:
            typeof body.contactPerson === "string" ? body.contactPerson.trim() || null : null,
          phone: typeof body.phone === "string" ? body.phone.trim() || null : null,
          email: typeof body.email === "string" ? body.email.trim() || null : null,
          address: typeof body.address === "string" ? body.address.trim() || null : null,
        },
      });
      await logAudit(tx, {
        userId: user.id,
        userName: user.fullName,
        branchId: null,
        action: "CREATE",
        entity: "Supplier",
        entityId: supplier.id,
        summary: `ثبت تأمین‌کننده جدید: ${supplier.name}`,
        ip: getClientIp(req),
      });
      return supplier;
    });

    return ok(created);
  } catch (e) {
    return handleApiError(e);
  }
}
