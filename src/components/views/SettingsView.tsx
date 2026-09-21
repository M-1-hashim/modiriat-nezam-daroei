"use client";

/** تنظیمات سیستم — معلومات شرکت، کنترل اسناد، پایه توزیع منفعت، پیشوندها و دیتای نمایشی */

import { useEffect, useState } from "react";
import { CircleAlert, Save, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { useUser, PermissionGate } from "@/components/shared/use-user";
import { apiSend, useApiData } from "@/lib/client-api";
import { PageHeader } from "@/components/shared/page-header";
import { ConfirmDialog } from "@/components/shared/form-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CURRENCY_LABELS } from "@/lib/format";
import { DISTRIBUTION_BASES } from "@/lib/terminology";
import { AppearanceSettings } from "@/components/views/appearance-settings";

// ─── هلپرها ───

function asRecord(d: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (d && typeof d === "object") {
    for (const [k, v] of Object.entries(d as Record<string, unknown>)) {
      if (v == null) {
        out[k] = "";
      } else if (typeof v === "string") {
        out[k] = v;
      } else if (typeof v === "number" || typeof v === "boolean") {
        out[k] = String(v);
      } else {
        out[k] = JSON.stringify(v);
      }
    }
  }
  return out;
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : "خطا در انجام عملیات";
}

function isQueued(res: unknown): boolean {
  return typeof res === "object" && res !== null && "queued" in res;
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 p-4 pt-0">{children}</CardContent>
    </Card>
  );
}

