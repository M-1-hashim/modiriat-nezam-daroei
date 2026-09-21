import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { ApiError, parseDate, round2, round4, toNum } from "@/lib/api-utils";
import {
  assertBranchAccess,
  effectiveBranchId,
  requirePermission,
  type AuthUser,
} from "@/lib/auth";
import {
  logAudit,
  nextDocNumber,
  recalcCustomerBalance,
  recalcPurchaseStatus,
  recalcSaleStatus,
  recalcSupplierBalance,
} from "@/lib/business";

// ─────────────────────────── کمکی‌ها ───────────────────────────

function asStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002"
  );
}

const CURRENCIES = ["AFN", "USD", "PKR"];
const PAYMENT_METHODS = ["CASH", "BANK", "HAWALA"];

const paymentDetailInclude = {
  customer: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
  sale: { select: { id: true, number: true } },
  purchase: { select: { id: true, number: true } },
  branch: { select: { id: true, name: true, code: true } },
} as const;

async function getPaymentDetail(id: string) {
  const payment = await db.payment.findUnique({ where: { id }, include: paymentDetailInclude });
  if (!payment) throw new ApiError("رسید پرداخت یافت نشد", 404, "NOT_FOUND");
  return payment;
}

// ─────────────────────────── ایجاد پرداخت ───────────────────────────

export async function createPayment(
  user: AuthUser,
  body: Record<string, unknown>,
  ip?: string
): Promise<unknown> {
  requirePermission(user, "payments.create");

  // خاصیت idempotency
  const localId = asStr(body.localId) || randomUUID();
  const existing = await db.payment.findUnique({ where: { localId }, include: paymentDetailInclude });
  if (existing) {
    assertBranchAccess(user, existing.branchId);
    return { payment: existing };
  }

  const type = asStr(body.type).toUpperCase();
  if (type !== "CUSTOMER" && type !== "SUPPLIER") {
    throw new ApiError("نوع پرداخت باید مشتری یا تأمین‌کننده باشد", 422, "VALIDATION");
  }

  // مبلغ همیشه به افغانی است (کلاینت تبدیل می‌کند)
  const amount = round2(toNum(body.amount, 0));
  if (amount <= 0) {
    throw new ApiError("مبلغ باید بزرگ‌تر از صفر باشد", 422, "VALIDATION");
  }

  const currency = asStr(body.currency).toUpperCase() || "AFN";
  if (!CURRENCIES.includes(currency)) {
    throw new ApiError("اسعار باید افغانی، دالر یا کلدار باشد", 422, "VALIDATION");
  }
  let exchangeRate = round4(toNum(body.exchangeRate, 1));
  if (currency === "AFN") exchangeRate = 1;
  if (exchangeRate <= 0) {
    throw new ApiError("نرخ تبدیل باید بزرگ‌تر از صفر باشد", 422, "VALIDATION");
  }

  const method = asStr(body.method).toUpperCase() || "CASH";
  if (!PAYMENT_METHODS.includes(method)) {
    throw new ApiError("طریقه پرداخت باید نقدی، بانک یا حواله باشد", 422, "VALIDATION");
  }

  const date = parseDate(body.date) ?? new Date();
  const branchId = effectiveBranchId(user, typeof body.branchId === "string" ? body.branchId : null);

  let customerId: string | null = null;
  let supplierId: string | null = null;
  let saleId: string | null = null;
  let purchaseId: string | null = null;
  let warning: string | undefined;

  if (type === "CUSTOMER") {
    customerId = asStr(body.customerId);
    if (!customerId) throw new ApiError("انتخاب مشتری الزامی است", 422, "VALIDATION");
    const customer = await db.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new ApiError("مشتری یافت نشد", 422, "VALIDATION");
    assertBranchAccess(user, customer.branchId);
    if (customer.branchId !== branchId) {
      throw new ApiError("مشتری انتخاب‌شده متعلق به شعبه دیگر است", 422, "VALIDATION");
    }
  } else {
    supplierId = asStr(body.supplierId);
    if (!supplierId) throw new ApiError("انتخاب تأمین‌کننده الزامی است", 422, "VALIDATION");
    const supplier = await db.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) throw new ApiError("تأمین‌کننده یافت نشد", 422, "VALIDATION");
  }

  const saleIdRaw = asStr(body.saleId);
  if (saleIdRaw) {
    if (type !== "CUSTOMER") {
      throw new ApiError("پرداخت فاکتور فروش فقط برای مشتری امکان‌پذیر است", 422, "VALIDATION");
    }
    const sale = await db.sale.findUnique({ where: { id: saleIdRaw } });
    if (!sale) throw new ApiError("فاکتور فروش یافت نشد", 422, "VALIDATION");
    if (sale.customerId !== customerId) {
      throw new ApiError("فاکتور فروش متعلق به این مشتری نیست", 422, "VALIDATION");
    }
    assertBranchAccess(user, sale.branchId);
    if (!["APPROVED", "COMPLETED"].includes(sale.status)) {
      throw new ApiError("فقط فاکتور تأییدشده قابل پرداخت است", 422, "VALIDATION");
    }
    saleId = sale.id;
    const outstanding = round2(sale.totalAfn - sale.returnedAfn - sale.paidAmount);
    if (amount > outstanding + 0.009) {
      warning = "مبلغ بیش از باقی‌مانده فاکتور است و به‌عنوان پیش‌پرداخت ثبت شد";
    }
  }

  const purchaseIdRaw = asStr(body.purchaseId);
  if (purchaseIdRaw) {
    if (type !== "SUPPLIER") {
      throw new ApiError("پرداخت فاکتور خرید فقط برای تأمین‌کننده امکان‌پذیر است", 422, "VALIDATION");
    }
    const purchase = await db.purchase.findUnique({ where: { id: purchaseIdRaw } });
    if (!purchase) throw new ApiError("فاکتور خرید یافت نشد", 422, "VALIDATION");
    if (purchase.supplierId !== supplierId) {
      throw new ApiError("فاکتور خرید متعلق به این تأمین‌کننده نیست", 422, "VALIDATION");
    }
    assertBranchAccess(user, purchase.branchId);
    if (!["APPROVED", "COMPLETED"].includes(purchase.status)) {
      throw new ApiError("فقط فاکتور تأییدشده قابل پرداخت است", 422, "VALIDATION");
    }
    purchaseId = purchase.id;
    const outstanding = round2(purchase.totalAfn - purchase.returnedAfn - purchase.paidAmount);
    if (amount > outstanding + 0.009) {
      warning = "مبلغ بیش از باقی‌مانده فاکتور است و به‌عنوان پیش‌پرداخت ثبت شد";
    }
  }

  try {
    const created = await db.$transaction(async (tx) => {
      const number = await nextDocNumber(tx, branchId, "PAYMENT");
      const payment = await tx.payment.create({
        data: {
          localId,
          number,
          type,
          direction: type === "CUSTOMER" ? "IN" : "OUT",
          branchId,
          customerId,
          supplierId,
          saleId,
          purchaseId,
          amount,
          currency,
          exchangeRate,
          method,
          reference: asStr(body.reference) || null,
          date,
          notes: asStr(body.notes) || null,
          createdBy: user.id,
          createdByName: user.fullName,
          status: "COMPLETED",
        },
      });

      // لینک به فاکتور → به‌روزرسانی paidAmount و وضعیت
      if (saleId) {
        const sale = await tx.sale.findUnique({ where: { id: saleId } });
        if (sale) {
          await tx.sale.update({
            where: { id: saleId },
            data: { paidAmount: round2(sale.paidAmount + amount) },
          });
          await recalcSaleStatus(tx, saleId);
        }
      }
      if (purchaseId) {
        const purchase = await tx.purchase.findUnique({ where: { id: purchaseId } });
        if (purchase) {
          await tx.purchase.update({
            where: { id: purchaseId },
            data: { paidAmount: round2(purchase.paidAmount + amount) },
          });
          await recalcPurchaseStatus(tx, purchaseId);
        }
      }

      if (customerId) await recalcCustomerBalance(tx, customerId);
      if (supplierId) await recalcSupplierBalance(tx, supplierId);

      await logAudit(tx, {
        userId: user.id,
        userName: user.fullName,
        branchId,
        action: "PAYMENT",
        entity: "Payment",
        entityId: payment.id,
        summary: `ثبت پرداخت ${payment.number} به مبلغ ${amount} افغانی (${type === "CUSTOMER" ? "دریافتی از مشتری" : "پرداختی به تأمین‌کننده"})`,
        ip,
      });

      return payment;
    });

    const payment = await getPaymentDetail(created.id);
    return warning ? { payment, warning } : { payment };
  } catch (e) {
    if (isUniqueViolation(e)) {
      const dup = await db.payment.findUnique({ where: { localId }, include: paymentDetailInclude });
      if (dup) {
        assertBranchAccess(user, dup.branchId);
        return { payment: dup };
      }
      throw new ApiError("رسید پرداخت با این مشخصات قبلاً ثبت شده است", 409, "DUPLICATE");
    }
    throw e;
  }
}

