"use client";

/**
 * اتصال به هاست — بخش بازسازی‌شده به درخواست کاربر (مطابق تصویر مرجع قبلی)
 *
 * شامل: مشخصات سرور SSH / پورت / نام کاربری cPanel / دیتابیس MySQL،
 * دکمه‌های «ذخیره و اتصال به هاست»، «تست اتصال SSH»،
 * «باز کردن پوشه تنظیمات» و «بازگشت به دیتابیس محلی» + نشان وضعیت تونل.
 */

import { useEffect, useState } from "react";
import {
  Server,
  Plug,
  Download,
  RefreshCcw,
  Cloud,
  CloudOff,
  Loader2,
  CheckCircle2,
  XCircle,
  FileJson,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useApiData, useSyncStatus, apiSend, type QueuedResult } from "@/lib/client-api";

function isQueued(r: unknown): r is QueuedResult {
  return !!r && typeof r === "object" && (r as { queued?: boolean }).queued === true;
}

type MaskedSettings = {
  sshHost: string;
  sshPort: number;
  sshUser: string;
  dbName: string;
  dbUser: string;
  hasPassword: boolean;
  localPort: number;
  updatedAt: string;
  configPath: string;
};

type TunnelStatus = {
  online: boolean;
  localPort: number | null;
  since: string | null;
  sshHost: string | null;
  lastError: string | null;
  mysqlVersion: string | null;
};

type HostPayload = { settings: MaskedSettings | null; status: TunnelStatus };

type TestResult = { ok: boolean; message: string; latencyMs?: number; details?: string };

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : "عملیه ناموفق بود";
}