function SettingSwitch({
  id,
  label,
  desc,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  desc?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border p-3">
      <div className="min-w-0">
        <Label htmlFor={id}>{label}</Label>
        {desc && <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>}
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

const PREFIX_FIELDS: { key: string; label: string }[] = [
  { key: "seq_prefix_PURCHASE", label: "خرید" },
  { key: "seq_prefix_SALE", label: "فروش" },
  { key: "seq_prefix_PAYMENT", label: "پرداخت" },
  { key: "seq_prefix_PURCHASE_RETURN", label: "برگشتی خرید" },
  { key: "seq_prefix_SALES_RETURN", label: "برگشتی فروش" },
];

const PREFIX_PLACEHOLDERS: Record<string, string> = {
  seq_prefix_PURCHASE: "PUR",
  seq_prefix_SALE: "SALE",
  seq_prefix_PAYMENT: "PAY",
  seq_prefix_PURCHASE_RETURN: "PR",
  seq_prefix_SALES_RETURN: "SR",
};

// ─── ویو ───

export default function SettingsView() {
  return (
    <PermissionGate permission="settings.view">
      <SettingsInner />
    </PermissionGate>
  );
}

function SettingsInner() {
  const { user, hasPermission } = useUser();
  const { data, loading, error, refetch } = useApiData<unknown>("/api/settings");
  const canEdit = hasPermission("settings.edit");

  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [formErr, setFormErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [seedOpen, setSeedOpen] = useState(false);
  const [seeding, setSeeding] = useState(false);

  useEffect(() => {
    if (data && form === null) {
      setForm(asRecord(data));
    }
  }, [data, form]);

  const val = (k: string): string => form?.[k] ?? "";
  const set = (k: string, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const flag = (k: string): boolean => form?.[k] === "true";

  const save = async () => {
    if (!form) return;
    const days = Number(form.expiry_warn_days ?? "90");
    if (!Number.isFinite(days) || days < 1 || !Number.isInteger(days)) {
      setFormErr("«روزهای هشدار انقضا» باید عدد صحیح مثبت باشد");
      return;
    }
    for (const p of PREFIX_FIELDS) {
      if (!(form[p.key] ?? "").trim()) {
        setFormErr(`پیشوند «${p.label}» نمی‌تواند خالی باشد`);
        return;
      }
    }
    setFormErr("");
    setSaving(true);
    try {
      const res = await apiSend<unknown>("/api/settings", {
        method: "PUT",
        body: JSON.stringify(form),
      });
      if (isQueued(res)) {
        toast.info("به‌صورت آفلاین ذخیره شد؛ پس از اتصال همگام می‌شود");
      } else {
        toast.success("تنظیمات با موفقیت ذخیره شد");
        setForm(null);
        void refetch();
      }
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const seedDemo = async () => {
    setSeeding(true);
    try {
      const res = await apiSend<unknown>("/api/seed", {
        body: JSON.stringify({ mode: "demo" }),
      });
      if (isQueued(res)) {
        toast.info("به‌صورت آفلاین ذخیره شد؛ پس از اتصال همگام می‌شود");
      } else {
        toast.success("دیتای نمایشی با موفقیت بارگذاری شد");
        setSeedOpen(false);
        setForm(null);
        void refetch();
      }
    } catch (e) {
      toast.error(errMessage(e));
      setSeedOpen(false);
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="تنظیمات سیستم"
        description="پیکربندی عمومی شرکت، ظاهر و تم، کنترل اسناد و پیشوندهای اسناد"
      />

      {/* تغییر تم و رنگ آیتم‌ها — فوراً اعمال می‌شود و به ذخیره‌سازی سرور نیاز ندارد */}
      <AppearanceSettings />

      {error ? (
        <Card className="border-rose-300 dark:border-rose-900">
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <p className="text-sm text-rose-600 dark:text-rose-400">خطا در دریافت تنظیمات: {error}</p>
            <Button size="sm" onClick={refetch} className="bg-primary text-primary-foreground hover:bg-primary/90">
              تلاش دوباره
            </Button>
          </CardContent>
        </Card>
      ) : loading && form === null ? (
        <div className="grid gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : !form ? null : (
        <>
          <SettingsGroup title="معلومات شرکت">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="set-company-name">نام شرکت</Label>
                <Input
                  id="set-company-name"
                  value={val("company_name")}
                  disabled={!canEdit}
                  onChange={(e) => set("company_name", e.target.value)}
                  placeholder="مثال: شرکت نسخه‌جویی افغان"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="set-company-phone">تلفن شرکت</Label>
                <Input
                  id="set-company-phone"
                  dir="ltr"
                  className="font-mono"
                  value={val("company_phone")}
                  disabled={!canEdit}
                  onChange={(e) => set("company_phone", e.target.value)}
                  placeholder="+93 700 000 000"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="set-company-address">آدرس شرکت</Label>
              <Textarea
                id="set-company-address"
                rows={2}
                value={val("company_address")}
                disabled={!canEdit}
                onChange={(e) => set("company_address", e.target.value)}
                placeholder="کابل، افغانستان"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="set-invoice-note">یادداشت پای فاکتورها</Label>
              <Textarea
                id="set-invoice-note"
                rows={2}
                value={val("invoice_footer_note")}
                disabled={!canEdit}
                onChange={(e) => set("invoice_footer_note", e.target.value)}
                placeholder="مثال: ادویه فروخته‌شده بدون تجویز داکتر، قابل برگشت نیست"
              />
            </div>
          </SettingsGroup>

          <SettingsGroup title="کنترل اسناد">
            <SettingSwitch
              id="set-ap-purchases"
              label="تصویب خریدها"
              desc="خریدها پیش از تأثیر بر موجودی باید توسط مسئول تصویب شوند"
              checked={flag("require_approval_purchases")}
              disabled={!canEdit}
              onChange={(v) => set("require_approval_purchases", v ? "true" : "false")}
            />
            <SettingSwitch
              id="set-ap-sales"
              label="تصویب فروش‌ها"
              desc="فروش‌ها پیش از نهایی شدن نیاز به تصویب دارند"
              checked={flag("require_approval_sales")}
              disabled={!canEdit}
              onChange={(v) => set("require_approval_sales", v ? "true" : "false")}
            />
            <SettingSwitch
              id="set-ap-expenses"
              label="تصویب مصارف"
              desc="مصارف پیش از پرداخت نیاز به تصویب دارند"
              checked={flag("require_approval_expenses")}
              disabled={!canEdit}
              onChange={(v) => set("require_approval_expenses", v ? "true" : "false")}
            />
            <SettingSwitch
              id="set-ap-returns"
              label="تصویب برگشتی‌ها"
              desc="برگشتی فروش و خرید پیش از تأثیر بر موجودی تصویب می‌شوند"
              checked={flag("require_approval_returns")}
              disabled={!canEdit}
              onChange={(v) => set("require_approval_returns", v ? "true" : "false")}
            />
            <SettingSwitch
              id="set-block-expired"
              label="جلوگیری از فروش اقلام منقضی"
              desc="فروش بچ‌های منقضی‌شده مسدود می‌شود (نزدیک انقضا فقط هشدار می‌دهد)"
              checked={flag("block_expired_sales")}
              disabled={!canEdit}
              onChange={(v) => set("block_expired_sales", v ? "true" : "false")}
            />
            <SettingSwitch
              id="set-negative"
              label="اجازه موجودی منفی"
              desc="فروش بدون موجودی کافی در گدام مجاز می‌شود (خطرناک است)"
              checked={flag("allow_negative_stock")}
              disabled={!canEdit}
              onChange={(v) => set("allow_negative_stock", v ? "true" : "false")}
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="set-expiry-days">روزهای هشدار انقضا</Label>
                <Input
                  id="set-expiry-days"
                  dir="ltr"
                  type="number"
                  min={1}
                  value={val("expiry_warn_days") || "90"}
                  disabled={!canEdit}
                  onChange={(e) => set("expiry_warn_days", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  بچ‌های نزدیک انقضا این تعداد روز قبل هشدار می‌دهند
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="set-invoice-tpl">تمپلیت پیش‌فرض فاکتور</Label>
                <Select
                  value={val("invoice_template_default") || "SIMPLE"}
                  disabled={!canEdit}
                  onValueChange={(v) => set("invoice_template_default", v)}
                >
                  <SelectTrigger id="set-invoice-tpl" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SIMPLE">ساده</SelectItem>
                    <SelectItem value="DETAILED">مفصل</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="set-currency">اسعار پیش‌فرض</Label>
                <Select
                  value={val("default_currency") || "AFN"}
                  disabled={!canEdit}
                  onValueChange={(v) => set("default_currency", v)}
                >
                  <SelectTrigger id="set-currency" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(CURRENCY_LABELS).map(([code, label]) => (
                      <SelectItem key={code} value={code}>
                        {label} ({code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </SettingsGroup>

          <SettingsGroup title="تخفیف و پروموشن">
            <div className="grid gap-2 sm:max-w-xs">
              <Label htmlFor="set-max-discount">حداکثر درصد تخفیف کاربران عادی</Label>
              <Input
                id="set-max-discount"
                dir="ltr"
                type="number"
                min={0}
                max={100}
                step="0.5"
                value={val("max_discount_percent") || "100"}
                disabled={!canEdit}
                onChange={(e) => set("max_discount_percent", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                کاربران عادی نمی‌توانند تخفیف بیش از این درصد بدهند (تخفیف قلم و فاکتور). مدیر ارشد همیشه مجاز است. مقدار ۱۰۰ یعنی بدون محدودیت.
              </p>
            </div>
          </SettingsGroup>

          <SettingsGroup title="کارکنان و معاش">
            <div className="grid gap-2 sm:max-w-xs">
              <Label htmlFor="set-attendance-base-days">روز مبنای محاسبهٔ معاش</Label>
              <Input
                id="set-attendance-base-days"
                dir="ltr"
                type="number"
                min={1}
                max={60}
                value={val("attendance_base_days") || "30"}
                disabled={!canEdit}
                onChange={(e) => set("attendance_base_days", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                مبلغ کسر روزانه غیبت = معاش ماهانه ÷ این تعداد روز. مثال: معاش ۳۰٬۰۰۰ و مبنای ۳۰ روز ⇒ کسر هر روز غیبت ۱٬۰۰۰ افغانی.
              </p>
            </div>
          </SettingsGroup>

          <SettingsGroup title="پایه توزیع منفعت">
            <div className="grid gap-2 sm:max-w-xs">
              <Label htmlFor="set-dist-base">پایه محاسبه سهم شرکا</Label>
              <Select
                value={val("profit_distribution_base") || "NET_PROFIT"}
                disabled={!canEdit}
                onValueChange={(v) => set("profit_distribution_base", v)}
              >
                <SelectTrigger id="set-dist-base" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(DISTRIBUTION_BASES).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                سهم هر شریک بر اساس این مبلغ پایه و درصد شراکت محاسبه می‌شود
              </p>
            </div>
          </SettingsGroup>

          <SettingsGroup title="پیشوندهای اسناد">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {PREFIX_FIELDS.map((p) => (
                <div key={p.key} className="grid gap-2">
                  <Label htmlFor={`set-${p.key}`}>پیشوند {p.label}</Label>
                  <Input
                    id={`set-${p.key}`}
                    dir="ltr"
                    className="font-mono"
                    value={val(p.key)}
                    disabled={!canEdit}
                    onChange={(e) => set(p.key, e.target.value.toUpperCase())}
                    placeholder={PREFIX_PLACEHOLDERS[p.key]}
                  />
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              نمونه شماره‌گذاری: PUR-KBL-00001 (پیشوند - کد شعبه - شماره ترتیبی)
            </p>
          </SettingsGroup>

          <Card className="gap-3 py-4">
            <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              {formErr ? (
                <p className="flex items-center gap-1.5 text-sm font-medium text-rose-600 dark:text-rose-400">
                  <CircleAlert className="h-4 w-4 shrink-0" />
                  {formErr}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {canEdit
                    ? "پس از تغییر مقادیر، دکمه ذخیره را بزنید"
                    : "شما صلاحیت ویرایش تنظیمات را ندارید (settings.edit)"}
                </p>
              )}
              {canEdit && (
                <Button
                  onClick={() => void save()}
                  disabled={saving}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <Save className="h-4 w-4" />
                  ذخیره تنظیمات
                </Button>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Card className="gap-3 border-amber-300 bg-amber-50/60 py-4 dark:border-amber-900 dark:bg-amber-950/30">
        <CardHeader className="px-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <TriangleAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            دیتای نمایشی (دمو)
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 pt-0">
          <p className="text-sm text-amber-900 dark:text-amber-200">
            دیتای نمایشی جدا از معلومات واقعی شما است و صرفاً برای آزمایش و آموزش سیستم استفاده
            می‌شود. با بارگذاری دمو، رکوردهای نمونه (شعبه، ادویه، مشتری، فروش و خرید) ایجاد می‌گردد.
          </p>
          {user.isSuperAdmin ? (
            <div>
              <Button
                variant="outline"
                size="sm"
                className="border-amber-400 text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950"
                onClick={() => setSeedOpen(true)}
              >
                بارگذاری دیتای نمایشی
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              بارگذاری دیتای نمایشی فقط توسط سوپرادمین امکان‌پذیر است
            </p>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={seedOpen}
        onOpenChange={setSeedOpen}
        title="بارگذاری دیتای نمایشی"
        message="با تأیید این عملیات، رکوردهای نمونه (شعبه، ادویه، مشتری، فروش و خرید) در دیتابیس ایجاد می‌شود. این دیتا برای آزمایش سیستم است. آیا ادامه می‌دهید؟"
        confirmLabel="بارگذاری دمو"
        onConfirm={() => void seedDemo()}
        submitting={seeding}
      />
    </div>
  );
}