// ─────────────────────────── لغو (حذف نرم) ───────────────────────────

export async function deletePayment(
  user: AuthUser,
  id: string,
  ip?: string
): Promise<unknown> {
  requirePermission(user, "payments.delete");

  const existing = await db.payment.findUnique({ where: { id } });
  if (!existing) throw new ApiError("رسید پرداخت یافت نشد", 404, "NOT_FOUND");
  assertBranchAccess(user, existing.branchId);
  if (existing.status === "CANCELLED") {
    throw new ApiError("این رسید قبلاً لغو شده است", 422, "INVALID_STATUS");
  }

  await db.$transaction(async (tx) => {
    const upd = await tx.payment.updateMany({
      where: { id, status: "COMPLETED" },
      data: { status: "CANCELLED" },
    });
    if (upd.count === 0) {
      throw new ApiError("این رسید قبلاً لغو شده است", 422, "INVALID_STATUS");
    }

    // معکوس‌سازی اثر روی فاکتور
    if (existing.saleId) {
      const sale = await tx.sale.findUnique({ where: { id: existing.saleId } });
      if (sale) {
        await tx.sale.update({
          where: { id: sale.id },
          data: { paidAmount: round2(sale.paidAmount - existing.amount) },
        });
        await recalcSaleStatus(tx, sale.id);
      }
    }
    if (existing.purchaseId) {
      const purchase = await tx.purchase.findUnique({ where: { id: existing.purchaseId } });
      if (purchase) {
        await tx.purchase.update({
          where: { id: purchase.id },
          data: { paidAmount: round2(purchase.paidAmount - existing.amount) },
        });
        await recalcPurchaseStatus(tx, purchase.id);
      }
    }

    // معکوس‌سازی توازن طرف حساب
    if (existing.customerId) await recalcCustomerBalance(tx, existing.customerId);
    if (existing.supplierId) await recalcSupplierBalance(tx, existing.supplierId);

    await logAudit(tx, {
      userId: user.id,
      userName: user.fullName,
      branchId: existing.branchId,
      action: "CANCEL",
      entity: "Payment",
      entityId: id,
      summary: `لغو رسید پرداخت ${existing.number} به مبلغ ${existing.amount} افغانی و معکوس‌سازی اثر آن`,
      ip,
    });
  });

  return getPaymentDetail(id);
}
