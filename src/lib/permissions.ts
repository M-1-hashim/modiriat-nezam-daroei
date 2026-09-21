/** کاتالوگ صلاحیت‌های سیستم — ماژول × اکشن */

export const MODULES = [
  "dashboard",
  "purchases",
  "sales",
  "promotions",
  "customers",
  "suppliers",
  "payments",
  "returns",
  "products",
  "inventory",
  "batches",
  "personnel",
  "hr",
  "expenses",
  "partnerships",
  "currency",
  "reports",
  "admin",
  "audit",
  "backup",
  "settings",
  "host",
] as const;

export type ModuleKey = (typeof MODULES)[number];

export const ACTIONS = ["view", "create", "edit", "delete", "approve"] as const;
export type ActionKey = (typeof ACTIONS)[number];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  dashboard: "داشبورد",
  purchases: "خریدها",
  sales: "فروش‌ها",
  promotions: "طرح‌های تشویقی (پروموشن)",
  customers: "مشتریان",
  suppliers: "تأمین‌کنندگان",
  payments: "پرداخت‌ها",
  returns: "برگشتی‌ها",
  products: "ادویه و اجناس",
  inventory: "موجودی گدام",
  batches: "بچ‌ها و انقضا",
  personnel: "مناطق و فروشندگان",
  hr: "کارکنان و منابع بشری",
  expenses: "مصارف",
  partnerships: "شراکت و مضاربه",
  currency: "اسعار",
  reports: "راپورها",
  admin: "مدیریت سیستم",
  audit: "سابقه فعالیت‌ها",
  backup: "نسخه‌های احتیاطی",
  settings: "تنظیمات",
  host: "اتصال به هاست",
};

export const ACTION_LABELS: Record<ActionKey, string> = {
  view: "دیدن",
  create: "ایجاد",
  edit: "ویرایش",
  delete: "حذف",
  approve: "تصویب",
};

export const ALL_PERMISSIONS: string[] = MODULES.flatMap((m) =>
  ACTIONS.map((a) => `${m}.${a}`)
);

export const permissionLabel = (perm: string): string => {
  const [mod, act] = perm.split(".");
  const m = MODULE_LABELS[mod as ModuleKey];
  const a = ACTION_LABELS[act as ActionKey];
  if (!m || !a) return perm;
  return `${a} ${m}`;
};
