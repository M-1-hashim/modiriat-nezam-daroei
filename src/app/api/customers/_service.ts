import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { ApiError, round2, toNum } from "@/lib/api-utils";
import {
  assertBranchAccess,
  effectiveBranchId,
  requirePermission,
  type AuthUser,
} from "@/lib/auth";
import { logAudit } from "@/lib/business";

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

const CUSTOMER_DETAIL_INCLUDE = {
  territory: { select: { id: true, name: true } },
  salesperson: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true, code: true } },
} as const;

async function getCustomerDetail(id: string) {
  const customer = await db.customer.findUnique({
    where: { id },
    include: CUSTOMER_DETAIL_INCLUDE,
  });
  if (!customer) throw new ApiError("مشتری یافت نشد", 404, "NOT_FOUND");
  return customer;
}

/** اعتبارسنجی ولسوالی/فروشنده برای شعبه مشخص */
async function validatePartyRefs(
  branchId: string,
  territoryId: string | null,
  salespersonId: string | null
): Promise<void> {
  if (territoryId) {
    const ter = await db.territory.findUnique({ where: { id: territoryId } });
    if (!ter) throw new ApiError("ولسوالی یافت نشد", 422, "VALIDATION");
    if (ter.branchId !== branchId) {
      throw new ApiError("ولسوالی انتخاب‌شده متعلق به همین شعبه نیست", 422, "VALIDATION");
    }
  }
  if (salespersonId) {
    const sp = await db.salesperson.findUnique({ where: { id: salespersonId } });
    if (!sp) throw new ApiError("فروشنده یافت نشد", 422, "VALIDATION");
    if (sp.branchId !== branchId) {
      throw new ApiError("فروشنده انتخاب‌شده متعلق به همین شعبه نیست", 422, "VALIDATION");
    }
  }
}

// ─────────────────────────── ایجاد ───────────────────────────

export async function createCustomer(
  user: AuthUser,
  body: Record<string, unknown>,
  ip?: string
): Promise<unknown> {
  requirePermission(user, "customers.create");

  // خاصیت idempotency
  const localId = asStr(body.localId) || randomUUID();
  const existing = await db.customer.findUnique({
    where: { localId },
    include: CUSTOMER_DETAIL_INCLUDE,
  });
  if (existing) {
    assertBranchAccess(user, existing.branchId);
    return existing;
  }

  const branchId = effectiveBranchId(user, typeof body.branchId === "string" ? body.branchId : null);

  const name = asStr(body.name);
  if (!name) throw new ApiError("نام مشتری الزامی است", 422, "VALIDATION");
  const type = asStr(body.type) || "PHARMACY";
  const territoryId = asStr(body.territoryId) || null;
  const salespersonId = asStr(body.salespersonId) || null;
  await validatePartyRefs(branchId, territoryId, salespersonId);

  const creditLimit = round2(toNum(body.creditLimit, 0));
  if (creditLimit < 0) throw new ApiError("سقف اعتبار نمی‌تواند منفی باشد", 422, "VALIDATION");
  const paymentTerms = Math.max(0, Math.round(toNum(body.paymentTerms, 0)));

  try {
    const created = await db.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          localId,
          branchId,
          type,
          name,
          contactPerson: asStr(body.contactPerson) || null,
          phone: asStr(body.phone) || null,
          address: asStr(body.address) || null,
          territoryId,
          salespersonId,
          creditLimit,
          paymentTerms,
        },
      });
      await logAudit(tx, {
        userId: user.id,
        userName: user.fullName,
        branchId,
        action: "CREATE",
        entity: "Customer",
        entityId: customer.id,
        summary: `ثبت مشتری جدید: ${customer.name}`,
        ip,
      });
      return customer;
    });
    return getCustomerDetail(created.id);
  } catch (e) {
    if (isUniqueViolation(e)) {
      const dup = await db.customer.findUnique({
        where: { localId },
        include: CUSTOMER_DETAIL_INCLUDE,
      });
      if (dup) {
        assertBranchAccess(user, dup.branchId);
        return dup;
      }
      throw new ApiError("مشتری با این مشخصات قبلاً ثبت شده است", 409, "DUPLICATE");
    }
    throw e;
  }
}

