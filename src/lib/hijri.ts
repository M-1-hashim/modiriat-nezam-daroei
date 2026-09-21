/**
 * تقویم هجری شمسی افغانستان
 * تبدیل گریگوری ↔ هجری شمسی با الگوریتم استاندارد جلالی و نام ماه‌های افغانی
 * منطقه زمانی نمایش: Asia/Kabul (UTC+04:30)
 */

export const HIJRI_MONTHS = [
  "حمل",
  "ثور",
  "جوزا",
  "سرطان",
  "اسد",
  "سنبله",
  "میزان",
  "عقرب",
  "قوس",
  "جدی",
  "دلو",
  "حوت",
];

const div = (a: number, b: number) => Math.trunc(a / b);
const mod = (a: number, b: number) => a - Math.trunc(a / b) * b;

const BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097,
  2192, 2262, 2324, 2394, 2456, 3178,
];

function jalCal(jy: number): { leap: number; gy: number; march: number } {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0];
  let jm = 0;
  let jump = 0;
  if (jy < jp || jy >= BREAKS[bl - 1]) throw new Error("سال نامعتبر");
  for (let i = 1; i < bl; i += 1) {
    jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

function g2d(gy: number, gm: number, gd: number): number {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
    div(153 * mod(gm + 9, 12) + 2, 5) +
    gd -
    34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn: number): { gy: number; gm: number; gd: number } {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

export function gregorianToHijri(date: Date): {
  jy: number;
  jm: number;
  jd: number;
} {
  const jdn = g2d(date.getFullYear(), date.getMonth() + 1, date.getDate());
  let jy = d2g(jdn).gy - 621;
  let jd: number;
  let jm: number;
  const r = jalCal(jy);
  const jdn1f = g2d(r.gy, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) {
      jm = 1 + div(k, 31);
      jd = mod(k, 31) + 1;
      return { jy, jm, jd };
    }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  jm = 7 + div(k, 30);
  jd = mod(k, 30) + 1;
  return { jy, jm, jd };
}

export function hijriToGregorian(
  jy: number,
  jm: number,
  jd: number
): { gy: number; gm: number; gd: number } {
  const r = jalCal(jy);
  const jdn = g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
  return d2g(jdn);
}

export function hijriMonthLength(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return jalCal(jy).leap === 1 ? 30 : 29;
}

/** تاریخ امروز به هجری شمسی (منطقه زمانی کابل) */
export function hijriToday(): { jy: number; jm: number; jd: number } {
  return gregorianToHijri(kabulNow());
}

/** اجزای تاریخ/ساعت فعلی در منطقه زمانی افغانستان */
export function kabulNow(): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kabul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return new Date(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second")
  );
}

const PERSIAN_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

export function toPersianDigits(s: string | number): string {
  return String(s).replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * قالب تاریخ هجری: ۱۴۰۴/۰۳/۱۲ (حمل)
 */
export function formatHijriDate(date: Date | string | number | null | undefined): string {
  if (!date) return "—";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "—";
  try {
    const { jy, jm, jd } = gregorianToHijri(kabulParts(d));
    return toPersianDigits(`${jy}/${pad2(jm)}/${pad2(jd)}`) + ` (${HIJRI_MONTHS[jm - 1]})`;
  } catch {
    return "—";
  }
}

/** تاریخ کوتاه بدون نام ماه: ۱۴۰۴/۰۳/۱۲ */
export function formatHijriShort(date: Date | string | number | null | undefined): string {
  if (!date) return "—";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "—";
  try {
    const { jy, jm, jd } = gregorianToHijri(kabulParts(d));
    return toPersianDigits(`${jy}/${pad2(jm)}/${pad2(jd)}`);
  } catch {
    return "—";
  }
}

/** تاریخ و ساعت: ۱۴۰۴/۰۳/۱۲ حمل — 14:30 */
export function formatHijriDateTime(
  date: Date | string | number | null | undefined
): string {
  if (!date) return "—";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "—";
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kabul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `${formatHijriShort(d)} — ${toPersianDigits(time)}`;
}

/** اجزای گریگوری همان لحظه در منطقه زمانی کابل */
function kabulParts(d: Date): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kabul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return new Date(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second")
  );
}

const KABUL_OFFSET_MS = 4 * 60 * 60 * 1000 + 30 * 60 * 1000; // UTC+04:30 — افغانستان ساعت تابستانی ندارد

/**
 * رشته ورودی فرم (هجری: 1404/03/12) → Date
 * لحظهٔ ساخته‌شده همیشه «۱۲:۰۰ به وقت کابل» همان روز شمسی است
 * (مستقل از منطقهٔ زمانی مرورگر/سرور — تا تاریخ سند هرگز یک روز جابجا نشود)
 */
export function hijriInputToDate(input: string): Date | null {
  const g = hijriInputToGregorian(input);
  if (!g) return null;
  // ۱۲:۰۰ کابل = ۰۷:۳۰ UTC
  return new Date(Date.UTC(g.gy, g.gm - 1, g.gd, 7, 30, 0));
}

/** رشته ورودی هجری (1404/03/12) → اجزای گریگوری همان روز یا null */
export function hijriInputToGregorian(
  input: string
): { gy: number; gm: number; gd: number } | null {
  const m = input.trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!m) return null;
  const jy = Number(m[1]);
  const jm = Number(m[2]);
  const jd = Number(m[3]);
  if (jm < 1 || jm > 12) return null;
  if (jd < 1 || jd > hijriMonthLength(jy, jm)) return null;
  return hijriToGregorian(jy, jm, jd);
}

