"use client";

/**
 * ویوی کارکنان — مدیریت کامل منابع بشری:
 *   تب ۱: کارکنان (ثبت، ویرایش، حذف، جزئیات)
 *   تب ۲: حاضری روزانه (حاضر / غایب / رخصتی با تأیید)
 *   تب ۳: گزارش‌ها (خلاصهٔ معاش ماهانه، حاضری روزانه/سالانه، سوابق بازه‌ای)
 *
 * محدودیت شعبه: غیرسوپرادمین فقط کارکنان و حاضری شعبهٔ خودش را می‌بیند.
 * محاسبهٔ کسر معاش: کسر روزانه = معاش ماهانه ÷ روز مبنای محاسبه (تنظیمات)
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CalendarCheck,
  Eye,
  Pencil,
  Plus,
  Trash2,
  UserCog,
  BarChart3,
  CheckCheck,
  Users,
} from "lucide-react";
import { PermissionGate, useUser } from "@/components/shared/use-user";
import { BADGE_TONES, PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { ConfirmDialog, FormDialog } from "@/components/shared/form-dialog";
import { apiSend, useApiData } from "@/lib/client-api";
import { formatMoney, formatNumber } from "@/lib/format";
import {
  HIJRI_MONTHS,
  dateToHijriInput,
  hijriInputToGregorianISO,
  formatHijriShort,
  hijriInputToDate,
  hijriMonthLength,
  hijriToday,
  hijriToGregorian,
  kabulNow,
  toPersianDigits,
} from "@/lib/hijri";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ─────────────────────── انواع ───────────────────────

type BranchItem = { id: string; name: string; code?: string | null };

type EmployeeItem = {
  id: string;
  branchId: string;
  fullName: string;
  fatherName?: string | null;
  phone?: string | null;
  position?: string | null;
  monthlySalary: number;
  startDate: string;
  isActive?: boolean | null;
  note?: string | null;
  branch?: { id: string; name: string } | null;
  _count?: { attendance?: number } | null;
};

type EmployeeDetail = EmployeeItem & {
  attendance: AttRecord[];
};

type AttRecord = {
  id: string;
  employeeId: string;
  branchId: string;
  date: string;
  status: "PRESENT" | "ABSENT" | "LEAVE";
  leaveApproved: boolean;
  note?: string | null;
  employee?: {
    id: string;
    fullName: string;
    position?: string | null;
    monthlySalary?: number;
  } | null;
  branch?: { id: string; name: string } | null;
};

type SummaryRow = {
  employeeId: string;
  fullName: string;
  position?: string | null;
  branchName: string;
  monthlySalary: number;
  present: number;
  absent: number;
  leaveApproved: number;
  leaveUnapproved: number;
  deductableDays: number;
  dailyRate: number;
  deduction: number;
  payable: number;
};

type SummaryResponse = {
  from: string;
  to: string;
  baseDays: number;
  rows: SummaryRow[];
  totals: {
    monthlySalary: number;
    present: number;
    absent: number;
    leaveApproved: number;
    leaveUnapproved: number;
    deduction: number;
    payable: number;
  };
};

type EntryState = {
  status: "" | "PRESENT" | "ABSENT" | "LEAVE";
  leaveApproved: boolean;
  note: string;
  dirty: boolean;
};

type ReportType = "payroll" | "daily" | "yearly" | "range";

// ─────────────────────── کمک‌کاری‌ها ───────────────────────

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

const FA_DIGIT_SRC = "۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩";
function normalizeDigits(s: string): string {
  return s.replace(/[۰-۹٠-٩]/g, (d) => String(FA_DIGIT_SRC.indexOf(d) % 10));
}

function isQueued(r: unknown): r is { queued: true; localId?: string } {
  return typeof r === "object" && r !== null && (r as { queued?: unknown }).queued === true;
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : "عملیات ناموفق بود";
}

/** امروز به‌صورت YYYY-MM-DD به وقت کابل */
function isoToday(): string {
  const now = kabulNow();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** ورودی هجری (1404/03/12) → YYYY-MM-DD گریگوری یا null (مستقل از منطقهٔ زمانی) */
function hijriInputToISO(input: string): string | null {
  return hijriInputToGregorianISO(normalizeDigits(input));
}

/** بازهٔ گریگوری یک ماه هجری شمسی */
function hijriMonthRange(jy: number, jm: number): { from: string; to: string } {
  const g1 = hijriToGregorian(jy, jm, 1);
  const g2 = hijriToGregorian(jy, jm, hijriMonthLength(jy, jm));
  return {
    from: `${g1.gy}-${pad2(g1.gm)}-${pad2(g1.gd)}`,
    to: `${g2.gy}-${pad2(g2.gm)}-${pad2(g2.gd)}`,
  };
}

/** بازهٔ گریگوری یک سال هجری شمسی */
function hijriYearRange(jy: number): { from: string; to: string } {
  const g1 = hijriToGregorian(jy, 1, 1);
  const g2 = hijriToGregorian(jy, 12, hijriMonthLength(jy, 12));
  return {
    from: `${g1.gy}-${pad2(g1.gm)}-${pad2(g1.gd)}`,
    to: `${g2.gy}-${pad2(g2.gm)}-${pad2(g2.gd)}`,
  };
}

function statusBadge(status: string, leaveApproved?: boolean) {
  if (status === "PRESENT") {
    return <Badge variant="outline" className={BADGE_TONES.emerald}>حاضر</Badge>;
  }
  if (status === "ABSENT") {
    return <Badge variant="outline" className={BADGE_TONES.rose}>غایب</Badge>;
  }
  if (status === "LEAVE") {
    return leaveApproved ? (
      <Badge variant="outline" className={BADGE_TONES.amber}>رخصتی (تأییدشده)</Badge>
    ) : (
      <Badge variant="outline" className={BADGE_TONES.rose}>رخصتی (تأییدنشده)</Badge>
    );
  }
  return <span className="text-muted-foreground">—</span>;
}

function ActiveBadge({ active }: { active?: boolean | null }) {
  return active ? (
    <Badge variant="outline" className={BADGE_TONES.emerald}>فعال</Badge>
  ) : (
    <Badge variant="outline" className={BADGE_TONES.slate}>غیرفعال</Badge>
  );
}

// ─────────────────────── ویو اصلی ───────────────────────

export default function EmployeesView() {
  return (
    <PermissionGate permission="hr.view">
      <EmployeesViewInner />
    </PermissionGate>
  );
}

function EmployeesViewInner() {
  const { user, hasPermission } = useUser();
  const isSuper = user.isSuperAdmin;
  const fixedBranchId = user.branchId ?? "";

  const canCreate = hasPermission("hr.create");
  const canEdit = hasPermission("hr.edit");
  const canDelete = hasPermission("hr.delete");
  const canApproveLeave = hasPermission("hr.approve");

  const branchesData = useApiData<BranchItem[]>("/api/branches");
  const branches = branchesData.data ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="کارکنان"
        description="مدیریت کارکنان شعبه‌ها، ثبت حاضری روزانه، محاسبهٔ کسر معاش و گزارش‌های منابع بشری"
      />

      <Tabs defaultValue="employees" className="gap-3">
        <TabsList>
          <TabsTrigger value="employees">
            <Users className="h-4 w-4" /> کارکنان
          </TabsTrigger>
          <TabsTrigger value="attendance">
            <CalendarCheck className="h-4 w-4" /> حاضری روزانه
          </TabsTrigger>
          <TabsTrigger value="reports">
            <BarChart3 className="h-4 w-4" /> گزارش‌ها
          </TabsTrigger>
        </TabsList>

        <TabsContent value="employees">
          <EmployeesTab
            branches={branches}
            isSuper={isSuper}
            fixedBranchId={fixedBranchId}
            fixedBranchName={user.branchName ?? ""}
            canCreate={canCreate}
            canEdit={canEdit}
            canDelete={canDelete}
          />
        </TabsContent>

        <TabsContent value="attendance">
          <AttendanceTab
            branches={branches}
            isSuper={isSuper}
            canRecord={canEdit}
            canApproveLeave={canApproveLeave}
          />
        </TabsContent>

        <TabsContent value="reports">
          <ReportsTab branches={branches} isSuper={isSuper} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─────────────────────── تب ۱: کارکنان ───────────────────────

type EmployeeFormState = {
  fullName: string;
  fatherName: string;
  phone: string;
  position: string;
  branchId: string;
  monthlySalary: string;
  startDate: string; // هجری
  isActive: boolean;
  note: string;
};

const EMPTY_EMPLOYEE_FORM: EmployeeFormState = {
  fullName: "",
  fatherName: "",
  phone: "",
  position: "",
  branchId: "",
  monthlySalary: "",
  startDate: dateToHijriInput(kabulNow()),
  isActive: true,
  note: "",
};

function EmployeesTab({
  branches,
  isSuper,
  fixedBranchId,
  fixedBranchName,
  canCreate,
  canEdit,
  canDelete,
}: {
  branches: BranchItem[];
  isSuper: boolean;
  fixedBranchId: string;
  fixedBranchName: string;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const list = useApiData<EmployeeItem[]>("/api/employees");
  const employees = list.data ?? [];

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeItem | null>(null);
  const [form, setForm] = useState<EmployeeFormState>(EMPTY_EMPLOYEE_FORM);
  const [saving, setSaving] = useState(false);

  const [deleting, setDeleting] = useState<EmployeeItem | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const detail = useApiData<EmployeeDetail>(detailId ? `/api/employees/${detailId}` : null);

  function openCreate() {
    setEditing(null);
    setForm({
      ...EMPTY_EMPLOYEE_FORM,
      branchId: isSuper ? "" : fixedBranchId,
      startDate: dateToHijriInput(kabulNow()),
    });
    setOpen(true);
  }

  function openEdit(e: EmployeeItem) {
    setEditing(e);
    setForm({
      fullName: e.fullName ?? "",
      fatherName: e.fatherName ?? "",
      phone: e.phone ?? "",
      position: e.position ?? "",
      branchId: e.branchId ?? fixedBranchId,
      monthlySalary: e.monthlySalary != null ? String(e.monthlySalary) : "",
      startDate: dateToHijriInput(e.startDate),
      isActive: e.isActive ?? true,
      note: e.note ?? "",
    });
    setOpen(true);
  }

  async function submit() {
    const fullName = form.fullName.trim();
    if (!fullName) {
      toast.error("نام و نام خانوادگی کارمند الزامی است");
      return;
    }
    const branchId = isSuper ? form.branchId : fixedBranchId;
    if (!branchId) {
      toast.error("انتخاب شعبه الزامی است");
      return;
    }
    const salary = Number(normalizeDigits(form.monthlySalary) || "0");
    if (!Number.isFinite(salary) || salary < 0) {
      toast.error("معاش ماهانه نامعتبر است");
      return;
    }
    const startISO = form.startDate.trim() ? hijriInputToISO(form.startDate) : isoToday();
    if (form.startDate.trim() && !startISO) {
      toast.error("تاریخ شروع به کار نامعتبر است — مثال: 1404/03/12");
      return;
    }
    setSaving(true);
    try {
      const res = await apiSend<unknown>(
        editing ? `/api/employees/${editing.id}` : "/api/employees",
        {
          method: editing ? "PUT" : "POST",
          body: {
            fullName,
            fatherName: form.fatherName.trim() || null,
            phone: form.phone.trim() || null,
            position: form.position.trim() || null,
            branchId,
            monthlySalary: salary,
            startDate: startISO,
            isActive: form.isActive,
            note: form.note.trim() || null,
          },
        }
      );
      if (isQueued(res)) {
        toast.info("به‌صورت آفلاین ذخیره شد؛ پس از اتصال همگام می‌شود");
      } else {
        toast.success(editing ? "معلومات کارمند ویرایش شد" : "کارمند جدید ثبت شد");
        void list.refetch();
      }
      setOpen(false);
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function submitDelete() {
    if (!deleting) return;
    setSaving(true);
    try {
      const res = await apiSend<unknown>(`/api/employees/${deleting.id}`, { method: "DELETE" });
      if (isQueued(res)) {
        toast.info("به‌صورت آفلاین ذخیره شد؛ پس از اتصال همگام می‌شود");
      } else {
        toast.success("کارمند و سوابق حاضری او حذف شد");
        void list.refetch();
      }
      setDeleting(null);
    } catch (e) {
      toast.error(errMessage(e));
      setDeleting(null);
    } finally {
      setSaving(false);
    }
  }

  const columns: Column<EmployeeItem>[] = [
    {
      key: "fullName",
      header: "نام و تخلص",
      render: (e) => (
        <div className="flex flex-col">
          <span className="font-semibold">{e.fullName}</span>
          {e.fatherName ? (
            <span className="text-xs text-muted-foreground">نام پدر: {e.fatherName}</span>
          ) : null}
        </div>
      ),
    },
    { key: "position", header: "سمت / وظیفه", render: (e) => e.position || "—" },
    { key: "branch", header: "شعبه", render: (e) => e.branch?.name ?? "—" },
    {
      key: "phone",
      header: "شماره تماس",
      render: (e) =>
        e.phone ? (
          <span dir="ltr" className="font-mono text-xs">{e.phone}</span>
        ) : (
          "—"
        ),
    },
    {
      key: "monthlySalary",
      header: "معاش ماهانه",
      render: (e) => <span className="font-semibold">{formatMoney(e.monthlySalary)}</span>,
    },
    {
      key: "startDate",
      header: "شروع به کار",
      render: (e) => formatHijriShort(e.startDate),
    },
    { key: "isActive", header: "وضعیت", render: (e) => <ActiveBadge active={e.isActive} /> },
    {
      key: "actions",
      header: "عملیات",
      sortable: false,
      render: (e) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="جزئیات"
            onClick={() => setDetailId(e.id)}
          >
            <Eye className="h-4 w-4" />
          </Button>
          {canEdit && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="ویرایش"
              onClick={() => openEdit(e)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {canDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-rose-600 hover:text-rose-700"
              title="حذف"
              onClick={() => setDeleting(e)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <Card className="border shadow-sm">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            کارکنان هر شعبه، معاش، تاریخ شروع به کار و وضعیت آنان — مدیر شعبه فقط کارکنان شعبهٔ خود را می‌بیند
          </p>
          {canCreate && (
            <Button
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={openCreate}
            >
              <Plus className="h-4 w-4" /> کارمند جدید
            </Button>
          )}
        </div>

        <DataTable
          columns={columns}
          rows={employees}
          loading={list.loading}
          searchKeys={["fullName", "fatherName", "position", "phone", "branch.name"]}
          searchPlaceholder="جستجوی کارمند..."
          emptyText="کارمندی ثبت نشده است"
          rowKey={(e) => e.id}
        />

        {/* ─── دیالوگ ثبت/ویرایش ─── */}
        <FormDialog
          open={open}
          onOpenChange={setOpen}
          title={editing ? `ویرایش کارمند «${editing.fullName}»` : "ثبت کارمند جدید"}
          description="معلومات کارمند را وارد کنید؛ کسر معاش بر اساس معاش ماهانه و حاضری محاسبه می‌شود"
          onSubmit={() => void submit()}
          submitting={saving}
        >
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="emp-fullName">نام و نام خانوادگی *</Label>
                <Input
                  id="emp-fullName"
                  value={form.fullName}
                  onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
                  placeholder="مثال: احمد کریمی"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="emp-fatherName">نام پدر</Label>
                <Input
                  id="emp-fatherName"
                  value={form.fatherName}
                  onChange={(e) => setForm((f) => ({ ...f, fatherName: e.target.value }))}
                  placeholder="مثال: محمد"
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="emp-phone">شماره تماس</Label>
                <Input
                  id="emp-phone"
                  dir="ltr"
                  className="font-mono"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="0700123456"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="emp-position">سمت / وظیفه</Label>
                <Input
                  id="emp-position"
                  value={form.position}
                  onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
                  placeholder="مثال: حسابدار، مسئول گدام"
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="emp-branch">شعبه *</Label>
                {isSuper ? (
                  <Select
                    value={form.branchId}
                    onValueChange={(v) => setForm((f) => ({ ...f, branchId: v }))}
                  >
                    <SelectTrigger id="emp-branch" className="w-full">
                      <SelectValue placeholder="شعبه را انتخاب کنید" />
                    </SelectTrigger>
                    <SelectContent>
                      {branches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input id="emp-branch" value={fixedBranchName} disabled />
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="emp-salary">معاش ماهانه (افغانی) *</Label>
                <Input
                  id="emp-salary"
                  dir="ltr"
                  type="number"
                  min={0}
                  value={form.monthlySalary}
                  onChange={(e) => setForm((f) => ({ ...f, monthlySalary: e.target.value }))}
                  placeholder="30000"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="emp-start">تاریخ شروع به کار (هجری)</Label>
                <Input
                  id="emp-start"
                  dir="ltr"
                  value={form.startDate}
                  onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                  placeholder="1404/03/12"
                />
                <p className="text-xs text-muted-foreground">
                  {hijriInputToISO(form.startDate)
                    ? `گریگوری: ${hijriInputToISO(form.startDate)}`
                    : "مثال: 1404/03/12"}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="emp-active">کارمند فعال</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  کارمند غیرفعال در ثبت حاضری و گزارش‌های معاش ظاهر نمی‌شود
                </p>
              </div>
              <Switch
                id="emp-active"
                checked={form.isActive}
                onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="emp-note">یادداشت</Label>
              <Input
                id="emp-note"
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="معلومات تکمیلی (اختیاری)"
              />
            </div>
          </div>
        </FormDialog>

        {/* ─── دیالوگ جزئیات ─── */}
        <FormDialog
          open={!!detailId}
          onOpenChange={(o) => !o && setDetailId(null)}
          title={`جزئیات کارمند — ${detail.data?.fullName ?? ""}`}
          description="معلومات و سوابق اخیر حاضری"
          submitLabel="بستن"
          onSubmit={() => setDetailId(null)}
        >
          {detail.data ? (
            <div className="grid gap-4">
              <div className="grid gap-2 rounded-md border p-3 text-sm sm:grid-cols-2">
                <p>نام و تخلص: <b>{detail.data.fullName}</b></p>
                <p>نام پدر: <b>{detail.data.fatherName || "—"}</b></p>
                <p>سمت: <b>{detail.data.position || "—"}</b></p>
                <p>شعبه: <b>{detail.data.branch?.name ?? "—"}</b></p>
                <p>
                  معاش ماهانه:{" "}
                  <b>
                    <span dir="ltr">{formatMoney(detail.data.monthlySalary)}</span>
                  </b>
                </p>
                <p>شروع به کار: <b>{formatHijriShort(detail.data.startDate)}</b></p>
                <p>
                  تماس:{" "}
                  {detail.data.phone ? (
                    <b dir="ltr" className="font-mono">{detail.data.phone}</b>
                  ) : (
                    "—"
                  )}
                </p>
                <p>
                  وضعیت: <ActiveBadge active={detail.data.isActive} />
                </p>
              </div>
              <div>
                <p className="mb-2 text-sm font-semibold">سوابق اخیر حاضری</p>
                <div className="max-h-64 overflow-y-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted">
                      <tr>
                        <th className="px-2 py-2 text-start font-semibold">تاریخ</th>
                        <th className="px-2 py-2 text-start font-semibold">وضعیت</th>
                        <th className="px-2 py-2 text-start font-semibold">یادداشت</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detail.data.attendance ?? []).length === 0 ? (
                        <tr>
                          <td colSpan={3} className="px-2 py-6 text-center text-muted-foreground">
                            سابقهٔ حاضری ثبت نشده است
                          </td>
                        </tr>
                      ) : (
                        (detail.data.attendance ?? []).map((r) => (
                          <tr key={r.id} className="border-t">
                            <td className="px-2 py-1.5">{formatHijriShort(r.date)}</td>
                            <td className="px-2 py-1.5">{statusBadge(r.status, r.leaveApproved)}</td>
                            <td className="px-2 py-1.5 text-muted-foreground">{r.note || "—"}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">در حال بارگیری...</p>
          )}
        </FormDialog>

        {/* ─── تأیید حذف ─── */}
        <ConfirmDialog
          open={!!deleting}
          onOpenChange={(o) => !o && setDeleting(null)}
          title="حذف کارمند"
          message={`حذف کارمند «${deleting?.fullName ?? ""}» و تمام سوابق حاضری او؟ این عملیات قابل بازگشت نیست.`}
          confirmLabel="حذف"
          danger
          onConfirm={() => void submitDelete()}
          submitting={saving}
        />
      </CardContent>
    </Card>
  );
}

// ─────────────────────── تب ۲: حاضری روزانه ───────────────────────

function AttendanceTab({
  branches,
  isSuper,
  canRecord,
  canApproveLeave,
}: {
  branches: BranchItem[];
  isSuper: boolean;
  canRecord: boolean;
  canApproveLeave: boolean;
}) {
  const [dateHijri, setDateHijri] = useState(() => dateToHijriInput(kabulNow()));
  const [branchSel, setBranchSel] = useState(() => (isSuper ? "all" : "own"));
  const [saving, setSaving] = useState(false);

  const dateISO = hijriInputToISO(dateHijri);
  const dateValid = !!dateISO;
  const isFuture = !!dateISO && dateISO > isoToday();

  const branchQ =
    isSuper && branchSel !== "all" ? `&branchId=${branchSel}` : "";

  const employeesList = useApiData<EmployeeItem[]>(
    dateValid ? `/api/employees?active=true${branchQ}` : null,
    [branchQ]
  );
  const recordsList = useApiData<AttRecord[]>(
    dateValid ? `/api/attendance?date=${dateISO}${branchQ}` : null,
    [dateISO, branchQ]
  );

  const [entries, setEntries] = useState<Record<string, EntryState>>({});

  // همگام‌سازی ورودی‌های محلی با دادهٔ سرور
  useEffect(() => {
    if (!employeesList.data) return;
    const rec = new Map((recordsList.data ?? []).map((r) => [r.employeeId, r]));
    const next: Record<string, EntryState> = {};
    for (const e of employeesList.data) {
      const r = rec.get(e.id);
      next[e.id] = {
        status: r?.status ?? "",
        leaveApproved: r ? r.leaveApproved : true,
        note: r?.note ?? "",
        dirty: false,
      };
    }
    setEntries(next);
  }, [employeesList.data, recordsList.data]);

  const employeeRows = employeesList.data ?? [];
  const dirtyCount = useMemo(
    () => Object.values(entries).filter((x) => x.dirty && x.status !== "").length,
    [entries]
  );
  const countedPresent = useMemo(
    () => Object.values(entries).filter((x) => x.status === "PRESENT").length,
    [entries]
  );
  const countedAbsent = useMemo(
    () => Object.values(entries).filter((x) => x.status === "ABSENT").length,
    [entries]
  );
  const countedLeave = useMemo(
    () => Object.values(entries).filter((x) => x.status === "LEAVE").length,
    [entries]
  );

  function setEntry(id: string, patch: Partial<EntryState>) {
    setEntries((cur) => ({
      ...cur,
      [id]: { ...cur[id], ...patch, dirty: true },
    }));
  }

  function setStatus(id: string, status: EntryState["status"]) {
    setEntries((cur) => ({
      ...cur,
      [id]: { ...cur[id], status, dirty: true },
    }));
  }

  function markAllPresent() {
    setEntries((cur) => {
      const next = { ...cur };
      for (const id of Object.keys(next)) {
        if (next[id].status !== "PRESENT") {
          next[id] = { ...next[id], status: "PRESENT", dirty: true };
        }
      }
      return next;
    });
  }

  async function save() {
    if (!dateISO) return;
    const records = Object.entries(entries)
      .filter(([, v]) => v.status !== "" && v.dirty)
      .map(([employeeId, v]) => ({
        employeeId,
        date: dateISO,
        status: v.status,
        leaveApproved: v.status === "LEAVE" ? v.leaveApproved : undefined,
        note: v.note.trim() || null,
      }));
    if (records.length === 0) {
      toast.info("تغییری برای ذخیره وجود ندارد");
      return;
    }
    setSaving(true);
    try {
      // ارسال دسته‌ای (حداکثر ۲۰۰ در هر درخواست)
      for (let i = 0; i < records.length; i += 200) {
        const chunk = records.slice(i, i + 200);
        const res = await apiSend<unknown>("/api/attendance", {
          method: "POST",
          body: { records: chunk },
        });
        if (isQueued(res)) {
          toast.info("به‌صورت آفلاین ذخیره شد؛ پس از اتصال همگام می‌شود");
        }
      }
      toast.success(`حاضری ${toPersianDigits(records.length)} کارمند برای این روز ثبت شد`);
      void recordsList.refetch();
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="border shadow-sm">
      <CardContent className="space-y-3 p-4">
        {/* فیلترها */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="grid gap-1">
            <Label htmlFor="att-date">تاریخ حاضری (هجری شمسی)</Label>
            <Input
              id="att-date"
              dir="ltr"
              className="w-36"
              value={dateHijri}
              onChange={(e) => setDateHijri(e.target.value)}
              placeholder="1404/03/12"
            />
            <p className="text-xs text-muted-foreground">
              {dateValid
                ? `گریگوری: ${dateISO} — ${formatHijriShort(`${dateISO}T00:00:00.000Z`)}`
                : "تاریخ نامعتبر — مثال: 1404/03/12"}
            </p>
          </div>
          {isSuper && (
            <div className="grid gap-1">
              <Label>شعبه</Label>
              <Select value={branchSel} onValueChange={setBranchSel}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">همهٔ شعبه‌ها</SelectItem>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDateHijri(dateToHijriInput(kabulNow()))}
            >
              امروز
            </Button>
            {canRecord && (
              <Button
                variant="outline"
                size="sm"
                onClick={markAllPresent}
                disabled={!dateValid || isFuture || employeeRows.length === 0}
              >
                <CheckCheck className="h-4 w-4" /> همه حاضر
              </Button>
            )}
          </div>
        </div>

        {isFuture && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            ثبت حاضری برای روز آینده امکان‌پذیر نیست.
          </p>
        )}

        {/* خلاصهٔ روز */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="outline" className={BADGE_TONES.emerald}>
            حاضر: {toPersianDigits(countedPresent)}
          </Badge>
          <Badge variant="outline" className={BADGE_TONES.rose}>
            غایب: {toPersianDigits(countedAbsent)}
          </Badge>
          <Badge variant="outline" className={BADGE_TONES.amber}>
            رخصتی: {toPersianDigits(countedLeave)}
          </Badge>
          <Badge variant="outline" className={BADGE_TONES.slate}>
            بدون ثبت:{" "}
            {toPersianDigits(
              employeeRows.length -
                (countedPresent + countedAbsent + countedLeave)
            )}
          </Badge>
        </div>

        {/* جدول ثبت حاضری */}
        <div className="max-h-96 overflow-y-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted">
              <tr>
                <th className="px-3 py-2 text-start font-semibold">کارمند</th>
                <th className="px-3 py-2 text-start font-semibold">سمت</th>
                <th className="px-3 py-2 text-start font-semibold">وضعیت</th>
                <th className="px-3 py-2 text-start font-semibold">تأیید رخصتی</th>
                <th className="px-3 py-2 text-start font-semibold">یادداشت</th>
              </tr>
            </thead>
            <tbody>
              {employeesList.loading || recordsList.loading ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                    در حال بارگیری...
                  </td>
                </tr>
              ) : employeeRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                    کارمند فعالی برای این شعبه ثبت نشده است
                  </td>
                </tr>
              ) : (
                employeeRows.map((e) => {
                  const entry = entries[e.id] ?? {
                    status: "",
                    leaveApproved: true,
                    note: "",
                    dirty: false,
                  };
                  return (
                    <tr key={e.id} className="border-t">
                      <td className="px-3 py-2">
                        <span className="font-semibold">{e.fullName}</span>
                        <span className="mr-2 text-xs text-muted-foreground">
                          {isSuper ? e.branch?.name : ""}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{e.position || "—"}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          {(
                            [
                              ["PRESENT", "حاضر", BADGE_TONES.emerald],
                              ["ABSENT", "غایب", BADGE_TONES.rose],
                              ["LEAVE", "رخصتی", BADGE_TONES.amber],
                            ] as const
                          ).map(([value, label, tone]) => (
                            <button
                              key={value}
                              type="button"
                              disabled={!canRecord || isFuture}
                              onClick={() => setStatus(e.id, value)}
                              className={
                                entry.status === value
                                  ? "rounded-md border px-2 py-1 text-xs font-bold " + tone
                                  : "rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
                              }
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {entry.status === "LEAVE" ? (
                          <label className="flex items-center gap-1.5 text-xs">
                            <Checkbox
                              checked={entry.leaveApproved}
                              disabled={!canRecord || !canApproveLeave || isFuture}
                              onCheckedChange={(v) =>
                                setEntry(e.id, { leaveApproved: v === true })
                              }
                              aria-label={`تأیید رخصتی ${e.fullName}`}
                            />
                            {entry.leaveApproved ? "تأییدشده" : "تأییدنشده"}
                          </label>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          className="h-8 w-full min-w-32 text-xs"
                          value={entry.note}
                          disabled={!canRecord || isFuture}
                          onChange={(ev) => setEntry(e.id, { note: ev.target.value })}
                          placeholder="یادداشت (اختیاری)"
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {canRecord && (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              رخصتی تأییدشده در محاسبهٔ کسر معاش حساب نمی‌شود؛ غایب و رخصتی تأییدنشده کسر می‌شود.
            </p>
            <Button
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => void save()}
              disabled={!dateValid || isFuture || dirtyCount === 0 || saving}
            >
              {saving ? "در حال ذخیره..." : `ذخیرهٔ حاضری (${toPersianDigits(dirtyCount)})`}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────── تب ۳: گزارش‌ها ───────────────────────

function ReportsTab({
  branches,
  isSuper,
}: {
  branches: BranchItem[];
  isSuper: boolean;
}) {
  const today = hijriToday();
  const [reportType, setReportType] = useState<ReportType>("payroll");
  const [branchSel, setBranchSel] = useState("all");

  // ورودی‌های مشترک
  const [yearHijri, setYearHijri] = useState(String(today.jy));
  const [monthSel, setMonthSel] = useState(today.jm);
  const [dateHijri, setDateHijri] = useState(dateToHijriInput(kabulNow()));
  const [fromHijri, setFromHijri] = useState(
    dateToHijriInput(
      (() => {
        const g = hijriToGregorian(today.jy, today.jm, 1);
        return new Date(g.gy, g.gm - 1, g.gd);
      })()
    )
  );
  const [toHijri, setToHijri] = useState(dateToHijriInput(kabulNow()));
  const [employeeSel, setEmployeeSel] = useState("all");
  const [statusSel, setStatusSel] = useState("all");

  const yearNum = Number(normalizeDigits(yearHijri) || "0");
  const yearValid = Number.isInteger(yearNum) && yearNum >= 1300 && yearNum <= 1600;

  const monthRange = yearValid ? hijriMonthRange(yearNum, monthSel) : null;
  const yearRange = yearValid ? hijriYearRange(yearNum) : null;
  const dateISO = hijriInputToISO(dateHijri);
  const fromISO = hijriInputToISO(fromHijri);
  const toISO = hijriInputToISO(toHijri);

  const branchQ = isSuper && branchSel !== "all" ? `&branchId=${branchSel}` : "";

  // کارمندها برای فیلتر گزارش بازه‌ای
  const employeesList = useApiData<EmployeeItem[]>("/api/employees?active=true");

  const summaryUrl = useMemo(() => {
    if (reportType === "payroll" && monthRange) {
      return `/api/attendance/summary?from=${monthRange.from}&to=${monthRange.to}${branchQ}`;
    }
    if (reportType === "yearly" && yearRange) {
      return `/api/attendance/summary?from=${yearRange.from}&to=${yearRange.to}${branchQ}`;
    }
    return null;
  }, [reportType, monthRange, yearRange, branchQ]);
  const summary = useApiData<SummaryResponse>(summaryUrl);

  const recordsUrl = useMemo(() => {
    if (reportType === "daily" && dateISO) {
      return `/api/attendance?date=${dateISO}${branchQ}`;
    }
    if (reportType === "range" && fromISO && toISO) {
      const empQ = employeeSel !== "all" ? `&employeeId=${employeeSel}` : "";
      const stQ = statusSel !== "all" ? `&status=${statusSel}` : "";
      return `/api/attendance?from=${fromISO}&to=${toISO}${branchQ}${empQ}${stQ}`;
    }
    return null;
  }, [reportType, dateISO, fromISO, toISO, branchQ, employeeSel, statusSel]);
  const records = useApiData<AttRecord[]>(recordsUrl);

  const summaryRows = summary.data?.rows ?? [];
  const recordRows = (records.data ?? []).slice().reverse(); // قدیمی → جدید

  return (
    <Card className="border shadow-sm">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="grid gap-1">
            <Label>نوع گزارش</Label>
            <Select value={reportType} onValueChange={(v) => setReportType(v as ReportType)}>
              <SelectTrigger className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="payroll">خلاصهٔ معاش ماهانه (کسر و قابل پرداخت)</SelectItem>
                <SelectItem value="daily">حاضری روزانه</SelectItem>
                <SelectItem value="yearly">حاضری و کسر سالانه</SelectItem>
                <SelectItem value="range">سوابق در بازهٔ انتخابی</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isSuper && (
            <div className="grid gap-1">
              <Label>شعبه</Label>
              <Select value={branchSel} onValueChange={setBranchSel}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">همهٔ شعبه‌ها</SelectItem>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {(reportType === "payroll" || reportType === "yearly") && (
            <div className="grid gap-1">
              <Label htmlFor="rep-year">سال هجری</Label>
              <Input
                id="rep-year"
                dir="ltr"
                className="w-24"
                value={yearHijri}
                onChange={(e) => setYearHijri(e.target.value)}
                placeholder="1404"
              />
            </div>
          )}

          {reportType === "payroll" && (
            <div className="grid gap-1">
              <Label>ماه هجری</Label>
              <Select
                value={String(monthSel)}
                onValueChange={(v) => setMonthSel(Number(v))}
              >
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HIJRI_MONTHS.map((m, i) => (
                    <SelectItem key={m} value={String(i + 1)}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {reportType === "daily" && (
            <div className="grid gap-1">
              <Label htmlFor="rep-date">تاریخ (هجری)</Label>
              <Input
                id="rep-date"
                dir="ltr"
                className="w-36"
                value={dateHijri}
                onChange={(e) => setDateHijri(e.target.value)}
                placeholder="1404/03/12"
              />
              <p className="text-xs text-muted-foreground">
                {dateISO ? `گریگوری: ${dateISO}` : "تاریخ نامعتبر"}
              </p>
            </div>
          )}

          {reportType === "range" && (
            <>
              <div className="grid gap-1">
                <Label htmlFor="rep-from">از تاریخ (هجری)</Label>
                <Input
                  id="rep-from"
                  dir="ltr"
                  className="w-36"
                  value={fromHijri}
                  onChange={(e) => setFromHijri(e.target.value)}
                  placeholder="1404/01/01"
                />
                <p className="text-xs text-muted-foreground">
                  {fromISO ? `گریگوری: ${fromISO}` : "نامعتبر"}
                </p>
              </div>
              <div className="grid gap-1">
                <Label htmlFor="rep-to">تا تاریخ (هجری)</Label>
                <Input
                  id="rep-to"
                  dir="ltr"
                  className="w-36"
                  value={toHijri}
                  onChange={(e) => setToHijri(e.target.value)}
                  placeholder="1404/03/12"
                />
                <p className="text-xs text-muted-foreground">
                  {toISO ? `گریگوری: ${toISO}` : "نامعتبر"}
                </p>
              </div>
              <div className="grid gap-1">
                <Label>کارمند</Label>
                <Select value={employeeSel} onValueChange={setEmployeeSel}>
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">همهٔ کارمندان</SelectItem>
                    {(employeesList.data ?? []).map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1">
                <Label>وضعیت</Label>
                <Select value={statusSel} onValueChange={setStatusSel}>
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">همه</SelectItem>
                    <SelectItem value="PRESENT">حاضر</SelectItem>
                    <SelectItem value="ABSENT">غایب</SelectItem>
                    <SelectItem value="LEAVE">رخصتی</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>

        {/* ─── گزارش خلاصهٔ معاش / سالانه ─── */}
        {summaryUrl ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <span className="font-semibold">
                {reportType === "payroll" ? "خلاصهٔ معاش ماهانه" : "حاضری و کسر سالانه"}
              </span>
              <span dir="ltr" className="text-xs text-muted-foreground">
                {summary.data ? `${formatHijriShort(summary.data.from)} — ${formatHijriShort(summary.data.to)}` : ""}
              </span>
              <Badge variant="outline" className={BADGE_TONES.slate}>
                روز مبنای محاسبه: {toPersianDigits(summary.data?.baseDays ?? 30)}
              </Badge>
              {summary.data && (
                <>
                  <Badge variant="outline" className={BADGE_TONES.emerald}>
                    مجموع معاشات: {formatMoney(summary.data.totals.monthlySalary)}
                  </Badge>
                  <Badge variant="outline" className={BADGE_TONES.rose}>
                    مجموع کسور: {formatMoney(summary.data.totals.deduction)}
                  </Badge>
                  <Badge variant="outline" className={BADGE_TONES.amber}>
                    مجموع قابل پرداخت: {formatMoney(summary.data.totals.payable)}
                  </Badge>
                </>
              )}
            </div>

            <DataTable
              columns={summaryColumns(isSuper)}
              rows={summaryRows}
              loading={summary.loading}
              searchKeys={["fullName", "branchName", "position"]}
              searchPlaceholder="جستجو در گزارش..."
              emptyText="برای این بازه کارمند یا سابقهٔ حاضری موجود نیست"
              rowKey={(r) => r.employeeId}
              pageSize={20}
              footer={
                summary.data
                  ? `کسر روزانهٔ هر کارمند = معاش ÷ ${summary.data.baseDays}`
                  : undefined
              }
            />
          </div>
        ) : null}

        {/* ─── گزارش سوابق / روزانه ─── */}
        {recordsUrl ? (
          <div className="space-y-2">
            <p className="text-sm font-semibold">
              {reportType === "daily"
                ? `حاضری روزانه — ${formatHijriShort(`${dateISO}T00:00:00.000Z`)}`
                : `سوابق حاضری از ${fromISO ? formatHijriShort(`${fromISO}T00:00:00.000Z`) : "—"} الی ${toISO ? formatHijriShort(`${toISO}T00:00:00.000Z`) : "—"}`}
            </p>
            <div className="max-h-96 overflow-y-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted">
                  <tr>
                    <th className="px-3 py-2 text-start font-semibold">تاریخ</th>
                    <th className="px-3 py-2 text-start font-semibold">کارمند</th>
                    {isSuper && (
                      <th className="px-3 py-2 text-start font-semibold">شعبه</th>
                    )}
                    <th className="px-3 py-2 text-start font-semibold">وضعیت</th>
                    <th className="px-3 py-2 text-start font-semibold">یادداشت</th>
                  </tr>
                </thead>
                <tbody>
                  {records.loading ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                        در حال بارگیری...
                      </td>
                    </tr>
                  ) : recordRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                        رکوردی برای این فیلترها ثبت نشده است
                      </td>
                    </tr>
                  ) : (
                    recordRows.map((r) => (
                      <tr key={r.id} className="border-t">
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          {formatHijriShort(r.date)}
                        </td>
                        <td className="px-3 py-1.5 font-semibold">{r.employee?.fullName ?? "—"}</td>
                        {isSuper && (
                          <td className="px-3 py-1.5">{r.branch?.name ?? "—"}</td>
                        )}
                        <td className="px-3 py-1.5">{statusBadge(r.status, r.leaveApproved)}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{r.note || "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {(records.data ?? []).length >= 5000 && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                نمایش حداکثر ۵۰۰۰ رکورد — بازهٔ کوچک‌تری انتخاب کنید.
              </p>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function summaryColumns(isSuper: boolean): Column<SummaryRow>[] {
  const cols: Column<SummaryRow>[] = [
    {
      key: "fullName",
      header: "کارمند",
      render: (r) => (
        <div className="flex flex-col">
          <span className="font-semibold">{r.fullName}</span>
          {r.position ? (
            <span className="text-xs text-muted-foreground">{r.position}</span>
          ) : null}
        </div>
      ),
    },
  ];
  if (isSuper) {
    cols.push({ key: "branchName", header: "شعبه", render: (r) => r.branchName });
  }
  cols.push(
    {
      key: "monthlySalary",
      header: "معاش ماهانه",
      render: (r) => formatMoney(r.monthlySalary),
    },
    { key: "present", header: "حاضر", render: (r) => formatNumber(r.present) },
    { key: "absent", header: "غایب", render: (r) => formatNumber(r.absent) },
    {
      key: "leave",
      header: "رخصتی",
      render: (r) => (
        <span>
          {toPersianDigits(r.leaveApproved)} تأییدشده
          {r.leaveUnapproved > 0 ? (
            <span className="text-rose-600 dark:text-rose-400">
              {" "}
              / {toPersianDigits(r.leaveUnapproved)} تأییدنشده
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "deductableDays",
      header: "روز کسر",
      render: (r) =>
        r.deductableDays > 0 ? (
          <span className="font-bold text-rose-700 dark:text-rose-400">
            {formatNumber(r.deductableDays)}
          </span>
        ) : (
          "۰"
        ),
    },
    {
      key: "deduction",
      header: "مبلغ کسر",
      render: (r) =>
        r.deduction > 0 ? (
          <span className="font-bold text-rose-700 dark:text-rose-400">
            {formatMoney(r.deduction)}
          </span>
        ) : (
          "۰"
        ),
    },
    {
      key: "payable",
      header: "معاش قابل پرداخت",
      render: (r) => <span className="font-bold">{formatMoney(r.payable)}</span>,
    }
  );
  return cols;
}
