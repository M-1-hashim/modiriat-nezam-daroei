import { db } from "@/lib/db";
import { ApiError, handleApiError, ok } from "@/lib/api-utils";
import { requireUser, requirePermission } from "@/lib/auth";
import { logAudit } from "@/lib/business";

// GET /api/partners
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    requirePermission(user, "partnerships.view");
    const url = new URL(req.url);
    const q = url.searchParams.get("q");

    const partners = await db.partner.findMany({
      where: q
        ? { OR: [{ name: { contains: q } }, { phone: { contains: q } }] }
        : undefined,
      include: { _count: { select: { partnerships: true } } },
      orderBy: { name: "asc" },
    });
    return ok(partners);
  } catch (e) {
    return handleApiError(e);
  }
}

// POST /api/partners {name, phone?, note?}
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    requirePermission(user, "partnerships.create");
    const body = (await req.json()) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw new ApiError("نام شریک الزامی است", 422, "VALIDATION");
    const phone = typeof body.phone === "string" && body.phone.trim() ? body.phone.trim() : null;
    const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;

    const created = await db.$transaction(async (tx) => {
      const row = await tx.partner.create({ data: { name, phone, note } });
      await logAudit(tx, {
        userId: user.id,
        userName: user.fullName,
        branchId: user.branchId,
        action: "CREATE",
        entity: "Partner",
        entityId: row.id,
        summary: `ایجاد شریک «${name}»`,
        after: { id: row.id, name },
      });
      return row;
    });

    return ok(created, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
