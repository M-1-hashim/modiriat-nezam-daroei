import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser, requirePermission } from "@/lib/auth";
import { logAudit } from "@/lib/business";
import { ok, fail, handleApiError, ApiError, getClientIp } from "@/lib/api-utils";

function isUniqueError(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

function optString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

function strOrNull(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// ─────────────────────────── GET /api/manufacturers (هر کاربر وارد — برای دراپ‌داون) ───────────────────────────
export async function GET(req: Request) {
  try {
    await requireUser();
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim() || "";

    const items = await db.manufacturer.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q } },
              { country: { contains: q } },
            ],
          }
        : {},
      orderBy: { name: "asc" },
      include: { _count: { select: { products: true } } },
    });
    return ok({ items });
  } catch (e) {
    return handleApiError(e);
  }
}

// ─────────────────────────── POST /api/manufacturers ───────────────────────────
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    requirePermission(user, "products.create");
    const body = (await req.json()) as Record<string, unknown>;
    const ip = getClientIp(req);

    const name = optString(body.name);
    if (!name) throw new ApiError("نام شرکت تولیدکننده الزامی است", 422, "VALIDATION");

    const manufacturer = await db.manufacturer.create({
      data: { name, country: strOrNull(body.country) },
    });

    await logAudit(db, {
      userId: user.id,
      userName: user.fullName,
      branchId: user.branchId,
      action: "CREATE",
      entity: "Manufacturer",
      entityId: manufacturer.id,
      summary: `ایجاد شرکت تولیدکنندهٔ «${manufacturer.name}»`,
      after: manufacturer,
      ip,
    });

    return ok(manufacturer, 201);
  } catch (e) {
    if (isUniqueError(e)) return fail("این مقدار قبلاً ثبت شده است", 409, "DUPLICATE");
    return handleApiError(e);
  }
}
