import { db } from "@/lib/db";
import {
  requireUser,
  requirePermission,
  assertBranchAccess,
} from "@/lib/auth";
import { applyStockMovement, logAudit, type MovementInput } from "@/lib/business";
import { ok, handleApiError, ApiError, toNum, round2, requireFields, getClientIp } from "@/lib/api-utils";

const ADJUST_TYPES = ["ADJUSTMENT", "DAMAGE", "EXPIRED"] as const;
type AdjustType = (typeof ADJUST_TYPES)[number];

type AdjustLine = {
  productId: string;
  batchId: string;
  newQuantity: number;
  reason: string;
  type: AdjustType;
};

function parseLines(raw: unknown): AdjustLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((l) => {
    const o = (l ?? {}) as Record<string, unknown>;
    const t = typeof o.type === "string" && (ADJUST_TYPES as readonly string[]).includes(o.type)
      ? (o.type as AdjustType)
      : "ADJUSTMENT";
    return {
      productId: typeof o.productId === "string" ? o.productId.trim() : "",
      batchId: typeof o.batchId === "string" ? o.batchId.trim() : "",
      newQuantity: round2(toNum(o.newQuantity)),
      reason: typeof o.reason === "string" ? o.reason.trim() : "",
      type: t,
    };
  });
}

// ─────────────────────────── POST /api/stock/adjustments — تعدیل موجودی ───────────────────────────
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    requirePermission(user, "inventory.edit");
    const body = (await req.json()) as Record<string, unknown>;
    const ip = getClientIp(req);

    requireFields(body, [{ key: "warehouseId", label: "گدام" }]);

    const warehouseId = String(body.warehouseId);
    const wh = await db.warehouse.findUnique({ where: { id: warehouseId } });
    if (!wh) throw new ApiError("گدام یافت نشد", 404);
    assertBranchAccess(user, wh.branchId);

    const lines = parseLines(body.lines);
    if (lines.length === 0) {
      throw new ApiError("حداقل یک قلم برای تعدیل الزامی است", 422, "VALIDATION");
    }
    for (const [i, line] of lines.entries()) {
      if (!line.productId || !line.batchId) {
        throw new ApiError(`قلم شماره ${i + 1}: جنس و بچ باید مشخص باشند`, 422, "VALIDATION");
      }
      if (line.newQuantity < 0) {
        throw new ApiError(`قلم شماره ${i + 1}: مقدار جدید نمی‌تواند منفی باشد`, 422, "VALIDATION");
      }
      if (!line.reason) {
        throw new ApiError("دلیل تعدیل الزامی است", 422, "VALIDATION");
      }
    }

    // اعتبارسنجی بچ‌ها و تطابق با جنس
    const batchIds = [...new Set(lines.map((l) => l.batchId))];
    const batches = await db.batch.findMany({
      where: { id: { in: batchIds } },
      include: { product: { select: { name: true } } },
    });
    const batchMap = new Map(batches.map((b) => [b.id, b]));
    for (const [i, line] of lines.entries()) {
      const batch = batchMap.get(line.batchId);
      if (!batch) {
        throw new ApiError(`قلم شماره ${i + 1}: بچ یافت نشد`, 422, "VALIDATION");
      }
      if (batch.productId !== line.productId) {
        throw new ApiError(
          `قلم شماره ${i + 1}: بچ «${batch.batchNumber}» به جنس «${batch.product.name}» تعلق دارد`,
          422,
          "VALIDATION"
        );
      }
    }

    await db.$transaction(async (tx) => {
      for (const line of lines) {
        const batch = batchMap.get(line.batchId);
        const existing = await tx.stockItem.findUnique({
          where: {
            productId_batchId_warehouseId: {
              productId: line.productId,
              batchId: line.batchId,
              warehouseId,
            },
          },
        });
        const current = existing?.quantity ?? 0;

        // خرابی/انقضا فقط به پایین
        if (
          (line.type === "DAMAGE" || line.type === "EXPIRED") &&
          line.newQuantity > current + 0.009
        ) {
          throw new ApiError(
            `برای ثبت ${line.type === "DAMAGE" ? "خرابی" : "انقضا"} مقدار جدید باید کمتر یا مساوی موجودی فعلی (${current}) باشد`,
            422,
            "VALIDATION"
          );
        }

        const baseMovement: Omit<MovementInput, "type" | "quantity"> = {
          productId: line.productId,
          batchId: line.batchId,
          userId: user.id,
          userName: user.fullName,
          branchId: wh.branchId,
          reason: line.reason,
        };

        if (line.type === "ADJUSTMENT") {
          // مقدار ورودی برای ADJUSTMENT «مقدار هدف» است — دلتا توسط موتور محاسبه می‌شود
          await applyStockMovement(tx, {
            ...baseMovement,
            type: "ADJUSTMENT",
            toWarehouseId: warehouseId,
            quantity: line.newQuantity,
          });
        } else {
          const delta = round2(current - line.newQuantity);
          if (delta > 0) {
            await applyStockMovement(tx, {
              ...baseMovement,
              type: line.type,
              fromWarehouseId: warehouseId,
              quantity: delta,
            });
          }
        }

        await logAudit(tx, {
          userId: user.id,
          userName: user.fullName,
          branchId: wh.branchId,
          action: "ADJUSTMENT",
          entity: "Stock",
          entityId: existing?.id ?? null,
          summary: `تعدیل موجودی «${batch?.product.name ?? ""}» بچ «${batch?.batchNumber ?? ""}» در گدام «${wh.name}»: از ${current} به ${line.newQuantity} — دلیل: ${line.reason}`,
          before: { quantity: current },
          after: { quantity: line.newQuantity, type: line.type },
          ip,
        });
      }
    });

    return ok({ adjusted: lines.length });
  } catch (e) {
    return handleApiError(e);
  }
}
