/** ثبت راهنمای ناوبری — منوی اصلی سیستم (client-safe) */

import {
  Landmark,
  LayoutDashboard,
  ShoppingCart,
  Store,
  Gift,
  Users,
  Truck,
  Wallet,
  RotateCcw,
  Pill,
  Layers,
  Boxes,
  MapPinned,
  UserCog,
  Receipt,
  Handshake,
  ArrowLeftRight,
  BarChart3,
  ShieldCheck,
  History,
  DatabaseBackup,
  Settings,
  Server,
  type LucideIcon,
} from "lucide-react";

export type ViewId =
  | "dashboard"
  | "cashbox"
  | "purchases"
  | "sales"
  | "promotions"
  | "customers"
  | "suppliers"
  | "payments"
  | "returns"
  | "products"
  | "batches"
  | "inventory"
  | "personnel"
  | "employees"
  | "expenses"
  | "partnerships"
  | "currency"
  | "reports"
  | "admin"
  | "audit"
  | "backup"
  | "settings"
  | "host";

export type NavItem = {
  id: ViewId;
  label: string;
  icon: LucideIcon;
  permission: string;
  component: string; // نام فایل در src/components/views
};

export type NavGroup = {
  title: string;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    title: "اصلی",
    items: [
      { id: "dashboard", label: "داشبورد", icon: LayoutDashboard, permission: "dashboard.view", component: "DashboardView" },
      { id: "cashbox", label: "موجودی صندوق", icon: Landmark, permission: "payments.view", component: "CashboxView" },
    ],
  },
  {
    title: "تجارت",
    items: [
      { id: "purchases", label: "خریدها", icon: ShoppingCart, permission: "purchases.view", component: "PurchasesView" },
      { id: "sales", label: "فروش‌ها", icon: Store, permission: "sales.view", component: "SalesView" },
      { id: "promotions", label: "طرح‌های تشویقی", icon: Gift, permission: "promotions.view", component: "PromotionsView" },
      { id: "customers", label: "مشتریان", icon: Users, permission: "customers.view", component: "CustomersView" },
      { id: "suppliers", label: "تأمین‌کنندگان", icon: Truck, permission: "suppliers.view", component: "SuppliersView" },
      { id: "payments", label: "پرداخت‌ها", icon: Wallet, permission: "payments.view", component: "PaymentsView" },
      { id: "returns", label: "برگشتی‌ها", icon: RotateCcw, permission: "returns.view", component: "ReturnsView" },
    ],
  },
  {
    title: "انبار",
    items: [
      { id: "products", label: "ادویه و اجناس", icon: Pill, permission: "products.view", component: "ProductsView" },
      { id: "batches", label: "بچ‌ها و انقضا", icon: Layers, permission: "batches.view", component: "BatchesView" },
      { id: "inventory", label: "موجودی گدام", icon: Boxes, permission: "inventory.view", component: "InventoryView" },
    ],
  },
  {
    title: "فروش و مناطق",
    items: [{ id: "personnel", label: "مناطق و فروشندگان", icon: MapPinned, permission: "personnel.view", component: "PersonnelView" }],
  },
  {
    title: "منابع بشری",
    items: [{ id: "employees", label: "کارکنان", icon: UserCog, permission: "hr.view", component: "EmployeesView" }],
  },
  {
    title: "مالی",
    items: [
      { id: "expenses", label: "مصارف", icon: Receipt, permission: "expenses.view", component: "ExpensesView" },
      { id: "partnerships", label: "شراکت و مضاربه", icon: Handshake, permission: "partnerships.view", component: "PartnershipsView" },
      { id: "currency", label: "اسعار", icon: ArrowLeftRight, permission: "currency.view", component: "CurrencyView" },
      { id: "reports", label: "راپورها", icon: BarChart3, permission: "reports.view", component: "ReportsView" },
    ],
  },
  {
    title: "مدیریت",
    items: [
      { id: "admin", label: "کاربران و شعبه‌ها", icon: ShieldCheck, permission: "admin.view", component: "AdminView" },
      { id: "audit", label: "سابقه فعالیت‌ها", icon: History, permission: "audit.view", component: "AuditView" },
      { id: "backup", label: "نسخه‌های احتیاطی", icon: DatabaseBackup, permission: "backup.view", component: "BackupView" },
      { id: "settings", label: "تنظیمات", icon: Settings, permission: "settings.view", component: "SettingsView" },
      { id: "host", label: "اتصال به هاست", icon: Server, permission: "host.view", component: "HostConnectionView" },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export const navItemById = (id: ViewId): NavItem | undefined =>
  ALL_NAV_ITEMS.find((i) => i.id === id);
