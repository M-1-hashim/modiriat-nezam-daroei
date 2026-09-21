import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { handleApiError, ok } from "@/lib/api-utils";
import { allowedBranchIds, hasPermission, requireUser } from "@/lib/auth";
import { getSettingNum } from "@/lib/business";

type NotificationItem = {
  id?: string;
  type: string;
  severity: "INFO" | "WARNING" | "DANGER";
  title: string;
  message: string;
  count?: number;
  viewId?: string;
  branchId?: string | null;
  createdAt?: Date;
};

/** هر هشدار به کدام ویو اشاره دارد (برای ناوبری فرانت) */
const VIEW_BY_TYPE: Record<string, string> = {
  EXPIRING_BATCHES: "batches",
  EXPIRED_BATCHES: "batches",
  LOW_STOCK: "inventory",
  CREDIT_LIMIT: "customers",
  PENDING_PURCHASES: "purchases",
  PENDING_SALES: "sales",
  PENDING_RETURNS: "returns",
  PENDING_EXPENSES: "expenses",
  CURRENCY_SYNC: "currency",
  SYNC_FAILED: "settings",
};

// GET /api/notifications — محاسبه هشدارها + نوتیفیکیشن‌های ذخیره‌شدهٔ خوانده‌نشده
export async function GET(_req: NextRequest) {
  try {
    const user = await requireUser();
    const scopes = allowedBranchIds(user);
    const now = new Date();
    const items: NotificationItem[] = [];

    const warehouseBranchFilter = scopes
      ? { warehouse: { branchId: { in: scopes } } }
      : {};

    // (a) بچ‌های نزدیک انقضا با موجودی
    const warnDays = await getSettingNum("expiry_warn_days", 90);
    const deadline = new Date(now.getTime() + warnDays * 24 * 60 * 60 * 1000);
    const expiringStock = await db.stockItem.findMany({
      where: {
        quantity: { gt: 0 },
        batch: { expiryDate: { gte: now, lte: deadline } },
        ...warehouseBranchFilter,
      },
      select: { batchId: true },
    });
    const expiringCount = new Set(expiringStock.map((s) => s.batchId)).size;
    if (expiringCount > 0) {
      items.push({
        type: "EXPIRING_BATCHES",
        severity: "WARNING",
        title: "بچ‌های نزدیک انقضا",
        message: `${expiringCount} بچ ادویه در ${warnDays} روز آینده تاریخ مصرف‌شان تمام می‌شود`,
        count: expiringCount,
      });
    }

    // (b) بچ‌های منقضی‌شده با موجودی
    const expiredStock = await db.stockItem.findMany({
      where: {
        quantity: { gt: 0 },
        batch: { expiryDate: { lt: now } },
        ...warehouseBranchFilter,
      },
      select: { batchId: true },
    });
    const expiredCount = new Set(expiredStock.map((s) => s.batchId)).size;
    if (expiredCount > 0) {
      items.push({
        type: "EXPIRED_BATCHES",
        severity: "DANGER",
        title: "ادویه منقضی‌شده در گدام",
        message: `${expiredCount} بچ منقضی‌شده در گدام موجود است؛ باید جدا گردد`,
        count: expiredCount,
      });
    }

    // (c) کمبود موجودی (زیر حداقل تعریف‌شدهٔ محصول)
    const stockGroups = await db.stockItem.groupBy({
      by: ["productId"],
      _sum: { quantity: true },
      ...(scopes ? { where: { warehouse: { branchId: { in: scopes } } } } : {}),
    });
    const productIds = stockGroups.map((g) => g.productId);
    if (productIds.length > 0) {
      const products = await db.product.findMany({
        where: { id: { in: productIds }, minStock: { gt: 0 } },
        select: { id: true, name: true, minStock: true },
      });
      const sums = new Map(
        stockGroups.map((g) => [g.productId, g._sum.quantity ?? 0])
      );
      const low = products.filter((p) => (sums.get(p.id) ?? 0) < p.minStock);
      if (low.length > 0) {
        items.push({
          type: "LOW_STOCK",
          severity: "WARNING",
          title: "کمبود موجودی",
          message: `${low.length} جنس به حداقل موجودی رسیده یا زیر آن است`,
          count: low.length,
        });
      }
    }

    // (d) مشتریان بالاتر از سقف اعتبار
    const creditCandidates = await db.customer.findMany({
      where: {
        isActive: true,
        creditLimit: { gt: 0 },
        balance: { gt: 0 },
        ...(scopes ? { branchId: { in: scopes } } : {}),
      },
      select: { id: true, name: true, balance: true, creditLimit: true },
      take: 500,
    });
    const overLimit = creditCandidates.filter((c) => c.balance > c.creditLimit);
    if (overLimit.length > 0) {
      items.push({
        type: "CREDIT_LIMIT",
        severity: "DANGER",
        title: "بلند رفتن از سقف اعتبار",
        message: `${overLimit.length} مشتری از سقف اعتبار تعیین‌شده عبور کرده است`,
        count: overLimit.length,
      });
    }

    // (e) اسناد در انتظار تصویب (برای کسانی که صلاحیت تصویب دارند)
    const branchFilter = scopes ? { branchId: { in: scopes } } : {};
    if (hasPermission(user, "purchases.approve")) {
      const c = await db.purchase.count({
        where: { status: "PENDING", ...branchFilter },
      });
      if (c > 0) {
        items.push({
          type: "PENDING_PURCHASES",
          severity: "INFO",
          title: "در انتظار تصویب",
          message: `${c} فاکتور خرید در انتظار تصویب است`,
          count: c,
        });
      }
    }
    if (hasPermission(user, "sales.approve")) {
      const c = await db.sale.count({
        where: { status: "PENDING", ...branchFilter },
      });
      if (c > 0) {
        items.push({
          type: "PENDING_SALES",
          severity: "INFO",
          title: "در انتظار تصویب",
          message: `${c} فاکتور فروش در انتظار تصویب است`,
          count: c,
        });
      }
    }
    if (hasPermission(user, "returns.approve")) {
      const [sr, pr] = await Promise.all([
        db.salesReturn.count({ where: { status: "REQUESTED", ...branchFilter } }),
        db.purchaseReturn.count({ where: { status: "REQUESTED", ...branchFilter } }),
      ]);
      const c = sr + pr;
      if (c > 0) {
        items.push({
          type: "PENDING_RETURNS",
          severity: "INFO",
          title: "در انتظار تصویب",
          message: `${c} برگشتی در انتظار تصویب است`,
          count: c,
        });
      }
    }
    if (hasPermission(user, "expenses.approve")) {
      const c = await db.expense.count({
        where: { status: "PENDING", ...branchFilter },
      });
      if (c > 0) {
        items.push({
          type: "PENDING_EXPENSES",
          severity: "INFO",
          title: "در انتظار تصویب",
          message: `${c} سند مصرف در انتظار تصویب است`,
          count: c,
        });
      }
    }

    // (f) به‌روزرسانی نرخ اسعار
    const cs = await db.currencySettings.findUnique({ where: { id: "main" } });
    const currencyStale =
      !cs || !cs.enabled
        ? false
        : !cs.lastSyncAt ||
          (now.getTime() - cs.lastSyncAt.getTime()) / 60000 >
            cs.refreshMinutes * 2;
    if (currencyStale) {
      const last = cs?.lastSyncAt;
      items.push({
        type: "CURRENCY_SYNC",
        severity: "WARNING",
        title: "به‌روزرسانی نرخ اسعار",
        message: last
          ? `آخرین همگام‌سازی نرخ اسعار ${Math.round(
              (now.getTime() - last.getTime()) / 60000
            )} دقیقه قبل انجام شده است`
          : "نرخ اسعار تاکنون همگام‌سازی نشده است",
        count: 1,
      });
    }

    // (g) همگام‌سازی ناموفق در ۲۴ ساعت اخیر
    const since24 = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const failedSync = await db.syncLog.count({
      where: { status: { in: ["FAILED", "CONFLICT"] }, createdAt: { gte: since24 } },
    });
    if (failedSync > 0) {
      items.push({
        type: "SYNC_FAILED",
        severity: "WARNING",
        title: "همگام‌سازی ناموفق",
        message: `${failedSync} مورد همگام‌سازی در ۲۴ ساعت اخیر ناموفق یا تعارض داشته است`,
        count: failedSync,
      });
    }

    // نوتیفیکیشن‌های ذخیره‌شدهٔ خوانده‌نشده (مربوط به شعبهٔ کاربر یا عمومی)
    const storedWhere: Prisma.NotificationWhereInput = { isRead: false };
    if (scopes) {
      storedWhere.OR =
        scopes.length > 0
          ? [{ branchId: null }, { branchId: { in: scopes } }]
          : [{ branchId: null }];
    }
    const unreadStored = await db.notification.findMany({
      where: storedWhere,
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    const storedItems: NotificationItem[] = unreadStored.map((n) => ({
      id: n.id,
      type: n.type,
      severity:
        n.severity === "DANGER"
          ? "DANGER"
          : n.severity === "WARNING"
            ? "WARNING"
            : "INFO",
      title: n.title,
      message: n.message ?? "",
      branchId: n.branchId,
      createdAt: n.createdAt,
    }));

    return ok({
      items: [...storedItems, ...items].map((it) => ({
        ...it,
        viewId: VIEW_BY_TYPE[it.type],
      })),
      unreadStored,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
