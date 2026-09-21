import { db } from "@/lib/db";
import { handleApiError, ok } from "@/lib/api-utils";
import { requireUser } from "@/lib/auth";
import { limitParam } from "../_util";

// GET /api/reports/currency?limit=50 — سابقه نرخ اسعار
export async function GET(req: Request) {
  try {
    await requireUser();
    const url = new URL(req.url);
    const limit = limitParam(url, 50, 500);

    const rows = await db.exchangeRate.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return ok({ rows });
  } catch (e) {
    return handleApiError(e);
  }
}
