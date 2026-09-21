/**
 * Supabase Client Helper
 *
 * این ماژول یک Supabase Client برای استفاده‌های آینده (Auth, Storage, Realtime)
 * در اختیار قرار می‌دهد. در صورتی که env vars تنظیم نشده باشند، با undefined
 * برمی‌گردد تا برنامه خراب نشود.
 *
 * نکته: data layer اصلی پروژه از Prisma (src/lib/db.ts) استفاده می‌کند که
 * از طریق DATABASE_URL به PostgreSQL وصل می‌شود. این Supabase Client فقط
 * برای قابلیت‌های اضافی (مثل Auth, Storage, Realtime) است.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedClient: SupabaseClient | null = null;

/**
 * Supabase Client — در صورتی که NEXT_PUBLIC_SUPABASE_URL و
 * NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY تنظیم شده باشند، یک client
 * برمی‌گرداند. در غیر این صورت null برمی‌گرداند.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (cachedClient) return cachedClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return null;
  }

  cachedClient = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return cachedClient;
}

/**
 * آیا Supabase Client فعال است؟ (env vars تنظیم شده‌اند)
 */
export function isSupabaseEnabled(): boolean {
  return getSupabaseClient() !== null;
}

export type { SupabaseClient };
