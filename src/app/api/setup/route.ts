import { handleApiError, ok } from "@/lib/api-utils";
import { ensureBootstrap } from "@/lib/bootstrap";

/** راه‌اندازی اولیه سیستم — عمومی (بدون احراز هویت) و idempotent */
export async function POST() {
  try {
    const result = await ensureBootstrap();
    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}

/** GET هم برای آسانی فراخوانی همان کار را انجام می‌دهد */
export async function GET() {
  try {
    const result = await ensureBootstrap();
    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}
