import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser, requirePermission } from "@/lib/auth";
import { logAudit } from "@/lib/business";
import { ok, handleApiError, ApiError } from "@/lib/api-utils";
import { ensureCurrencies, ensureRateScheduler, maybeAutoSync } from "@/lib/rate-sync";

function isUniqueError(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

function optString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

// ─── GET /api/currencies — هر کاربر وارد؛ درج idempotent ارزهای پیش‌فرض + شروع زمان‌بند ───
export async function GET() {
  try {
    await requireUser();
    ensureRateScheduler();
    await ensureCurrencies();
    void maybeAutoSync();

    const items = await db.currency.findMany({
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    });
    return ok({ items });
  } catch (e) {
    return handleApiError(e);
  }
}

// ─── POST /api/currencies — افزودن ارز جدید (لیست قابل توسعه) ───
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    requirePermission(user, "currency.edit");
    const body = (await req.json()) as Record<string, unknown>;

    const code = optString(body.code)?.toUpperCase();
    const name = optString(body.name);
    const symbol = optString(body.symbol);
    const sortOrder = Math.max(0, Math.floor(Number(body.sortOrder ?? 100)) || 100);

    if (!code || !/^[A-Z]{3}$/.test(code)) {
      throw new ApiError("کد ارز باید سه حرف انگلیسی باشد (مثال: CNY)", 422, "VALIDATION");
    }
    if (!name) throw new ApiError("نام ارز الزامی است", 422, "VALIDATION");

    try {
      const created = await db.currency.create({
        data: { code, name, symbol: symbol ?? null, sortOrder },
      });
      await logAudit(db, {
        userId: user.id,
        userName: user.fullName,
        branchId: user.branchId,
        action: "CREATE",
        entity: "Currency",
        entityId: created.id,
        summary: `افزودن ارز ${code} — ${name}`,
        after: { code, name, symbol, sortOrder },
      });
      return ok({ item: created }, 201);
    } catch (e) {
      if (isUniqueError(e)) {
        throw new ApiError("این کد ارز قبلاً ثبت شده است", 409, "DUPLICATE");
      }
      throw e;
    }
  } catch (e) {
    return handleApiError(e);
  }
}
