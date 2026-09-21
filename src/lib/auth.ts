import "server-only";
import { cookies } from "next/headers";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "crypto";
import { db } from "./db";
import { ApiError } from "./api-utils";
import type { Prisma } from "@prisma/client";

export const SESSION_COOKIE = "pharma_session";
const SESSION_DAYS = 30;

// ─────────────────── Demo Mode (بدون نیاز به دیتابیس) ───────────────────
// وقتی دیتابیس در دسترس نباشد یا هنوز راه‌اندازی نشده باشد، login با این
// credentials به‌صورت cookie-only کار می‌کند. می‌توانید با env vars تغییر دهید.
const DEMO_ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "admin";
const DEMO_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "admin123";
const DEMO_TOKEN_PREFIX = "demo:";
const DEMO_USER_ID = "demo-admin";

export const DEMO_USER: AuthUser = {
  id: DEMO_USER_ID,
  username: DEMO_ADMIN_USERNAME,
  fullName: "مدیر ارشد سیستم (Demo)",
  roleKey: "SUPER_ADMIN",
  roleName: "مدیر ارشد سیستم (دفتر مرکزی)",
  permissions: ["*"],
  branchId: null,
  branchName: null,
  isSuperAdmin: true,
};

/** آیا این token مال demo session است؟ */
function isDemoToken(token: string): boolean {
  return token.startsWith(DEMO_TOKEN_PREFIX);
}

/** ساخت token برای demo session (به‌جای ذخیره در دیتابیس) */
function makeDemoToken(): string {
  return DEMO_TOKEN_PREFIX + randomBytes(32).toString("hex");
}

/** ساخت demo session و set کردن کوکی */
export async function createDemoSession(): Promise<string> {
  const token = makeDemoToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  return token;
}

/** چک credentials در برابر demo admin — بدون نیاز به دیتابیس */
export function checkDemoCredentials(username: string, password: string): boolean {
  // مقایسه با زمان ثابت برای جلوگیری از timing attack
  const u = Buffer.from(username);
  const p = Buffer.from(password);
  const eu = Buffer.from(DEMO_ADMIN_USERNAME);
  const ep = Buffer.from(DEMO_ADMIN_PASSWORD);
  if (u.length !== eu.length || p.length !== ep.length) {
    // تطابق طول برای timingSafeEqual لازم است؛ اگر فرق دارد، False برمی‌گردد
    return false;
  }
  return (
    timingSafeEqual(u, eu) &&
    timingSafeEqual(p, ep)
  );
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = scryptSync(password, salt, 64);
  const original = Buffer.from(hash, "hex");
  return (
    original.length === test.length && timingSafeEqual(original, test)
  );
}

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export type AuthUser = {
  id: string;
  username: string;
  fullName: string;
  roleKey: string;
  roleName: string;
  permissions: string[];
  branchId: string | null;
  branchName: string | null;
  isSuperAdmin: boolean;
};

export async function createSession(
  userId: string,
  device?: string,
  ip?: string
): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  try {
    await db.session.create({
      data: { token: hashToken(token), userId, device, ip, expiresAt },
    });
  } catch (e) {
    // اگر دیتابیس در دسترس نباشد، session در دیتابیس ذخیره نمی‌شود
    // اما cookie همچنان set می‌شود تا کاربر بتواند وارد شود (demo mode)
    console.warn("[auth] DB session create failed — cookie-only session:", e instanceof Error ? e.message : String(e));
  }
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  return token;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token && !isDemoToken(token)) {
    try {
      await db.session.deleteMany({ where: { token: hashToken(token) } });
    } catch (e) {
      console.warn("[auth] DB session delete failed (ignoring):", e instanceof Error ? e.message : String(e));
    }
  }
  store.delete(SESSION_COOKIE);
}

