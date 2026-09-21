import { db } from "@/lib/db";
import { handleApiError, ok, round2 } from "@/lib/api-utils";
import {
  allowedBranchIds,
  assertBranchAccess,
  requirePermission,
  requireUser,
} from "@/lib/auth";

// ─────────────────────── انواع ───────────────────────

type TxRow = {
  id: string;
  kind: "PAYMENT_IN" | "PAYMENT_OUT" | "EXPENSE";
  number: string | null;
  title: string;
  sub: string | null;
  amountAfn: number;
  date: Date;
  branchId: string;
  branchName: string;
};

type BranchBox = {
  branchId: string;
  branchName: string;
  branchCode: string;
  isHeadOffice: boolean;
  inflowAfn: number;
  outflowAfn: number;
  expensesAfn: number;
  pendingExpensesAfn: number;
  balanceAfn: number;
};

// GET /api/cashbox — موجودی صندوق هر شعبه
// وارده = رسیدهای نقدی جهت IN (کامل‌شده)
// صارده = رسیدهای نقدی جهت OUT (کامل‌شده)
// مصارف = مصرف‌های تأییدشده
// فقط «نقدی» (CASH) در محاسبهٔ صندوق می‌آید — بانک/حواله حساب جدا دارند
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    requirePermission(user, "payments.view");

    const url = new URL(req.url);
    const branchIdParam = url.searchParams.get("branchId")?.trim() ?? "";

    if (branchIdParam) assertBranchAccess(user, branchIdParam);
    const allowed = allowedBranchIds(user);
    if (allowed !== undefined && allowed.length === 0) {
      return ok({ branches: [], totals: emptyTotals(), recent: [] });
    }

    const branchScope = branchIdParam
      ? { id: branchIdParam }
      : allowed
        ? { id: { in: allowed } }
        : {};
    const txScope = branchIdParam
      ? { branchId: branchIdParam }
      : allowed
        ? { branchId: { in: allowed } }
        : {};

    const [branches, payments, expenses] = await Promise.all([
      db.branch.findMany({
        where: { isActive: true, ...branchScope },
        orderBy: [{ isHeadOffice: "desc" }, { name: "asc" }],
        select: { id: true, name: true, code: true, isHeadOffice: true },
      }),
      db.payment.findMany({
        where: { status: "COMPLETED", method: "CASH", ...txScope },
        select: {
          id: true,
          branchId: true,
          direction: true,
          number: true,
          amount: true,
          exchangeRate: true,
          date: true,
          notes: true,
          customer: { select: { name: true } },
          supplier: { select: { name: true } },
          branch: { select: { name: true } },
        },
      }),
      db.expense.findMany({
        where: { ...txScope },
        select: {
          id: true,
          branchId: true,
          amountAfn: true,
          status: true,
          date: true,
          description: true,
          category: { select: { name: true } },
          branch: { select: { name: true } },
        },
      }),
    ]);

    // ─── محاسبهٔ صندوق هر شعبه ───
    const boxes = new Map<string, BranchBox>();
    for (const b of branches) {
      boxes.set(b.id, {
        branchId: b.id,
        branchName: b.name,
        branchCode: b.code,
        isHeadOffice: b.isHeadOffice,
        inflowAfn: 0,
        outflowAfn: 0,
        expensesAfn: 0,
        pendingExpensesAfn: 0,
        balanceAfn: 0,
      });
    }
    const touch = (branchId: string): BranchBox | null =>
      boxes.get(branchId) ?? null;

    for (const p of payments) {
      const box = touch(p.branchId);
      if (!box) continue;
      const afn = round2(p.amount * (p.exchangeRate || 1));
      if (p.direction === "IN") box.inflowAfn = round2(box.inflowAfn + afn);
      else box.outflowAfn = round2(box.outflowAfn + afn);
    }
    for (const x of expenses) {
      const box = touch(x.branchId);
      if (!box) continue;
      if (x.status === "APPROVED") {
        box.expensesAfn = round2(box.expensesAfn + (x.amountAfn ?? 0));
      } else if (x.status === "PENDING") {
        box.pendingExpensesAfn = round2(
          box.pendingExpensesAfn + (x.amountAfn ?? 0)
        );
      }
    }
    for (const box of boxes.values()) {
      box.balanceAfn = round2(
        box.inflowAfn - box.outflowAfn - box.expensesAfn
      );
    }

    const branchList = [...boxes.values()].sort((a, b) => {
      if (a.isHeadOffice !== b.isHeadOffice) return a.isHeadOffice ? -1 : 1;
      return a.branchName.localeCompare(b.branchName, "fa");
    });

    const totals = branchList.reduce(
      (acc, b) => ({
        inflowAfn: round2(acc.inflowAfn + b.inflowAfn),
        outflowAfn: round2(acc.outflowAfn + b.outflowAfn),
        expensesAfn: round2(acc.expensesAfn + b.expensesAfn),
        pendingExpensesAfn: round2(
          acc.pendingExpensesAfn + b.pendingExpensesAfn
        ),
        balanceAfn: round2(acc.balanceAfn + b.balanceAfn),
      }),
      emptyTotals()
    );

    // ─── آخرین حرکت‌های نقدی (ترکیب رسیدها و مصارف) ───
    const recent: TxRow[] = [
      ...payments.map<TxRow>((p) => ({
        id: p.id,
        kind: p.direction === "IN" ? "PAYMENT_IN" : "PAYMENT_OUT",
        number: p.number,
        title:
          p.customer?.name ??
          p.supplier?.name ??
          (p.direction === "IN" ? "رسید پول گرفتن" : "رسید پرداخت پول"),
        sub: p.notes ?? null,
        amountAfn: round2(p.amount * (p.exchangeRate || 1)),
        date: p.date,
        branchId: p.branchId,
        branchName: p.branch?.name ?? "—",
      })),
      ...expenses
        .filter((x) => x.status === "APPROVED")
        .map<TxRow>((x) => ({
          id: x.id,
          kind: "EXPENSE",
          number: null,
          title: x.category?.name ?? "مصرف",
          sub: x.description ?? null,
          amountAfn: x.amountAfn ?? 0,
          date: x.date,
          branchId: x.branchId,
          branchName: x.branch?.name ?? "—",
        })),
    ]
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, 60);

    return ok({ branches: branchList, totals, recent });
  } catch (e) {
    return handleApiError(e);
  }
}

function emptyTotals() {
  return {
    inflowAfn: 0,
    outflowAfn: 0,
    expensesAfn: 0,
    pendingExpensesAfn: 0,
    balanceAfn: 0,
  };
}
