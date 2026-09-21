# راهنمای دپلوی در Vercel + Supabase 🚀

این سند توضیح می‌دهد چگونه پروژه را به‌صورت آنلاین روی **Vercel** با دیتابیس **Supabase** دیپلوی کنید.

---

## ۱. پیش‌نیازها

1. اکانت رایگان [Vercel](https://vercel.com) — با GitHub وارد شوید.
2. اکانت رایگان [Supabase](https://supabase.com) — با GitHub وارد شوید.
3. مخزن GitHub: `https://github.com/M-1-hashim/modiriat-nezam-daroei`

---

## ۲. مراحل (حدود ۱۰ دقیقه)

### گام ۱: ساخت پروژه Supabase

1. به [supabase.com](https://supabase.com) بروید و **New Project** بزنید.
2. نام پروژه: `pharma-db` (یا هر نام دلخواه).
3. **Database Password**: یک رمز قوی بسازید و در جای امن ذخیره کنید (Supabase آن را دوباره نشان نمی‌دهد).
4. Region: `East US` یا نزدیک‌ترین region (ترجیحاً همان region که Vercel پروژه را میزبانی می‌کند).
5. **Create new project** → چند دقیقه صبر کنید.

### گام ۲: گرفتن connection strings

1. در داشبورد Supabase به **Project Settings (⚙️) → Database** بروید.
2. به پایین اسکرول کنید تا قسمت **Connection string** را ببینید.
3. دو URL مورد نیاز وجود دارد:

#### A) Transaction pooler (پورت 6543) — برای `DATABASE_URL`
تب **Transaction** را انتخاب کنید (نه Session و نه Direct). چیزی شبیه:
```
postgresql://postgres.abcdefghijklmno:[YOUR_PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
```
به انتها این را اضافه کنید (برای PgBouncer + Prisma):
```
?pgbouncer=true&connection_limit=1&prepared_statement_suffix=$1
```
**نتیجه نهایی `DATABASE_URL`:**
```
postgresql://postgres.abcdefghijklmno:[YOUR_PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1&prepared_statement_suffix=$1
```

#### B) Session pooler (پورت 5432) — برای `DIRECT_URL`
همان صفحه، تب **Session** (یاDirect) را انتخاب کنید. چیزی شبیه:
```
postgresql://postgres.abcdefghijklmno:[YOUR_PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres
```
این به‌عنوان `DIRECT_URL` استفاده می‌شود (بدون query params).

### گام ۳: دیپلوی در Vercel

1. به [vercel.com/new](https://vercel.com/new) بروید.
2. مخزن `M-1-hashim/modiriat-nezam-daroei` را انتخاب کنید.
3. در قسمت **Environment Variables**، این دو متغیر را اضافه کنید:

| Key | Value | Environment |
|---|---|---|
| `DATABASE_URL` | (URL pooler پورت 6543 با `?pgbouncer=true...`) | Production, Preview, Development |
| `DIRECT_URL` | (URL مستقیم پورت 5432 بدون query params) | Production, Preview, Development |

4. روی **Deploy** کلیک کنید.
5. چند دقیقه صبر کنید — Vercel خودکار `npm install` + `prisma generate` + `next build` را اجرا می‌کند.

### گام ۴: ساخت schema در دیتابیس Supabase

پس از اولین دیپلوی موفق، جدول‌ها را در دیتابیس بسازید.

**روش آسان (از لوکال):**
```bash
# ۱. فایل .env بسازید:
cp .env.example .env

# ۲. در .env، DATABASE_URL و DIRECT_URL را با مقادیر Supabase پر کنید.

# ۳. اجرا (Prisma خودکار از DIRECT_URL برای migration استفاده می‌کند):
npx prisma db push
```

**روش جایگزین (از داشبورد Supabase):**
1. در Supabase → **SQL Editor** بروید.
2. خروجی `npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script` را کپی و اجرا کنید.

### گام ۵: ورود به سیستم

- آدرس `https://your-project.vercel.app` را باز کنید.
- در اولین بازدید، راه‌اندازی اولیه خودکار انجام می‌شود (رول‌ها، شعبه دفتر مرکزی کابل، گدام اصلی، کاربر admin).
- ورود پیش‌فرض:

| نام کاربری | رمز | نقش |
|---|---|---|
| `admin` | `admin123` | مدیر ارشد سیستم |

> 🔐 **بلافاصله پس از اولین ورود، رمز admin را تغییر دهید!**

---

## ۳. نکات و محدودیت‌ها

1. **نسخه‌های احتیاطی (Backups):** ویژگی backup/restore برای SQLite محلی بود. روی Supabase از **Backups** تب در داشبورد Supabase یا **PITR (Point-in-Time Recovery)** استفاده کنید.

2. **PgBouncer + Prisma:** به‌خاطر داشته باشید که `DATABASE_URL` (pooler) برای runtime و `DIRECT_URL` برای migration است. اگر اشتباه جایگزین کنید، migration با خطای `prepared statement` می‌شکند.

3. **Connection Limits:** tier رایگان Supabase محدودیت connection دارد (معمولاً 60). به‌خاطر همین از pooler (پورت 6543) استفاده می‌کنیم.

4. **هاست کانکشن (SSH Tunnel):** این ویژگی برای MySQL هاست اشتراکی بود. روی Vercel + Supabase به آن نیازی نیست.

5. **PWA و آفلاین:** Service Worker و manifest کار می‌کنند.

6. **Timeout:** توابع serverless روی Vercel حداکثر 10 ثانیه (رایگان) تا 60 ثانیه (Pro) اجرا می‌شوند.

---

## ۴. رفع مشکلات (Troubleshooting)

| مشکل | راه‌حل |
|---|---|
| `Environment Variable "DATABASE_URL" cannot be found` | در Vercel → Settings → Environment Variables، آن را اضافه و rebuild کنید. |
| `Error: prepared statement ... does not exist` | شما از `DIRECT_URL` در `DATABASE_URL` استفاده کرده‌اید — pooler (پورت 6543) را جایگزین کنید. |
| `relation does not exist` | مرحله ۴ (`npx prisma db push`) را اجرا نکرده‌اید. |
| `too many connections` | مطمئن شوید `DATABASE_URL` از pooler (پورت 6543) استفاده می‌کند، نه Direct. |
| خطای `sslmode` | Supabase به‌صورت پیش‌فرض SSL دارد؛ نیازی به `?sslmode=require` نیست. |
| `Can't reach database server` | Project Ref و Region را در URL چک کنید؛ تست کنید که پروژه Supabase در حالت Active است. |

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

**با تشکر از استفاده از این پروژه!** 🇦🇫
