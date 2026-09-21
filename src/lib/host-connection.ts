/**
 * مدیریت اتصال به هاست — تونل SSH به دیتابیس MySQL میزبان
 *
 * بخش «اتصال به هاست» به درخواست کاربر (مطابق تصویر مرجع قبلی):
 *  - مشخصات سرور SSH (هاست اشتراکی cPanel) و دیتابیس MySQL ذخیره می‌شود
 *  - «تست اتصال SSH» یک دست‌دادن واقعی SSH انجام می‌دهد
 *  - «ذخیره و اتصال به هاست» تونل محلی (127.0.0.1:5522 → میزبان:3306) را برقرار می‌کند
 *    و دست‌دادن MySQL را از طریق تونل آزمایش می‌کند
 *  - «بازگشت به دیتابیس محلی» تونل را می‌بندد
 *
 * رمزها هرگز به مرورگر برگردانده نمی‌شوند (فایل 0600 در کنار دیتابیس).
 * معماری سیستم لوکال‌محور است: معلومات اصلی در SQLite محلی می‌ماند؛
 * تونل فقط راه دسترسی به MySQL هاست را باز نگه می‌دارد.
 */

import { promises as fs } from "fs";
import path from "path";
import net from "net";
import { Client as SshClient, type ClientError } from "ssh2";
import mysql from "mysql2/promise";
import { resolveDbPaths } from "@/app/api/backups/_restore";

export type HostSettings = {
  sshHost: string;
  sshPort: number;
  sshUser: string;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  /** پورت محلی تونل — پیش‌فرض ۵۵۲۲ */
  localPort: number;
  updatedAt: string;
};

export type MaskedSettings = Omit<HostSettings, "dbPassword"> & {
  hasPassword: boolean;
  configPath: string;
};

export type TunnelStatus = {
  online: boolean;
  localPort: number | null;
  since: string | null;
  sshHost: string | null;
  lastError: string | null;
  mysqlVersion: string | null;
};

export type TestResult = {
  ok: boolean;
  message: string;
  latencyMs?: number;
  details?: string;
};

const DEFAULT_LOCAL_PORT = 5522;
const CONNECT_TIMEOUT_MS = 12_000;

/* ─────────────────────────── ذخیرهٔ تنظیمات ─────────────────────────── */

let cachedSettings: HostSettings | null = null;

function configPath(): string {
  const { dbPath } = resolveDbPaths();
  return path.join(path.dirname(dbPath), "host-connection.json");
}

export async function loadSettings(): Promise<HostSettings | null> {
  if (cachedSettings) return cachedSettings;
  try {
    const raw = await fs.readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<HostSettings>;
    if (!parsed.sshHost || !parsed.sshUser) return null;
    cachedSettings = {
      sshHost: String(parsed.sshHost),
      sshPort: Number(parsed.sshPort) || 22,
      sshUser: String(parsed.sshUser),
      dbName: String(parsed.dbName || ""),
      dbUser: String(parsed.dbUser || ""),
      dbPassword: String(parsed.dbPassword || ""),
      localPort: Number(parsed.localPort) || DEFAULT_LOCAL_PORT,
      updatedAt: String(parsed.updatedAt || ""),
    };
    return cachedSettings;
  } catch {
    return null;
  }
}

export async function saveSettings(
  input: Partial<HostSettings>,
): Promise<HostSettings> {
  const current = await loadSettings();
  const next: HostSettings = {
    sshHost: String(input.sshHost ?? current?.sshHost ?? "").trim(),
    sshPort: clampPort(input.sshPort ?? current?.sshPort ?? 22),
    sshUser: String(input.sshUser ?? current?.sshUser ?? "").trim(),
    dbName: String(input.dbName ?? current?.dbName ?? "").trim(),
    dbUser: String(input.dbUser ?? current?.dbUser ?? "").trim(),
    // رمز خالی یعنی همان رمز قبلی حفظ شود (میدان خالی در فرم = بدون تغییر)
    dbPassword:
      input.dbPassword !== undefined && String(input.dbPassword) !== ""
        ? String(input.dbPassword)
        : (current?.dbPassword ?? ""),
    localPort: clampPort(input.localPort ?? current?.localPort ?? DEFAULT_LOCAL_PORT),
    updatedAt: new Date().toISOString(),
  };
  if (!next.sshHost) throw new Error("آدرس سرور SSH لازم است");
  if (!next.sshUser) throw new Error("نام کاربری SSH لازم است");
  const file = configPath();
  await fs.writeFile(file, JSON.stringify(next, null, 2), { mode: 0o600 });
  cachedSettings = next;
  return next;
}