// ─────────────────────────── ویرایش ───────────────────────────

export async function updateCustomer(
  user: AuthUser,
  id: string,
  body: Record<string, unknown>,
  ip?: string
): Promise<unknown> {
  requirePermission(user, "customers.edit");

  const existing = await db.customer.findUnique({ where: { id } });
  if (!existing) throw new ApiError("مشتری یافت نشد", 404, "NOT_FOUND");
  assertBranchAccess(user, existing.branchId);

  const data: {
    name?: string;
    type?: string;
    contactPerson?: string | null;
    phone?: string | null;
    address?: string | null;
    territoryId?: string | null;
    salespersonId?: string | null;
    creditLimit?: number;
    paymentTerms?: number;
    isActive?: boolean;
  } = {};

  if ("name" in body) {
    const name = asStr(body.name);
    if (!name) throw new ApiError("نام مشتری الزامی است", 422, "VALIDATION");
    data.name = name;
  }
  if ("type" in body) data.type = asStr(body.type) || "PHARMACY";
  if ("contactPerson" in body) data.contactPerson = asStr(body.contactPerson) || null;
  if ("phone" in body) data.phone = asStr(body.phone) || null;
  if ("address" in body) data.address = asStr(body.address) || null;

  if ("territoryId" in body) {
    const territoryId = asStr(body.territoryId) || null;
    await validatePartyRefs(existing.branchId, territoryId, null);
    data.territoryId = territoryId;
  }
  if ("salespersonId" in body) {
    const salespersonId = asStr(body.salespersonId) || null;
    await validatePartyRefs(existing.branchId, null, salespersonId);
    data.salespersonId = salespersonId;
  }
  if ("creditLimit" in body) {
    const creditLimit = round2(toNum(body.creditLimit, 0));
    if (creditLimit < 0) throw new ApiError("سقف اعتبار نمی‌تواند منفی باشد", 422, "VALIDATION");
    data.creditLimit = creditLimit;
  }
  if ("paymentTerms" in body) {
    data.paymentTerms = Math.max(0, Math.round(toNum(body.paymentTerms, 0)));
  }
  if ("isActive" in body) data.isActive = Boolean(body.isActive);

  await db.$transaction(async (tx) => {
    await tx.customer.update({ where: { id }, data });
    await logAudit(tx, {
      userId: user.id,
      userName: user.fullName,
      branchId: existing.branchId,
      action: "UPDATE",
      entity: "Customer",
      entityId: id,
      summary: `ویرایش مشتری ${existing.name}`,
      ip,
    });
  });

  return getCustomerDetail(id);
}

// ─────────────────────────── حذف/غیرفعال‌سازی ───────────────────────────

export async function deleteCustomer(
  user: AuthUser,
  id: string,
  ip?: string
): Promise<unknown> {
  requirePermission(user, "customers.delete");

  const existing = await db.customer.findUnique({ where: { id } });
  if (!existing) throw new ApiError("مشتری یافت نشد", 404, "NOT_FOUND");
  assertBranchAccess(user, existing.branchId);

  const [salesCount, paymentsCount, returnsCount] = await Promise.all([
    db.sale.count({ where: { customerId: id } }),
    db.payment.count({ where: { customerId: id } }),
    db.salesReturn.count({ where: { customerId: id } }),
  ]);

  const hasTransactions = salesCount + paymentsCount + returnsCount > 0;

  await db.$transaction(async (tx) => {
    if (hasTransactions) {
      await tx.customer.update({ where: { id }, data: { isActive: false } });
    } else {
      await tx.customer.delete({ where: { id } });
    }
    await logAudit(tx, {
      userId: user.id,
      userName: user.fullName,
      branchId: existing.branchId,
      action: "DELETE",
      entity: "Customer",
      entityId: id,
      summary: hasTransactions
        ? `غیرفعال‌سازی مشتری ${existing.name} (دارای تراکنش)`
        : `حذف مشتری ${existing.name}`,
      ip,
    });
  });

  return hasTransactions
    ? {
        id,
        deactivated: true,
        message: "مشتری دارای تراکنش است؛ به‌صورت غیرفعال علامت شد",
      }
    : { id, deactivated: false, message: "مشتری حذف شد" };
}
