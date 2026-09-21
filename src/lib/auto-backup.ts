/**
 * auto-backup.ts — پشتیبان‌گیری خودکار دیتابیس + بازگردانی خودکار پس از پاک‌شدگی
 *
 * پیشینه: در رویداد ۲۰۲۶/۰۷/۰۲ (سپتامبر ۲۰۲۶) محیط میزبانی ری‌استارت شد و
 * مکانیزم اسنپ‌شات پلتفرم، پوشهٔ db/ را شامل نمی‌شد — کل دیتابیس از دست رفت.
 *
 * این ماژول دو سپر ایجاد می‌کند:
 *
 *  ۱) پشتیبان‌گیری دوره‌ای (هر ۱۵ دقیقه) در دو محل:
 *     - db/backups/ → با رکورد Backup (نوع AUTO) → در بخش «نسخه‌های احتیاطی»
 *       دیده می‌شود و از همان‌جا قابل بازگردانی است
 *     - /home/sync/db-backups/ → مونتِ پایدار که با ری‌استارت کانتینر
 *       از بین نمی‌رود (همان جایی که repo.tar پلتفرم زندگی می‌کند)
 *
 *  ۲) بازگردانی خودکار در بوت (restoreIfWiped): اگر دیتابیس موقع استارت
 *     سرور «خالی» باشد (هیچ کاربری ندارد = تازه bootstrap شده یا صفر شده)
 *     و نسخهٔ پشتیبان موجود باشد، جدیدترین نسخه به‌طور خودکار برمی‌گردد —
 *     بدون نیاز به دخالت کاربر.
 *
 * فراخوانی دستی: POST /api/backups/auto (اجازهٔ backup.create)
 */

import { promises as fs } from "fs";
import path from "path";
import { db } from "@/lib/db";
import { resolveDbPaths } from "@/app/api/backups/_restore";

const RETENTION_UI = 24; // نسخه در db/backups (۶ ساعت با فواصل ۱۵ دقیقه‌ای)
const RETENTION_SYNC = 16; // نسخه در /home/sync (۴ ساعت پوشش)
const INTERVAL_MS = 15 * 60 * 1000; // هر ۱۵ دقیقه
const FIRST_RUN_DELAY_MS = 20 * 1000; // ۲۰ ثانیه پس از بوت
const MIN_BACKUP_BYTES = 50 * 1024; // کمتر از این = فایل خراب

const SYNC_BACKUPS_DIR = "/home/sync/db-backups";

export type AutoBackupResult = {
  skipped: boolean;
  reason?: string;
  filename?: string;
  sizeKb?: number;
  syncSaved?: boolean;
};

/** آیا سیستم هیچ دادهٔ کاری دارد؟ (فقط راه‌اندازی اولیه نباشد) */
async function hasBusinessData(): Promise<boolean> {
  const counts = await Promise.all([
    db.product.count(),
    db.customer.count(),
    db.supplier.count(),
    db.sale.count(),
    db.purchase.count(),
    db.expense.count(),
    db.payment.count(),
    db.partner.count(),
    db.partnership.count(),
    db.category.count(),
    db.stockItem.count(),
  ]);
  return counts.some((c) => c > 0);
}

function stampName(prefix: string): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 17); // سال تا میلی‌ثانیه — بدون تصادم
  return `${prefix}-${stamp}.db`;
}

/**
 * گرفتن یک نسخهٔ پشتیبان خودکار از فایل دیتابیس در دو محل.
 * enforce=true → حتی برای سیستم خالی هم نسخه بگیر (فراخوانی دستی)
 */
export async function runAutoBackup(
  options: { enforce?: boolean } = {},
): Promise<AutoBackupResult> {
  const { dbPath, backupsDir } = resolveDbPaths();

  try {
    await fs.access(dbPath);
  } catch {
    return { skipped: true, reason: "DB_FILE_MISSING" };
  }

  if (!options.enforce && !(await hasBusinessData())) {
    console.log("[auto-backup] skip — سیستم هنوز دادهٔ کاری ندارد (EMPTY_DB)");
    return { skipped: true, reason: "EMPTY_DB" };
  }

  await fs.mkdir(backupsDir, { recursive: true });

  const filename = stampName("auto");
  const dest = path.join(backupsDir, filename);

  await fs.copyFile(dbPath, dest);
  const stat = await fs.stat(dest);

  await db.backup.create({
    data: {
      filename,
      size: stat.size,
      type: "AUTO",
      status: "OK",
      note: "پشتیبان‌گیری خودکار سیستم",
      createdBy: null,
      createdByName: null,
    },
  });

  // کپی دوم در مونت پایدار /home/sync — در برابر ری‌ست کامل محیط مقاوم است
  let syncSaved = false;
  try {
    await fs.mkdir(SYNC_BACKUPS_DIR, { recursive: true });
    await fs.copyFile(dbPath, path.join(SYNC_BACKUPS_DIR, filename));
    syncSaved = true;
  } catch (e) {
    console.error("[auto-backup] sync-dir copy failed:", e);
  }

  await pruneAutoBackups(backupsDir, RETENTION_UI);
  await pruneSyncBackups(RETENTION_SYNC);

  const sizeKb = Math.round(stat.size / 1024);
  console.log(
    `[auto-backup] نسخهٔ خودکار گرفته شد: ${filename} (${sizeKb} کیلوبایت)${syncSaved ? " + sync" : ""}`,
  );
  return { skipped: false, filename, sizeKb, syncSaved };
}

