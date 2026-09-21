"use client";

/** نسخه‌های احتیاطی — ایجاد، بازیابی و حذف بک‌آپ‌های دیتابیس */

import { useMemo, useRef, useState } from "react";
import {
  DatabaseBackup,
  Download,
  Plus,
  RotateCcw,
  Trash2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { useUser, PermissionGate } from "@/components/shared/use-user";
import { apiSend, useApiData } from "@/lib/client-api";
import { runBulkOperation, bulkResultMessage } from "@/lib/bulk";
import { PageHeader, StatusBadge, BADGE_TONES } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { ConfirmDialog, FormDialog } from "@/components/shared/form-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatHijriDateTime, formatNumber } from "@/lib/format";
import { saveBlobToDevice, type SaveToDeviceResult } from "@/lib/save-file";

// ─── انواع ───

type BackupRow = {
  id: string;
  filename: string;
  size?: number;
  type?: string | null;
  status?: string | null;
  note?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
  createdAt?: string | null;
  [key: string]: unknown;
};

// ─── هلپرها ───

const OFFLINE_MSG = "به‌صورت آفلاین ذخیره شد؛ پس از اتصال همگام می‌شود";

function asList<T>(d: unknown): T[] {
  if (Array.isArray(d)) return d as T[];
  if (d && typeof d === "object" && Array.isArray((d as { items?: unknown }).items)) {
    return (d as { items: T[] }).items;
  }
  return [];
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : "خطا در انجام عملیات";
}

function isQueued(res: unknown): boolean {
  return typeof res === "object" && res !== null && "queued" in res;
}

function formatSize(bytes?: number): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${formatNumber(bytes)} بایت`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${formatNumber(kb, 1)} کیلوبایت`;
  return `${formatNumber(kb / 1024, 2)} مگابایت`;
}

function typeInfo(type?: string | null): { label: string; tone: string } {
  const t = (type ?? "").toUpperCase();
  if (t === "MANUAL") return { label: "دستی", tone: "emerald" };
  if (t === "AUTO" || t === "AUTOMATIC") return { label: "خودکار", tone: "amber" };
  if (t === "UPLOADED") return { label: "بارگذاری‌شده", tone: "violet" };
  return { label: type || "—", tone: "slate" };
}

// ─── ویو ───

export default function BackupView() {
  return (
    <PermissionGate permission="backup.view">
      <BackupInner />
    </PermissionGate>
  );
}

