"use client";

/** ویوی مناطق و فروشندگان — مدیریت مناطق فروش و فروشندگان با اتصال مناطق */

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Map, Pencil, Plus, Trash2, Users } from "lucide-react";
import { PermissionGate, useUser } from "@/components/shared/use-user";
import { BADGE_TONES, PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { ConfirmDialog, FormDialog } from "@/components/shared/form-dialog";
import { apiSend, useApiData } from "@/lib/client-api";
import { runBulkOperation, bulkResultMessage } from "@/lib/bulk";
import { formatNumber, formatPct } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type BranchItem = { id: string; name: string; code?: string | null };
type UserItem = { id: string; fullName: string; username: string };

type TerritoryItem = {
  id: string;
  name: string;
  description?: string | null;
  branchId?: string | null;
  branch?: { id: string; name: string } | null;
  isActive?: boolean | null;
  customersCount?: number | null;
  _count?: { customers?: number } | null;
};

type SalespersonItem = {
  id: string;
  name: string;
  phone?: string | null;
  commission?: number | null;
  branchId?: string | null;
  branch?: { id: string; name: string } | null;
  userId?: string | null;
  isActive?: boolean | null;
  territories?: { id: string; name: string }[] | null;
};

type DeleteTarget = { kind: "territory" | "salesperson"; id: string; name: string };

function listOf<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)) {
    return (data as { items: T[] }).items;
  }
  return [];
}

function qs(params: Record<string, string | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

function isQueued(res: unknown): res is { queued: true; localId: string } {
  return typeof res === "object" && res !== null && "queued" in res;
}

function territoryCustomers(t: TerritoryItem): number | null {
  if (typeof t.customersCount === "number") return t.customersCount;
  const c = t._count?.customers;
  return typeof c === "number" ? c : null;
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">
        {label}
        {required && <span className="text-rose-600"> *</span>}
      </Label>
      {children}
    </div>
  );
}

function ActiveBadge({ active }: { active?: boolean | null }) {
  return active === false ? (
    <Badge variant="outline" className={BADGE_TONES.slate}>
      غیرفعال
    </Badge>
  ) : (
    <Badge variant="outline" className={BADGE_TONES.emerald}>
      فعال
    </Badge>
  );
}

