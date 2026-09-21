import { PrismaClient } from "@prisma/client";
import path from "path";
import { db } from "@/lib/db";
import type { Tx } from "@/lib/auth";

/** کاتالوگ کامل جدول‌ها به ترتیب وابستگی (والد → فرزند) برای ساخت مجدد */
export const RESTORE_CREATE_ORDER = [
  "systemSetting",
  "currencySettings",
  "exchangeRate",
  "role",
  "branch",
  "supplier",
  "warehouse",
  "territory",
  "salesperson",
  "numberSequence",
  "user",
  "customer",
  "session",
  "auditLog",
  "category",
  "manufacturer",
  "product",
  "batch",
  "expenseCategory",
  "expense",
  "stockItem",
  "stockMovement",
  "sale",
  "saleItem",
  "purchase",
  "purchaseItem",
  "payment",
  "salesReturn",
  "salesReturnItem",
  "purchaseReturn",
  "purchaseReturnItem",
  "partner",
  "partnership",
  "profitDistribution",
  "notification",
  "backup",
  "syncLog",
] as const;

export type RestoreModel = (typeof RESTORE_CREATE_ORDER)[number];

type Delegate = {
  findMany: (args?: Record<string, unknown>) => Promise<Record<string, unknown>[]>;
  createMany: (args: { data: Record<string, unknown>[] }) => Promise<unknown>;
  deleteMany: (args?: Record<string, unknown>) => Promise<unknown>;
};

/** مسیر فایل دیتابیس و پوشهٔ نسخه‌های احتیاطی از DATABASE_URL */
export function resolveDbPaths(): { dbPath: string; backupsDir: string } {
  const raw = process.env.DATABASE_URL ?? "file:./db/custom.db";
  const stripped = raw.startsWith("file:") ? raw.slice("file:".length) : raw;
  const dbPath = path.isAbsolute(stripped)
    ? stripped
    : path.join(process.cwd(), stripped);
  return { dbPath, backupsDir: path.join(path.dirname(dbPath), "backups") };
}

/**
 * بازیابی کامل دیتابیس از فایل نسخهٔ احتیاطی:
 * یک PrismaClient دوم به فایل بک‌آپ وصل می‌شود، همهٔ جدول‌ها را می‌خواند و
 * داخل تراکنش دیتابیس اصلی اول فرزندها را حذف و بعد همه را بازمی‌سازد.
 */
export async function restoreFromBackupFile(backupPath: string): Promise<number> {
  const second = new PrismaClient({ datasourceUrl: `file:${backupPath}` });
  try {
    const src = second as unknown as Record<string, Delegate>;

    // خواندن همهٔ ردیف‌ها از فایل بک‌آپ
    const data: Partial<Record<RestoreModel, Record<string, unknown>[]>> = {};
    for (const model of RESTORE_CREATE_ORDER) {
      if (model === "salesperson") {
        // رابطهٔ چند-به-چند مناطق هم خوانده شود
        data[model] = await src[model].findMany({
          include: { territories: { select: { id: true } } },
        });
      } else {
        data[model] = await src[model].findMany();
      }
    }

    return await db.$transaction(async (tx: Tx) => {
      const dest = tx as unknown as Record<string, Delegate>;

      // ۱) حذف از فرزند → والد
      for (const model of [...RESTORE_CREATE_ORDER].reverse()) {
        await dest[model].deleteMany({});
      }

      // ۲) بازسازی از والد → فرزند
      let total = 0;
      for (const model of RESTORE_CREATE_ORDER) {
        const rows = data[model];
        if (!rows || rows.length === 0) continue;
        if (model === "salesperson") {
          const plain = rows.map((r) => {
            const { territories, ...rest } = r;
            void territories;
            return rest;
          });
          await dest[model].createMany({ data: plain });
          // اتصال مجدد مناطق (m2m)
          for (const r of rows) {
            const rel = r.territories;
            if (Array.isArray(rel) && rel.length > 0) {
              const ids = rel
                .map((t) =>
                  typeof t === "object" && t !== null && "id" in t
                    ? String((t as { id: unknown }).id)
                    : ""
                )
                .filter((s) => s !== "");
              if (ids.length > 0) {
                await tx.salesperson.update({
                  where: { id: String(r.id) },
                  data: { territories: { set: ids.map((id) => ({ id })) } },
                });
              }
            }
          }
        } else {
          await dest[model].createMany({ data: rows });
        }
        total += rows.length;
      }
      return total;
    });
  } finally {
    await second.$disconnect();
  }
}
