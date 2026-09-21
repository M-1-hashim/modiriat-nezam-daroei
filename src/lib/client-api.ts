"use client";

/**
 * لایه ارتباط با API + صف همگام‌سازی آفلاین
 *
 * - apiSend: همیشه ابتدا به سرور (لوکال) تلاش می‌شود — حتی وقتی navigator.onLine=false
 *   است، چون در حالت لوکال/آفلاین سرور خودِ سیستم در دسترس است.
 *   فقط در خطای شبکه واقعی، درخواست‌های قابل صف با localId (uuid) در localStorage
 *   ذخیره و { queued: true, localId } برمی‌گردد.
 * - useApiData: هوک خواندن داده با loading/error/refetch.
 * - useSyncStatus: وضعیت دسترسی به سرور، تعداد صف، همگام‌سازی دستی/خودکار.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type ApiEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { message: string; code?: string } };

export type QueuedResult = { queued: true; localId: string };

const QUEUE_KEY = "pharma_offline_queue";
const LAST_SYNC_KEY = "pharma_last_sync";
const DEVICE_KEY = "pharma_device_id";

/** endpointهایی که در حالت آفلاین قابل ذخیره هستند */
export const QUEUEABLE_PATHS = [
  "/api/purchases",
  "/api/sales",
  "/api/payments",
  "/api/expenses",
  "/api/customers",
];

export type QueueItem = {
  localId: string;
  path: string;
  payload: unknown;
  queuedAt: string;
  retries: number;
  lastError?: string;
};

