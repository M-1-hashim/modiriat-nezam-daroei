"use client";

/**
 * مدیریت ظاهر سیستم — تم‌های آماده و رنگ سفارشی آیتم‌ها (client-safe)
 *
 * شش تم مرجع سیستم (مطابق تصاویر مرجع):
 *  ۱. آبی مدرن (Modern Business)     — روشن، سایدبار آبی سرمه‌ای
 *  ۲. تیره حرفه‌ای (Dark Professional) — تاریک، تأکید فیروزه‌ای
 *  ۳. سبز تازه (Green Fresh)          — روشن، سایدبار سبز
 *  ۴. بنفش خلاقانه (Purple Creative)   — روشن، سایدبار بنفش
 *  ۵. مینیمال روشن (Light Minimal)     — روشن، خنثی و ساده
 *  ۶. دارک گرادیانت (Gradient Dark)    — تاریک با گرادیانت بنفش/فیروزه‌ای
 *
 * هر تم مجموعهٔ کامل توکن‌ها (پس‌زمینه، کارت، سایدبار، نمودارها و…) را در
 * globals.css تعریف می‌کند و به‌صورت یکپارچه روی همهٔ بخش‌ها اعمال می‌شود.
 */

export type ThemeMode = "light" | "dark";

export type ThemePreset = {
  id: string;
  /** نام فارسی تم */
  name: string;
  /** نام انگلیسی (مطابق تصاویر مرجع) */
  enName: string;
  /** حالت پیش‌فرض نمایش این تم — هنگام انتخاب خودکار اعمال می‌شود */
  mode: ThemeMode;
  /** رنگ‌های پیش‌نمایش: سایدبار، صفحه، تأکید، کارت */
  preview: { sidebar: string; page: string; accent: string; card: string };
};

export const DEFAULT_THEME_ID = "modern-blue";

/** تم‌های آمادهٔ سیستم — با globals.css هماهنگ است */
export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "modern-blue",
    name: "آبی مدرن",
    enName: "Modern Business",
    mode: "light",
    preview: { sidebar: "#1e40af", page: "#f3f6fb", accent: "#2563eb", card: "#ffffff" },
  },
  {
    id: "dark-pro",
    name: "تیره حرفه‌ای",
    enName: "Dark Professional",
    mode: "dark",
    preview: { sidebar: "#080e1c", page: "#0b1220", accent: "#22d3ee", card: "#121c31" },
  },
  {
    id: "green-fresh",
    name: "سبز تازه",
    enName: "Green Fresh",
    mode: "light",
    preview: { sidebar: "#16a34a", page: "#f4faf5", accent: "#16a34a", card: "#ffffff" },
  },
  {
    id: "purple-creative",
    name: "بنفش خلاقانه",
    enName: "Purple Creative",
    mode: "light",
    preview: { sidebar: "#6d28d9", page: "#f8f5fd", accent: "#7c3aed", card: "#ffffff" },
  },
  {
    id: "light-minimal",
    name: "مینیمال روشن",
    enName: "Light Minimal",
    mode: "light",
    preview: { sidebar: "#ffffff", page: "#fafafa", accent: "#334155", card: "#ffffff" },
  },
  {
    id: "gradient-dark",
    name: "دارک گرادیانت",
    enName: "Gradient Dark",
    mode: "dark",
    preview: { sidebar: "#312e81", page: "#0d0b21", accent: "#8b5cf6", card: "#161334" },
  },
];

/** آیا شناسهٔ تم معتبر است؟ (حفاظت در برابر مقدار قدیمی/نامعتبر حافظه) */
export function isValidThemeId(id: string): boolean {
  return THEME_PRESETS.some((t) => t.id === id);
}