function BackupInner() {
  const { user, hasPermission } = useUser();
  const { data: raw, loading, error, refetch } = useApiData<unknown>("/api/backups");
  const backups = useMemo(() => asList<BackupRow>(raw), [raw]);

  const canCreate = hasPermission("backup.create");
  const canDelete = hasPermission("backup.delete");
  const canRestore = user.isSuperAdmin;

  const [createOpen, setCreateOpen] = useState(false);
  const [note, setNote] = useState("");
  // ذخیرهٔ فایل نسخه در دستگاه کاربر (با انتخاب پوشهٔ دلخواه)
  const [saveToDevice, setSaveToDevice] = useState(true);
  const [restoreTarget, setRestoreTarget] = useState<BackupRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BackupRow | null>(null);
  const [busy, setBusy] = useState(false);

  // بارگذاری نسخهٔ پشتیبان از کامپیوتر کاربر
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadNote, setUploadNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // دانلود فایل نسخهٔ احتیاطی
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // انتخاب گروهی — فقط حذف گروهی (بازیابی گروهی هرگز)
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  /** پیام نتیجهٔ ذخیرهٔ فایل در دستگاه کاربر */
  const toastSaveResult = (result: SaveToDeviceResult, filename: string) => {
    if (result === "saved") {
      toast.success(`فایل «${filename}» در پوشهٔ انتخابی شما ذخیره شد`);
    } else if (result === "downloaded") {
      toast.info(
        "مرورگر شما انتخاب پوشه را پشتیبانی نمی‌کند — فایل در پوشهٔ Downloads ذخیره شد"
      );
    } else {
      toast.info("ذخیره در دستگاه لغو شد — نسخه در فهرست سیستم باقی است");
    }
  };

  const createBackup = async () => {
    setBusy(true);
    try {
      const res = await apiSend<{ id?: string; filename?: string }>("/api/backups", {
        body: JSON.stringify({ note: note.trim() || undefined }),
      });
      if (isQueued(res)) {
        toast.info(OFFLINE_MSG);
        return;
      }
      toast.success("نسخه احتیاطی با موفقیت ایجاد شد");
      setCreateOpen(false);
      setNote("");
      void refetch();
      // ذخیرهٔ فایل نسخه در دستگاه کاربر — پنجرهٔ انتخاب پوشه باز می‌شود
      if (saveToDevice && res?.id) {
        try {
          const fileRes = await fetch(`/api/backups/${res.id}/download`);
          if (fileRes.ok) {
            const blob = await fileRes.blob();
            const fname = res.filename || "backup.db";
            const dlName = fname.endsWith(".db") ? fname : `${fname}.db`;
            const result = await saveBlobToDevice(blob, dlName, {
              description: "نسخهٔ احتیاطی دیتابیس",
              extensions: [".db"],
            });
            toastSaveResult(result, dlName);
          } else {
            toast.error("نسخه ایجاد شد اما دریافت فایل برای ذخیره در دستگاه ناموفق بود");
          }
        } catch {
          toast.error("نسخه ایجاد شد اما ذخیرهٔ فایل در دستگاه ناموفق بود");
        }
      }
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const doRestore = async () => {
    if (!restoreTarget) return;
    setBusy(true);
    try {
      const res = await apiSend<{ safetyBackup?: { filename?: string } }>(
        `/api/backups/${restoreTarget.id}/restore`,
        {
          method: "POST",
          body: JSON.stringify({ confirm: true }),
        }
      );
      if (isQueued(res)) {
        toast.info(OFFLINE_MSG);
      } else {
        const safetyName =
          res && typeof res === "object" && "safetyBackup" in res
            ? (res as { safetyBackup?: { filename?: string } }).safetyBackup?.filename
            : undefined;
        toast.success(
          safetyName
            ? `بازیابی انجام شد — نسخهٔ موقت حالت قبلی با نام «${safetyName}» در فهرست ثبت شد`
            : "بازیابی انجام شد؛ همه معلومات به نسخه انتخابی برگشت"
        );
        setRestoreTarget(null);
        void refetch();
      }
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  /** بارگذاری فایل نسخهٔ پشتیبان از کامپیوتر کاربر (مستقیم — قابل صف‌کردن نیست) */
  const submitUpload = async () => {
    if (!uploadFile) {
      toast.error("ابتدا فایل نسخهٔ پشتیبان را انتخاب کنید");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", uploadFile);
      if (uploadNote.trim()) fd.append("note", uploadNote.trim());
      const res = await fetch("/api/backups/upload", { method: "POST", body: fd });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error || "بارگذاری ناموفق بود");
      toast.success("نسخهٔ پشتیبان بارگذاری شد و به فهرست اضافه گردید");
      setUploadOpen(false);
      setUploadFile(null);
      setUploadNote("");
      void refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "بارگذاری ناموفق بود");
    } finally {
      setUploading(false);
    }
  };

  /** دانلود فایل نسخهٔ احتیاطی — کاربر پوشهٔ دلخواه در دستگاه خود را انتخاب می‌کند */
  const downloadBackup = async (r: BackupRow) => {
    setDownloadingId(r.id);
    try {
      const res = await fetch(`/api/backups/${r.id}/download`);
      // بدنه فقط یک بار خوانده می‌شود — پیام خطا فقط وقتی پاسخ ناموفق است
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "دانلود ناموفق بود");
      }
      const blob = await res.blob();
      const fname = r.filename || "backup.db";
      const dlName = fname.endsWith(".db") ? fname : `${fname}.db`;
      const result = await saveBlobToDevice(blob, dlName, {
        description: "نسخهٔ احتیاطی دیتابیس",
        extensions: [".db"],
      });
      toastSaveResult(result, dlName);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "دانلود ناموفق بود");
    } finally {
      setDownloadingId(null);
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      const res = await apiSend<unknown>(`/api/backups/${deleteTarget.id}`, { method: "DELETE" });
      if (isQueued(res)) {
        toast.info(OFFLINE_MSG);
      } else {
        toast.success("نسخه احتیاطی حذف شد");
        setDeleteTarget(null);
        void refetch();
      }
    } catch (e) {
      toast.error(errMessage(e));
      setDeleteTarget(null);
    } finally {
      setBusy(false);
    }
  };

  const doBulkDelete = async () => {
    setBusy(true);
    try {
      const result = await runBulkOperation(selectedIds, (id) =>
        apiSend<unknown>(`/api/backups/${id}`, { method: "DELETE" })
      );
      const msg = bulkResultMessage("حذف گروهی نسخه‌های احتیاطی", result);
      if (msg.tone === "success") toast.success(msg.message);
      else if (msg.tone === "warning") toast.warning(msg.message);
      else toast.error(msg.message);
      setSelectedIds([]);
      void refetch();
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setBusy(false);
      setBulkDeleteOpen(false);
    }
  };

  const columns: Column<BackupRow>[] = [
    {
      key: "filename",
      header: "نام فایل",
      render: (r) => (
        <span dir="ltr" className="block max-w-[220px] break-all font-mono text-xs">
          {r.filename ?? "—"}
        </span>
      ),
    },
    { key: "size", header: "حجم", render: (r) => formatSize(r.size) },
    {
      key: "type",
      header: "نوع",
      render: (r) => {
        const t = typeInfo(r.type);
        return (
          <Badge variant="outline" className={BADGE_TONES[t.tone] ?? BADGE_TONES.slate}>
            {t.label}
          </Badge>
        );
      },
    },
    { key: "status", header: "وضعیت", render: (r) => <StatusBadge status={r.status} /> },
    {
      key: "note",
      header: "یادداشت",
      render: (r) => (
        <span className="line-clamp-2 block max-w-[200px] text-xs">{r.note || "—"}</span>
      ),
    },
    { key: "createdByName", header: "ایجادکننده", render: (r) => r.createdByName ?? "—" },
    { key: "createdAt", header: "تاریخ", render: (r) => formatHijriDateTime(r.createdAt) },
    {
      key: "actions",
      header: "عملیات",
      sortable: false,
      render: (r) => (
        <div className="flex flex-wrap items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={downloadingId === r.id}
            onClick={() => void downloadBackup(r)}
          >
            <Download className="h-3.5 w-3.5" />
            {downloadingId === r.id ? "در حال دانلود..." : "دانلود"}
          </Button>
          {canRestore && (
            <Button variant="outline" size="sm" onClick={() => setRestoreTarget(r)}>
              <RotateCcw className="h-3.5 w-3.5" />
              بازیابی
            </Button>
          )}
          {canDelete && (
            <Button
              variant="outline"
              size="sm"
              className="border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950"
              onClick={() => setDeleteTarget(r)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              حذف
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="نسخه‌های احتیاطی"
        description="ایجاد و مدیریت نسخه‌های پشتیبان دیتابیس سیستم"
        actions={
          canCreate ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setUploadFile(null);
                  setUploadNote("");
                  setUploadOpen(true);
                }}
              >
                <Upload className="h-4 w-4" />
                بارگذاری نسخه پشتیبان
              </Button>
              <Button
                size="sm"
                onClick={() => setCreateOpen(true)}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" />
                ایجاد نسخه احتیاطی
              </Button>
            </div>
          ) : null
        }
      />

      <Alert className="border-amber-300 bg-amber-50/70 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
        <TriangleAlert className="h-4 w-4" />
        <AlertTitle>نسخه احتیاطی چیست؟</AlertTitle>
        <AlertDescription>
          ایجاد نسخه احتیاطی، کل دیتابیس SQLite سیستم را کپی می‌کند. اگر هنگام ایجاد،
          گزینهٔ <span className="font-semibold">ذخیرهٔ فایل نسخه در دستگاه من</span> را
          فعال نگه دارید (یا از دکمهٔ <span className="font-semibold">دانلود</span> استفاده
          کنید)، پنجرهٔ «ذخیره در...» باز می‌شود و پوشهٔ دلخواه در دستگاه خود را انتخاب
          می‌کنید تا فایل داخل همان پوشه ذخیره شود. با دکمهٔ{" "}
          <span className="font-semibold">بارگذاری نسخه پشتیبان</span> فایل ذخیره‌شده را
          دوباره وارد سیستم کنید. بازیابی یک نسخه،{" "}
          <span className="font-semibold">
            همه معلومات فعلی را با نسخه انتخابی جایگزین می‌کند
          </span>{" "}
          — پیش از جایگزینی، سیستم به‌صورت خودکار یک نسخه موقت از معلومات فعلی می‌گیرد.
        </AlertDescription>
      </Alert>

      {error ? (
        <Card className="border-rose-300 dark:border-rose-900">
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <p className="text-sm text-rose-600 dark:text-rose-400">
              خطا در دریافت فهرست نسخه‌ها: {error}
            </p>
            <Button size="sm" onClick={refetch} className="bg-primary text-primary-foreground hover:bg-primary/90">
              تلاش دوباره
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="gap-3 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-base">فهرست نسخه‌های احتیاطی</CardTitle>
            <CardDescription>
              بازیابی فقط توسط سوپرادمین و حذف با صلاحیت backup.delete امکان‌پذیر است
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <DataTable
              columns={columns}
              rows={backups}
              searchKeys={["filename", "note"]}
              searchPlaceholder="جستجوی نام فایل یا یادداشت..."
              loading={loading}
              rowKey={(r) => r.id}
              emptyText="هیچ نسخه احتیاطی ایجاد نشده است"
              selectable={canDelete}
              getRowId={(r) => r.id}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              bulkActions={
                canDelete && selectedIds.length > 0 ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950"
                    disabled={busy}
                    onClick={() => setBulkDeleteOpen(true)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    حذف گروهی
                  </Button>
                ) : null
              }
            />
          </CardContent>
        </Card>
      )}

      <FormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="ایجاد نسخه احتیاطی"
        description="از کل دیتابیس فعلی یک نسخه پشتیبان گرفته می‌شود"
        submitLabel="ایجاد نسخه"
        submitting={busy}
        onSubmit={() => void createBackup()}
      >
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="backup-note">یادداشت (اختیاری)</Label>
            <Input
              id="backup-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="مثال: قبل از تغییرات اسعار"
            />
          </div>
          <div className="grid gap-2 rounded-md border bg-muted/40 p-3">
            <div className="flex items-start gap-2">
              <Checkbox
                id="save-to-device"
                checked={saveToDevice}
                onCheckedChange={(v) => setSaveToDevice(v === true)}
                className="mt-0.5"
              />
              <div className="grid gap-1">
                <Label
                  htmlFor="save-to-device"
                  className="cursor-pointer font-medium leading-5"
                >
                  ذخیرهٔ فایل نسخه در دستگاه من (انتخاب پوشه)
                </Label>
                <p className="text-xs leading-5 text-muted-foreground">
                  پس از ایجاد نسخه، پنجرهٔ «ذخیره در...» باز می‌شود و پوشهٔ دلخواه
                  در کامپیوتر یا موبایل خود را انتخاب می‌کنید تا فایل نسخه داخل
                  همان پوشه ذخیره شود. در مرورگرهای بدون پشتیبانی (فایرفاکس/سافاری)،
                  فایل به‌صورت خودکار در پوشهٔ Downloads ذخیره می‌شود.
                </p>
              </div>
            </div>
          </div>
        </div>
      </FormDialog>

      <FormDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        title="بارگذاری نسخه پشتیبان"
        description="فایل نسخهٔ پشتیبان ذخیره‌شده در کامپیوتر خود را انتخاب کنید تا به فهرست نسخه‌ها اضافه شود؛ بازیابی آن جداگانه و با تأیید انجام می‌شود"
        submitLabel="بارگذاری فایل"
        submitting={uploading}
        onSubmit={() => void submitUpload()}
      >
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="backup-file">فایل نسخهٔ پشتیبان (.db یا .sqlite)</Label>
            <input
              ref={fileInputRef}
              id="backup-file"
              type="file"
              accept=".db,.sqlite,.sqlite3"
              className="w-full cursor-pointer rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm file:me-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1 file:text-sm file:font-medium hover:file:bg-muted/80"
              onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-muted-foreground">
              فقط فایل دیتابیس SQLite معتبر پذیرفته می‌شود (حداکثر ۵۱۲ مگابایت). فایل
              بارگذاری‌شده بازنویسی نمی‌شود و با نام جدید ذخیره می‌گردد.
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="upload-note">یادداشت (اختیاری)</Label>
            <Input
              id="upload-note"
              value={uploadNote}
              onChange={(e) => setUploadNote(e.target.value)}
              placeholder="مثال: نسخهٔ پایان ماه حمل"
            />
          </div>
        </div>
      </FormDialog>

      <ConfirmDialog
        open={!!restoreTarget}
        onOpenChange={(o) => !o && setRestoreTarget(null)}
        title="بازیابی نسخه احتیاطی"
        message="بازیابی، همه معلومات فعلی را با نسخه انتخابی جایگزین می‌کند. پیش از جایگزینی، سیستم به‌صورت خودکار از معلومات فعلی یک نسخه احتیاطی موقت می‌گیرد تا در صورت نیاز بتوانید برگردید. آیا مطمئن هستید؟"
        confirmLabel="بازیابی"
        danger
        onConfirm={() => void doRestore()}
        submitting={busy}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="حذف نسخه احتیاطی"
        message={`آیا از حذف نسخه «${deleteTarget?.filename ?? ""}» مطمئن هستید؟ فایل پشتیبان برای همیشه از بین می‌رود.`}
        confirmLabel="حذف"
        danger
        onConfirm={() => void doDelete()}
        submitting={busy}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={(o) => !o && setBulkDeleteOpen(false)}
        title={`حذف گروهی ${selectedIds.length.toLocaleString("en-US")} نسخه احتیاطی`}
        message={`آیا از حذف گروهی ${selectedIds.length.toLocaleString("en-US")} نسخه انتخاب‌شده مطمئن هستید؟ فایل‌های پشتیبان برای همیشه از بین می‌روند و قابل بازگشت نیستند.`}
        confirmLabel="حذف گروهی"
        danger
        onConfirm={() => void doBulkDelete()}
        submitting={busy}
      />

      {!canCreate && !canDelete && !canRestore && (
        <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <DatabaseBackup className="h-3.5 w-3.5" />
          شما فقط اجازه دیدن فهرست نسخه‌ها را دارید
        </p>
      )}
    </div>
  );
}
