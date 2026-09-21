import { ApiError, parseDate, toNum } from "@/lib/api-utils";
import { allowedBranchIds, requirePermission, type AuthUser } from "@/lib/auth";
import { hijriDayKey, hijriDayLabel, hijriMonthKey, hijriMonthLabel } from "@/lib/hijri";

/** بازه زمانی گزارش — پیش‌فرض: ۹۰ روز اخیر */
export function resolveRange(url: URL): { from: Date; to: Date } {
  const to = parseDate(url.searchParams.get("to")) ?? new Date();
  const from =
    parseDate(url.searchParams.get("from")) ??
    new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000);
  if (from > to) throw new ApiError("تاریخ شروع باید قبل از تاریخ ختم باشد", 422, "VALIDATION");
  return { from, to };
}

/**
 * فیلتر شعبه برای گزارش‌ها:
 * - کاربر عادی: همیشه شعبه خودش ([] یعنی هیچ دسترسی)
 * - سوپرادمین: بدون branchId = همه شعبه‌ها (undefined)، با branchId = همان شعبه
 */
export function resolveBranchIds(user: AuthUser, url: URL): string[] | undefined {
  const allowed = allowedBranchIds(user);
  if (allowed) return allowed;
  const branchId = url.searchParams.get("branchId");
  return branchId ? [branchId] : undefined;
}

/** کلید شمسی روز گزارش (مرتب‌پذیر): 1404/03/12 */
export function reportDayKey(d: Date): string {
  return hijriDayKey(d);
}

/** برچسب شمسی روز گزارش: ۱۴۰۴/۰۳/۱۲ (حمل) */
export function reportDayLabel(d: Date): string {
  return hijriDayLabel(d);
}

/** کلید شمسی ماه گزارش (مرتب‌پذیر): 1404/03 */
export function reportMonthKey(d: Date): string {
  return hijriMonthKey(d);
}

/** برچسب شمسی ماه گزارش: ۱۴۰۴/۰۳ (حمل) */
export function reportMonthLabel(d: Date): string {
  return hijriMonthLabel(d);
}

export type ReportRow = {
  key: string;
  label: string;
  count: number;
  quantity: number;
  totalAfn: number;
  costAfn?: number;
  profitAfn?: number;
};

export function bumpRow(
  map: Map<string, ReportRow>,
  key: string,
  label: string,
  opts: { count: number; quantity: number; totalAfn: number; costAfn: number }
): void {
  const existing = map.get(key);
  if (existing) {
    existing.count += opts.count;
    existing.quantity += opts.quantity;
    existing.totalAfn += opts.totalAfn;
    existing.costAfn = (existing.costAfn ?? 0) + opts.costAfn;
  } else {
    map.set(key, {
      key,
      label,
      count: opts.count,
      quantity: opts.quantity,
      totalAfn: opts.totalAfn,
      costAfn: opts.costAfn,
    });
  }
}

export function finalizeRows(map: Map<string, ReportRow>, withProfit: boolean): ReportRow[] {
  const rows = [...map.values()].map((r) => {
    const totalAfn = Math.round(r.totalAfn * 100) / 100;
    const costAfn = Math.round((r.costAfn ?? 0) * 100) / 100;
    const base: ReportRow = {
      key: r.key,
      label: r.label,
      count: r.count,
      quantity: Math.round(r.quantity * 100) / 100,
      totalAfn,
    };
    if (withProfit) {
      base.costAfn = costAfn;
      base.profitAfn = Math.round((totalAfn - costAfn) * 100) / 100;
    }
    return base;
  });
  rows.sort((a, b) => b.totalAfn - a.totalAfn);
  return rows;
}

export function limitParam(url: URL, def: number, max = 500): number {
  return Math.min(max, Math.max(1, Math.floor(toNum(url.searchParams.get("limit"), def))));
}

export type Guard = { user: AuthUser };

export function guardReportsView(user: AuthUser): void {
  requirePermission(user, "reports.view");
}