function parsePerms(raw: string): string[] {
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

export async function buildAuthUser(userId: string): Promise<AuthUser | null> {
  // اگر userId مال demo است، DEMO_USER را برگردان
  if (userId === DEMO_USER_ID) return DEMO_USER;

  const user = await db.user.findUnique({
    where: { id: userId },
    include: { role: true, branch: true },
  });
  if (!user || !user.isActive) return null;
  const perms = parsePerms(user.role.permissions);
  const isSuperAdmin = user.role.key === "SUPER_ADMIN" || perms.includes("*");
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    roleKey: user.role.key,
    roleName: user.role.name,
    permissions: isSuperAdmin ? ["*"] : perms,
    branchId: user.branchId,
    branchName: user.branch?.name ?? null,
    isSuperAdmin,
  };
}

/** خواندن کاربر فعلی بدون خطا (با پشتیبانی از demo session) */
export async function getSessionUser(): Promise<AuthUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  // ۱) demo session — مستقیم از cookie، بدون نیاز به دیتابیس
  if (isDemoToken(token)) {
    return DEMO_USER;
  }

  // ۲) database session
  try {
    const session = await db.session.findUnique({
      where: { token: hashToken(token) },
    });
    if (!session || session.expiresAt < new Date()) return null;
    return buildAuthUser(session.userId);
  } catch (e) {
    // اگر دیتابیس در دسترس نباشد، cookie وجود دارد ولی session در دیتابیس نیست
    // در اینجا کاربر را لاگ‌اوت نمی‌کنیم — فقط null برمی‌گردانیم
    console.warn("[auth] getSessionUser DB lookup failed:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

/** کاربر فعلی یا خطای 401 */
export async function requireUser(): Promise<AuthUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new ApiError("برای ادامه باید وارد سیستم شوید", 401, "UNAUTHORIZED");
  }
  return user;
}

export function hasPermission(user: AuthUser, perm: string): boolean {
  if (user.isSuperAdmin) return true;
  return user.permissions.includes(perm);
}

/** چک صلاحیت یا خطای 403 */
export function requirePermission(user: AuthUser, perm: string): void {
  if (!hasPermission(user, perm)) {
    throw new ApiError(
      "شما صلاحیت لازم برای این عملیه را ندارید",
      403,
      "FORBIDDEN"
    );
  }
}

/** آیا کاربر به شعبه مورد نظر دسترسی دارد؟ غیرسوپرادمین فقط شعبه خودش */
export function assertBranchAccess(user: AuthUser, branchId?: string | null): void {
  if (user.isSuperAdmin) return;
  if (!branchId) return;
  if (user.branchId && branchId !== user.branchId) {
    throw new ApiError(
      "شما به معلومات شعبه دیگر دسترسی ندارید",
      403,
      "BRANCH_FORBIDDEN"
    );
  }
  if (!user.branchId && !user.isSuperAdmin) {
    throw new ApiError(
      "حساب کاربری شما به هیچ شعبه‌ای مربوط نیست",
      403,
      "BRANCH_FORBIDDEN"
    );
  }
}

/** کاربر غیرسوپرادمین همیشه شعبه خودش؛ بازگشت undefined یعنی همه شعبه‌ها */
export function allowedBranchIds(user: AuthUser): string[] | undefined {
  if (user.isSuperAdmin) return undefined;
  return user.branchId ? [user.branchId] : [];
}

/** branchId مؤثر برای ایجاد رکورد توسط کاربر فعلی */
export function effectiveBranchId(user: AuthUser, requested?: string | null): string {
  if (user.isSuperAdmin) {
    if (!requested) {
      // سوپرادمین عضو یک شعبه است؟ همان شعبه؛ وگرنه خطا
      if (user.branchId) return user.branchId;
      throw new ApiError("انتخاب شعبه الزامی است", 422, "VALIDATION");
    }
    return requested;
  }
  if (!user.branchId) {
    throw new ApiError(
      "حساب کاربری شما به هیچ شعبه‌ای مربوط نیست",
      403,
      "BRANCH_FORBIDDEN"
    );
  }
  return user.branchId;
}

export type Tx = Prisma.TransactionClient;