export async function getMaskedSettings(): Promise<MaskedSettings | null> {
  const s = await loadSettings();
  if (!s) return null;
  const { dbPassword, ...rest } = s;
  void dbPassword;
  return { ...rest, hasPassword: Boolean(dbPassword), configPath: configPath() };
}

function clampPort(p: unknown): number {
  const n = Math.floor(Number(p));
  if (!Number.isFinite(n) || n < 1 || n > 65535) return 22;
  return n;
}

/* ─────────────────────────── وضعیت تونل ─────────────────────────── */

type TunnelState = {
  server: net.Server | null;
  ssh: SshClient | null;
  online: boolean;
  since: string | null;
  localPort: number | null;
  sshHost: string | null;
  lastError: string | null;
  mysqlVersion: string | null;
};
 
const g = globalThis as any;
const state: TunnelState = g.__pharmaHostTunnel ?? {
  server: null,
  ssh: null,
  online: false,
  since: null,
  localPort: null,
  sshHost: null,
  lastError: null,
  mysqlVersion: null,
};
g.__pharmaHostTunnel = state;

export function getStatus(): TunnelStatus {
  return {
    online: state.online,
    localPort: state.localPort,
    since: state.since,
    sshHost: state.sshHost,
    lastError: state.lastError,
    mysqlVersion: state.mysqlVersion,
  };
}

/* ─────────────────────────── SSH پایه ─────────────────────────── */

function sshConnect(settings: HostSettings): Promise<SshClient> {
  return new Promise((resolve, reject) => {
    const conn = new SshClient();
    let settled = false;
    const done = (err: Error) => {
      if (settled) return;
      settled = true;
      if (err) {
        try {
          conn.end();
        } catch {
          /* ignore */
        }
        reject(err);
      } else {
        resolve(conn);
      }
    };
    const timer = setTimeout(
      () => done(new Error("زمان انتظار اتصال SSH تمام شد")),
      CONNECT_TIMEOUT_MS,
    );
    conn
      .on("ready", () => {
        clearTimeout(timer);
        done(undefined as unknown as Error);
      })
      .on("error", (err: ClientError) => {
        clearTimeout(timer);
        done(friendlySshError(err));
      })
      .connect({
        host: settings.sshHost,
        port: settings.sshPort,
        username: settings.sshUser,
        // در cPanel رمز SSH همان رمز cPanel است — کاربر همان را در
        // فیلد «رمز» فرم وارد می‌کند و فقط سمت سرور ذخیره می‌شود.
        password: settings.dbPassword || undefined,
        tryKeyboard: false,
        readyTimeout: CONNECT_TIMEOUT_MS,
      });
  });
}

function friendlySshError(err: Error & { level?: string; code?: string }): Error {
  const level = err.level || "";
  const code = err.code || "";
  if (/authentication/i.test(err.message) || level === "client-authentication") {
    return new Error("احراز هویت SSH ناموفق بود — نام کاربری یا رمز اشتباه است");
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return new Error("آدرس سرور یافت نشد — آدرس هاست را بررسی کنید");
  }
  if (code === "ECONNREFUSED") {
    return new Error("سرور اتصال را رد کرد — پورت SSH را بررسی کنید");
  }
  if (code === "ETIMEDOUT" || /timed?\s?out/i.test(err.message)) {
    return new Error("اتصال به سرور با وقفهٔ زمانی مواجه شد — پورت ۲۱۰۹۸/۲۲ ممکن است در شبکهٔ شما مسدود باشد");
  }
  return new Error(`اتصال SSH ناموفق بود: ${err.message}`);
}

