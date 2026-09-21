# راهنمای دپلوی در Vercel 🚀

این سند توضیح می‌دهد چگونه این پروژه را به‌صورت آنلاین روی **Vercel** دیپلوی کنید.

---

## ۱. پیش‌نیازها

1. اکانت رایگان [Vercel](https://vercel.com) — می‌توانید با حساب GitHub وارد شوید.
2. مخزن GitHub: `https://github.com/M-1-hashim/modiriat-nezam-daroei`
3. (برای پروداکشن) یک دیتابیس آنلاین — یکی از گزینه‌های زیر:
   - **[Neon](https://neon.tech)** — PostgreSQL سرورلس، tier رایگان عالی (توصیه‌شده)
   - **[Vercel Postgres](https://vercel.com/storage/postgres)** — یک کلیک به پروژه وصل می‌شود
   - **[PlanetScale](https://planetscale.com)** — MySQL سرورلس
   - **[Supabase](https://supabase.com)** — PostgreSQL با قابلیت‌های بیشتر

> ⚠️ **توجه مهم درباره دیتابیس:**
> پروژه به‌صورت پیش‌فرض از **SQLite** (فایل محلی) استفاده می‌کند که برای توسعه لوکال عالی است.
> اما روی Vercel به دلیل ماهیت serverless (سیستم فایل موقتی)، SQLite داده‌ها را بین درخواست‌ها
> حفظ نمی‌کند. برای پروداکشن باید به **PostgreSQL** یا **MySQL** سوئیچ کنید (مرحله ۴).

---

## ۲. مرحله ۱: دیپلوی روی Vercel

### روش A: از داشبورد Vercel

1. به [vercel.com/new](https://vercel.com/new) بروید.
2. مخزن `M-1-hashim/modiriat-nezam-daroei` را از لیست GitHub انتخاب کنید.
3. در قسمت **Environment Variables**، مقادیر زیر را اضافه کنید:
   - `DATABASE_URL` = (URL دیتابیس پروداکشن شما — مرحله ۴ را ببینید)
4. روی **Deploy** کلیک کنید.
5. چند دقیقه صبر کنید؛ Vercel خودکار `npm install` و `npm run build` را اجرا می‌کند.

### روش B: از Vercel CLI

```bash
# نصب CLI
npm i -g vercel

# در پوشه پروژه:
vercel          # پیش‌نمایش (preview)
vercel --prod   # پروداکشن
```

---

## ۳. مرحله ۲: تنظیم Environment Variables در Vercel

به **Project Settings → Environment Variables** بروید و این‌ها را تنظیم کنید:

| نام متغیر | مقدار | توضیح |
|---|---|---|
| `DATABASE_URL` | `postgresql://...` یا `mysql://...` | رشته اتصال دیتابیس پروداکشن |
| `NEXT_PUBLIC_SITE_URL` | `https://your-project.vercel.app` | (اختیاری) آدرس سایت برای لینک‌های مطلق |

---

## ۴. مرحله ۳: آماده‌سازی دیتابیس پروداکشن

### گزینه A: Neon PostgreSQL (توصیه‌شده — رایگان و ساده)

1. به [neon.tech](https://neon.tech) بروید و حساب بسازید (با GitHub وارد شوید).
2. یک پروژه جدید بسازید.
3. رشته اتصال را از داشبورد Neon کپی کنید:
   ```
   postgresql://user:password@ep-xxx.region.aws.neon.tech/dbname?sslmode=require
   ```
4. در `prisma/schema.prisma`، `provider` را تغییر دهید:
   ```prisma
   datasource db {
     provider = "postgresql"   // ← از "sqlite" به "postgresql"
     url      = env("DATABASE_URL")
   }
   ```
5. commit و push:
   ```bash
   git add prisma/schema.prisma
   git commit -m "switch: SQLite → PostgreSQL for Vercel production"
   git push origin main
   ```
6. Vercel به‌صورت خودکار rebuild می‌کند.
7. **بعد از دیپلوی موفق**، schema را به دیتابیس اعمال کنید:
   - به Vercel → **Terminal** (یا در لوکال با `.env` تنظیم‌شده) بروید و اجرا کنید:
     ```bash
     npx prisma db push
     ```
   - یا می‌توانید آن را به build command اضافه کنید (با احتیاط):
     ```
     prisma generate && prisma db push --accept-data-loss && next build
     ```

### گزینه B: Vercel Postgres (یک‌کلیک)

1. در داشبورد Vercel به **Storage** بروید.
2. **Create Database → Postgres (Neon)** را انتخاب کنید.
3. به پروژه وصل کنید — Vercel خودکار `DATABASE_URL` و سایر متغیرها را ست می‌کند.
4. همانند گزینه A، `provider = "postgresql"` در schema قرار دهید.

### گزینه C: PlanetScale MySQL

1. به [planetscale.com](https://planetscale.com) بروید و database بسازید.
2. connection string را بگیرید (به شکل `mysql://...`).
3. در `prisma/schema.prisma`:
   ```prisma
   datasource db {
     provider = "mysql"
     url      = env("DATABASE_URL")
   }
   ```
4. commit و push.

---

## ۵. ورود اولیه به سیستم

پس از دیپلوی موفق و اجرای `prisma db push`:

- آدرس `https://your-project.vercel.app` را باز کنید.
- سیستم در اولین بازدید، راه‌اندازی اولیه خودکار را انجام می‌دهد (رول‌ها، شعبه دفتر مرکزی کابل، گدام اصلی، کاربر admin).
- ورود پیش‌فرض:

| نام کاربری | رمز | نقش |
|---|---|---|
| `admin` | `admin123` | مدیر ارشد سیستم |

> 🔐 **بلافاصله پس از اولین ورود، رمز admin را تغییر دهید!**

---

## ۶. نکات و محدودیت‌های مهم

1. **نسخه‌های احتیاطی (Backups):** ویژگی backup/restore بر پایه فایل SQLite کار می‌کرد. روی Vercel serverless، این قابلیت به‌صورت سنتی کار نخواهد کرد. برای backup از کنسول دیتابیس (Neon/PlanetScale) استفاده کنید.

2. **هاست کانکشن (SSH Tunnel):** این ویژگی برای اتصال از سرور لوکال به MySQL هاست اشتراکی طراحی شده بود. روی Vercel به آن نیازی ندارید — دیتابیس خود را به‌صورت مستقیم به رله‌ی آنلاین وصل کنید.

3. **PWA و آفلاین:** Service Worker و manifest در پوشه `public/` کار خواهند کرد. اما همگام‌سازی آفلاین به دلیل محدودیت‌های serverless ممکن است در شرایط خاص متفاوت رفتار کند. برای بهترین نتیجه، از یک شاخه مشترک از دیتابیس آنلاین استفاده کنید.

4. **Memory:** برای تکمیل عملیات‌های سنگین (مثل گزارش‌های بزرگ)، Vercel tier رایگان 1024MB حافظه دارد. اگر با خطای حافظه مواجه شدید، upgrade به Pro را در نظر بگیرید.

5. **Timeout:** توابع serverless روی Vercel حداکثر 10 ثانیه روی tier رایگان (و 60 ثانیه روی Pro) اجرا می‌شوند. اگر گزارش‌های خیلی بزرگ دارید، آن‌ها را به بخش‌های کوچک‌تر تقسیم کنید.

---

## ۷. رفع مشکلات (Troubleshooting)

| مشکل | راه‌حل |
|---|---|
| `Environment Variable "DATABASE_URL" cannot be found` | در Project Settings → Environment Variables، آن را اضافه و rebuild کنید. |
| `PrismaClientInitializationError` | مطمئن شوید `postinstall: prisma generate` در `package.json` موجود است (هست). |
| خطای migration / schema mismatch | `npx prisma db push` را با DATABASE_URL تنظیم‌شده اجرا کنید. |
| صفحه خالی یا 404 | یک بار دیگر `vercel --prod` اجرا یا `Redeploy` بزنید. |
| خطای `output: "standalone"` | مشکلی نیست؛ Vercel آن را خودکار هندل می‌کند. |

---

## ۸. دیپلوی مجدد پس از تغییرات

هر commit به شاخه `main` به‌صورت خودکار دیپلوی جدید ایجاد می‌کند. برای دیپلوی دستی:

```bash
git add .
git commit -m "..."
git push origin main
```

یا از داشبورد Vercel: **Deployments → ... → Redeploy**.

---

**با تشکر از استفاده از این پروژه!** 🇦🇫
