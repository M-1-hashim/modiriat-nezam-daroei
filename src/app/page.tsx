"use client";

/**
 * پوسته اصلی سیستم — تک‌صفحه‌ای (SPA)
 * همه ماژول‌ها به صورت client-side view در همین مسیر مدیریت می‌شوند.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { UserContext, makeHasPermission, type SessionUser } from "@/components/shared/use-user";
import { apiGet, apiSend, useSyncStatus, useConnectionStatus, getQueue, type QueuedResult } from "@/lib/client-api";
import { NAV_GROUPS, ALL_NAV_ITEMS, navItemById, type ViewId } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  Loader2,
  LogOut,
  Menu,
  Moon,
  Sun,
  Bell,
  Search,
  Cloud,
  Database,
  WifiOff,
  RefreshCw,
  Pill,
  UserRound,
  ShieldCheck,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatHijriDateTime } from "@/lib/format";

// ─── ویوها ───
import DashboardView from "@/components/views/DashboardView";
import CashboxView from "@/components/views/CashboxView";
import PurchasesView from "@/components/views/PurchasesView";
import SalesView from "@/components/views/SalesView";
import PromotionsView from "@/components/views/PromotionsView";
import CustomersView from "@/components/views/CustomersView";
import SuppliersView from "@/components/views/SuppliersView";
import PaymentsView from "@/components/views/PaymentsView";
import ReturnsView from "@/components/views/ReturnsView";
import ProductsView from "@/components/views/ProductsView";
import BatchesView from "@/components/views/BatchesView";
import InventoryView from "@/components/views/InventoryView";
import PersonnelView from "@/components/views/PersonnelView";
import EmployeesView from "@/components/views/EmployeesView";
import ExpensesView from "@/components/views/ExpensesView";
import PartnershipsView from "@/components/views/PartnershipsView";
import CurrencyView from "@/components/views/CurrencyView";
import ReportsView from "@/components/views/ReportsView";
import AdminView from "@/components/views/AdminView";
import AuditView from "@/components/views/AuditView";
import BackupView from "@/components/views/BackupView";
import SettingsView from "@/components/views/SettingsView";
import HostConnectionView from "@/components/views/HostConnectionView";

const VIEW_COMPONENTS: Record<ViewId, React.ComponentType> = {
  dashboard: DashboardView,
  cashbox: CashboxView,
  purchases: PurchasesView,
  sales: SalesView,
  promotions: PromotionsView,
  customers: CustomersView,
  suppliers: SuppliersView,
  payments: PaymentsView,
  returns: ReturnsView,
  products: ProductsView,
  batches: BatchesView,
  inventory: InventoryView,
  personnel: PersonnelView,
  employees: EmployeesView,
  expenses: ExpensesView,
  partnerships: PartnershipsView,
  currency: CurrencyView,
  reports: ReportsView,
  admin: AdminView,
  audit: AuditView,
  backup: BackupView,
  settings: SettingsView,
  host: HostConnectionView,
};

/** درخواست با مهلت زمانی — جلوگیری از گیر کردن ابدی صفحه ورود */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    );
  });
}

type SearchResult = {
  products: { id: string; name: string; strength?: string }[];
  batches: { id: string; batchNumber: string; productName: string }[];
  customers: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
  sales: { id: string; number: string; customerName?: string }[];
  purchases: { id: string; number: string; supplierName?: string }[];
  payments: { id: string; number: string }[];
};

type NotificationItem = {
  type: string;
  severity: string;
  title: string;
  message?: string;
  count?: number;
};

