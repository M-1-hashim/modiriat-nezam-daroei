/**
 * هِلپرهای مشترک مسیرهای مدیریتی (فقط برای فایل‌های این پروژه توسط ایجنت 2-a استفاده می‌شود)
 * این فایل route نیست — Next.js آن را نادیده می‌گیرد.
 */
import { ApiError, handleApiError } from "@/lib/api-utils";
import type { AuthUser } from "@/lib/auth";

/** خواندن امن بدنهٔ JSON — هرگز پرتاب خطا نمی‌کند */
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const j: unknown = await req.json();
    return j && typeof j === "object" && !Array.isArray(j)
      ? (j as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** آیا خطای Prisma مربوط به تکراری بودن مقدار یکتاست؟ */
export function isDuplicateKeyError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: unknown }).code === "P2002"
  );
}

/** هندل مرکزی خطاها — خطای یکتا بودن را به پیام دری دوستانه تبدیل می‌کند */
export function handleRouteError(e: unknown, duplicateMsg?: string) {
  if (isDuplicateKeyError(e)) {
    return handleApiError(
      new ApiError(
        duplicateMsg ?? "این مقدار قبلاً ثبت شده است — مورد مشابهی از قبل وجود دارد",
        409,
        "DUPLICATE"
      )
    );
  }
  return handleApiError(e);
}

/** فقط مدیر ارشد سیستم */
export function requireSuperAdmin(
  user: AuthUser,
  message = "فقط مدیر ارشد سیستم مجاز است"
): void {
  if (!user.isSuperAdmin) {
    throw new ApiError(message, 403, "SUPER_ADMIN_ONLY");
  }
}

export function bodyStr(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  return typeof v === "string" ? v.trim() : "";
}

export function bodyOptStr(
  body: Record<string, unknown>,
  key: string
): string | undefined {
  const v = body[key];
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

export function bodyBool(
  body: Record<string, unknown>,
  key: string,
  def = false
): boolean {
  const v = body[key];
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v === "true" || v === "1";
  if (typeof v === "number") return v !== 0;
  return def;
}

export function bodyNum(
  body: Record<string, unknown>,
  key: string,
  def = 0
): number {
  const v = body[key];
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : def;
}

/** کپی رکورد بدون فیلدهای حساس (مثل passwordHash) */
export function stripFields<T extends object>(
  obj: T,
  keys: string[]
): Record<string, unknown> {
  const out = { ...(obj as Record<string, unknown>) };
  for (const k of keys) delete out[k];
  return out;
}

/** پارس رشتهٔ JSON صلاحیت‌ها */
export function parsePermsField(raw: string): string[] {
  try {
    const a: unknown = JSON.parse(raw);
    return Array.isArray(a) ? a.map(String) : [];
  } catch {
    return [];
  }
}
