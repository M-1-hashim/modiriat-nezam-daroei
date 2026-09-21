# راهنمای دپلوی در Vercel + Supabase 🚀

فقط **۳ مرحله** — تمام!

---

## مرحله ۱: دیتابیس Supabase را آماده کنید

۱. به [supabase.com](https://supabase.com) بروید → **New Project**
۲. نام و رمز قوی بسازید → **Create**
۳. از منوی سمت چپ: **SQL Editor** ← **New query**
۴. محتوای فایل [`supabase-schema.sql`](./supabase-schema.sql) را کپی و Paste کنید
۵. دکمه **Run** (Ctrl+Enter) را بزنید
۶. پیام «Success. No rows returned» را ببینید

---

## مرحله ۲: گرفتن Connection String

۱. در Supabase به **Project Settings (⚙️) ← Database** بروید
۲. به پایین اسکرول کنید تا **Connection string**
۳. تب **Session** را انتخاب کنید — چیزی شبیه:
   ```
   postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres
   ```

> ⚠️ **مهم:** حتماً از تب **Session** (نه Direct) استفاده کنید!
> Direct connection روی IPv6 است و Vercel serverless فقط IPv4 می‌دهد.

---

## مرحله ۳: دپلوی در Vercel

۱. به [vercel.com/new](https://vercel.com/new) بروید
۲. مخزن **`M-1-hashim/modiriat-nezam-daroei`** را انتخاب کنید
۳. در قسمت **Environment Variables**، این متغیرها را اضافه کنید:

### الزامی (برای کارکرد پروژه):

| Key | Value |
|---|---|
| `DATABASE_URL` | (همان connection string از مرحله ۲) |

### اختیاری (برای Supabase Client SDK در آینده):

| Key | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://[PROJECT_REF].supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | (از Supabase → Settings → API) |

۴. دکمه **Deploy** را بزنید
۵. ۲-۳ دقیقه صبر کنید

---

## ورود

پس از دیپلوی موفق، URL (مثل `pharma-xxx.vercel.app`) را باز کنید:

| نام کاربری | رمز |
|---|---|
| `admin` | `admin123` |

> 🔐 **بلافاصله پس از اولین ورود، رمز admin را تغییر دهید!**

---

## اگر ایرور دیدید

| ایرور | راه‌حل |
|---|---|
| `Can't reach database server` | از تب **Session** استفاده کنید (نه Direct) |
| `Environment Variable "DATABASE_URL" cannot be found` | در Vercel → Settings → Environment Variables، آن را اضافه و Redeploy بزنید |
| `relation does not exist` | SQL را در Supabase اجرا نکرده‌اید — مرحله ۱ را کامل کنید |
| `tenant/user postgres.XXX not found` | region اشتباه است — از Supabase dashboard بررسی کنید |
| `too many connections` | از Session Pooler استفاده کنید (نه Direct) |

---

## خلاصه در یک خط

> Supabase SQL اجرا → Session Pooler URL کپی → Vercel `DATABASE_URL` → Deploy → ورود با admin/admin123

**تمام!**
