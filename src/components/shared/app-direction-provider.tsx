"use client";

/**
 * ارائه‌دهندهٔ جهت (Direction) برای تمام کامپوننت‌های Radix UI
 *
 * بدون این wrapper، همهٔ پریمیتیوهای Radix (Tabs، Select، Dialog، Dropdown و...)
 * پیش‌فرض dir="ltr" دارند و محتوای داخلی‌شان — از جمله فهرست‌های داخل تب‌ها —
 * چپ‌به‌راست نمایش داده می‌شود. با dir="rtl" در ریشهٔ برنامه، تمام
 * کامپوننت‌های Radix و زیردرخت‌های آن‌ها راست‌به‌چپ می‌شوند.
 */

import { DirectionProvider as RadixDirectionProvider } from "@radix-ui/react-direction";

export function AppDirectionProvider({ children }: { children: React.ReactNode }) {
  return <RadixDirectionProvider dir="rtl">{children}</RadixDirectionProvider>;
}
