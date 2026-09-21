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
  await db.session.create({
    data: { token: hashToken(token), userId, device, ip, expiresAt },
  });
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
  if (token) {
    await db.session.deleteMany({ where: { token: hashToken(token) } });
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

/** خواندن کاربر فعلی بدون خطا */
export async function getSessionUser(): Promise<AuthUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { token: hashToken(token) },
  });
  if (!session || session.expiresAt < new Date()) return null;
  return buildAuthUser(session.userId);
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