/** نگه‌داشتن حداکثر limit نسخهٔ AUTO در db/backups؛ حذف رکورد + فایل قدیمی‌ها */
async function pruneAutoBackups(backupsDir: string, limit: number): Promise<void> {
  try {
    const olds = await db.backup.findMany({
      where: { type: "AUTO" },
      orderBy: { createdAt: "desc" },
      skip: limit,
    });
    for (const row of olds) {
      await fs
        .unlink(path.join(backupsDir, row.filename))
        .catch(() => undefined);
      await db.backup.delete({ where: { id: row.id } }).catch(() => undefined);
    }
  } catch (e) {
    console.error("[auto-backup] retention failed:", e);
  }
}

/** نگه‌داشتن حداکثر limit نسخه در /home/sync/db-backups */
async function pruneSyncBackups(limit: number): Promise<void> {
  try {
    const files = (await fs.readdir(SYNC_BACKUPS_DIR))
      .filter((f) => f.endsWith(".db"))
      .sort()
      .reverse();
    for (const f of files.slice(limit)) {
      await fs
        .unlink(path.join(SYNC_BACKUPS_DIR, f))
        .catch(() => undefined);
    }
  } catch {
    // پوشهٔ sync موجود نیست — نادیده گرفته می‌شود
  }
}

/**
 * جدیدترین نسخهٔ پشتیبان موجود (sync اول، بعد db/backups)
 * Returns the newest valid candidate or null.
 */
async function newestBackupFile(): Promise<string | null> {
  const { backupsDir } = resolveDbPaths();
  const dirs = [SYNC_BACKUPS_DIR, backupsDir];
  for (const dir of dirs) {
    try {
      const files = (await fs.readdir(dir))
        .filter((f) => f.endsWith(".db"))
        .sort()
        .reverse(); // نام شامل مهر زمانی است — جدیدترین آخر (sort نزولی) اول
      for (const f of files) {
        const p = path.join(dir, f);
        try {
          const st = await fs.stat(p);
          if (st.size >= MIN_BACKUP_BYTES) return p;
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * بازگردانی خودکار پس از پاک‌شدگی — در استارت سرور، پیش از هر اتصال دیگر.
 * اگر دیتابیس هیچ کاربری نداشته باشد (خالی/bootstrapنشده) و نسخهٔ پشتیبان
 * موجود باشد، جدیدترین نسخه روی فایل دیتابیس کپی می‌شود.
 */
export async function restoreIfWiped(): Promise<boolean> {
  try {
    const userCount = await db.user.count();
    if (userCount > 0) return false; // دیتابیس زنده است — کاری نکن

    const backupPath = await newestBackupFile();
    if (!backupPath) {
      console.log(
        "[auto-backup] دیتابیس خالی است و نسخهٔ پشتیبانی موجود نیست — از صفر شروع می‌شود",
      );
      return false;
    }

    const { dbPath } = resolveDbPaths();
    // قطع اتصال قبل از جایگزینی فایل تا pool به inode قدیمی متصل نماند
    await db.$disconnect();

    await fs.copyFile(backupPath, dbPath);
    const st = await fs.stat(dbPath);
    console.log(
      `[auto-backup] ✅ دیتابیس خالی شناسایی شد — از نسخهٔ پشتیبان بازگردانی شد: ${backupPath} (${Math.round(st.size / 1024)} کیلوبایت)`,
    );
    return true;
  } catch (e) {
    console.error("[auto-backup] restoreIfWiped failed:", e);
    return false;
  }
}

// ─── زمان‌بند (singleton در سطح پروسه) ───

type AutoBackupGlobal = typeof globalThis & {
  __autoBackupStarted?: boolean;
};
const g = globalThis as AutoBackupGlobal;

/** فعال‌سازی زمان‌بند پشتیبان‌گیری خودکار — یک‌بار در عمر پروسه */
export function ensureAutoBackupScheduler(): void {
  if (g.__autoBackupStarted) return;
  g.__autoBackupStarted = true;

  const tick = () => {
    runAutoBackup().catch((e) =>
      console.error("[auto-backup] scheduled run failed:", e),
    );
  };

  setTimeout(tick, FIRST_RUN_DELAY_MS).unref();
  setInterval(tick, INTERVAL_MS).unref();
  console.log("[auto-backup] scheduler started (هر ۱۵ دقیقه — دو محل)");
}
