"use client";

/** تنظیمات ظاهر — انتخاب تم (۶ تم مرجع)، حالت نمایش (روشن/تاریک) و رنگ سفارشی آیتم‌ها */

import { useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Check, Moon, Paintbrush, Palette, RotateCcw, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DEFAULT_THEME_ID,
  ITEM_COLOR_SUGGESTIONS,
  THEME_PRESETS,
  applyItemColor,
  applyThemePreset,
  contrastForeground,
  getStoredItemColor,
  getStoredPreset,
  isDocumentDark,
  subscribeAppearance,
  subscribeHtmlClass,
  type ThemePreset,
} from "@/lib/appearance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const HEX_6 = /^#[0-9a-fA-F]{6}$/;
const HEX_ANY = /^#[0-9a-fA-F]{6}$|^#[0-9a-fA-F]{3}$/;

/** پیش‌نمایش مصور هر تم — شبیه‌سازی کوچک داشبورد (سایدبار + کارت‌ها) */
function ThemePreview({ theme }: { theme: ThemePreset }) {
  const { sidebar, page, accent, card } = theme.preview;
  return (
    <span
      aria-hidden
      className="flex h-20 w-full overflow-hidden rounded-lg border shadow-inner"
      style={{ backgroundColor: page }}
    >
      {/* سایدبار (در RTL سمت راست قرار می‌گیرد) */}
      <span className="flex w-9 shrink-0 flex-col gap-1.5 p-1.5" style={{ backgroundColor: sidebar }}>
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: accent }} />
        <span className="h-1.5 w-full rounded-full bg-white/25" />
        <span
          className="h-1.5 w-full rounded-full"
          style={{ backgroundColor: accent }}
        />
        <span className="h-1.5 w-full rounded-full bg-white/25" />
        <span className="h-1.5 w-full rounded-full bg-white/25" />
      </span>
      {/* محتوا */}
      <span className="flex flex-1 flex-col gap-1.5 p-1.5">
        <span className="flex gap-1.5">
          <span
            className="h-5 flex-1 rounded-md border border-black/5"
            style={{ backgroundColor: card }}
          />
          <span
            className="h-5 flex-1 rounded-md border border-black/5"
            style={{ backgroundColor: card }}
          />
        </span>
        <span
          className="h-5 flex-1 rounded-md border border-black/5"
          style={{ backgroundColor: card }}
        />
        <span
          className="h-1.5 w-1/2 rounded-full"
          style={{ backgroundColor: accent }}
        />
      </span>
    </span>
  );
}

