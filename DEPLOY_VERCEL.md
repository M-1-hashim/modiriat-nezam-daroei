# راهنمای دپلوی در Vercel 🚀

این سند توضیح می‌دهد چگونه پروژه را به‌صورت آنلاین روی **Vercel** دیپلوی کنید.

---

## ۱. پیش‌نیازها

1. اکانت رایگان [Vercel](https://vercel.com) — می‌توانید با حساب GitHub وارد شوید.
2. مخزن GitHub: `https://github.com/M-1-hashim/modiriat-nezam-daroei`
3. یک دیتابیس PostgreSQL آنلاین — **ساده‌ترین گزینه: [Neon](https://neon.tech)** (رایگان، با GitHub Login)

> پروژه به‌صورت پیش‌فرض از **PostgreSQL** استفاده می‌کند (سازگار با Vercel serverless).

---

## ۲. مراحل دپلوی (۵ دقیقه)

### گام ۱: ساخت دیتابیس Neon (رایگان)

1. به [neon.tech](https://neon.tech) بروید و با GitHub وارد شوید.
2. **New Project** → نام بدهید (مثلاً `pharma-db`) → region `AWS US East` → **Create**.
3. در داشبورد Neon، دکمه **Connection string** را کپی کنید. چیزی شبیه:
   ```
   postgresql://neondb:AbCdEf123@ep-xxx-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

### گام ۲: دیپلوی در Vercel

1. به [vercel.com/new](https://vercel.com/new) بروید.
2. مخزن `M-1-hashim/modiriat-nezam-daroei` را انتخاب کنید.
3. در قسمت **Environment Variables**، این متغیر را اضافه کنید:
   - **Key:** `DATABASE_URL`
   - **Value:** (همان connection string که از Neon کپی کردید)
   - **Environment:** Production (و همچنین Preview و Development)
4. روی **Deploy** کلیک کنید.
5. چند دقیقه صبر کنید — Vercel خودکار `npm install` + `prisma generate` + `next build` را اجرا می‌کند.

### گام ۳: ساخت schema در دیتابیس

پس از اولین دیپلوی موفق، جدول‌ها را در دیتابیس بسازید. دو راه وجود دارد:

**روش A (آسان‌تر — از داشبورد Vercel):**
1. در Vercel به **Project → Settings → Functions** بروید.
2. یا یک Command Bar باز کنید و این را اجرا کنید:
   ```
   npx prisma db push
   ```
   (با `DATABASE_URL` که قبلاً تنظیم کردید)

**روش B (از لوکال):**
```bash
# ۱. فایل .env بسازید:
cp .env.example .env
# ۲. DATABASE_URL را در .env با connection string Neon جایگزین کنید.
# ۳. اجرا:
npx prisma db push
```

### گام ۴: ورود به سیستم

- آدرس `https://your-project.vercel.app` را باز کنید.
- در اولین بازدید، راه‌اندازی اولیه خودکار انجام می‌شود (رول‌ها، شعبه دفتر مرکزی کابل، گدام اصلی، کاربر admin).
- ورود پیش‌فرض:

| نام کاربری | رمز | نقش |
|---|---|---|
| `admin` | `admin123` | مدیر ارشد سیستم |

> 🔐 **بلافاصله پس از اولین ورود، رمز admin را تغییر دهید!**

---

## ۳. نکات و محدودیت‌ها

1. **نسخه‌های احتیاطی (Backups):** ویژگی backup/restore برای SQLite محلی طراحی شده بود. روی Vercel از کنسول Neon (تب **Branches** یا **Time Travel**) برای backup استفاده کنید.

2. **هاست کانکشن (SSH Tunnel):** این ویژگی برای اتصال از سرور لوکال به MySQL هاست اشتراکی بود. روی Vercel به آن نیازی نیست — دیتابیس Postgres خود را مستقیماً وصل کنید.

3. **PWA و آفلاین:** Service Worker و manifest کار می‌کنند. همگام‌سازی آفلاین نیز کار می‌کند اما به دلیل ماهیت serverless، داده‌های در حال پردازش باید کم باشد.

4. **Memory:** tier رایگان Vercel 1024MB حافظه دارد. برای گزارش‌های بسیار بزرگ، upgrade به Pro را در نظر بگیرید.

5. **Timeout:** توابع serverless روی Vercel حداکثر 10 ثانیه (رایگان) تا 60 ثانیه (Pro) اجرا می‌شوند.

---

## ۴. رفع مشکلات (Troubleshooting)

| مشکل | راه‌حل |
|---|---|
| `Environment Variable "DATABASE_URL" cannot be found` | در Project Settings → Environment Variables، آن را اضافه و rebuild کنید. |
| `PrismaClientInitializationError` | مطمئن شوید `DATABASE_URL` صحیح است و `npx prisma db push` اجرا شده. |
| خطای `sslmode` یا `SSL connection required` | رشته connection باید `?sslmode=require` در انتها داشته باشد. |
| خطای `relation does not exist` | `npx prisma db push` را اجرا نکرده‌اید — مرحله ۳ را انجام دهید. |
| صفحه خالی / 500 | لاگ‌ها را در Vercel → **Logs** ببینید. |

---

## ۵. دیپلوی مجدد پس از تغییرات

هر commit به شاخه `main` به‌صورت خودکار دیپلوی جدید ایجاد می‌کند:

```bash
git add .
git commit -m "..."
git push origin main
```

یا از داشبورد Vercel: **Deployments → ... → Redeploy**.

---

## ۶. تبدیل به SQLite برای لوکال (اختیاری)

اگر می‌خواهید لوکال بدون نصب PostgreSQL توسعه دهید:

1. در `prisma/schema.prisma`:
   ```prisma
   datasource db {
     provider = "sqlite"   // به‌جای postgresql
     url      = env("DATABASE_URL")
   }
   ```
2. در `.env`:
   ```
   DATABASE_URL="file:./db/custom.db"
   ```
3. `npx prisma db push` اجرا کنید.

**توجه:** این تغییر را commit و push نکنید — Vercel به PostgreSQL نیاز دارد.

---

**با تشکر از استفاده از این پروژه!** 🇦🇫