/* ─────────────────────────── تست اتصال SSH ─────────────────────────── */

export async function testSsh(input?: Partial<HostSettings>): Promise<TestResult> {
  const base = await loadSettings();
  const settings = { ...(base ?? emptySettings()), ...(input ?? {}) } as HostSettings;
  if (!settings.sshHost || !settings.sshUser) {
    return { ok: false, message: "ابتدا آدرس سرور و نام کاربری SSH را وارد کنید" };
  }
  const t0 = Date.now();
  let conn: SshClient | null = null;
  try {
    conn = await sshConnect(settings);
    const latency = Date.now() - t0;
    const who = await new Promise<string>((resolve) => {
      if (!conn) return resolve("");
      conn.exec("echo ok", (err, stream) => {
        if (err) return resolve("");
        let out = "";
        stream.on("data", (d: Buffer) => (out += d.toString()));
        stream.on("close", () => resolve(out.trim()));
        stream.stderr?.on?.("data", () => {});
      });
      setTimeout(() => resolve(""), 5000);
    });
    return {
      ok: true,
      message: who
        ? `اتصال SSH موفق بود — سرور پاسخ داد (${latency} میلی‌ثانیه)`
        : `دست‌دادن SSH موفق بود (${latency} میلی‌ثانیه)`,
      latencyMs: latency,
      details: `${settings.sshUser}@${settings.sshHost}:${settings.sshPort}`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "اتصال SSH ناموفق بود" };
  } finally {
    try {
      conn?.end();
    } catch {
      /* ignore */
    }
  }
}

function emptySettings(): HostSettings {
  return {
    sshHost: "",
    sshPort: 22,
    sshUser: "",
    dbName: "",
    dbUser: "",
    dbPassword: "",
    localPort: DEFAULT_LOCAL_PORT,
    updatedAt: "",
  };
}

/* ─────────────────────────── تونل پایدار ─────────────────────────── */

export async function connectHost(
  input?: Partial<HostSettings>,
): Promise<TestResult> {
  if (input && (input.sshHost || input.sshUser)) {
    await saveSettings(input);
  }
  const settings = await loadSettings();
  if (!settings) {
    return { ok: false, message: "ابتدا مشخصات هاست را ذخیره کنید" };
  }
  // تونل قبلی را ببند تا پورت آزاد بماند
  await stopTunnel(true);

  let ssh: SshClient;
  const t0 = Date.now();
  try {
    ssh = await sshConnect(settings);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "اتصال SSH ناموفق بود";
    Object.assign(state, {
      online: false,
      lastError: msg,
      localPort: null,
      since: null,
      sshHost: settings.sshHost,
      mysqlVersion: null,
    } satisfies Partial<TunnelState>);
    return { ok: false, message: msg };
  }

  const server = net.createServer((socket) => {
    ssh.forwardOut(
      socket.remoteAddress ?? "127.0.0.1",
      socket.remotePort ?? 0,
      "127.0.0.1",
      3306,
      (err, stream) => {
        if (err || !stream) {
          socket.destroy();
          return;
        }
        socket.pipe(stream).pipe(socket);
        socket.on("error", () => stream.end());
        stream.on("error", () => socket.destroy());
        socket.on("close", () => stream.end());
        stream.on("close", () => socket.destroy());
      },
    );
  });

  const localPort = settings.localPort || DEFAULT_LOCAL_PORT;

  const listenOk = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 5000);
    server.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    server.listen(localPort, "127.0.0.1", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });

  if (!listenOk) {
    try {
      server.close();
    } catch {
      /* ignore */
    }
    try {
      ssh.end();
    } catch {
      /* ignore */
    }
    const msg = `پورت محلی ${localPort} آزاد نیست — تونل برقرار نشد`;
    Object.assign(state, {
      online: false,
      lastError: msg,
      localPort: null,
      since: null,
      sshHost: settings.sshHost,
      mysqlVersion: null,
    } satisfies Partial<TunnelState>);
    return { ok: false, message: msg };
  }

  // آزمایش MySQL از طریق تونل
  const mysqlResult = await probeMysql(localPort, settings);
  const latency = Date.now() - t0;

  Object.assign(state, {
    server,
    ssh,
    online: true,
    since: new Date().toISOString(),
    localPort,
    sshHost: settings.sshHost,
    lastError: mysqlResult.ok ? null : mysqlResult.message,
    mysqlVersion: mysqlResult.ok ? (mysqlResult.details ?? null) : null,
  } satisfies Partial<TunnelState>);

  ssh.on("close", () => {
    Object.assign(state, {
      online: false,
      lastError: "اتصال SSH از سمت سرور بسته شد",
    } satisfies Partial<TunnelState>);
    try {
      server.close();
    } catch {
      /* ignore */
    }
  });
  ssh.on("error", () => {
    Object.assign(state, { online: false } satisfies Partial<TunnelState>);
  });

  return mysqlResult.ok
    ? {
        ok: true,
        message: `تونل فعال شد — 127.0.0.1:${localPort} → ${settings.sshHost}:3306 (${latency} میلی‌ثانیه)؛ MySQL پاسخ داد`,
        latencyMs: latency,
        details: mysqlResult.details ?? undefined,
      }
    : {
        ok: true,
        message: `تونل SSH فعال شد (127.0.0.1:${localPort}) ولی آزمایش MySQL ناموفق بود: ${mysqlResult.message}`,
        details: mysqlResult.message,
      };
}