export function AppearanceSettings() {
  const { setTheme } = useTheme();

  // وضعیت ظاهر از استور خارجی خوانده می‌شود (بدون setState در effect)
  const preset = useSyncExternalStore(subscribeAppearance, getStoredPreset, () => DEFAULT_THEME_ID);
  const itemColor = useSyncExternalStore(subscribeAppearance, getStoredItemColor, () => "");
  const isDark = useSyncExternalStore(subscribeHtmlClass, isDocumentDark, () => false);

  // پیش‌نویس تایپ رنگ دلخواه — تا رنگ نامعتبر میانی اعمال نشود
  const [hexDraft, setHexDraft] = useState<string | null>(null);

  /** انتخاب تم — حالت نمایش (روشن/تاریک) هم مطابق تم مرجع تنظیم می‌شود */
  const choosePreset = (t: ThemePreset) => {
    applyThemePreset(t.id, true);
    setTheme(t.mode);
  };
  const chooseColor = (hex: string) => {
    setHexDraft(null);
    applyItemColor(hex, true);
  };

  const activePreset = preset;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {/* ─── تغییر تم ─── */}
      <section
        className="rounded-xl border bg-card text-card-foreground shadow-sm"
        aria-labelledby="appearance-theme-title"
      >
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Palette className="h-4 w-4 text-primary" />
          <h2 id="appearance-theme-title" className="text-base font-semibold">
            تغییر تم
          </h2>
        </div>
        <div className="grid gap-4 p-4">
          {/* حالت نمایش */}
          <div className="grid gap-2">
            <p className="text-sm font-medium">حالت نمایش</p>
            <div
              className="flex w-fit overflow-hidden rounded-lg border"
              role="group"
              aria-label="حالت نمایش"
            >
              <button
                type="button"
                onClick={() => setTheme("light")}
                aria-pressed={!isDark}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-2 text-sm transition-colors",
                  !isDark ? "bg-primary font-semibold text-primary-foreground" : "hover:bg-muted"
                )}
              >
                <Sun className="h-4 w-4" />
                روشن
              </button>
              <button
                type="button"
                onClick={() => setTheme("dark")}
                aria-pressed={isDark}
                className={cn(
                  "flex items-center gap-1.5 border-s px-4 py-2 text-sm transition-colors",
                  isDark ? "bg-primary font-semibold text-primary-foreground" : "hover:bg-muted"
                )}
              >
                <Moon className="h-4 w-4" />
                تاریک
              </button>
            </div>
          </div>

          {/* تم‌های آماده — ۶ تم مرجع سیستم */}
          <div className="grid gap-2">
            <p className="text-sm font-medium">تم‌های سیستم</p>
            <p className="text-xs text-muted-foreground">
              هر تم به‌صورت یکپارچه روی داشبورد، منو، جدول‌ها، فرم‌ها، دکمه‌ها، کارت‌ها،
              فاکتورها و پنجره‌ها اعمال می‌شود
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {THEME_PRESETS.map((t) => {
                const active = activePreset === t.id && !itemColor;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => choosePreset(t)}
                    aria-pressed={active}
                    className={cn(
                      "group grid gap-2 rounded-xl border p-2.5 text-start transition-all hover:shadow-md",
                      active && "border-primary ring-2 ring-primary/40"
                    )}
                  >
                    <ThemePreview theme={t} />
                    <span className="flex items-center gap-1.5 px-0.5">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{t.name}</span>
                        <span dir="ltr" className="block truncate text-[10px] text-muted-foreground">
                          {t.enName}
                        </span>
                      </span>
                      {t.mode === "dark" ? (
                        <Moon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <Sun className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ─── رنگ آیتم‌ها ─── */}
      <section
        className="rounded-xl border bg-card text-card-foreground shadow-sm"
        aria-labelledby="appearance-items-title"
      >
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Paintbrush className="h-4 w-4 text-primary" />
          <h2 id="appearance-items-title" className="text-base font-semibold">
            رنگ آیتم‌ها
          </h2>
        </div>
        <div className="grid gap-4 p-4">
          <p className="text-xs text-muted-foreground">
            رنگ دکمه‌ها و آیتم‌های فعال منو را به دلخواه تغییر دهید. این رنگ روی تم انتخاب‌شده
            اولویت دارد و در همین مرورگر ذخیره می‌شود.
          </p>

          {/* رنگ‌های پیشنهادی */}
          <div className="grid gap-2">
            <p className="text-sm font-medium">رنگ‌های پیشنهادی</p>
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label="رنگ‌های پیشنهادی آیتم‌ها"
            >
              {ITEM_COLOR_SUGGESTIONS.map((c) => {
                const active = itemColor.toLowerCase() === c.toLowerCase();
                return (
                  <button
                    key={c}
                    type="button"
                    aria-label={`انتخاب رنگ ${c}`}
                    aria-pressed={active}
                    onClick={() => chooseColor(c)}
                    className={cn(
                      "relative h-9 w-9 rounded-full border shadow-sm transition-transform hover:scale-110",
                      active && "ring-2 ring-foreground/60 ring-offset-2 dark:ring-offset-background"
                    )}
                    style={{ backgroundColor: c }}
                  >
                    {active && (
                      <Check
                        className="absolute inset-0 m-auto h-4 w-4 drop-shadow"
                        style={{ color: contrastForeground(c) }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* رنگ دلخواه */}
          <div className="grid gap-2">
            <p className="text-sm font-medium">رنگ دلخواه</p>
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="انتخاب رنگ دلخواه آیتم‌ها"
                value={HEX_6.test(itemColor) ? itemColor : "#059669"}
                onChange={(e) => chooseColor(e.target.value)}
                className="h-10 w-14 cursor-pointer rounded-md border bg-card p-1"
              />
              <Input
                dir="ltr"
                className="w-32 text-left font-mono"
                value={hexDraft ?? itemColor}
                placeholder="#059669"
                onChange={(e) => {
                  const v = e.target.value.trim();
                  setHexDraft(v);
                  if (HEX_ANY.test(v)) applyItemColor(v, true);
                }}
                onBlur={() => setHexDraft(null)}
              />
            </div>
          </div>

          {/* بازنشانی */}
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">حذف رنگ سفارشی</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                بازگشت به رنگ تم انتخاب‌شده
              </p>
            </div>
            <Button variant="outline" size="sm" disabled={!itemColor} onClick={() => chooseColor("")}>
              <RotateCcw className="h-4 w-4" />
              بازنشانی
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