export function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function deviceId(): string {
  if (typeof window === "undefined") return "server";
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = uuid();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

function readQueue(): QueueItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueueItem[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(items: QueueItem[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

export function getQueue(): QueueItem[] {
  return readQueue();
}

export function isQueuable(path: string): boolean {
  return QUEUEABLE_PATHS.some((p) => path === p || path.startsWith(p + "/") || path.startsWith(p + "?"));
}

export class ApiClientError extends Error {
  code?: string;
  status: number;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
};

/** درخواست POST/PUT که در صورت خطای شبکه، آفلاین صف می‌شود */
export async function apiSend<T = unknown>(
  path: string,
  options: RequestOptions = {}
): Promise<T | QueuedResult> {
  const method = (options.method ?? "POST").toUpperCase();
  const isCreate = method === "POST";
  const payload = options.body;

  // حالت لوکال/آفلاین: حتی وقتی navigator.onLine=false است، سرور محلی (همان
  // سیستمی که اپ روی آن اجرا می‌شود) در دسترس است؛ پس همیشه ابتدا تلاش می‌کنیم
  // و فقط در خطای شبکهٔ واقعی، درخواست در صف ذخیره می‌شود تا بعداً همگام شود.
  try {
    return await rawRequest<T>(path, { ...options, method });
  } catch (e) {
    // خطای شبکه (سرور در دسترس نیست) → صف برای POSTهای قابل صف
    const isNetworkError =
      e instanceof TypeError ||
      (e instanceof Error && (e.name === "AbortError" || /fetch|network/i.test(e.message)));
    if (isNetworkError && isCreate && isQueuable(path)) {
      const localId = uuid();
      const queue = readQueue();
      queue.push({
        localId,
        path,
        payload,
        queuedAt: new Date().toISOString(),
        retries: 0,
      });
      writeQueue(queue);
      return { queued: true, localId };
    }
    throw e;
  }
}

async function rawRequest<T>(path: string, options: RequestOptions): Promise<T> {
  // اگر بدنه از قبل رشته شده باشد، دوباره stringify نمی‌کنیم (جلوگیری از double-stringify
  // که باعث می‌شد سرور به‌جای آبجکت، یک رشته دریافت کند و اعتبارسنجی «الزامی» خطا بدهد)
  const rawBody =
    typeof options.body === "string"
      ? options.body
      : options.body !== undefined
        ? JSON.stringify(options.body)
        : undefined;

  const res = await fetch(path, {
    method: options.method ?? "GET",
    headers: rawBody !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: rawBody,
    signal: options.signal,
    cache: "no-store",
  });

  let json: ApiEnvelope<T> | null = null;
  try {
    json = (await res.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiClientError(
      `پاسخ نامعتبر از سرور (کد ${res.status})`,
      res.status
    );
  }

  if (!json || !json.ok) {
    const err = json && "error" in json ? json.error : undefined;
    throw new ApiClientError(
      err?.message ?? `درخواست ناموفق بود (کد ${res.status})`,
      res.status,
      err?.code
    );
  }
  return json.data;
}

/** درخواست GET ساده */
export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  return rawRequest<T>(path, { signal });
}

/** هوک خواندن داده */
export function useApiData<T = unknown>(
  path: string | null,
  deps: unknown[] = []
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    const ac = new AbortController();
    abortRef.current = ac;
    // تعویق به‌روزرسانی state به ماکروتسک برای جلوگیری از رندر آبشاری
    const timer = window.setTimeout(() => {
      if (!active) return;
      if (!path) {
        setLoading(false);
        setData(null);
        return;
      }
      setLoading(true);
      setError(null);
      apiGet<T>(path, ac.signal)
        .then((d) => {
          if (active) {
            setData(d);
            setLoading(false);
          }
        })
        .catch((e) => {
          if (active && e?.name !== "AbortError") {
            setError(e?.message ?? "خطا در دریافت معلومات");
            setLoading(false);
          }
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
      ac.abort();
    };
  }, [path, tick, ...deps]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, refetch, setData };
}

// ─────────────────────── همگام‌سازی آفلاین ───────────────────────

export type SyncState = {
  online: boolean;
  pending: number;
  syncing: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
};

function lastSync(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(LAST_SYNC_KEY);
}

/**
 * بررسی دسترسی به سرور محلی — مستقل از اینترنت
 * در حالت لوکال حتی وقتی اینترنت قطع است، سرور در دسترس است و برمی‌گرداند true
 */
export async function probeServer(timeoutMs = 4000): Promise<boolean> {
  if (typeof window === "undefined") return true;
  try {
    const res = await fetch("/api/auth/bootstrap-status", {
      method: "HEAD",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    // هر پاسخ (حتی ۴۰۱/۴۰۵) یعنی سرور در دسترس است
    return res.status > 0;
  } catch {
    return false;
  }
}

/** ارسال صف به سرور؛ نتیجه هر آیتم گزارش می‌شود */
export async function flushQueue(
  onProgress?: (done: number, total: number) => void
): Promise<{ synced: number; failed: number; conflicts: number; errors: string[] }> {
  const queue = readQueue();
  if (queue.length === 0) return { synced: 0, failed: 0, conflicts: 0, errors: [] };

  let synced = 0;
  let failed = 0;
  let conflicts = 0;
  const errors: string[] = [];
  const remaining: QueueItem[] = [];

  try {
    const res = await fetch("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: deviceId(),
        items: queue.map((q) => ({
          localId: q.localId,
          path: q.path,
          payload: q.payload,
          queuedAt: q.queuedAt,
        })),
      }),
      signal: AbortSignal.timeout(15000),
    });
    const json = (await res.json()) as ApiEnvelope<{
      results: { localId: string; status: string; message?: string }[];
    }>;
    if (!json.ok) throw new Error(json.error?.message ?? "همگام‌سازی ناموفق بود");

    const resultMap = new Map(json.data.results.map((r) => [r.localId, r]));
    for (let i = 0; i < queue.length; i++) {
      onProgress?.(i + 1, queue.length);
      const item = queue[i];
      const r = resultMap.get(item.localId);
      if (!r) {
        remaining.push(item);
        continue;
      }
      if (r.status === "SYNCED" || r.status === "DUPLICATE") {
        synced++;
      } else if (r.status === "CONFLICT") {
        conflicts++;
        remaining.push({ ...item, retries: item.retries + 1, lastError: r.message });
        errors.push(r.message ?? "تعارض در همگام‌سازی");
      } else {
        failed++;
        remaining.push({ ...item, retries: item.retries + 1, lastError: r.message });
        if (r.message) errors.push(r.message);
      }
    }
    writeQueue(remaining);
    localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
    return { synced, failed, conflicts, errors };
  } catch (e) {
    // شبکه قطع — صف دست‌نخورده می‌ماند
    return {
      synced: 0,
      failed: 0,
      conflicts: 0,
      errors: [e instanceof Error ? e.message : "اتصال برقرار نشد"],
    };
  }
}

/** هوک وضعیت همگام‌سازی */
export function useSyncStatus() {
  const [state, setState] = useState<SyncState>({
    online: true,
    pending: 0,
    syncing: false,
    lastSyncAt: null,
    lastError: null,
  });

  const refresh = useCallback(() => {
    setState((s) => ({
      ...s,
      pending: readQueue().length,
      lastSyncAt: lastSync(),
    }));
    // وضعیت «آنلاین» = دسترسی به سرور (نه اینترنت!)
    // در حالت لوکال، حتی وقتی navigator.onLine=false است، سرور در دسترس است
    if (typeof navigator === "undefined" || navigator.onLine) {
      setState((s) => ({ ...s, online: true }));
    } else {
      void probeServer().then((reachable) => {
        setState((s) => ({ ...s, online: reachable }));
      });
    }
  }, []);

  const syncNow = useCallback(async (): Promise<{
    synced: number;
    failed: number;
    conflicts: number;
    errors: string[];
  } | null> => {
    const queue = readQueue();
    // صف خالی؟ فقط وضعیت را تازه کن (بررسی سرور محلی بدون اینترنت هم انجام می‌شود)
    if (queue.length === 0) {
      refresh();
      return null;
    }
    // اگر مرورگر آفلاین گزارش شده، اول دسترسی سرور محلی را بررسی کن
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      const reachable = await probeServer(3000);
      setState((s) => ({ ...s, online: reachable }));
      if (!reachable) {
        refresh();
        return null;
      }
    }
    setState((s) => ({ ...s, syncing: true }));
    const result = await flushQueue();
    setState((s) => ({
      ...s,
      syncing: false,
      pending: readQueue().length,
      lastSyncAt: lastSync(),
      lastError: result.errors[0] ?? null,
    }));
    return result;
  }, [refresh]);

  useEffect(() => {
    const t = window.setTimeout(refresh, 0);
    const onOnline = () => {
      refresh();
      void syncNow();
    };
    const onOffline = () => refresh();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const interval = window.setInterval(() => {
      void syncNow();
    }, 60_000);
    // حالت لوکال: وقتی مرورگر خودش را آفلاین می‌داند، هر ۱۵ ثانیه سرور محلی را چک کن؛
    // اگر در دسترس بود، وضعیت آنلاین شود و صف همگام گردد
    const probeInterval =
      typeof navigator !== "undefined" && !navigator.onLine
        ? window.setInterval(() => {
            void probeServer(3000).then((reachable) => {
              if (reachable) {
                setState((s) => ({ ...s, online: true }));
                void syncNow();
              } else {
                setState((s) => ({ ...s, online: false }));
              }
            });
          }, 15_000)
        : null;
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.clearInterval(interval);
      if (probeInterval) window.clearInterval(probeInterval);
    };
  }, [refresh, syncNow]);

  return { ...state, refresh, syncNow };
}

// ─────────────────── وضعیت واقعی اتصال (چراغک هدر) ───────────────────

/**
 * وضعیت واقعی اتصال سیستم — سه حالت:
 *  - HOST:     سیستم به هاست (تونل SSH/دیتابیس میزبان) متصل است → «متصل به هاست»
 *  - LOCAL_DB: اینترنت هست ولی سیستم به هاست متصل نیست → «دیتا بیس محلی»
 *  - OFFLINE:  دستگاه اصلاً به اینترنت وصل نیست (یا سرور سیستم در دسترس نیست) → «افلاین»
 */
export type ConnectionState = "HOST" | "LOCAL_DB" | "OFFLINE";

export type ConnectionStatusState = {
  state: ConnectionState;
  /** اینترنت دستگاه (navigator.onLine) */
  navigatorOnline: boolean;
  /** سرور سیستم پاسخ می‌دهد؟ */
  serverReachable: boolean;
  /** تونل هاست فعال است؟ (null = هنوز بررسی نشده) */
  hostOnline: boolean | null;
  /** اولین بررسی هنوز انجام نشده */
  checking: boolean;
  /** زمان آخرین بررسی */
  checkedAt: string | null;
};

/** هوک وضعیت اتصال واقعی — وضعیت تونل هاست را هر pollMs میلی‌ثانیه بررسی می‌کند */
export function useConnectionStatus(pollMs = 15_000): ConnectionStatusState & {
  recheck: () => Promise<void>;
} {
  const [navigatorOnline, setNavigatorOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  );
  const [serverReachable, setServerReachable] = useState(true);
  const [hostOnline, setHostOnline] = useState<boolean | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  const check = useCallback(async () => {
    if (typeof navigator !== "undefined") {
      setNavigatorOnline(navigator.onLine);
    }
    try {
      const res = await fetch("/api/host-connection/status", {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      setServerReachable(true);
      let online: boolean | null = null;
      try {
        const json = (await res.json()) as ApiEnvelope<{ online?: boolean }>;
        if (json && json.ok && json.data) online = Boolean(json.data.online);
      } catch {
        /* پاسخ غیر JSON — وضعیت تونل نامشخص می‌ماند */
      }
      setHostOnline(online);
      setCheckedAt(new Date().toISOString());
    } catch {
      // خطای شبکه واقعی — سرور سیستم در دسترس نیست
      setServerReachable(false);
      setHostOnline(null);
      setCheckedAt(new Date().toISOString());
    }
  }, []);

  useEffect(() => {
    // تعویق اولین بررسی به ماکروتسک — جلوگیری از setState همگام در بدنهٔ اثر
    const t = window.setTimeout(() => {
      if (typeof navigator !== "undefined") {
        setNavigatorOnline(navigator.onLine);
      }
      void check();
    }, 0);
    const onOnline = () => {
      setNavigatorOnline(true);
      void check();
    };
    const onOffline = () => setNavigatorOnline(false);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    const id = window.setInterval(() => void check(), pollMs);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(id);
    };
  }, [check, pollMs]);

  const state: ConnectionState = !navigatorOnline || !serverReachable
    ? "OFFLINE"
    : hostOnline
      ? "HOST"
      : "LOCAL_DB";

  return {
    state,
    navigatorOnline,
    serverReachable,
    hostOnline,
    checking: checkedAt === null,
    checkedAt,
    recheck: check,
  };
}