/** رشته ورودی هجری → ISO روز گریگوری (YYYY-MM-DD) — مستقل از منطقهٔ زمانی */
export function hijriInputToGregorianISO(input: string): string | null {
  const g = hijriInputToGregorian(input);
  if (!g) return null;
  return `${g.gy}-${pad2(g.gm)}-${pad2(g.gd)}`;
}

/** شروع روز شمسیِ شامل این لحظه (۰۰:۰۰:۰۰٫۰۰۰ به وقت کابل) */
export function hijriDayStart(date: Date): Date {
  const k = kabulParts(date);
  // ۰۰:۰۰ کابل = ۱۹:۳۰ UTC روز قبل
  return new Date(Date.UTC(k.getFullYear(), k.getMonth(), k.getDate(), 0, 0, 0) - KABUL_OFFSET_MS);
}

/** ختم روز شمسیِ شامل این لحظه (۲۳:۵۹:۵۹٫۹۹۹ به وقت کابل) — برای فیلترهای «تا تاریخ» */
export function hijriDayEnd(date: Date): Date {
  const k = kabulParts(date);
  return new Date(
    Date.UTC(k.getFullYear(), k.getMonth(), k.getDate(), 23, 59, 59, 999) - KABUL_OFFSET_MS
  );
}

/** رشته ورودی هجری (1404/03/12) → شروع آن روز به وقت کابل */
export function hijriInputToDayStart(input: string): Date | null {
  const g = hijriInputToGregorian(input);
  if (!g) return null;
  return new Date(Date.UTC(g.gy, g.gm - 1, g.gd, 0, 0, 0) - KABUL_OFFSET_MS);
}

/** رشته ورودی هجری (1404/03/12) → ختم آن روز به وقت کابل (۲۳:۵۹:۵۹٫۹۹۹) */
export function hijriInputToDayEnd(input: string): Date | null {
  const g = hijriInputToGregorian(input);
  if (!g) return null;
  return new Date(Date.UTC(g.gy, g.gm - 1, g.gd, 23, 59, 59, 999) - KABUL_OFFSET_MS);
}

/** Date → رشته ورودی فرم هجری 1404/03/12 */
export function dateToHijriInput(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "";
  try {
    const { jy, jm, jd } = gregorianToHijri(kabulParts(d));
    return `${jy}/${pad2(jm)}/${pad2(jd)}`;
  } catch {
    return "";
  }
}

/** کلید شمسی روز (لاتین، مرتب‌پذیر): 1404/03/12 */
export function hijriDayKey(date: Date | string | number): string {
  const { jy, jm, jd } = gregorianToHijri(kabulParts(new Date(date)));
  return `${jy}/${pad2(jm)}/${pad2(jd)}`;
}

/** کلید شمسی ماه (لاتین، مرتب‌پذیر): 1404/03 */
export function hijriMonthKey(date: Date | string | number): string {
  const { jy, jm } = gregorianToHijri(kabulParts(new Date(date)));
  return `${jy}/${pad2(jm)}`;
}

/** برچسب شمسی روز برای گزارش: ۱۴۰۴/۰۳/۱۲ (حمل) */
export function hijriDayLabel(date: Date | string | number): string {
  const { jy, jm, jd } = gregorianToHijri(kabulParts(new Date(date)));
  return toPersianDigits(`${jy}/${pad2(jm)}/${pad2(jd)}`) + ` (${HIJRI_MONTHS[jm - 1]})`;
}

/** برچسب شمسی ماه برای گزارش: ۱۴۰۴/۰۳ (حمل) */
export function hijriMonthLabel(date: Date | string | number): string {
  const { jy, jm } = gregorianToHijri(kabulParts(new Date(date)));
  return toPersianDigits(`${jy}/${pad2(jm)}`) + ` (${HIJRI_MONTHS[jm - 1]})`;
}

/**
 * شروع ماه شمسی جاری به وقت کابل (۰۰:۰۰ روز اول ماه)
 * برای محاسبات «ماه جاری» در سرور
 */
export function currentShamsiMonthStart(now: Date = new Date()): Date {
  const { jy, jm } = gregorianToHijri(kabulParts(now));
  const g = hijriToGregorian(jy, jm, 1);
  // ۰۰:۰۰ کابل روز اول ماه = ۱۹:۳۰ UTC روز قبل
  return new Date(Date.UTC(g.gy, g.gm - 1, g.gd, 0, 0, 0) - KABUL_OFFSET_MS);
}

/**
 * ختم ماه شمسی جاری به وقت کابل (۲۳:۵۹:۵۹٫۹۹۹ روز آخر ماه)
 * تاریخ سندها همیشه «۱۲:۰۰ کابل» است — برای اینکه هیچ سند ماه جاری
 * از محاسبات جا نماند، مرز بالایی باید ختم روز/ماه باشد نه «الان»
 */
export function currentShamsiMonthEnd(now: Date = new Date()): Date {
  const { jy, jm } = gregorianToHijri(kabulParts(now));
  const lastDay = hijriMonthLength(jy, jm);
  const g = hijriToGregorian(jy, jm, lastDay);
  return new Date(
    Date.UTC(g.gy, g.gm - 1, g.gd, 23, 59, 59, 999) - KABUL_OFFSET_MS
  );
}

/** اجزای شمسی امروز به وقت کابل — میان‌بر برای داشبورد و گزارش‌ها */
export { hijriToday as shamsiToday };
