import { db } from "@/lib/db";
import { handleApiError, ok, round2 } from "@/lib/api-utils";
import { requireUser, requirePermission, allowedBranchIds } from "@/lib/auth";
import { currentShamsiMonthEnd, currentShamsiMonthStart, hijriDayEnd } from "@/lib/hijri";
import {
  computePeriodFinancials,
  computePeriodPurchases,
  getSettingNum,
} from "@/lib/business";

const DAY_MS = 24 * 60 * 60 * 1000;

/** شروع امروز به وقت کابل */
function kabulTodayStart(now: Date): Date {
  const kabulDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kabul" }).format(now);
  return new Date(`${kabulDate}T00:00:00+04:30`);
}

// GET /api/dashboard
export async function GET() {
  try {
    const user = await requireUser();
    requirePermission(user, "dashboard.view");

    const allowed = allowedBranchIds(user);
    const now = new Date();
    // ماه جاری تقویم شمسی — از روز اول ماه تا ختم ماه
    // نکتهٔ مهم: تاریخ سندها همیشه «۱۲:۰۰ به وقت کابل» است؛ اگر مرز بالایی
    // «الان» باشد، سندهای امروز قبل از ظهر از محاسبات جا می‌مانند. مرز درست
    // ختم روز (برای امروز) و ختم ماه شمسی (برای ماه جاری) است.
    const monthStart = currentShamsiMonthStart(now);
    const monthEnd = currentShamsiMonthEnd(now);
    const todayStart = kabulTodayStart(now);
    const todayEnd = hijriDayEnd(now);
    const activeStatuses = ["APPROVED", "COMPLETED"];

    // کاربر بدون شعبه — هیچ داده‌ای
    if (allowed !== undefined && allowed.length === 0) {
      return ok({
        branchCount: 0,
        salesTodayAfn: 0,
        salesMonthAfn: 0,
        purchasesMonthAfn: 0,
        grossProfitMonthAfn: 0,
        netProfitMonthAfn: 0,
        receivablesAfn: 0,
        payablesAfn: 0,
        inventoryValueAfn: 0,
        expiringBatches: 0,
        lowStockCount: 0,
        recent: [],
        branchPerformance: [],
        salespersonPerformance: [],
        territoryPerformance: [],
      });
    }
    const branchFilter = allowed ? { branchId: { in: allowed } } : {};

    // ─── فروش امروز (کابل) ───
    const todayAgg = await db.sale.aggregate({
      where: { date: { gte: todayStart, lte: todayEnd }, status: { in: activeStatuses }, ...branchFilter },
      _sum: { totalAfn: true, returnedAfn: true },
    });
    const salesTodayAfn = round2((todayAgg._sum.totalAfn ?? 0) - (todayAgg._sum.returnedAfn ?? 0));

    // ─── مالی ماه جاری (شمسی) ───
    const financials = await computePeriodFinancials(monthStart, monthEnd, allowed ?? undefined);
    const purchasesMonth = await computePeriodPurchases(monthStart, monthEnd, allowed ?? undefined);

    // ─── تعداد شعب ───
    const branchCount = user.isSuperAdmin
      ? await db.branch.count({ where: { isActive: true } })
      : 1;

    // ─── توازن‌ها و ارزش موجودی ───
    const [receivables, payables] = await Promise.all([
      db.customer.aggregate({ where: { balance: { gt: 0 }, ...branchFilter }, _sum: { balance: true } }),
      db.supplier.aggregate({ where: { balance: { gt: 0 } }, _sum: { balance: true } }),
    ]);

    const warehouses = await db.warehouse.findMany({
      where: allowed ? { branchId: { in: allowed } } : {},
      select: { id: true },
    });
    const whIds = warehouses.map((w) => w.id);

    let inventoryValueAfn = 0;
    let expiringBatches = 0;
    let lowStockCount = 0;
    if (whIds.length > 0) {
      const warnDays = await getSettingNum("expiry_warn_days", 90);
      const warnDate = new Date(now.getTime() + warnDays * DAY_MS);

      const stockItems = await db.stockItem.findMany({
        where: { warehouseId: { in: whIds }, quantity: { gt: 0 } },
        select: {
          quantity: true,
          batchId: true,
          batch: { select: { expiryDate: true, costPrice: true } },
          product: { select: { id: true, minStock: true } },
        },
      });

      const expiringSet = new Set<string>();
      const productQty = new Map<string, { qty: number; minStock: number }>();
      for (const s of stockItems) {
        inventoryValueAfn += s.quantity * s.batch.costPrice;
        if (s.batch.expiryDate && s.batch.expiryDate <= warnDate) expiringSet.add(s.batchId);
        if (s.product.minStock > 0) {
          const entry = productQty.get(s.product.id) ?? { qty: 0, minStock: s.product.minStock };
          entry.qty += s.quantity;
          productQty.set(s.product.id, entry);
        }
      }
      expiringBatches = expiringSet.size;
      for (const p of productQty.values()) {
        if (p.qty < p.minStock) lowStockCount += 1;
      }
    }

    // ─── آخرین فروش‌ها و خریدها ───
    const [recentSales, recentPurchases] = await Promise.all([
      db.sale.findMany({
        where: branchFilter,
        orderBy: { date: "desc" },
        take: 10,
        select: { number: true, date: true, totalAfn: true, status: true, customer: { select: { name: true } } },
      }),
      db.purchase.findMany({
        where: branchFilter,
        orderBy: { date: "desc" },
        take: 10,
        select: { number: true, date: true, totalAfn: true, status: true, supplier: { select: { name: true } } },
      }),
    ]);
    const recent = [
      ...recentSales.map((s) => ({
        kind: "SALE" as const,
        number: s.number,
        partyName: s.customer.name,
        totalAfn: s.totalAfn,
        date: s.date,
        status: s.status,
      })),
      ...recentPurchases.map((p) => ({
        kind: "PURCHASE" as const,
        number: p.number,
        partyName: p.supplier.name,
        totalAfn: p.totalAfn,
        date: p.date,
        status: p.status,
      })),
    ]
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, 10);

    // ─── عملکرد شعب (فقط سوپرادمین) ───
    let branchPerformance: {
      branchId: string;
      branchName: string;
      salesAfn: number;
      purchasesAfn: number;
      expensesAfn: number;
      netProfitAfn: number;
    }[] = [];
    if (user.isSuperAdmin) {
      const branches = await db.branch.findMany({ where: { isActive: true }, select: { id: true, name: true } });
      for (const b of branches) {
        const fin = await computePeriodFinancials(monthStart, monthEnd, [b.id]);
        const pur = await computePeriodPurchases(monthStart, monthEnd, [b.id]);
        branchPerformance.push({
          branchId: b.id,
          branchName: b.name,
          salesAfn: fin.revenueAfn,
          purchasesAfn: pur.totalAfn,
          expensesAfn: fin.expensesAfn,
          netProfitAfn: fin.netProfitAfn,
        });
      }
    }

    // ─── عملکرد فروشندگان و مناطق (کاربر شعبه‌دار) ───
    let salespersonPerformance: { salespersonId: string; name: string; count: number; salesAfn: number }[] = [];
    let territoryPerformance: { territoryId: string; name: string; count: number; salesAfn: number }[] = [];
    if (!user.isSuperAdmin && user.branchId) {
      const branchId = user.branchId;

      const [salespersons, salesByPerson] = await Promise.all([
        db.salesperson.findMany({
          where: { branchId, isActive: true },
          select: { id: true, name: true },
        }),
        db.sale.groupBy({
          by: ["salespersonId"],
          where: {
            branchId,
            date: { gte: monthStart, lte: monthEnd },
            status: { in: activeStatuses },
            salespersonId: { not: null },
          },
          _count: true,
          _sum: { totalAfn: true, returnedAfn: true },
        }),
      ]);
      const personAgg = new Map(
        salesByPerson.map((g) => [
          g.salespersonId as string,
          {
            count: g._count,
            salesAfn: round2((g._sum.totalAfn ?? 0) - (g._sum.returnedAfn ?? 0)),
          },
        ])
      );
      salespersonPerformance = salespersons.map((sp) => ({
        salespersonId: sp.id,
        name: sp.name,
        count: personAgg.get(sp.id)?.count ?? 0,
        salesAfn: personAgg.get(sp.id)?.salesAfn ?? 0,
      }));

      const [territories, salesByTerritory] = await Promise.all([
        db.territory.findMany({
          where: { branchId, isActive: true },
          select: { id: true, name: true },
        }),
        db.sale.groupBy({
          by: ["territoryId"],
          where: {
            branchId,
            date: { gte: monthStart, lte: monthEnd },
            status: { in: activeStatuses },
            territoryId: { not: null },
          },
          _count: true,
          _sum: { totalAfn: true, returnedAfn: true },
        }),
      ]);
      const territoryAgg = new Map(
        salesByTerritory.map((g) => [
          g.territoryId as string,
          {
            count: g._count,
            salesAfn: round2((g._sum.totalAfn ?? 0) - (g._sum.returnedAfn ?? 0)),
          },
        ])
      );
      territoryPerformance = territories.map((t) => ({
        territoryId: t.id,
        name: t.name,
        count: territoryAgg.get(t.id)?.count ?? 0,
        salesAfn: territoryAgg.get(t.id)?.salesAfn ?? 0,
      }));
    }

    return ok({
      branchCount,
      salesTodayAfn,
      salesMonthAfn: financials.revenueAfn,
      purchasesMonthAfn: purchasesMonth.totalAfn,
      grossProfitMonthAfn: financials.grossProfitAfn,
      netProfitMonthAfn: financials.netProfitAfn,
      receivablesAfn: round2(receivables._sum.balance ?? 0),
      payablesAfn: round2(payables._sum.balance ?? 0),
      inventoryValueAfn: round2(inventoryValueAfn),
      expiringBatches,
      lowStockCount,
      recent,
      branchPerformance,
      salespersonPerformance,
      territoryPerformance,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
