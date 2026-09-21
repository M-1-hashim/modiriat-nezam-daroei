import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handleApiError, ok } from "@/lib/api-utils";
import { allowedBranchIds, hasPermission, requireUser } from "@/lib/auth";

type SearchResults = {
  products: unknown[];
  batches: unknown[];
  customers: unknown[];
  suppliers: unknown[];
  sales: unknown[];
  purchases: unknown[];
  payments: unknown[];
};

// GET /api/search?q= — جستجوی سراسری با احترام به صلاحیت‌ها و شعبه‌ها
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim();

    const empty: SearchResults = {
      products: [],
      batches: [],
      customers: [],
      suppliers: [],
      sales: [],
      purchases: [],
      payments: [],
    };
    if (q.length < 2) return ok(empty);

    const contains = { contains: q };
    const scopes = allowedBranchIds(user);
    const branchFilter = scopes ? { branchId: { in: scopes } } : {};

    const [
      products,
      batches,
      customers,
      suppliers,
      sales,
      purchases,
      payments,
    ] = await Promise.all([
      hasPermission(user, "products.view")
        ? db.product.findMany({
            where: {
              isActive: true,
              OR: [
                { name: contains },
                { genericName: contains },
                { barcode: contains },
              ],
            },
            select: {
              id: true,
              name: true,
              genericName: true,
              strength: true,
              dosageForm: true,
              unit: true,
              salePrice: true,
            },
            take: 5,
          })
        : Promise.resolve([]),
      hasPermission(user, "batches.view")
        ? db.batch.findMany({
            where: { batchNumber: contains },
            include: { product: { select: { id: true, name: true } } },
            orderBy: { createdAt: "desc" },
            take: 5,
          })
        : Promise.resolve([]),
      hasPermission(user, "customers.view")
        ? db.customer.findMany({
            where: {
              ...branchFilter,
              OR: [{ name: contains }, { phone: contains }],
            },
            select: {
              id: true,
              name: true,
              type: true,
              phone: true,
              balance: true,
              branchId: true,
            },
            take: 5,
          })
        : Promise.resolve([]),
      hasPermission(user, "suppliers.view")
        ? db.supplier.findMany({
            where: { OR: [{ name: contains }, { country: contains }] },
            select: { id: true, name: true, type: true, country: true, balance: true },
            take: 5,
          })
        : Promise.resolve([]),
      hasPermission(user, "sales.view")
        ? db.sale.findMany({
            where: { ...branchFilter, number: contains },
            include: { customer: { select: { id: true, name: true } } },
            orderBy: { date: "desc" },
            take: 5,
          })
        : Promise.resolve([]),
      hasPermission(user, "purchases.view")
        ? db.purchase.findMany({
            where: { ...branchFilter, number: contains },
            include: { supplier: { select: { id: true, name: true } } },
            orderBy: { date: "desc" },
            take: 5,
          })
        : Promise.resolve([]),
      hasPermission(user, "payments.view")
        ? db.payment.findMany({
            where: {
              ...branchFilter,
              OR: [{ number: contains }, { reference: contains }],
            },
            orderBy: { date: "desc" },
            select: {
              id: true,
              number: true,
              type: true,
              direction: true,
              amount: true,
              currency: true,
              date: true,
            },
            take: 5,
          })
        : Promise.resolve([]),
    ]);

    return ok({
      products,
      batches,
      customers,
      suppliers,
      sales,
      purchases,
      payments,
    } satisfies SearchResults);
  } catch (e) {
    return handleApiError(e);
  }
}
