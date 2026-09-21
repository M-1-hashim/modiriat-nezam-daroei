"use client";

/** اعمال تم و رنگ ذخیره‌شده در شروع برنامه (در سمت کلاینت) */

import { useEffect } from "react";
import { initAppearance } from "@/lib/appearance";

export function AppThemeInit() {
  useEffect(() => {
    initAppearance();
  }, []);
  return null;
}