/** رنگ‌های پیشنهادی برای رنگ سفارشی آیتم‌ها */
export const ITEM_COLOR_SUGGESTIONS: string[] = [
  "#059669", // زمردی
  "#0d9488", // فیروزه‌ای
  "#16a34a", // سبز
  "#65a30d", // لیمویی
  "#ca8a04", // زرد تیره
  "#d97706", // کهربایی
  "#ea580c", // نارنجی
  "#dc2626", // سرخ
  "#e11d48", // گلگون
  "#db2777", // صورتی
  "#7c3aed", // بنفش
  "#9333ea", // ارغوانی
  "#92400e", // قهوه‌ای
  "#475569", // خاکستری تیره
];

const LS_PRESET = "pharma_theme_preset";
const LS_ITEM_COLOR = "pharma_item_color";

const BRAND_PROPS = ["--brand", "--brand-foreground", "--primary-foreground"] as const;

// ─── استور سبک برای همگام‌سازی UI با تغییرات ظاهر ───

const appearanceListeners = new Set<() => void>();

/** اشتراک در تغییرات ظاهر (برای useSyncExternalStore) */
export function subscribeAppearance(cb: () => void): () => void {
  appearanceListeners.add(cb);
  return () => {
    appearanceListeners.delete(cb);
  };
}

function notifyAppearance(): void {
  for (const l of appearanceListeners) l();
}

/** درخشندگی نسبی رنگ hex برای محاسبه رنگ متن کنتراست */
function luminance(hex: string): number {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return 0;
  const ch = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** رنگ متن مناسب روی پس‌زمینهٔ رنگ داده‌شده */
export function contrastForeground(hex: string): string {
  return luminance(hex) > 0.45 ? "#1a1a1a" : "#ffffff";
}

/** اعمال تم آماده روی سند و ذخیره آن */
export function applyThemePreset(id: string, persist = true): void {
  const root = document.documentElement;
  const clean = isValidThemeId(id) ? id : DEFAULT_THEME_ID;
  root.dataset.appTheme = clean;
  if (persist) {
    try {
      localStorage.setItem(LS_PRESET, clean);
    } catch {
      /* حافظه در دسترس نیست */
    }
  }
  notifyAppearance();
}

/** اعمال رنگ سفارشی آیتم‌ها (رنگ خالی/نامعتبر = حذف رنگ سفارشی) */
export function applyItemColor(hex: string, persist = true): void {
  const root = document.documentElement;
  const style = root.style;
  const clean = (hex || "").trim().toLowerCase();
  const valid = /^#[0-9a-f]{6}$/.test(clean) || /^#[0-9a-f]{3}$/.test(clean);
  if (!valid) {
    for (const p of BRAND_PROPS) style.removeProperty(p);
    if (persist) {
      try {
        localStorage.removeItem(LS_ITEM_COLOR);
      } catch {
        /* حافظه در دسترس نیست */
      }
    }
    notifyAppearance();
    return;
  }
  const fg = contrastForeground(clean);
  style.setProperty("--brand", clean);
  style.setProperty("--brand-foreground", fg);
  style.setProperty("--primary-foreground", fg);
  if (persist) {
    try {
      localStorage.setItem(LS_ITEM_COLOR, clean);
    } catch {
      /* حافظه در دسترس نیست */
    }
  }
  notifyAppearance();
}

/** خواندن تم ذخیره‌شده */
export function getStoredPreset(): string {
  try {
    const stored = localStorage.getItem(LS_PRESET);
    return stored && isValidThemeId(stored) ? stored : DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

/** خواندن رنگ سفارشی ذخیره‌شده */
export function getStoredItemColor(): string {
  try {
    return localStorage.getItem(LS_ITEM_COLOR) || "";
  } catch {
    return "";
  }
}

/** اشتراک در تغییر کلاس dark روی سند (برای حالت نمایش next-themes) */
export function subscribeHtmlClass(cb: () => void): () => void {
  const observer = new MutationObserver(cb);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

/** وضعیت تاریک بودن سند */
export function isDocumentDark(): boolean {
  return document.documentElement.classList.contains("dark");
}

/** اعمال تنظیمات ذخیره‌شده در شروع برنامه */
export function initAppearance(): void {
  applyThemePreset(getStoredPreset(), false);
  const color = getStoredItemColor();
  if (color) applyItemColor(color, false);
}
