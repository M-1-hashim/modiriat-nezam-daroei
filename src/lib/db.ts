import { PrismaClient } from '@prisma/client'

/**
 * آیا DATABASE_URL صحیح تنظیم شده؟
 * (پروتکل postgresql:// یا postgres://)
 */
export function isDbConfigured(): boolean {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  return url.startsWith('postgresql://') || url.startsWith('postgres://');
}

/**
 * یک PrismaClient "null" — هر روش Prisma که صدا زده شود، داده خالی برمی‌گرداند.
 * این باعث می‌شود همه APIها حتی بدون دیتابیس هم کار کنند و UI صفحه خالی نشان دهد
 * به‌جای این که با 500 خطا خراب شود.
 *
 * رفتار:
 *   - findMany / groupBy / findManyAndReturn  → []
 *   - findUnique / findFirst                  → null
 *   - count                                   → 0
 *   - aggregate                               → { _sum:{}, _avg:{}, _min:{}, _max:{}, _count:{} }
 *   - create / update / upsert / delete       → {} (همیشه یک آبجکت خالی)
 *   - deleteMany / updateMany                 → { count: 0 }
 *   - $transaction                            → نتیجه fn با خود null prisma
 *   - $queryRaw / $executeRaw                  → []
 *   - $disconnect / $connect                  → undefined
 */
function createNullPrisma(): PrismaClient {
  const nullModel = new Proxy({} as Record<string, unknown>, {
    get(_target, method: string) {
      return async (..._args: unknown[]) => {
        switch (method) {
          case 'findMany':
          case 'groupBy':
          case 'findManyAndReturn':
            return [];
          case 'findUnique':
          case 'findFirst':
          case 'findUniqueOrThrow':
          case 'findFirstOrThrow':
            return null;
          case 'count':
            return 0;
          case 'aggregate':
            return { _sum: {}, _avg: {}, _min: {}, _max: {}, _count: {} };
          case 'create':
          case 'createMany':
            return {};
          case 'createManyAndReturn':
            return [];
          case 'update':
          case 'updateMany':
          case 'upsert':
            return {};
          case 'delete':
            return {};
          case 'deleteMany':
            return { count: 0 };
          default:
            // روش‌های ناشناخته هم null برمی‌گردانند
            return null;
        }
      };
    },
  });

  const nullPrisma = new Proxy({} as PrismaClient, {
    get(_target, prop: string) {
      // روش‌های $
      if (prop.startsWith('$')) {
        if (prop === '$transaction') {
          return async (fn: (tx: unknown) => unknown) => {
            // $transaction می‌تواند آرایه‌ای از پرامیس‌ها یا یک تابع باشد
            if (typeof fn === 'function') {
              try { return await fn(nullPrisma); } catch { return undefined; }
            }
            if (Array.isArray(fn)) {
              return Promise.all(fn.map(async (p) => {
                try { return await p; } catch { return undefined; }
              }));
            }
            return undefined;
          };
        }
        if (prop === '$queryRaw' || prop === '$queryRawUnsafe' || prop === '$executeRaw' || prop === '$executeRawUnsafe') {
          return async () => [];
        }
        if (prop === '$disconnect' || prop === '$connect') {
          return async () => undefined;
        }
        return () => undefined;
      }
      // model handlers: db.user.findMany() etc.
      return nullModel;
    },
  });
  return nullPrisma;
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  nullPrisma: PrismaClient | undefined
}

// اگر DATABASE_URL تنظیم نشده باشد، از null prisma استفاده می‌کنیم
// این باعث می‌شود همه APIها بدون خطا داده خالی برگردانند (demo mode)
const _dbConfigured = isDbConfigured();
if (!_dbConfigured && process.env.NODE_ENV === "production") {
  console.warn("[db] DATABASE_URL not configured or invalid — using null Prisma (demo mode). All DB calls return empty data.");
}
export const db = _dbConfigured
  ? (globalForPrisma.prisma ?? new PrismaClient({
      log: ['query'],
    }))
  : (globalForPrisma.nullPrisma ?? (globalForPrisma.nullPrisma = createNullPrisma()))

if (process.env.NODE_ENV !== "production" && _dbConfigured) globalForPrisma.prisma = db