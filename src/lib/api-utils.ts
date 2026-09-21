import { NextResponse } from "next/server";

/** خطای استاندارد API — پیام‌ها همیشه دری باشند */
export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status = 400, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

export function fail(message: string, status = 400, code?: string) {
  return NextResponse.json({ ok: false, error: { message, code } }, { status });
}

export function handleApiError(e: unknown) {
  if (e instanceof ApiError) return fail(e.message, e.status, e.code);
  console.error("[api-error]", e);
  const message =
    e instanceof Error ? e.message : "خطای ناشناخته در سرور رخ داد";
  return fail(message, 500);
}

/** گرد کردن پول به دو رقم اعشار */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** گرد کردن نرخ اسعار به چهار رقم اعشار */
export function round4(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

export function toNum(v: unknown, def = 0): number {
  if (v === null || v === undefined || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export function parseDate(v: unknown): Date | undefined {
  if (!v) return undefined;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? undefined : d;
}

export function requireFields(
  body: Record<string, unknown>,
  fields: { key: string; label: string }[]
) {
  const missing = fields.filter(
    (f) =>
      body[f.key] === undefined ||
      body[f.key] === null ||
      body[f.key] === ""
  );
  if (missing.length > 0) {
    throw new ApiError(
      `مقدار این فیلدها الزامی است: ${missing.map((m) => m.label).join("، ")}`,
      422,
      "VALIDATION"
    );
  }
}

export function getPagination(url: URL, defaultLimit = 25) {
  const page = Math.max(1, toNum(url.searchParams.get("page"), 1));
  const limit = Math.min(200, Math.max(1, toNum(url.searchParams.get("limit"), defaultLimit)));
  return { page, limit, skip: (page - 1) * limit, take: limit };
}

export function getClientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    ""
  );
}
