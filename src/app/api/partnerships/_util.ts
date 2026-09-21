import type { Tx } from "@/lib/auth";
import { ApiError, round2 } from "@/lib/api-utils";

export const PARTNERSHIP_TYPES = ["EQUITY", "MUDARABAH"] as const;
export const MUDARABAH_ROLES = ["CAPITAL_PROVIDER", "WORKING_PARTNER"] as const;
export const PARTNERSHIP_STATUSES = ["ACTIVE", "ENDED", "SUSPENDED"] as const;

/** مجموع سهم سهامداران سهامیِ فعال یک شعبه (با احتساب سهم جدید) باید ≤ ۱۰۰٪ باشد */
export async function validateEquityShareSum(
  tx: Tx,
  branchId: string,
  excludeId: string | null,
  newSharePct: number
): Promise<void> {
  const agg = await tx.partnership.aggregate({
    where: {
      branchId,
      type: "EQUITY",
      status: "ACTIVE",
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    _sum: { profitSharePct: true },
  });
  const sum = round2((agg._sum.profitSharePct ?? 0) + newSharePct);
  if (sum > 100.009) {
    throw new ApiError(
      "مجموع سهم سهامداران فعال این شعبه از ۱۰۰٪ تجاوز می‌کند",
      422,
      "SHARE_EXCEEDED"
    );
  }
}
