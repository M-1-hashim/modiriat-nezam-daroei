import "server-only";
import { db } from "./db";
import { hashPassword } from "./auth";
import { setSetting } from "./business";

/**
 * راه‌اندازی اولیه سیستم — idempotent
 * شرکت، رول‌های پایه، شعبه دفتر مرکزی کابل، گدام اصلی، کاربر سوپرادمین و تنظیمات پیش‌فرض
 */
export async function ensureBootstrap(): Promise<{ created: boolean }> {
  const setupDone = await db.systemSetting.findUnique({
    where: { key: "setup_done" },
  });
  if (setupDone?.value === "true") return { created: false };

  // ─── رول‌های پایه ───
  const roles = [
    { key: "SUPER_ADMIN", name: "مدیر ارشد سیستم (دفتر مرکزی)", permissions: JSON.stringify(["*"]), isSystem: true },
    {
      key: "BRANCH_MANAGER",
      name: "مدیر شعبه",
      permissions: JSON.stringify([
        "dashboard.view", "purchases.view", "purchases.create", "purchases.edit", "purchases.approve",
        "sales.view", "sales.create", "sales.edit", "sales.approve",
        "customers.view", "customers.create", "customers.edit", "customers.delete",
        "suppliers.view", "payments.view", "payments.create", "payments.delete",
        "returns.view", "returns.create", "returns.approve",
        "products.view", "products.create", "products.edit",
        "inventory.view", "inventory.create", "inventory.edit",
        "batches.view", "personnel.view", "personnel.create", "personnel.edit",
        "hr.view", "hr.create", "hr.edit", "hr.delete", "hr.approve",
        "expenses.view", "expenses.create", "expenses.edit", "expenses.approve",
        "partnerships.view", "currency.view", "currency.edit",
        "hr.view",
        "reports.view", "admin.view", "audit.view", "backup.view", "host.view",
      ]),
      isSystem: true,
    },
    {
      key: "ACCOUNTANT",
      name: "حسابدار",
      permissions: JSON.stringify([
        "dashboard.view", "purchases.view", "sales.view",
        "customers.view", "customers.create", "customers.edit",
        "suppliers.view", "payments.view", "payments.create",
        "returns.view", "expenses.view", "expenses.create", "expenses.edit",
        "products.view", "inventory.view", "batches.view",
        "partnerships.view", "currency.view", "reports.view",
      ]),
      isSystem: true,
    },
    {
      key: "SALESPERSON",
      name: "فروشنده",
      permissions: JSON.stringify([
        "dashboard.view", "sales.view", "sales.create",
        "customers.view", "customers.create", "payments.view", "payments.create",
        "products.view", "inventory.view", "batches.view",
      ]),
      isSystem: true,
    },
    {
      key: "WAREHOUSE_KEEPER",
      name: "مسئول گدام",
      permissions: JSON.stringify([
        "dashboard.view", "products.view", "products.create", "products.edit",
        "inventory.view", "inventory.create", "inventory.edit",
        "batches.view", "purchases.view", "sales.view", "returns.view", "returns.create",
      ]),
      isSystem: true,
    },
    {
      key: "PURCHASE_OFFICER",
      name: "مسئول خرید",
      permissions: JSON.stringify([
        "dashboard.view", "purchases.view", "purchases.create", "purchases.edit",
        "suppliers.view", "suppliers.create", "suppliers.edit",
        "products.view", "products.create", "products.edit",
        "inventory.view", "batches.view",
      ]),
      isSystem: true,
    },
  ];

  for (const r of roles) {
    await db.role.upsert({
      where: { key: r.key },
      create: r,
      update: {},
    });
  }

  // ─── شعبه دفتر مرکزی ───
  let branch = await db.branch.findUnique({ where: { code: "HO" } });
  if (!branch) {
    branch = await db.branch.create({
      data: {
        code: "HO",
        name: "دفتر مرکزی — کابل",
        city: "کابل",
        isHeadOffice: true,
        isActive: true,
      },
    });
  }

  // ─── گدام اصلی ───
  const mainWh = await db.warehouse.findFirst({
    where: { branchId: branch.id, isMain: true },
  });
  if (!mainWh) {
    await db.warehouse.create({
      data: { branchId: branch.id, name: "گدام اصلی", isMain: true },
    });
  }

  // ─── کاربر سوپرادمین پیش‌فرض ───
  const superRole = await db.role.findUnique({ where: { key: "SUPER_ADMIN" } });
  const adminExists = await db.user.findUnique({ where: { username: "admin" } });
  let created = false;
  if (!adminExists && superRole) {
    await db.user.create({
      data: {
        username: "admin",
        passwordHash: hashPassword("admin123"),
        fullName: "مدیر ارشد سیستم",
        roleId: superRole.id,
        branchId: branch.id,
        isActive: true,
      },
    });
    created = true;
  }

  // ─── تنظیمات پیش‌فرض ───
  const defaults: Record<string, string> = {
    company_name: "شرکت دارویی نمونه افغانستان",
    company_address: "کابل، افغانستان",
    company_phone: "+93 700 000 000",
    invoice_footer_note: "از خرید شما سپاسگزاریم — با تاریخی از سلامت",
    require_approval_purchases: "false",
    require_approval_sales: "false",
    require_approval_expenses: "false",
    require_approval_returns: "false",
    block_expired_sales: "true",
    allow_negative_stock: "false",
    expiry_warn_days: "90",
    profit_distribution_base: "NET_PROFIT",
    default_currency: "AFN",
    attendance_base_days: "30",
    invoice_template_default: "DETAILED",
    seq_prefix_PURCHASE: "PUR",
    seq_prefix_SALE: "SEL",
    seq_prefix_PAYMENT: "PAY",
    seq_prefix_PURCHASE_RETURN: "PRN",
    seq_prefix_SALES_RETURN: "SRN",
  };
  for (const [key, value] of Object.entries(defaults)) {
    await setSetting(key, value);
  }

  // ─── کتگوری‌های مصارف پیش‌فرض ───
  const expenseCats = [
    "کرایه/راجستر",
    "معاشات",
    "ترانسپورت",
    "برق و آب",
    "تعمیرات",
    "سایر مصارف",
  ];
  for (const name of expenseCats) {
    await db.expenseCategory.upsert({ where: { name }, create: { name }, update: {} });
  }

  // ─── اسعار اولیه دستی ───
  const rateExists = await db.exchangeRate.findFirst({ where: { base: "USD", quote: "AFN" } });
  if (!rateExists) {
    await db.exchangeRate.createMany({
      data: [
        { base: "USD", quote: "AFN", buyRate: 71.5, sellRate: 72.0, source: "MANUAL", recordedByName: "نظام" },
        { base: "PKR", quote: "AFN", buyRate: 0.256, sellRate: 0.26, source: "MANUAL", recordedByName: "نظام" },
        { base: "USD", quote: "PKR", buyRate: 278, sellRate: 280, source: "MANUAL", recordedByName: "نظام" },
      ],
    });
  }

  await setSetting("setup_done", "true");
  return { created };
}
