/**
 * اجرای عملیات گروهی روی چند رکورد — با کنترل هم‌زمانی و جمع‌بندی نتیجه.
 * عملیات گروهی روی endpointهای تک‌رکورد موجود اجرا می‌شود تا منطق
 * صلاحیت‌ها، آدیت و قوانین تجاری هر ماژول دست‌نخورده بماند.
 */

export type BulkFailure = { id: string; message: string };

export type BulkResult = {
  okIds: string[];
  failures: BulkFailure[];
};

const CONCURRENCY = 4;

export async function runBulkOperation<T>(
  ids: string[],
  op: (id: string) => Promise<T>,
): Promise<BulkResult> {
  const okIds: string[] = [];
  const failures: BulkFailure[] = [];

  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(async (id) => {
        await op(id);
        return id;
      }),
    );
    settled.forEach((res, idx) => {
      const id = batch[idx];
      if (res.status === "fulfilled") {
        okIds.push(id);
      } else {
        const reason = res.reason;
        failures.push({
          id,
          message:
            reason instanceof Error
              ? reason.message
              : typeof reason === "string" && reason
                ? reason
                : "عملیات ناموفق بود",
        });
      }
    });
  }

  return { okIds, failures };
}

/** پیام دری نتیجهٔ عملیات گروهی برای toast */
export function bulkResultMessage(
  action: string,
  result: BulkResult,
): { tone: "success" | "warning" | "error"; message: string } {
  const okCount = result.okIds.length;
  const failCount = result.failures.length;
  if (failCount === 0) {
    return {
      tone: "success",
      message: `${action} ${okCount.toLocaleString("en-US")} مورد با موفقیت انجام شد`,
    };
  }
  if (okCount === 0) {
    return {
      tone: "error",
      message: `${action} ناموفق بود: ${result.failures[0].message}`,
    };
  }
  return {
    tone: "warning",
    message: `${action}: ${okCount.toLocaleString("en-US")} مورد موفق، ${failCount.toLocaleString("en-US")} مورد ناموفق — ${result.failures[0].message}`,
  };
}
