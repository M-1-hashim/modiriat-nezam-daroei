/** قالب‌بندی اعداد، پول و تاریخ برای رابط دری (client-safe) */

import {
  formatHijriDate,
  formatHijriDateTime,
  formatHijriShort,
} from "./hijri";

export const CURRENCY_LABELS: Record<string, string> = {
  AFN: "افغانی",
  USD: "دالر امریکایی",
  PKR: "کلدار پاکستانی",
};

export const CURRENCY_OPTIONS = ["AFN", "USD", "PKR"] as const;

export function currencyLabel(c?: string | null): string {
  return CURRENCY_LABELS[c ?? "AFN"] ?? c ?? "افغانی";
}

function group(n: string): string {
  return n.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** قالب پول: 1,250,000.50 افغانی */
export function formatMoney(
  n: number | null | undefined,
  currency?: string | null,
  opts?: { withCurrency?: boolean; decimals?: boolean }
): string {
  const value = typeof n === "number" && Number.isFinite(n) ? n : 0;
  const withCur = opts?.withCurrency ?? true;
  const decimals = opts?.decimals ?? false;
  const abs = Math.abs(value);
  const intPart = Math.floor(abs);
  const frac = abs - intPart;
  let s = group(String(intPart));
  if (decimals || frac > 0.0009) {
    s += "." + String(Math.round(frac * 100)).padStart(2, "0");
  }
  if (value < 0) s = "-" + s;
  return withCur ? `${s} ${currencyLabel(currency)}` : s;
}

/** عدد خالص با جداکننده هزارگان */
export function formatNumber(n: number | null | undefined, decimals = 0): string {
  const value = typeof n === "number" && Number.isFinite(n) ? n : 0;
  const s = decimals > 0
    ? value.toFixed(decimals)
    : String(Math.round(value * 100) / 100);
  const [i, f] = s.split(".");
  return f ? `${group(i)}.${f}` : group(i);
}

/** درصد */
export function formatPct(n: number | null | undefined): string {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return `${formatNumber(v, v % 1 === 0 ? 0 : 1)}٪`;
}

export { formatHijriDate, formatHijriDateTime, formatHijriShort };