export default function HostConnectionView() {
  const { data, loading, refetch } = useApiData<HostPayload>("/api/host-connection");
  const { online: serverOnline } = useSyncStatus();
  const [form, setForm] = useState({
    sshHost: "",
    sshPort: "21098",
    sshUser: "",
    dbName: "",
    dbUser: "",
    dbPassword: "",
  });
  const [formTouched, setFormTouched] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "test" | "connect" | "disconnect">(null);
  const [lastTest, setLastTest] = useState<TestResult | null>(null);
  const loaded = data?.settings ?? null;

  // وقتی تنظیمات از سرور رسید و کاربر هنوز چیزی ننوشته، فرم را پر کن
  useEffect(() => {
    if (loaded && !formTouched) {
      setForm((f) => ({
        ...f,
        sshHost: loaded.sshHost || "",
        sshPort: String(loaded.sshPort || 22),
        sshUser: loaded.sshUser || "",
        dbName: loaded.dbName || "",
        dbUser: loaded.dbUser || "",
      }));
    }
  }, [loaded, formTouched]);

  const status = data?.status ?? null;
  const payload = () => ({
    sshHost: form.sshHost.trim(),
    sshPort: Number(form.sshPort) || 22,
    sshUser: form.sshUser.trim(),
    dbName: form.dbName.trim(),
    dbUser: form.dbUser.trim(),
    dbPassword: form.dbPassword,
  });

  const doTest = async () => {
    if (!form.sshHost.trim() || !form.sshUser.trim()) {
      toast.error("آدرس سرور و نام کاربری SSH را وارد کنید");
      return;
    }
    setBusy("test");
    setLastTest(null);
    try {
      const res = await apiSend<TestResult>("/api/host-connection/test", {
        method: "POST",
        body: JSON.stringify(payload()),
      });
      if (isQueued(res)) {
        toast.error("اتصال برقرار نیست — تست SSH قابل صف‌کردن نیست؛ دوباره تلاش کنید");
        return;
      }
      setLastTest(res);
      if (res?.ok) toast.success(res.message);
      else toast.error(res?.message || "اتصال SSH ناموفق بود");
    } catch (e) {
      setLastTest({ ok: false, message: errMessage(e) });
      toast.error(errMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const doConnect = async () => {
    if (!form.sshHost.trim() || !form.sshUser.trim()) {
      toast.error("آدرس سرور و نام کاربری SSH را وارد کنید");
      return;
    }
    setBusy("connect");
    setLastTest(null);
    try {
      const res = await apiSend<{ result: TestResult; status: TunnelStatus }>(
        "/api/host-connection/connect",
        { method: "POST", body: JSON.stringify(payload()) }
      );
      if (isQueued(res)) {
        toast.error("اتصال برقرار نیست — اتصال به هاست قابل صف‌کردن نیست؛ دوباره تلاش کنید");
        return;
      }
      setForm((f) => ({ ...f, dbPassword: "" }));
      setLastTest(res?.result ?? null);
      if (res?.result?.ok) {
        toast.success(res.result.message);
        void refetch();
      } else {
        toast.error(res?.result?.message || "اتصال به هاست ناموفق بود");
        void refetch();
      }
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const doDisconnect = async () => {
    setBusy("disconnect");
    try {
      const res = await apiSend<{ result: TestResult }>("/api/host-connection/disconnect", {
        method: "POST",
      });
      if (isQueued(res)) {
        toast.error("اتصال برقرار نیست — دوباره تلاش کنید");
        return;
      }
      toast.info(res?.result?.message || "اتصال قطع شد");
      setLastTest(null);
      void refetch();
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const doDownloadConfig = async () => {
    try {
      const res = await fetch("/api/host-connection");
      const json = (await res.json()) as { ok?: boolean; data?: HostPayload };
      const s = json.data?.settings;
      if (!s) {
        toast.error("هنوز تنظیماتی ذخیره نشده است");
        return;
      }
      const content = JSON.stringify(
        {
          sshHost: s.sshHost,
          sshPort: s.sshPort,
          sshUser: s.sshUser,
          dbName: s.dbName,
          dbUser: s.dbUser,
          localPort: s.localPort,
          note: "رمزها به دلایل امنیتی در این فایل گنجانده نشده است؛ مسیر فایل اصلی روی سرور: " + s.configPath,
        },
        null,
        2
      );
      const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "host-connection.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("فایل تنظیمات دانلود شد — رمزها حذف‌شده است");
    } catch (e) {
      toast.error(errMessage(e));
    }
  };

  const online = status?.online ?? false;

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="اتصال به هاست"
        description="اتصال امن SSH به هاست اشتراکی (cPanel) و دیتابیس MySQL میزبان — مشخصات فقط در سرور ذخیره می‌شود"
        actions={
          <Badge variant="outline" className={online ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300"}>
            {online ? <Cloud className="h-3.5 w-3.5" /> : <CloudOff className="h-3.5 w-3.5" />}
            {online ? `تونل فعال @127.0.0.1:${status?.localPort ?? 5522}` : "دیتابیس محلی"}
          </Badge>
        }
      />

      {/* وضعیت تونل */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <span
              aria-hidden
              className={`inline-block h-2.5 w-2.5 rounded-full ${online ? "bg-emerald-500" : "bg-rose-400"}`}
            />
            SSH tunnel: {online ? "online" : "offline"}
            {online && status?.localPort ? (
              <span dir="ltr" className="font-mono text-xs text-muted-foreground">
                @127.0.0.1:{status.localPort}
              </span>
            ) : null}
          </CardTitle>
          <CardDescription>
            {online
              ? `متصل به ${status?.sshHost ?? "—"}${status?.mysqlVersion ? ` — MySQL ${status.mysqlVersion}` : ""}`
              : "سیستم در حالت لوکال کار می‌کند؛ برای استفاده از دیتابیس میزبان، اتصال را برقرار کنید"}
          </CardDescription>
        </CardHeader>
        {status?.lastError && (
          <CardContent className="pt-0">
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              {status.lastError}
            </p>
          </CardContent>
        )}
      </Card>

      {/* فرم مشخصات */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Server className="h-4 w-4" />
            مشخصات اتصال به هاست
          </CardTitle>
          <CardDescription>
            این مشخصات از تصویر/هاست شما پیش‌فرض شده است — رمز را وارد و ذخیره کنید. رمز هرگز به مرورگر برگردانده نمی‌شود.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ssh-host">آدرس سرور SSH</Label>
              <Input
                id="ssh-host"
                dir="ltr"
                className="text-left"
                placeholder="server370.web-hosting.com"
                value={form.sshHost}
                onChange={(e) => {
                  setFormTouched(true);
                  setForm((f) => ({ ...f, sshHost: e.target.value }));
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ssh-port">پورت SSH</Label>
              <Input
                id="ssh-port"
                dir="ltr"
                className="text-left"
                inputMode="numeric"
                placeholder="21098"
                value={form.sshPort}
                onChange={(e) => {
                  setFormTouched(true);
                  setForm((f) => ({ ...f, sshPort: e.target.value.replace(/[^0-9]/g, "") }));
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ssh-user">نام کاربری SSH (همان رمز cPanel)</Label>
              <Input
                id="ssh-user"
                dir="ltr"
                className="text-left"
                autoComplete="off"
                placeholder="databaselumix313"
                value={form.sshUser}
                onChange={(e) => {
                  setFormTouched(true);
                  setForm((f) => ({ ...f, sshUser: e.target.value }));
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="db-name">نام دیتابیس</Label>
              <Input
                id="db-name"
                dir="ltr"
                className="text-left"
                autoComplete="off"
                placeholder="databaselumix313_factory"
                value={form.dbName}
                onChange={(e) => {
                  setFormTouched(true);
                  setForm((f) => ({ ...f, dbName: e.target.value }));
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="db-user">نام کاربری دیتابیس</Label>
              <Input
                id="db-user"
                dir="ltr"
                className="text-left"
                autoComplete="off"
                placeholder="databaselumix313_factory"
                value={form.dbUser}
                onChange={(e) => {
                  setFormTouched(true);
                  setForm((f) => ({ ...f, dbUser: e.target.value }));
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="db-password">
                رمز دیتابیس
                {loaded?.hasPassword && (
                  <span className="mr-1 text-[10px] text-muted-foreground">(ذخیره‌شده — برای تغییر پر کنید)</span>
                )}
              </Label>
              <Input
                id="db-password"
                dir="ltr"
                className="text-left"
                type="password"
                autoComplete="new-password"
                placeholder={loaded?.hasPassword ? "••••••••" : "رمز cPanel / MySQL"}
                value={form.dbPassword}
                onChange={(e) => {
                  setFormTouched(true);
                  setForm((f) => ({ ...f, dbPassword: e.target.value }));
                }}
              />
            </div>
          </div>

          {/* دکمه‌ها */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button onClick={() => void doConnect()} disabled={busy !== null} className="min-h-11">
              {busy === "connect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
              ذخیره و اتصال به هاست
            </Button>
            <Button variant="outline" onClick={() => void doTest()} disabled={busy !== null} className="min-h-11">
              {busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              تست اتصال SSH
            </Button>
            <Button variant="outline" onClick={() => void doDownloadConfig()} disabled={busy !== null} className="min-h-11">
              <FileJson className="h-4 w-4" />
              باز کردن پوشه تنظیمات
            </Button>
            <Button
              variant="outline"
              onClick={() => void doDisconnect()}
              disabled={busy !== null || !online}
              className="min-h-11"
            >
              {busy === "disconnect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              بازگشت به دیتابیس محلی
            </Button>
          </div>

          {/* نتیجهٔ آخرین تست */}
          {lastTest && (
            <div
              className={`mt-4 flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                lastTest.ok
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                  : "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300"
              }`}
              role="status"
            >
              {lastTest.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <span>{lastTest.message}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* توضیح حالت لوکال */}
      <Card>
        <CardContent className="flex items-start gap-2 pt-4 text-xs leading-6 text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            معماری سیستم لوکال‌محور است: معلومات اصلی روی دیتابیس همین سیستم (SQLite) ذخیره می‌شود و در قطع انترنت هم
            کار می‌کند. «اتصال به هاست» تونل امن SSH را به MySQL هاست اشتراکی باز می‌کند (۱۲۷.۰.۰.۱:۵۵۲۲ → هاست:۳۳۰۶)
            تا دسترسی سرور به دیتابیس میزبان بررسی و برقرار شود؛ وضعیت اتصال همیشه با نشان سبز/سرخ بالا قابل دیدن است
            {serverOnline ? "" : " — در حال حاضر سرور از مرورگر شما قابل دسترسی نیست"}.
          </span>
        </CardContent>
      </Card>

      {loading && (
        <p className="text-center text-xs text-muted-foreground">در حال بارگیری تنظیمات…</p>
      )}
    </div>
  );
}
