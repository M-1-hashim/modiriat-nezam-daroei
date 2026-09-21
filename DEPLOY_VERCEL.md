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

۱. در Supabase به **Project Settings (⚙️) → Database** بروید
۲. به پایین اسکرول کنید تا **Connection string**
۳. تب **Direct** (یا Session) را انتخاب کنید — چیزی شبیه:
   ```
   postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres
   ```
۴. کپی کنید — این همان `DATABASE_URL` است که در مرحله بعد لازم دارید

---

## مرحله ۳: دپلوی در Vercel

۱. به [vercel.com/new](https://vercel.com/new) بروید
۲. مخزن **`M-1-hashim/modiriat-nezam-daroei`** را انتخاب کنید
۳. در قسمت **Environment Variables**، فقط **یک** متغیر اضافه کنید:

| Key | Value |
|---|---|
| `DATABASE_URL` | (همان connection string از مرحله ۲) |

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
| `Environment Variable "DATABASE_URL" cannot be found` | در Vercel → Settings → Environment Variables، آن را اضافه و Redeploy بزنید |
| `relation does not exist` | SQL را در Supabase اجرا نکرده‌اید — مرحله ۱ را کامل کنید |
| `Can't reach database server` | connection string را چک کنید — Project Ref و رمز درست باشند |
| `too many connections` | در Supabase به Project Settings → Database → Connection pooling را فعال کنید |

---

## خلاصه در یک خط

> Supabase SQL اجرا → connection string کپی → Vercel `DATABASE_URL` → Deploy → ورود با admin/admin123

**تمام!**
