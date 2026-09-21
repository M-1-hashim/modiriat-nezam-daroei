/**
 * instrumentation.ts — قلاب راه‌اندازی سرور (Next.js)
 *
 * زمان‌بند به‌روزرسانی خودکار نرخ اسعار را در لحظهٔ استارت سرور فعال می‌کند
 * تا بازهٔ «هر N دقیقه» (تنظیم بخش اسعار — پیش‌فرض ۱۵ دقیقه) همیشه در حال
 * اجرا باشد، بدون اینکه نیاز باشد کاربر اول وارد ماژول اسعار شود.
 *
 * نکته: فقط در ران‌تایم nodejs اجرا می‌شود (نه edge) و خطاها هرگز
 * استارت سرور را نمی‌شکنند.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { ensureRateScheduler, maybeAutoSync } = await import("@/lib/rate-sync");
    ensureRateScheduler();
    // اولین بررسی بلافاصله پس از بوت — اگر نرخ‌ها کهنه باشند در پس‌زمینه همگام می‌شود
    void maybeAutoSync();
    console.log("[instrumentation] rate scheduler started");
  } catch (e) {
    console.error("[instrumentation] rate scheduler failed to start:", e);
  }
  try {
    // ۱) اگر دیتابیس خالی/پاک‌شده باشد، جدیدترین نسخهٔ پشتیبان خودکار برمی‌گردد
    const { restoreIfWiped, ensureAutoBackupScheduler } = await import(
      "@/lib/auto-backup"
    );
    await restoreIfWiped();
    // ۲) پشتیبان‌گیری خودکار — هر ۱۵ دقیقه در db/backups و /home/sync/db-backups
    ensureAutoBackupScheduler();
  } catch (e) {
    console.error("[instrumentation] auto-backup scheduler failed to start:", e);
  }
}
