import { db } from "@/lib/db";
import {
  requireUser,
  requirePermission,
  assertBranchAccess,
} from "@/lib/auth";
import { applyStockMovement, logAudit } from "@/lib/business";
import { ok, handleApiError, ApiError, toNum, requireFields, getClientIp } from "@/lib/api-utils";

type TransferLine = { productId: string; batchId: string; quantity: number };

function parseLines(raw: unknown): TransferLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((l) => {
    const o = (l ?? {}) as Record<string, unknown>;
    return {
      productId: typeof o.productId === "string" ? o.productId.trim() : "",
      batchId: typeof o.batchId === "string" ? o.batchId.trim() : "",
      quantity: toNum(o.quantity),
    };
  });
}

// ─────────────────────────── POST /api/stock/transfers — انتقال بین گدام‌ها ───────────────────────────
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    requirePermission(user, "inventory.edit");
    const body = (await req.json()) as Record<string, unknown>;
    const ip = getClientIp(req);

    requireFields(body, [
      { key: "fromWarehouseId", label: "گدام مبدأ" },
      { key: "toWarehouseId", label: "گدام مقصد" },
    ]);

    const fromWarehouseId = String(body.fromWarehouseId);
    const toWarehouseId = String(body.toWarehouseId);
    const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null;

    if (fromWarehouseId === toWarehouseId) {
      throw new ApiError("گدام مبدأ و مقصد نمی‌توانند یکسان باشند", 422, "VALIDATION");
    }

    const lines = parseLines(body.lines);
    if (lines.length === 0) {
      throw new ApiError("حداقل یک قلم برای انتقال الزامی است", 422, "VALIDATION");
    }
    for (const [i, line] of lines.entries()) {
      if (!line.productId || !line.batchId) {
        throw new ApiError(`قلم شماره ${i + 1}: جنس و بچ باید مشخص باشند`, 422, "VALIDATION");
      }
      if (!(line.quantity > 0)) {
        throw new ApiError(`قلم شماره ${i + 1}: تعداد باید بزرگ‌تر از صفر باشد`, 422, "VALIDATION");
      }
    }

    // هر دو گدام باید در شعبه‌های مجاز کاربر باشند
    const [fromWh, toWh] = await Promise.all([
      db.warehouse.findUnique({ where: { id: fromWarehouseId } }),
      db.warehouse.findUnique({ where: { id: toWarehouseId } }),
    ]);
    if (!fromWh) throw new ApiError("گدام مبدأ یافت نشد", 404);
    if (!toWh) throw new ApiError("گدام مقصد یافت نشد", 404);
    assertBranchAccess(user, fromWh.branchId);
    assertBranchAccess(user, toWh.branchId);

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
        await applyStockMovement(tx, {
          productId: line.productId,
          batchId: line.batchId,
          fromWarehouseId,
          toWarehouseId,
          type: "TRANSFER",
          quantity: line.quantity,
          reason,
          userId: user.id,
          userName: user.fullName,
          branchId: fromWh.branchId,
        });
      }
      await logAudit(tx, {
        userId: user.id,
        userName: user.fullName,
        branchId: fromWh.branchId,
        action: "CREATE",
        entity: "StockTransfer",
        summary: `انتقال ${lines.length} قلم از گدام «${fromWh.name}» به گدام «${toWh.name}»${reason ? ` — دلیل: ${reason}` : ""}`,
        after: { fromWarehouseId, toWarehouseId, reason, lineCount: lines.length, lines },
        ip,
      });
    });

    return ok({ transferred: lines.length });
  } catch (e) {
    return handleApiError(e);
  }
}
