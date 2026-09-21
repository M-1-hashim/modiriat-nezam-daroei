import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handleApiError, ok, toNum } from "@/lib/api-utils";
import { requireUser } from "@/lib/auth";

// GET /api/sync/logs?limit=50 — آخرین نتیجه‌های همگام‌سازی
export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const url = new URL(req.url);
    const limit = Math.min(200, Math.max(1, toNum(url.searchParams.get("limit"), 50)));
    const logs = await db.syncLog.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return ok(logs);
  } catch (e) {
    return handleApiError(e);
  }
}