export default function PersonnelView() {
  const { user, hasPermission } = useUser();
  const isSuper = user.isSuperAdmin;
  const fixedBranchId = user.branchId ?? "";

  // داده‌ها
  const { data: terrData, loading: terrLoading, refetch: refetchTerr } =
    useApiData<unknown>("/api/territories");
  const territories = listOf<TerritoryItem>(terrData);

  const { data: spData, loading: spLoading, refetch: refetchSp } =
    useApiData<unknown>("/api/salespersons");
  const salespersons = listOf<SalespersonItem>(spData);

  const { data: brData } = useApiData<unknown>(isSuper ? "/api/branches" : null);
  const branches = listOf<BranchItem>(brData);

  const [spOpen, setSpOpen] = useState(false);
  const { data: userData } = useApiData<unknown>(
    spOpen ? `/api/users${qs({ branchId: user.branchId ?? undefined })}` : null
  );
  const users = listOf<UserItem>(userData);

  // دیالوگ منطقه
  const [terrOpen, setTerrOpen] = useState(false);
  const [terrEditing, setTerrEditing] = useState<TerritoryItem | null>(null);
  const [terrName, setTerrName] = useState("");
  const [terrDesc, setTerrDesc] = useState("");
  const [terrBranch, setTerrBranch] = useState("");

  // دیالوگ فروشنده
  const [spEditing, setSpEditing] = useState<SalespersonItem | null>(null);
  const [spName, setSpName] = useState("");
  const [spPhone, setSpPhone] = useState("");
  const [spCommission, setSpCommission] = useState("");
  const [spBranch, setSpBranch] = useState("");
  const [spUser, setSpUser] = useState("none");
  const [spTerritories, setSpTerritories] = useState<string[]>([]);

  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
  const [saving, setSaving] = useState(false);

  // انتخاب گروهی
  const [terrSelectedIds, setTerrSelectedIds] = useState<string[]>([]);
  const [spSelectedIds, setSpSelectedIds] = useState<string[]>([]);
  const [bulkConfirm, setBulkConfirm] = useState<"territory" | "salesperson" | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const spBranchValue = isSuper ? spBranch : fixedBranchId;
  const branchTerritories = useMemo(() => {
    return territories.filter((t) => {
      if (!spBranchValue) return true;
      const tBranch = t.branchId ?? t.branch?.id;
      return !tBranch || tBranch === spBranchValue;
    });
  }, [territories, spBranchValue]);

  // ─── مناطق ───
  function openTerrCreate() {
    setTerrEditing(null);
    setTerrName("");
    setTerrDesc("");
    setTerrBranch(isSuper ? "" : fixedBranchId);
    setTerrOpen(true);
  }

  function openTerrEdit(t: TerritoryItem) {
    setTerrEditing(t);
    setTerrName(t.name ?? "");
    setTerrDesc(t.description ?? "");
    setTerrBranch(t.branchId ?? t.branch?.id ?? fixedBranchId);
    setTerrOpen(true);
  }

  async function submitTerritory() {
    const name = terrName.trim();
    if (!name) {
      toast.error("نام منطقه الزامی است");
      return;
    }
    const branchId = isSuper ? terrBranch : fixedBranchId;
    if (isSuper && !branchId) {
      toast.error("انتخاب شعبه الزامی است");
      return;
    }
    setSaving(true);
    try {
      const res = await apiSend<unknown>(
        terrEditing ? `/api/territories/${terrEditing.id}` : "/api/territories",
        {
          method: terrEditing ? "PUT" : "POST",
          body: { name, description: terrDesc.trim() || null, branchId },
        }
      );
      if (isQueued(res)) {
        toast.info("به‌صورت آفلاین ذخیره شد؛ پس از اتصال همگام می‌شود");
      } else {
        toast.success(terrEditing ? "منطقه ویرایش شد" : "منطقه جدید ثبت شد");
        void refetchTerr();
      }
      setTerrOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ذخیره ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  const terrColumns: Column<TerritoryItem>[] = [
    {
      key: "name",
      header: "نام منطقه",
      render: (t) => <span className="font-semibold">{t.name}</span>,
    },
    { key: "branch", header: "شعبه", render: (t) => t.branch?.name ?? "—" },
    { key: "description", header: "توضیحات", render: (t) => t.description ?? "—" },
    {
      key: "customers",
      header: "تعداد مشتریان",
      render: (t) => {
        const c = territoryCustomers(t);
        return c == null ? "—" : formatNumber(c);
      },
    },
    { key: "isActive", header: "وضعیت", render: (t) => <ActiveBadge active={t.isActive} /> },
    {
      key: "actions",
      header: "عملیات",
      sortable: false,
      render: (t) => (
        <div className="flex items-center gap-1">
          {hasPermission("personnel.edit") && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="ویرایش"
              onClick={() => openTerrEdit(t)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {hasPermission("personnel.delete") && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-rose-600 hover:text-rose-700"
              title="حذف"
              onClick={() => setDeleting({ kind: "territory", id: t.id, name: t.name })}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  // ─── فروشندگان ───
  function openSpCreate() {
    setSpEditing(null);
    setSpName("");
    setSpPhone("");
    setSpCommission("");
    setSpBranch(isSuper ? "" : fixedBranchId);
    setSpUser("none");
    setSpTerritories([]);
    setSpOpen(true);
  }

  function openSpEdit(s: SalespersonItem) {
    setSpEditing(s);
    setSpName(s.name ?? "");
    setSpPhone(s.phone ?? "");
    setSpCommission(s.commission != null ? String(s.commission) : "");
    setSpBranch(s.branchId ?? s.branch?.id ?? fixedBranchId);
    setSpUser(s.userId ?? "none");
    setSpTerritories((s.territories ?? []).map((t) => t.id));
    setSpOpen(true);
  }

  function toggleSpTerritory(id: string, on: boolean) {
    setSpTerritories((cur) =>
      on ? (cur.includes(id) ? cur : [...cur, id]) : cur.filter((x) => x !== id)
    );
  }

  async function submitSalesperson() {
    const name = spName.trim();
    if (!name) {
      toast.error("نام فروشنده الزامی است");
      return;
    }
    const branchId = isSuper ? spBranch : fixedBranchId;
    if (isSuper && !branchId) {
      toast.error("انتخاب شعبه الزامی است");
      return;
    }
    const commission = Number(spCommission);
    setSaving(true);
    try {
      const res = await apiSend<unknown>(
        spEditing ? `/api/salespersons/${spEditing.id}` : "/api/salespersons",
        {
          method: spEditing ? "PUT" : "POST",
          body: {
            name,
            phone: spPhone.trim() || null,
            commission: Number.isFinite(commission) ? commission : 0,
            branchId,
            territoryIds: spTerritories,
            userId: spUser === "none" ? null : spUser,
          },
        }
      );
      if (isQueued(res)) {
        toast.info("به‌صورت آفلاین ذخیره شد؛ پس از اتصال همگام می‌شود");
      } else {
        toast.success(spEditing ? "فروشنده ویرایش شد" : "فروشنده جدید ثبت شد");
        void refetchSp();
      }
      setSpOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ذخیره ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  const spColumns: Column<SalespersonItem>[] = [
    {
      key: "name",
      header: "نام",
      render: (s) => <span className="font-semibold">{s.name}</span>,
    },
    {
      key: "phone",
      header: "تلفن",
      render: (s) =>
        s.phone ? (
          <span dir="ltr" className="font-mono text-xs">
            {s.phone}
          </span>
        ) : (
          "—"
        ),
    },
    { key: "branch", header: "شعبه", render: (s) => s.branch?.name ?? "—" },
    {
      key: "territories",
      header: "مناطق",
      render: (s) =>
        (s.territories?.length ?? 0) === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <div className="flex max-w-56 flex-wrap gap-1">
            {(s.territories ?? []).map((t) => (
              <Badge key={t.id} variant="outline" className={BADGE_TONES.amber}>
                {t.name}
              </Badge>
            ))}
          </div>
        ),
    },
    {
      key: "commission",
      header: "کمیشن",
      render: (s) => formatPct(Number(s.commission ?? 0)),
    },
    { key: "isActive", header: "وضعیت", render: (s) => <ActiveBadge active={s.isActive} /> },
    {
      key: "actions",
      header: "عملیات",
      sortable: false,
      render: (s) => (
        <div className="flex items-center gap-1">
          {hasPermission("personnel.edit") && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="ویرایش"
              onClick={() => openSpEdit(s)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {hasPermission("personnel.delete") && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-rose-600 hover:text-rose-700"
              title="حذف"
              onClick={() => setDeleting({ kind: "salesperson", id: s.id, name: s.name })}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  // ─── حذف مشترک ───
  async function submitDelete() {
    if (!deleting) return;
    setSaving(true);
    try {
      const res = await apiSend<unknown>(
        deleting.kind === "territory"
          ? `/api/territories/${deleting.id}`
          : `/api/salespersons/${deleting.id}`,
        { method: "DELETE" }
      );
      if (isQueued(res)) {
        toast.info("به‌صورت آفلاین ذخیره شد؛ پس از اتصال همگام می‌شود");
      } else {
        toast.success("عملیات حذف انجام شد");
        void refetchTerr();
        void refetchSp();
      }
      setDeleting(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "حذف ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  // ─── حذف گروهی ───
  async function bulkDeleteTerritories() {
    setBulkBusy(true);
    try {
      const result = await runBulkOperation(terrSelectedIds, (id) =>
        apiSend<unknown>(`/api/territories/${id}`, { method: "DELETE" })
      );
      const msg = bulkResultMessage("حذف گروهی مناطق", result);
      if (msg.tone === "success") toast.success(msg.message);
      else if (msg.tone === "warning") toast.warning(msg.message);
      else toast.error(msg.message);
      setTerrSelectedIds([]);
      setBulkConfirm(null);
      void refetchTerr();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "حذف گروهی ناموفق بود");
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkDeleteSalespersons() {
    setBulkBusy(true);
    try {
      const result = await runBulkOperation(spSelectedIds, (id) =>
        apiSend<unknown>(`/api/salespersons/${id}`, { method: "DELETE" })
      );
      const msg = bulkResultMessage("حذف گروهی فروشندگان", result);
      if (msg.tone === "success") toast.success(msg.message);
      else if (msg.tone === "warning") toast.warning(msg.message);
      else toast.error(msg.message);
      setSpSelectedIds([]);
      setBulkConfirm(null);
      void refetchSp();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "حذف گروهی ناموفق بود");
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <PermissionGate permission="personnel.view">
      <div className="space-y-4">
        <PageHeader
          title="مناطق و فروشندگان"
          description="ساختار فروش شعبه: تعریف مناطق جغرافیایی و فروشندگان مرتبط با هر منطقه"
        />

        <Tabs defaultValue="territories" className="gap-3">
          <TabsList>
            <TabsTrigger value="territories">
              <Map className="h-4 w-4" /> مناطق
            </TabsTrigger>
            <TabsTrigger value="salespersons">
              <Users className="h-4 w-4" /> فروشندگان
            </TabsTrigger>
          </TabsList>

          {/* ─── تب مناطق ─── */}
          <TabsContent value="territories">
            <Card className="border shadow-sm">
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-muted-foreground">
                    مناطق فروش برای تفکیک مشتریان و فروشندگان هر شعبه استفاده می‌شود
                  </p>
                  {hasPermission("personnel.create") && (
                    <Button
                      className="bg-primary text-primary-foreground hover:bg-primary/90"
                      onClick={openTerrCreate}
                    >
                      <Plus className="h-4 w-4" /> منطقه جدید
                    </Button>
                  )}
                </div>
                <DataTable
                  columns={terrColumns}
                  rows={territories}
                  loading={terrLoading}
                  searchKeys={["name", "description", "branch.name"]}
                  searchPlaceholder="جستجوی منطقه..."
                  emptyText="منطقه‌ای ثبت نشده است"
                  rowKey={(t) => t.id}
                  selectable
                  getRowId={(t) => t.id}
                  selectedIds={terrSelectedIds}
                  onSelectionChange={setTerrSelectedIds}
                  bulkActions={
                    hasPermission("personnel.delete") ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 border-rose-300 text-xs text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950"
                        onClick={() => setBulkConfirm("territory")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        حذف گروهی
                      </Button>
                    ) : null
                  }
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* ─── تب فروشندگان ─── */}
          <TabsContent value="salespersons">
            <Card className="border shadow-sm">
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-muted-foreground">
                    زنجیره ساختار فروش: شعبه → منطقه → فروشنده → مشتریان → فروش
                  </p>
                  {hasPermission("personnel.create") && (
                    <Button
                      className="bg-primary text-primary-foreground hover:bg-primary/90"
                      onClick={openSpCreate}
                    >
                      <Plus className="h-4 w-4" /> فروشنده جدید
                    </Button>
                  )}
                </div>
                <DataTable
                  columns={spColumns}
                  rows={salespersons}
                  loading={spLoading}
                  searchKeys={["name", "phone", "branch.name"]}
                  searchPlaceholder="جستجوی فروشنده..."
                  emptyText="فروشنده‌ای ثبت نشده است"
                  rowKey={(s) => s.id}
                  selectable
                  getRowId={(s) => s.id}
                  selectedIds={spSelectedIds}
                  onSelectionChange={setSpSelectedIds}
                  bulkActions={
                    hasPermission("personnel.delete") ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 border-rose-300 text-xs text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950"
                        onClick={() => setBulkConfirm("salesperson")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        حذف گروهی
                      </Button>
                    ) : null
                  }
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* دیالوگ منطقه */}
        <FormDialog
          open={terrOpen}
          onOpenChange={(o) => {
            if (!o) setTerrOpen(false);
          }}
          title={terrEditing ? "ویرایش منطقه" : "منطقه جدید"}
          description="نام و توضیحات منطقه فروش"
          onSubmit={submitTerritory}
          submitting={saving}
        >
          <div className="space-y-3">
            {isSuper ? (
              <Field label="شعبه" required>
                <Select value={terrBranch || "none"} onValueChange={(v) => setTerrBranch(v === "none" ? "" : v)}>
                  <SelectTrigger className="w-full bg-background">
                    <SelectValue placeholder="انتخاب شعبه" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none" disabled>
                      — انتخاب شعبه —
                    </SelectItem>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : (
              <div className="rounded-md border bg-muted/40 p-2.5 text-sm">
                <span className="text-xs text-muted-foreground">شعبه: </span>
                {user.branchName ?? "—"}
              </div>
            )}
            <Field label="نام منطقه" required>
              <Input
                value={terrName}
                onChange={(e) => setTerrName(e.target.value)}
                placeholder="مثلاً کارته نو"
                autoFocus
              />
            </Field>
            <Field label="توضیحات">
              <Input
                value={terrDesc}
                onChange={(e) => setTerrDesc(e.target.value)}
                placeholder="اختیاری"
              />
            </Field>
          </div>
        </FormDialog>

        {/* دیالوگ فروشنده */}
        <FormDialog
          open={spOpen}
          onOpenChange={(o) => {
            if (!o) setSpOpen(false);
          }}
          title={spEditing ? "ویرایش فروشنده" : "فروشنده جدید"}
          description="معلومات فروشنده، کمیشن و مناطق تحت پوشش"
          wide
          onSubmit={submitSalesperson}
          submitting={saving}
        >
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="نام فروشنده" required>
                <Input
                  value={spName}
                  onChange={(e) => setSpName(e.target.value)}
                  placeholder="مثلاً احمد نظری"
                  autoFocus
                />
              </Field>
              <Field label="شماره تلفن">
                <Input
                  dir="ltr"
                  value={spPhone}
                  onChange={(e) => setSpPhone(e.target.value)}
                  placeholder="0700 000 000"
                />
              </Field>
              <Field label="کمیشن (٪)">
                <Input
                  dir="ltr"
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  value={spCommission}
                  onChange={(e) => setSpCommission(e.target.value)}
                  placeholder="0"
                />
              </Field>
              {isSuper ? (
                <Field label="شعبه" required>
                  <Select
                    value={spBranch || "none"}
                    onValueChange={(v) => setSpBranch(v === "none" ? "" : v)}
                  >
                    <SelectTrigger className="w-full bg-background">
                      <SelectValue placeholder="انتخاب شعبه" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none" disabled>
                        — انتخاب شعبه —
                      </SelectItem>
                      {branches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : (
                <div className="self-end rounded-md border bg-muted/40 p-2.5 text-sm">
                  <span className="text-xs text-muted-foreground">شعبه: </span>
                  {user.branchName ?? "—"}
                </div>
              )}
              <Field label="اتصال به کاربر سیستم (اختیاری)">
                <Select value={spUser} onValueChange={setSpUser}>
                  <SelectTrigger className="w-full bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— بدون اتصال —</SelectItem>
                    {users.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.fullName} ({u.username})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="مناطق تحت پوشش">
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
                {branchTerritories.length === 0 ? (
                  <p className="p-2 text-xs text-muted-foreground">
                    برای این شعبه منطقه‌ای ثبت نشده — ابتدا از تب «مناطق» منطقه اضافه کنید
                  </p>
                ) : (
                  branchTerritories.map((t) => (
                    <label
                      key={t.id}
                      className="flex cursor-pointer items-center gap-2 rounded p-1.5 text-sm hover:bg-muted/50"
                    >
                      <Checkbox
                        checked={spTerritories.includes(t.id)}
                        onCheckedChange={(v) => toggleSpTerritory(t.id, v === true)}
                      />
                      <span>{t.name}</span>
                    </label>
                  ))
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {spTerritories.length} منطقه انتخاب شده
              </p>
            </Field>
          </div>
        </FormDialog>

        {/* تأیید حذف */}
        <ConfirmDialog
          open={deleting !== null}
          onOpenChange={(o) => {
            if (!o) setDeleting(null);
          }}
          title="تأیید حذف"
          message={
            deleting
              ? `آیا از حذف «${deleting.name}» مطمئن هستید؟ در صورت داشتن سوابق مرتبط، رکورد غیرفعال می‌شود.`
              : ""
          }
          confirmLabel="حذف"
          danger
          onConfirm={submitDelete}
          submitting={saving}
        />

        {/* تأیید حذف گروهی */}
        <ConfirmDialog
          open={bulkConfirm !== null}
          onOpenChange={(o) => {
            if (!o) setBulkConfirm(null);
          }}
          title={bulkConfirm === "salesperson" ? "حذف گروهی فروشندگان" : "حذف گروهی مناطق"}
          message={
            bulkConfirm === "salesperson"
              ? `حذف گروهی ${spSelectedIds.length.toLocaleString("en-US")} فروشنده؟ در صورت داشتن فاکتور یا مشتری، رکورد به‌جای حذف غیرفعال می‌شود.`
              : `حذف گروهی ${terrSelectedIds.length.toLocaleString("en-US")} منطقه؟ در صورت داشتن مشتری، رکورد به‌جای حذف غیرفعال می‌شود.`
          }
          confirmLabel="حذف"
          danger
          onConfirm={() => {
            if (bulkConfirm === "salesperson") void bulkDeleteSalespersons();
            else if (bulkConfirm === "territory") void bulkDeleteTerritories();
          }}
          submitting={bulkBusy}
        />
      </div>
    </PermissionGate>
  );
}