async function probeMysql(
  localPort: number,
  settings: HostSettings,
): Promise<TestResult> {
  if (!settings.dbName || !settings.dbUser) {
    return { ok: false, message: "نام دیتابیس یا نام کاربری دیتابیس ثبت نشده است" };
  }
  let conn: mysql.Connection | null = null;
  try {
    conn = await mysql.createConnection({
      host: "127.0.0.1",
      port: localPort,
      user: settings.dbUser,
      password: settings.dbPassword,
      database: settings.dbName,
      connectTimeout: CONNECT_TIMEOUT_MS,
    });
    const [rows] = await conn.query("SELECT VERSION() AS v");
    const v = Array.isArray(rows) && rows[0] ? String((rows[0] as { v?: unknown }).v ?? "") : "";
    return {
      ok: true,
      message: v ? `اتصال MySQL موفق بود — نسخهٔ سرور: ${v}` : "اتصال MySQL موفق بود",
      details: v,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "اتصال MySQL ناموفق بود";
    return {
      ok: false,
      message: /access denied/i.test(msg)
        ? "دسترسی MySQL رد شد — نام دیتابیس/کاربری/رمز را بررسی کنید"
        : /handshake|protocol/i.test(msg)
          ? "پاسخ MySQL معتبر نبود — مطمئن شوید دیتابیس روی هاست فعال است"
          : msg,
    };
  } finally {
    try {
      await conn?.end();
    } catch {
      /* ignore */
    }
  }
}

export async function stopTunnel(silent = false): Promise<TestResult> {
  const wasOnline = state.online;
  const errs: string[] = [];
  try {
    state.server?.close();
  } catch (e) {
    errs.push(e instanceof Error ? e.message : "");
  }
  try {
    state.ssh?.end();
  } catch (e) {
    errs.push(e instanceof Error ? e.message : "");
  }
  Object.assign(state, {
    server: null,
    ssh: null,
    online: false,
    since: null,
    localPort: null,
    mysqlVersion: null,
    lastError: null,
  } satisfies Partial<TunnelState>);
  if (silent) return { ok: true, message: "closed" };
  return wasOnline
    ? { ok: true, message: "اتصال به هاست قطع شد — به دیتابیس محلی برگشتید" }
    : { ok: true, message: "اتصال فعالی وجود نداشت — سیستم روی دیتابیس محلی است" };
}