export default function Page() {
  const [booting, setBooting] = useState(true);
  const [bootWarn, setBootWarn] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [view, setView] = useState<ViewId>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchRes, setSearchRes] = useState<SearchResult | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const sync = useSyncStatus();
  const conn = useConnectionStatus();

  const loadMe = useCallback(async () => {
    try {
      // مهلت ۷ ثانیه — اگر سرور جواب ندهد، صفحه ورود با هشدار نشان داده می‌شود
      const res = await withTimeout(apiGet<{ user: SessionUser | null }>("/api/auth/me"), 7000);
      setBootWarn(false);
      setUser(res.user);
      if (res.user) {
        // همگام‌سازی صف آفلاین پس از ورود
        if (getQueue().length > 0) {
          void sync.syncNow();
        }
      }
    } catch {
      setUser(null);
      setBootWarn(true);
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => {
    // علامت‌گذاری بوت موفق React — اسکریپت ریکاوری در layout فقط وقتی اکتیو می‌شود
    // که این پرچم بعد از ۷ ثانیه تنظیم نشده باشد (هیدریشن شکسته)
    (window as { __PHARMA_READY__?: boolean }).__PHARMA_READY__ = true;
    void loadMe();
  }, [loadMe]);

  // اعلان‌ها
  useEffect(() => {
    if (!user) return;
    let active = true;
    const load = () => {
      apiGet<{ items: NotificationItem[] }>("/api/notifications")
        .then((r) => active && setNotifications(r.items))
        .catch(() => undefined);
    };
    load();
    const t = window.setInterval(load, 120_000);
    return () => {
      active = false;
      window.clearInterval(t);
    };
  }, [user]);

  // جستجوی سراسری
  useEffect(() => {
    if (!searchOpen) return;
    if (searchQ.trim().length < 2) {
      setSearchRes(null);
      return;
    }
    const t = window.setTimeout(() => {
      apiGet<SearchResult>(`/api/search?q=${encodeURIComponent(searchQ.trim())}`)
        .then(setSearchRes)
        .catch(() => setSearchRes(null));
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchQ, searchOpen]);

  // میان‌بر جستجو Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ثبت PWA (فقط production)
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  const allowedGroups = useMemo(() => {
    if (!user) return [];
    const check = (perm: string) =>
      user.isSuperAdmin || user.permissions.includes(perm);
    return NAV_GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((i) => check(i.permission)),
    })).filter((g) => g.items.length > 0);
  }, [user]);

  const openView = (id: ViewId) => {
    setView(id);
    setSidebarOpen(false);
  };

  const logout = async () => {
    try {
      await apiSend("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
    setUser(null);
    setView("dashboard");
  };

  if (booting) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
        <Pill className="h-10 w-10 text-primary" />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          در حال بارگذاری سیستم...
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <LoginView
        warning={
          bootWarn
            ? "بررسی وضعیت ورود با مشکل مواجه شد. اگر صفحه کامل بارگذاری نمی‌شود، با Ctrl+Shift+R رفرش کنید یا اتصال خود را بررسی کنید."
            : undefined
        }
        onSuccess={(u) => {
          setUser(u);
          toast.success(`خوش آمدید ${u.fullName}`);
          if (getQueue().length > 0) {
            toast.info("اسناد آفلاین ذخیره‌شده در صف همگام‌سازی قرار دارند");
          }
        }}
      />
    );
  }

  const hasPermission = makeHasPermission(user);
  const current = navItemById(view);
  const ViewComp = VIEW_COMPONENTS[view];
  const dangerCount = notifications.filter((n) => n.severity === "DANGER").length;

  return (
    <UserContext.Provider value={{ user, hasPermission, refreshUser: loadMe }}>
      <div className="flex min-h-screen flex-col bg-background">
        {/* هدر */}
        <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur print:hidden">
          <div className="flex h-14 items-center gap-2 px-3 sm:px-4">
            {/* منوی موبایل */}
            <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden" aria-label="منو">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-72 bg-sidebar p-0 text-sidebar-foreground [&>button]:text-sidebar-foreground">
                <SheetTitle className="sr-only">منوی اصلی</SheetTitle>
                <SidebarContent groups={allowedGroups} view={view} onNavigate={openView} />
              </SheetContent>
            </Sheet>

            <div className="flex items-center gap-2">
              <Pill className="hidden h-6 w-6 text-primary sm:block" />
              <span className="hidden text-sm font-bold sm:block">نظام مدیریت دارویی</span>
            </div>

            <div className="flex flex-1 items-center justify-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="gap-2 text-muted-foreground sm:w-72 sm:justify-start"
                onClick={() => setSearchOpen(true)}
              >
                <Search className="h-4 w-4" />
                <span className="hidden sm:inline">جستجوی سراسری...</span>
                <kbd className="hidden rounded border bg-muted px-1.5 text-[10px] sm:inline">Ctrl K</kbd>
              </Button>
            </div>

            <div className="flex items-center gap-1">
              {/* چراغک وضعیت واقعی اتصال — متصل به هاست / دیتا بیس محلی / افلاین */}
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "gap-1.5",
                  conn.state === "OFFLINE" && "text-rose-600 dark:text-rose-400",
                  conn.state === "LOCAL_DB" && "text-amber-600 dark:text-amber-400",
                  conn.state === "HOST" && "text-emerald-600 dark:text-emerald-400"
                )}
                onClick={() => void sync.syncNow().then((r) => {
                  if (r) {
                    if (r.synced > 0) toast.success(`${r.synced} سند همگام شد`);
                    if (r.conflicts > 0) toast.warning(`${r.conflicts} تعارض — نیاز به بررسی`);
                    if (r.failed > 0) toast.error(`${r.failed} مورد ناموفق: ${r.errors[0] ?? ""}`);
                  } else if (sync.pending === 0) {
                    toast.info("صف همگام‌سازی خالی است");
                  }
                  void conn.recheck();
                })}
                title={
                  conn.state === "HOST"
                    ? "متصل به هاست — سیستم به دیتابیس میزبان وصل است"
                    : conn.state === "LOCAL_DB"
                      ? "دیتا بیس محلی — اینترنت وصل است ولی سیستم به هاست متصل نیست"
                      : "افلاین — دستگاه به اینترنت متصل نیست"
                }
              >
                {sync.syncing || conn.checking ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : conn.state === "HOST" ? (
                  <Cloud className="h-4 w-4" />
                ) : conn.state === "LOCAL_DB" ? (
                  <Database className="h-4 w-4" />
                ) : (
                  <WifiOff className="h-4 w-4" />
                )}
                {/* چراغک وضعیت */}
                {!sync.syncing && !conn.checking && (
                  <span
                    aria-hidden
                    className={cn(
                      "inline-block h-2 w-2 shrink-0 rounded-full",
                      conn.state === "HOST" && "animate-pulse bg-emerald-500",
                      conn.state === "LOCAL_DB" && "bg-amber-500",
                      conn.state === "OFFLINE" && "bg-rose-500"
                    )}
                  />
                )}
                {sync.pending > 0 && (
                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                    {sync.pending}
                  </Badge>
                )}
                <span className="hidden text-xs md:inline">
                  {conn.state === "HOST"
                    ? "متصل به هاست"
                    : conn.state === "LOCAL_DB"
                      ? "دیتا بیس محلی"
                      : "افلاین"}
                </span>
              </Button>

              {/* اعلان‌ها */}
              <Popover open={notifOpen} onOpenChange={setNotifOpen}>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" className="relative" aria-label="اعلان‌ها">
                    <Bell className="h-5 w-5" />
                    {notifications.length > 0 && (
                      <span
                        className={cn(
                          "absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white",
                          dangerCount > 0 ? "bg-rose-600" : "bg-amber-500"
                        )}
                      >
                        {notifications.length}
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="end">
                  <div className="border-b px-3 py-2 text-sm font-semibold">هشدارها و اعلان‌ها</div>
                  <ScrollArea className="max-h-80">
                    {notifications.length === 0 ? (
                      <p className="p-4 text-center text-xs text-muted-foreground">
                        هشدار فعالی وجود ندارد
                      </p>
                    ) : (
                      notifications.map((n, i) => (
                        <button
                          key={i}
                          type="button"
                          className="flex w-full flex-col gap-0.5 border-b px-3 py-2 text-right hover:bg-muted/50"
                          onClick={() => {
                            setNotifOpen(false);
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px]",
                                n.severity === "DANGER"
                                  ? "border-rose-200 bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                                  : n.severity === "WARNING"
                                    ? "border-amber-200 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                                    : ""
                              )}
                            >
                              {n.severity === "DANGER" ? "خطر" : n.severity === "WARNING" ? "هشدار" : "معلومات"}
                            </Badge>
                            <span className="text-xs font-medium">{n.title}</span>
                            {n.count ? (
                              <span className="ms-auto text-[10px] text-muted-foreground">{n.count}</span>
                            ) : null}
                          </div>
                          {n.message && (
                            <span className="text-[11px] text-muted-foreground">{n.message}</span>
                          )}
                        </button>
                      ))
                    )}
                  </ScrollArea>
                </PopoverContent>
              </Popover>

              {/* تم */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                aria-label="تغییر تم"
              >
                {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </Button>

              {/* منوی کاربر */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="gap-2 px-2">
                    <span className="hidden text-xs sm:block">
                      <span className="block font-semibold">{user.fullName}</span>
                      <span className="block text-[10px] text-muted-foreground">
                        {user.branchName ?? "دفتر مرکزی"}
                      </span>
                    </span>
                    <UserRound className="h-5 w-5 text-primary" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>
                    <div>{user.fullName}</div>
                    <div className="text-xs font-normal text-muted-foreground">
                      {user.roleName} — {user.branchName ?? "دفتر مرکزی"}
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem disabled>
                    <ShieldCheck className="ml-2 h-4 w-4" />
                    {user.roleName}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void logout()} className="text-rose-600">
                    <LogOut className="ml-2 h-4 w-4" />
                    خروج از سیستم
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        <div className="flex flex-1">
          {/* سایدبار دسکتاپ */}
          <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 border-s border-sidebar-border bg-sidebar text-sidebar-foreground lg:block print:hidden">
            <SidebarContent groups={allowedGroups} view={view} onNavigate={openView} />
          </aside>

          {/* محتوا */}
          <main className="min-w-0 flex-1 p-3 sm:p-6">
            <div className="mb-4 flex items-center gap-2 lg:hidden">
              {current && <span className="text-sm font-bold">{current.label}</span>}
            </div>
            <ViewComp />
          </main>
        </div>

        {/* فوتر ثابت */}
        <footer className="mt-auto border-t bg-white py-2 dark:bg-background print:hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                {conn.state === "HOST" ? (
                  <Cloud className="h-3.5 w-3.5 text-emerald-600" />
                ) : conn.state === "LOCAL_DB" ? (
                  <Database className="h-3.5 w-3.5 text-amber-600" />
                ) : (
                  <WifiOff className="h-3.5 w-3.5 text-rose-600" />
                )}
                {conn.state === "HOST"
                  ? "متصل به هاست"
                  : conn.state === "LOCAL_DB"
                    ? "دیتا بیس محلی — اسناد در همین سیستم ذخیره می‌شود"
                    : "افلاین — دستگاه به اینترنت متصل نیست"}
              </span>
              {sync.lastSyncAt && (
                <span>آخرین همگام‌سازی: {formatHijriDateTime(sync.lastSyncAt)}</span>
              )}
              <span className="flex items-center gap-1">
                <RefreshCw className="h-3 w-3" />
                نرخ اسعار: از تنظیمات ماژول اسعار
              </span>
            </div>
            <div>تقویم: هجری شمسی — {formatHijriDateTime(new Date())}</div>
          </div>
        </footer>
      </div>

      {/* جستجوی سراسری */}
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Search className="h-4 w-4" /> جستجوی سراسری
            </DialogTitle>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="محصول، بچ، مشتری، فاکتور..."
              className="pr-8"
            />
            {searchQ && (
              <button
                type="button"
                onClick={() => setSearchQ("")}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="پاک کردن"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <ScrollArea className="max-h-80">
            {!searchRes ? (
              <p className="p-4 text-center text-xs text-muted-foreground">
                حداقل دو حرف بنویسید تا جستجو آغاز شود
              </p>
            ) : (
              <div className="space-y-3 py-1">
                <SearchSection
                  title="محصولات"
                  items={searchRes.products.map((p) => ({
                    key: p.id,
                    label: p.name,
                    sub: p.strength ?? "",
                    view: "products" as ViewId,
                  }))}
                  onNavigate={openView}
                  setSearchOpen={setSearchOpen}
                />
                <SearchSection
                  title="بچ‌ها"
                  items={searchRes.batches.map((b) => ({
                    key: b.id,
                    label: b.batchNumber,
                    sub: b.productName,
                    view: "batches" as ViewId,
                  }))}
                  onNavigate={openView}
                  setSearchOpen={setSearchOpen}
                />
                <SearchSection
                  title="مشتریان"
                  items={searchRes.customers.map((c) => ({ key: c.id, label: c.name, sub: "", view: "customers" as ViewId }))}
                  onNavigate={openView}
                  setSearchOpen={setSearchOpen}
                />
                <SearchSection
                  title="تأمین‌کنندگان"
                  items={searchRes.suppliers.map((s) => ({ key: s.id, label: s.name, sub: "", view: "suppliers" as ViewId }))}
                  onNavigate={openView}
                  setSearchOpen={setSearchOpen}
                />
                <SearchSection
                  title="فاکتورهای فروش"
                  items={searchRes.sales.map((s) => ({ key: s.id, label: s.number, sub: s.customerName ?? "", view: "sales" as ViewId }))}
                  onNavigate={openView}
                  setSearchOpen={setSearchOpen}
                />
                <SearchSection
                  title="فاکتورهای خرید"
                  items={searchRes.purchases.map((p) => ({ key: p.id, label: p.number, sub: p.supplierName ?? "", view: "purchases" as ViewId }))}
                  onNavigate={openView}
                  setSearchOpen={setSearchOpen}
                />
                <SearchSection
                  title="رسیدهای پرداخت"
                  items={searchRes.payments.map((p) => ({ key: p.id, label: p.number, sub: "", view: "payments" as ViewId }))}
                  onNavigate={openView}
                  setSearchOpen={setSearchOpen}
                />
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </UserContext.Provider>
  );
}

function SearchSection({
  title,
  items,
  onNavigate,
  setSearchOpen,
}: {
  title: string;
  items: { key: string; label: string; sub: string; view: ViewId }[];
  onNavigate: (v: ViewId) => void;
  setSearchOpen: (o: boolean) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-1 px-1 text-[11px] font-semibold text-muted-foreground">{title}</p>
      <div className="space-y-0.5">
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-right text-sm hover:bg-muted"
            onClick={() => {
              onNavigate(it.view);
              setSearchOpen(false);
            }}
          >
            <span>{it.label}</span>
            {it.sub && <span className="text-xs text-muted-foreground">{it.sub}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function SidebarContent({
  groups,
  view,
  onNavigate,
}: {
  groups: typeof NAV_GROUPS;
  view: ViewId;
  onNavigate: (v: ViewId) => void;
}) {
  return (
    <nav className="flex h-full flex-col overflow-y-auto p-3" aria-label="منوی اصلی">
      <div className="mb-3 flex items-center gap-2 px-2 pt-1">
        <Pill className="h-7 w-7 text-sidebar-primary" />
        <div>
          <p className="text-sm font-black leading-tight">نظام مدیریت دارویی</p>
          <p className="text-[10px] text-sidebar-foreground/60">واردات و عمده‌فروشی — افغانستان</p>
        </div>
      </div>
      {groups.map((g) => (
        <div key={g.title} className="mb-3">
          <p className="mb-1 px-2 text-[10px] font-bold uppercase tracking-wide text-sidebar-foreground/50">
            {g.title}
          </p>
          <div className="space-y-0.5">
            {g.items.map((item) => {
              const Icon = item.icon;
              const active = view === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                    active
                      ? "bg-sidebar-primary font-semibold text-sidebar-primary-foreground shadow-sm"
                      : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="mt-auto px-2 pb-2 pt-3 text-[10px] text-sidebar-foreground/50">
        نسخه ۱٫۰ — ساخته‌شده برای بازار افغانستان
      </div>
    </nav>
  );
}

// ─── صفحه ورود ───

function LoginView({
  onSuccess,
  warning,
}: {
  onSuccess: (u: SessionUser) => void;
  warning?: string;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ hasUsers: boolean; defaultHint?: string }>("/api/auth/bootstrap-status")
      .then((r) => setHint(r.defaultHint ?? null))
      .catch(() => undefined);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await withTimeout(
        apiSend<{ user: SessionUser }>("/api/auth/login", {
          method: "POST",
          body: { username, password },
        }),
        10000
      );
      const queued: QueuedResult | null = (res as { queued?: boolean }).queued
        ? (res as QueuedResult)
        : null;
      if (queued) {
        toast.info("اتصال قطع است — پس از اتصال دوباره تلاش کنید");
        return;
      }
      onSuccess((res as { user: SessionUser }).user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ورود ناموفق بود");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-brand-soft to-muted p-4 dark:from-background dark:to-background">
      <div className="w-full max-w-sm rounded-2xl border bg-white p-6 shadow-lg dark:bg-card">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md">
            <Pill className="h-8 w-8" />
          </div>
          <h1 className="text-lg font-black">نظام مدیریت دارویی</h1>
          <p className="text-xs text-muted-foreground">
            واردات، عمده‌فروشی، انبار و حسابداری — افغانستان
          </p>
        </div>
        {warning && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-center text-[11px] text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            {warning}
          </p>
        )}
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="username" className="text-xs font-medium">
              نام کاربری
            </label>
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              dir="ltr"
              className="text-left"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="password" className="text-xs font-medium">
              رمز عبور
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              dir="ltr"
              className="text-left"
            />
          </div>
          {error && (
            <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950 dark:text-rose-300">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full bg-primary hover:bg-primary/90" disabled={loading}>
            {loading && <Loader2 className="ml-1 h-4 w-4 animate-spin" />}
            ورود به سیستم
          </Button>
        </form>
        {hint && (
          <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-center text-[11px] text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            ورود پیش‌فرض: <b dir="ltr">admin / admin123</b> — پس از ورود رمز را تغییر دهید
          </p>
        )}
      </div>
      <p className="mt-4 text-center text-[11px] text-muted-foreground">
        تقویم هجری شمسی — منطقه زمانی افغانستان (UTC+4:30)
      </p>
    </div>
  );
}
