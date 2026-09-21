/** برچسب‌های دری برای وضعیت‌ها، انواع و انتخاب‌ها */

export const DOC_STATUS: Record<string, { label: string; tone: string }> = {
  DRAFT: { label: "پیش‌نویس", tone: "slate" },
  PENDING: { label: "در انتظار تصویب", tone: "amber" },
  REQUESTED: { label: "درخواست شده", tone: "amber" },
  APPROVED: { label: "تأیید شده", tone: "emerald" },
  COMPLETED: { label: "تکمیل شده", tone: "emerald" },
  CALCULATED: { label: "محاسبه شده", tone: "amber" },
  PAID: { label: "پرداخت شده", tone: "emerald" },
  CANCELLED: { label: "لغو شده", tone: "rose" },
  ENDED: { label: "خاتمه یافته", tone: "slate" },
  SUSPENDED: { label: "معلق", tone: "amber" },
};

export const BATCH_STATUS: Record<string, { label: string; tone: string }> = {
  VALID: { label: "صالح", tone: "emerald" },
  EXPIRING_SOON: { label: "نزدیک انقضا", tone: "amber" },
  EXPIRED: { label: "منقضی شده", tone: "rose" },
};

export const PURCHASE_TYPES: Record<string, string> = {
  LOCAL: "خرید محلی",
  IMPORT: "خرید وارداتی",
  FOREIGN: "خرید خارجی",
};

export const SALE_TYPES: Record<string, string> = {
  WHOLESALE: "فروش عمده",
  CASH: "فروش نقدی",
  CREDIT: "فروش قرضی (سیستی)",
};

export const CUSTOMER_TYPES: Record<string, string> = {
  PHARMACY: "فارمسی",
  HOSPITAL: "شفاخانه",
  CLINIC: "کلینیک",
  COMPANY: "شرکت",
  OTHER: "سایر",
};

// ─── تخفیف و پروموشن (طرح تشویقی) ───

export const PROMO_TYPES: Record<string, string> = {
  FREE_QTY: "کالای رایگان (خرید X دریافت Y)",
  PERCENT: "پروموشن درصدی",
  AMOUNT: "پروموشن مبلغی",
  COMBINED: "ترکیبی (رایگان + تخفیف)",
};

export const PROMO_SCOPES: Record<string, string> = {
  LINE: "هر قلم فاکتور",
  INVOICE: "کل فاکتور",
};

export const PROMO_STATUSES: Record<string, { label: string; tone: string }> = {
  ACTIVE: { label: "فعال", tone: "emerald" },
  SCHEDULED: { label: "در انتظار شروع", tone: "amber" },
  EXPIRED: { label: "منقضی‌شده", tone: "rose" },
  INACTIVE: { label: "غیرفعال", tone: "slate" },
};

export const DISCOUNT_TYPES: Record<string, string> = {
  PERCENT: "درصد (٪)",
  AMOUNT: "مبلغ ثابت",
};

export const PROMO_REPORT_TYPES: Record<string, string> = {
  sales_discounts: "تخفیفات فروش (صادره)",
  supplier_discounts: "تخفیفات دریافتی از تأمین‌کنندگان",
  free_goods: "ارزش کالای رایگان",
  promo_usage: "استفاده از هر پروموشن",
  promo_status: "وضعیت پروموشن‌ها (فعال/منقضی)",
  profit_impact: "تأثیر تخفیف و پروموشن بر سود",
  by_product: "بر اساس محصول (دارو)",
  by_customer: "بر اساس مشتری",
  by_supplier: "بر اساس تأمین‌کننده",
  by_period: "بر اساس بازه زمانی (ماهانه)",
};

export const SUPPLIER_TYPES: Record<string, string> = {
  LOCAL: "داخلی",
  FOREIGN: "خارجی",
};

export const PAYMENT_METHODS: Record<string, string> = {
  CASH: "نقدی",
  BANK: "بانکی",
  HAWALA: "حواله",
};

export const PAYMENT_TYPES: Record<string, string> = {
  CUSTOMER: "پرداخت مشتری",
  SUPPLIER: "پرداخت تأمین‌کننده",
};

export const PARTNERSHIP_TYPES: Record<string, string> = {
  EQUITY: "شراکت سهامی",
  MUDARABAH: "مضاربه",
};

export const PARTNERSHIP_ROLES: Record<string, string> = {
  CAPITAL_PROVIDER: "تأمین‌کننده سرمایه",
  WORKING_PARTNER: "شریک کارگر (مدیر)",
};

export const MOVEMENT_TYPES: Record<string, { label: string; tone: string }> = {
  IN: { label: "ورود (خرید)", tone: "emerald" },
  OUT: { label: "خروج (فروش)", tone: "rose" },
  TRANSFER: { label: "انتقال بین گدام‌ها", tone: "amber" },
  ADJUSTMENT: { label: "تعدیل موجودی", tone: "slate" },
  RETURN_IN: { label: "برگشت به گدام", tone: "emerald" },
  RETURN_OUT: { label: "برگشت به تأمین‌کننده", tone: "rose" },
  DAMAGE: { label: "خسارت‌دیده", tone: "rose" },
  EXPIRED: { label: "خراج منقضی", tone: "rose" },
};

export const DISTRIBUTION_BASES: Record<string, string> = {
  NET_PROFIT: "منفعت خالص",
  GROSS_PROFIT: "منفعت ناخالص",
  REVENUE: "عواید",
};

export const SEVERITY: Record<string, { label: string; tone: string }> = {
  INFO: { label: "معلومات", tone: "slate" },
  WARNING: { label: "هشدار", tone: "amber" },
  DANGER: { label: "خطر", tone: "rose" },
};

export function labelOf(
  map: Record<string, string>,
  key: string | null | undefined
): string {
  if (!key) return "—";
  return map[key] ?? key;
}
