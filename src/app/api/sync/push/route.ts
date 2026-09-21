import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ApiError, getClientIp, handleApiError, ok } from "@/lib/api-utils";
import type { AuthUser } from "@/lib/auth";
import { requireUser } from "@/lib/auth";
import { readBody } from "@/app/api/users/_shared";
// سرویس‌های مشترک ایجنت 2-c — منطق ایجاد رکورد بدون HTTP داخلی
import { createPurchase } from "@/app/api/purchases/_service";
import { createSale } from "@/app/api/sales/_service";
import { createPayment } from "@/app/api/payments/_service";
import { createExpense } from "@/app/api/expenses/_service";
import { createCustomer } from "@/app/api/customers/_service";

type SyncHandler = (
  u: AuthUser,
  b: Record<string, unknown>,
  ip?: string
) => Promise<unknown>;

/** نقشهٔ مسیرهای مجاز همگام‌سازی → تابع ایجاد رکورد */
const HANDLERS: Record<string, SyncHandler> = {
  "/api/purchases": createPurchase,
  "/api/sales": createSale,
  "/api/payments": createPayment,
  "/api/expenses": createExpense,
  "/api/customers": createCustomer,
};

type SyncResult = {
  localId: string;
  status: "SYNCED" | "DUPLICATE" | "FAILED" | "CONFLICT";
  message?: string;
  id?: string;
};

// POST /api/sync/push {deviceId, items:[{localId,path,payload,queuedAt}]}
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await readBody(req);
    const ip = getClientIp(req);
    const deviceId = body.deviceId ? String(body.deviceId).trim() : "unknown-device";

    const rawItems = Array.isArray(body.items) ? body.items : [];
    type ParsedItem = {
      localId: string;
      path: string;
      payload: Record<string, unknown>;
    };
    const items: ParsedItem[] = [];
    const results: SyncResult[] = [];

    for (const raw of rawItems) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const localId = typeof r.localId === "string" ? r.localId.trim() : "";
      const itemPath = typeof r.path === "string" ? r.path.trim() : "";
      const payload =
        r.payload && typeof r.payload === "object" && !Array.isArray(r.payload)
          ? (r.payload as Record<string, unknown>)
          : {};
      if (!localId || !itemPath) {
        results.push({
          localId: localId || "-",
          status: "FAILED",
          message: "localId یا مسیر همگام‌سازی نامعتبر است",
        });
        continue;
      }
      items.push({ localId, path: itemPath, payload });
    }

    // پردازش ترتیبی — خطای هر آیتم هرگز کل درخواست را نمی‌شکند
    for (const item of items) {
      const handler = HANDLERS[item.path];
      if (!handler) {
        await db.syncLog.create({
          data: {
            deviceId,
            localId: item.localId,
            entityType: item.path,
            status: "FAILED",
            message: "مسیر همگام‌سازی مجاز نیست",
            userId: user.id,
          },
        });
        results.push({
          localId: item.localId,
          status: "FAILED",
          message: "مسیر همگام‌سازی مجاز نیست",
        });
        continue;
      }

      // جلوگیری از همگام‌سازی دوبارهٔ همان آیتم
      const already = await db.syncLog.findFirst({
        where: {
          localId: item.localId,
          entityType: item.path,
          status: { in: ["SYNCED", "DUPLICATE"] },
        },
        orderBy: { createdAt: "desc" },
      });
      if (already) {
        await db.syncLog.create({
          data: {
            deviceId,
            localId: item.localId,
            entityType: item.path,
            entityId: already.entityId,
            status: "DUPLICATE",
            message: "این مورد قبلاً همگام شده است",
            userId: user.id,
          },
        });
        results.push({
          localId: item.localId,
          status: "DUPLICATE",
          message: "این مورد قبلاً همگام شده است",
          ...(already.entityId ? { id: already.entityId } : {}),
        });
        continue;
      }

      try {
        const record = await handler(user, item.payload, ip);
        const entityId =
          record && typeof record === "object" && "id" in record
            ? String((record as { id: unknown }).id)
            : undefined;
        await db.syncLog.create({
          data: {
            deviceId,
            localId: item.localId,
            entityType: item.path,
            entityId: entityId ?? null,
            status: "SYNCED",
            message: "موفقانه همگام شد",
            userId: user.id,
          },
        });
        results.push({
          localId: item.localId,
          status: "SYNCED",
          ...(entityId ? { id: entityId } : {}),
        });
      } catch (e) {
        const isConflict = e instanceof ApiError && e.code === "INSUFFICIENT_STOCK";
        const status: SyncResult["status"] = isConflict ? "CONFLICT" : "FAILED";
        const message =
          e instanceof Error ? e.message : "خطای ناشناخته در همگام‌سازی";
        await db.syncLog
          .create({
            data: {
              deviceId,
              localId: item.localId,
              entityType: item.path,
              status,
              message,
              userId: user.id,
            },
          })
          .catch(() => undefined);
        results.push({ localId: item.localId, status, message });
      }
    }

    return ok({ results });
  } catch (e) {
    return handleApiError(e);
  }
}
