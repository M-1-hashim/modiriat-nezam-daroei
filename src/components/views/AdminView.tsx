"use client";

/** مدیریت سیستم — تب‌های کاربران، رول‌ها (صلاحیت‌ها)، شعبه‌ها و گدام‌ها */

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useUser, PermissionGate } from "@/components/shared/use-user";
import { apiSend, useApiData } from "@/lib/client-api";
import { runBulkOperation, bulkResultMessage } from "@/lib/bulk";
import { PageHeader, BADGE_TONES } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FormDialog, ConfirmDialog } from "@/components/shared/form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ACTIONS,
  ACTION_LABELS,
  MODULES,
  MODULE_LABELS,
  type ModuleKey,
} from "@/lib/permissions";
import { formatHijriDateTime } from "@/lib/format";

// ─── انواع داده API ───

type UserRow = {
  id: string;
  username: string;
  fullName: string;
  roleId: string;
  branchId?: string | null;
  isActive?: boolean;
  lastLoginAt?: string | null;
  role?: { name?: string; key?: string } | null;
  branch?: { name?: string } | null;
  roleName?: string | null;
  branchName?: string | null;
  [key: string]: unknown;
};

type RoleRow = {
  id: string;
  name: string;
  key: string;
  permissions?: unknown;
  isSystem?: boolean;
  [key: string]: unknown;
};

type BranchRow = {
  id: string;
  code: string;
  name: string;
  city?: string | null;
  address?: string | null;
  phone?: string | null;
  isHeadOffice?: boolean;
  isActive?: boolean;
  [key: string]: unknown;
};

type WarehouseRow = {
  id: string;
  name: string;
  branchId?: string | null;
  location?: string | null;
  isMain?: boolean;
  isActive?: boolean;
  branch?: { name?: string } | null;
  branchName?: string | null;
  [key: string]: unknown;
};

type UserFormState = {
  fullName: string;
  username: string;
  password: string;
  roleId: string;
  branchId: string;
  isActive: boolean;
};

type RoleFormState = {
  id: string | null;
  name: string;
  key: string;
  perms: string[];
};

type BranchFormState = {
  id: string | null;
  code: string;
  name: string;
  city: string;
  address: string;
  phone: string;
  isHeadOffice: boolean;
  isActive: boolean;
};

type WarehouseFormState = {
  id: string | null;
  name: string;
  branchId: string;
  location: string;
  isMain: boolean;
  isActive: boolean;
};

// ─── هلپرهای مشترک ───

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

function parsePermissions(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string" && v.trim()) {
    try {
      const parsed: unknown = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === "string");
    } catch {
      return [v];
    }
  }
  return [];
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="p-4 pt-0">{children}</CardContent>
    </Card>
  );
}

function ActiveBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge variant="outline" className={BADGE_TONES.emerald}>
      فعال
    </Badge>
  ) : (
    <Badge variant="outline" className={BADGE_TONES.rose}>
      غیرفعال
    </Badge>
  );
}

function InlineError({ msg }: { msg: string }) {
  if (!msg) return null;
  return <p className="text-sm font-medium text-rose-600 dark:text-rose-400">{msg}</p>;
}

// ─── ویو اصلی ───

export default function AdminView() {
  return (
    <PermissionGate permission="admin.view">
      <AdminInner />
    </PermissionGate>
  );
}

function AdminInner() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="مدیریت سیستم"
        description="مدیریت کاربران، رول‌ها و صلاحیت‌ها، شعبه‌ها و گدام‌ها"
      />
      <Tabs defaultValue="users">
        <TabsList className="h-auto w-full flex-wrap">
          <TabsTrigger value="users">کاربران</TabsTrigger>
          <TabsTrigger value="roles">رول‌ها (صلاحیت‌ها)</TabsTrigger>
          <TabsTrigger value="branches">شعبه‌ها</TabsTrigger>
          <TabsTrigger value="warehouses">گدام‌ها</TabsTrigger>
        </TabsList>
        <TabsContent value="users">
          <UsersTab />
        </TabsContent>
        <TabsContent value="roles">
          <RolesTab />
        </TabsContent>
        <TabsContent value="branches">
          <BranchesTab />
        </TabsContent>
        <TabsContent value="warehouses">
          <WarehousesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── تب کاربران ───

const EMPTY_USER_FORM: UserFormState = {
  fullName: "",
  username: "",
  password: "",
  roleId: "",
  branchId: "",
  isActive: true,
};

function UsersTab() {
  const { user, hasPermission } = useUser();
  const { data: usersRaw, loading, error, refetch } = useApiData<unknown>("/api/users");
  const { data: rolesRaw } = useApiData<unknown>("/api/roles");
  const { data: branchesRaw } = useApiData<unknown>("/api/branches");

  const users = useMemo(() => asList<UserRow>(usersRaw), [usersRaw]);
  const roles = useMemo(() => asList<RoleRow>(rolesRaw), [rolesRaw]);
  const branches = useMemo(() => asList<BranchRow>(branchesRaw), [branchesRaw]);

  const canCreate = hasPermission("admin.create");
  const canEdit = hasPermission("admin.edit");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [form, setForm] = useState<UserFormState>(EMPTY_USER_FORM);
  const [formErr, setFormErr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [userSelectedIds, setUserSelectedIds] = useState<string[]>([]);
  const [bulkDeactivateOpen, setBulkDeactivateOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_USER_FORM, branchId: user.branchId ?? "" });
    setFormErr("");
    setOpen(true);
  };

  const openEdit = (u: UserRow) => {
    setEditing(u);
    setForm({
      fullName: u.fullName ?? "",
      username: u.username ?? "",
      password: "",
      roleId: u.roleId ?? "",
      branchId: u.branchId ?? user.branchId ?? "",
      isActive: u.isActive ?? true,
    });
    setFormErr("");
    setOpen(true);
  };

  const submit = async () => {
    if (!form.fullName.trim()) {
      setFormErr("نام کامل کاربر الزامی است");
      return;
    }
    if (!form.username.trim()) {
      setFormErr("نام کاربری الزامی است");
      return;
    }
    if (!editing && form.password.length < 6) {
      setFormErr("رمز عبور باید حداقل ۶ حرف باشد");
      return;
    }
    if (!form.roleId) {
      setFormErr("انتخاب رول الزامی است");
      return;
    }
    if (!editing && user.isSuperAdmin && !form.branchId) {
      setFormErr("انتخاب شعبه برای کاربر جدید الزامی است");
      return;
    }
    setFormErr("");
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        fullName: form.fullName.trim(),
        username: form.username.trim(),
        roleId: form.roleId,
        isActive: form.isActive,
      };
      if (user.isSuperAdmin && form.branchId) body.branchId = form.branchId;
      if (form.password) body.password = form.password;
      const res = await apiSend<unknown>(
        editing ? `/api/users/${editing.id}` : "/api/users",
        { method: editing ? "PUT" : "POST", body: JSON.stringify(body) }
      );
      if (isQueued(res)) {
        toast.info(OFFLINE_MSG);
      } else {
        toast.success(editing ? "معلومات کاربر ویرایش شد" : "کاربر جدید ایجاد شد");
        setOpen(false);
        void refetch();
      }
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (u: UserRow) => {
    setTogglingId(u.id);
    try {
      const res = await apiSend<unknown>(`/api/users/${u.id}`, {
        method: "PUT",
        body: JSON.stringify({ isActive: !(u.isActive ?? true) }),
      });
      if (isQueued(res)) {
        toast.info(OFFLINE_MSG);
      } else {
        toast.success((u.isActive ?? true) ? "کاربر غیرفعال شد" : "کاربر فعال شد");
        void refetch();
      }
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setTogglingId(null);
    }
  };

  const bulkSetActive = async (isActive: boolean) => {
    setBulkBusy(true);
    try {
      const result = await runBulkOperation(userSelectedIds, (id) =>
        apiSend<unknown>(`/api/users/${id}`, {
          method: "PUT",
          body: JSON.stringify({ isActive }),
        })
      );
      const msg = bulkResultMessage(
        isActive ? "فعال‌سازی گروهی کاربران" : "غیرفعال‌سازی گروهی کاربران",
        result
      );
      if (msg.tone === "success") toast.success(msg.message);
      else if (msg.tone === "warning") toast.warning(msg.message);
      else toast.error(msg.message);
      setUserSelectedIds([]);
      setBulkDeactivateOpen(false);
      void refetch();
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setBulkBusy(false);
    }
  };

  const columns: Column<UserRow>[] = [
    { key: "fullName", header: "نام", render: (r) => r.fullName ?? "—" },
    {
      key: "username",
      header: "نام کاربری",
      render: (r) => (
        <span dir="ltr" className="font-mono text-xs">
          {r.username}
        </span>
      ),
    },
    { key: "role", header: "رول", render: (r) => r.roleName ?? r.role?.name ?? "—" },
    { key: "branch", header: "شعبه", render: (r) => r.branchName ?? r.branch?.name ?? "—" },
    {
      key: "isActive",
      header: "وضعیت",
      render: (r) => <ActiveBadge active={r.isActive ?? true} />,
    },
    {
      key: "lastLoginAt",
      header: "آخرین ورود",
      render: (r) => (r.lastLoginAt ? formatHijriDateTime(r.lastLoginAt) : "—"),
    },
    {
      key: "actions",
      header: "عملیات",
      sortable: false,
      render: (r) =>
        canEdit ? (
          <div className="flex flex-wrap items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => openEdit(r)}>
              ویرایش
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={togglingId === r.id}
              onClick={() => void toggleActive(r)}
            >
              {(r.isActive ?? true) ? "غیرفعال" : "فعال"}
            </Button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <SectionCard title="کاربران سیستم" description="مدیریت حساب‌های کاربری و رول آن‌ها">
      <DataTable
        columns={columns}
        rows={users}
        searchKeys={["fullName", "username"]}
        searchPlaceholder="جستجوی نام یا نام کاربری..."
        loading={loading}
        rowKey={(r) => r.id}
        selectable
        getRowId={(r) => r.id}
        selectedIds={userSelectedIds}
        onSelectionChange={setUserSelectedIds}
        bulkActions={
          canEdit ? (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-7 border-rose-300 text-xs text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950"
                onClick={() => setBulkDeactivateOpen(true)}
              >
                غیرفعال‌سازی گروهی
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => void bulkSetActive(true)}
              >
                فعال‌سازی گروهی
              </Button>
            </>
          ) : null
        }
        emptyText="کاربری ثبت نشده است"
        toolbar={
          canCreate ? (
            <Button
              size="sm"
              onClick={openCreate}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              افزودن کاربر
            </Button>
          ) : null
        }
      />

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={editing ? "ویرایش کاربر" : "افزودن کاربر جدید"}
        description={editing ? `ویرایش معلومات «${editing.fullName}»` : "معلومات کاربر جدید را وارد کنید"}
        onSubmit={() => void submit()}
        submitting={submitting}
      >
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="user-fullName">نام کامل *</Label>
            <Input
              id="user-fullName"
              value={form.fullName}
              onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
              placeholder="مثال: احمد کریمی"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="user-username">نام کاربری *</Label>
            <Input
              id="user-username"
              dir="ltr"
              className="font-mono"
              value={form.username}
              disabled={!!editing}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              placeholder="ahmad.karimi"
            />
            {editing && (
              <p className="text-xs text-muted-foreground">نام کاربری پس از ایجاد قابل تغییر نیست</p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="user-password">
              {editing ? "رمز عبور جدید" : "رمز عبور *"}
            </Label>
            <Input
              id="user-password"
              dir="ltr"
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              placeholder={editing ? "برای تغییر رمز پر کنید" : "حداقل ۶ حرف"}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="user-role">رول *</Label>
            <Select
              value={form.roleId}
              onValueChange={(v) => setForm((f) => ({ ...f, roleId: v }))}
            >
              <SelectTrigger id="user-role" className="w-full">
                <SelectValue placeholder="رول را انتخاب کنید" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="user-branch">شعبه {!editing && "*"}</Label>
            {user.isSuperAdmin ? (
              <Select
                value={form.branchId}
                onValueChange={(v) => setForm((f) => ({ ...f, branchId: v }))}
              >
                <SelectTrigger id="user-branch" className="w-full">
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
              <>
                <Select value={user.branchId ?? ""} disabled>
                  <SelectTrigger id="user-branch" className="w-full">
                    <SelectValue placeholder={user.branchName ?? "شعبه شما"} />
                  </SelectTrigger>
                </Select>
                <p className="text-xs text-muted-foreground">
                  کاربران غیر-سوپرادمین فقط در شعبه خودشان ایجاد می‌شوند
                </p>
              </>
            )}
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label htmlFor="user-active">کاربر فعال</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                کاربر غیرفعال نمی‌تواند وارد سیستم شود
              </p>
            </div>
            <Switch
              id="user-active"
              checked={form.isActive}
              onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
            />
          </div>
          <InlineError msg={formErr} />
        </div>
      </FormDialog>

      <ConfirmDialog
        open={bulkDeactivateOpen}
        onOpenChange={(o) => !o && setBulkDeactivateOpen(false)}
        title="غیرفعال‌سازی گروهی کاربران"
        message={`غیرفعال‌سازی گروهی ${userSelectedIds.length.toLocaleString("en-US")} کاربر؟ کاربران غیرفعال نمی‌توانند وارد سیستم شوند. حساب کاربری خودتان قابل غیرفعال‌سازی نیست.`}
        confirmLabel="غیرفعال‌سازی"
        danger
        onConfirm={() => void bulkSetActive(false)}
        submitting={bulkBusy}
      />
    </SectionCard>
  );
}

// ─── تب رول‌ها ───

const EMPTY_ROLE_FORM: RoleFormState = { id: null, name: "", key: "", perms: [] };

function RolesTab() {
  const { hasPermission } = useUser();
  const { data: rolesRaw, loading, error, refetch } = useApiData<unknown>("/api/roles");
  const roles = useMemo(() => asList<RoleRow>(rolesRaw), [rolesRaw]);

  const canCreate = hasPermission("admin.create");
  const canEdit = hasPermission("admin.edit");
  const canDelete = hasPermission("admin.delete");

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<RoleFormState>(EMPTY_ROLE_FORM);
  const [formErr, setFormErr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RoleRow | null>(null);
  const [roleSelectedIds, setRoleSelectedIds] = useState<string[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const isStar = form.perms.includes("*");

  const openCreate = () => {
    setForm(EMPTY_ROLE_FORM);
    setFormErr("");
    setOpen(true);
  };

  const openEdit = (r: RoleRow) => {
    setForm({
      id: r.id,
      name: r.name ?? "",
      key: r.key ?? "",
      perms: parsePermissions(r.permissions),
    });
    setFormErr("");
    setOpen(true);
  };

  const togglePerm = (perm: string) => {
    setForm((f) => ({
      ...f,
      perms: f.perms.includes(perm)
        ? f.perms.filter((p) => p !== perm)
        : [...f.perms, perm],
    }));
  };

  const toggleModule = (m: ModuleKey) => {
    const all = ACTIONS.map((a) => `${m}.${a}`);
    setForm((f) => {
      const hasAll = all.every((p) => f.perms.includes(p));
      const perms = hasAll
        ? f.perms.filter((p) => !all.includes(p))
        : [...new Set([...f.perms, ...all])];
      return { ...f, perms };
    });
  };

  const toggleStar = (checked: boolean) => {
    setForm((f) => ({ ...f, perms: checked ? ["*"] : [] }));
  };

  const submit = async () => {
    if (!form.name.trim()) {
      setFormErr("نام رول الزامی است");
      return;
    }
    if (!form.id && !form.key.trim()) {
      setFormErr("کلید رول الزامی است (مثال: MANAGER)");
      return;
    }
    if (form.perms.length === 0) {
      setFormErr("حداقل یک صلاحیت انتخاب کنید");
      return;
    }
    setFormErr("");
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        permissions: form.perms,
      };
      if (!form.id) body.key = form.key.trim().toUpperCase();
      const res = await apiSend<unknown>(form.id ? `/api/roles/${form.id}` : "/api/roles", {
        method: form.id ? "PUT" : "POST",
        body: JSON.stringify(body),
      });
      if (isQueued(res)) {
        toast.info(OFFLINE_MSG);
      } else {
        toast.success(form.id ? "رول ویرایش شد" : "رول جدید ایجاد شد");
        setOpen(false);
        void refetch();
      }
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setSubmitting(true);
    try {
      const res = await apiSend<unknown>(`/api/roles/${deleteTarget.id}`, { method: "DELETE" });
      if (isQueued(res)) {
        toast.info(OFFLINE_MSG);
      } else {
        toast.success("رول حذف شد");
        setDeleteTarget(null);
        void refetch();
      }
    } catch (e) {
      toast.error(errMessage(e));
      setDeleteTarget(null);
    } finally {
      setSubmitting(false);
    }
  };

  const bulkDeleteRoles = async () => {
    setBulkBusy(true);
    try {
      const result = await runBulkOperation(roleSelectedIds, (id) =>
        apiSend<unknown>(`/api/roles/${id}`, { method: "DELETE" })
      );
      const msg = bulkResultMessage("حذف گروهی رول‌ها", result);
      if (msg.tone === "success") toast.success(msg.message);
      else if (msg.tone === "warning") toast.warning(msg.message);
      else toast.error(msg.message);
      setRoleSelectedIds([]);
      setBulkDeleteOpen(false);
      void refetch();
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setBulkBusy(false);
    }
  };

  const columns: Column<RoleRow>[] = [
    { key: "name", header: "نام رول", render: (r) => r.name ?? "—" },
    {
      key: "key",
      header: "کلید",
      render: (r) => (
        <span dir="ltr" className="font-mono text-xs">
          {r.key}
        </span>
      ),
    },
    {
      key: "permCount",
      header: "تعداد صلاحیت‌ها",
      render: (r) => {
        const perms = parsePermissions(r.permissions);
        if (perms.includes("*")) {
          return <Badge variant="outline" className={BADGE_TONES.emerald}>دسترسی کامل (سوپرادمین)</Badge>;
        }
        return <Badge variant="outline" className={BADGE_TONES.slate}>{perms.length} صلاحیت</Badge>;
      },
    },
    {
      key: "isSystem",
      header: "نوع",
      render: (r) =>
        r.isSystem ? (
          <Badge variant="outline" className={BADGE_TONES.amber}>سیستمی</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">عادی</span>
        ),
    },
    {
      key: "actions",
      header: "عملیات",
      sortable: false,
      render: (r) => (
        <div className="flex flex-wrap items-center gap-1">
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => openEdit(r)}>
              ویرایش
            </Button>
          )}
          {canDelete && !r.isSystem && (
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
    <SectionCard
      title="رول‌ها و صلاحیت‌ها"
      description="تعریف نقش‌های کاری و تعیین صلاحیت دقیق هر نقش"
    >
      <DataTable
        columns={columns}
        rows={roles}
        searchKeys={["name", "key"]}
        searchPlaceholder="جستجوی رول..."
        loading={loading}
        rowKey={(r) => r.id}
        selectable
        getRowId={(r) => r.id}
        selectedIds={roleSelectedIds}
        onSelectionChange={setRoleSelectedIds}
        bulkActions={
          canDelete ? (
            <Button
              variant="outline"
              size="sm"
              className="h-7 border-rose-300 text-xs text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950"
              onClick={() => setBulkDeleteOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              حذف گروهی
            </Button>
          ) : null
        }
        emptyText="رولی ثبت نشده است"
        toolbar={
          canCreate ? (
            <Button
              size="sm"
              onClick={openCreate}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              افزودن رول
            </Button>
          ) : null
        }
      />

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        wide
        title={form.id ? "ویرایش رول" : "افزودن رول جدید"}
        description="صلاحیت‌های این رول را تعیین کنید"
        onSubmit={() => void submit()}
        submitting={submitting}
      >
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="role-name">نام رول *</Label>
              <Input
                id="role-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="مثال: مدیر شعبه"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="role-key">کلید رول {!form.id && "*"}</Label>
              <Input
                id="role-key"
                dir="ltr"
                className="font-mono"
                value={form.key}
                disabled={!!form.id}
                onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))}
                placeholder="BRANCH_MANAGER"
              />
              {form.id && (
                <p className="text-xs text-muted-foreground">کلید پس از ایجاد قابل تغییر نیست</p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border border-brand/40 bg-brand-soft p-3 dark:border-brand/40 dark:bg-brand-soft/60">
            <div>
              <Label htmlFor="role-star">دسترسی کامل (سوپرادمین)</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                با فعال شدن این گزینه، رول به همه بخش‌ها دسترسی دارد و جدول صلاحیت‌ها غیرفعال می‌شود
              </p>
            </div>
            <Checkbox
              id="role-star"
              checked={isStar}
              onCheckedChange={(v) => toggleStar(v === true)}
            />
          </div>

          <div
            className={`grid gap-2 rounded-md border p-3 ${isStar ? "pointer-events-none opacity-50" : ""}`}
            aria-disabled={isStar}
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">صلاحیت‌ها ({form.perms.filter((p) => p !== "*").length})</p>
              <button
                type="button"
                className="text-xs text-brand-soft-foreground underline-offset-2 hover:underline dark:text-brand-soft-foreground"
                onClick={() => toggleStar(false)}
              >
                پاک کردن همه
              </button>
            </div>
            {MODULES.map((m) => {
              const all = ACTIONS.map((a) => `${m}.${a}`);
              const hasAll = all.every((p) => form.perms.includes(p));
              return (
                <div key={m} className="rounded-md border p-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      className="text-sm font-medium hover:text-brand-soft-foreground dark:hover:text-brand-soft-foreground"
                      onClick={() => toggleModule(m)}
                      title="انتخاب/لغو همه صلاحیت‌های این ماژول"
                    >
                      {MODULE_LABELS[m]}
                    </button>
                    <button
                      type="button"
                      className="text-xs text-brand-soft-foreground underline-offset-2 hover:underline dark:text-brand-soft-foreground"
                      onClick={() => toggleModule(m)}
                    >
                      {hasAll ? "لغو انتخاب همه" : "انتخاب همه"}
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                    {ACTIONS.map((a) => {
                      const perm = `${m}.${a}`;
                      return (
                        <label
                          key={perm}
                          htmlFor={`perm-${perm}`}
                          className="flex cursor-pointer items-center gap-1.5 text-xs"
                        >
                          <Checkbox
                            id={`perm-${perm}`}
                            checked={form.perms.includes(perm)}
                            onCheckedChange={() => togglePerm(perm)}
                          />
                          {ACTION_LABELS[a]}
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <InlineError msg={formErr} />
        </div>
      </FormDialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="حذف رول"
        message={`آیا از حذف رول «${deleteTarget?.name ?? ""}» مطمئن هستید؟ این عملیات قابل بازگشت نیست.`}
        confirmLabel="حذف"
        danger
        onConfirm={() => void doDelete()}
        submitting={submitting}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={(o) => !o && setBulkDeleteOpen(false)}
        title="حذف گروهی رول‌ها"
        message={`حذف گروهی ${roleSelectedIds.length.toLocaleString("en-US")} رول؟ رول‌های سیستمی یا تخصیص‌یافته به کاربران حذف نمی‌شوند.`}
        confirmLabel="حذف"
        danger
        onConfirm={() => void bulkDeleteRoles()}
        submitting={bulkBusy}
      />
    </SectionCard>
  );
}

// ─── تب شعبه‌ها ───

const EMPTY_BRANCH_FORM: BranchFormState = {
  id: null,
  code: "",
  name: "",
  city: "",
  address: "",
  phone: "",
  isHeadOffice: false,
  isActive: true,
};

function BranchesTab() {
  const { user, hasPermission } = useUser();
  const { data: branchesRaw, loading, error, refetch } = useApiData<unknown>("/api/branches");
  const branches = useMemo(() => asList<BranchRow>(branchesRaw), [branchesRaw]);

  const isSuper = user.isSuperAdmin;
  const canCreate = isSuper && hasPermission("admin.create");
  const canEdit = isSuper && hasPermission("admin.edit");
  const canDelete = isSuper && hasPermission("admin.delete");

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<BranchFormState>(EMPTY_BRANCH_FORM);
  const [formErr, setFormErr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BranchRow | null>(null);
  const [branchSelectedIds, setBranchSelectedIds] = useState<string[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const openCreate = () => {
    setForm(EMPTY_BRANCH_FORM);
    setFormErr("");
    setOpen(true);
  };

  const openEdit = (b: BranchRow) => {
    setForm({
      id: b.id,
      code: b.code ?? "",
      name: b.name ?? "",
      city: b.city ?? "",
      address: b.address ?? "",
      phone: b.phone ?? "",
      isHeadOffice: b.isHeadOffice ?? false,
      isActive: b.isActive ?? true,
    });
    setFormErr("");
    setOpen(true);
  };

  const submit = async () => {
    if (!form.code.trim()) {
      setFormErr("کد شعبه الزامی است");
      return;
    }
    if (!form.name.trim()) {
      setFormErr("نام شعبه الزامی است");
      return;
    }
    setFormErr("");
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        code: form.code.trim(),
        name: form.name.trim(),
        city: form.city.trim() || undefined,
        address: form.address.trim() || undefined,
        phone: form.phone.trim() || undefined,
        isHeadOffice: form.isHeadOffice,
        isActive: form.isActive,
      };
      const res = await apiSend<unknown>(
        form.id ? `/api/branches/${form.id}` : "/api/branches",
        { method: form.id ? "PUT" : "POST", body: JSON.stringify(body) }
      );
      if (isQueued(res)) {
        toast.info(OFFLINE_MSG);
      } else {
        toast.success(form.id ? "شعبه ویرایش شد" : "شعبه جدید ایجاد شد");
        setOpen(false);
        void refetch();
      }
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setSubmitting(true);
    try {
      const res = await apiSend<unknown>(`/api/branches/${deleteTarget.id}`, { method: "DELETE" });
      if (isQueued(res)) {
        toast.info(OFFLINE_MSG);
      } else {
        toast.success("شعبه حذف/غیرفعال شد");
        setDeleteTarget(null);
        void refetch();
      }
    } catch (e) {
      toast.error(errMessage(e));
      setDeleteTarget(null);
    } finally {
      setSubmitting(false);
    }
  };

  const bulkDeleteBranches = async () => {
    setBulkBusy(true);
    try {
      const result = await runBulkOperation(branchSelectedIds, (id) =>
        apiSend<unknown>(`/api/branches/${id}`, { method: "DELETE" })
      );
      const msg = bulkResultMessage("حذف گروهی شعبه‌ها", result);
      if (msg.tone === "success") toast.success(msg.message);
      else if (msg.tone === "warning") toast.warning(msg.message);
      else toast.error(msg.message);
      setBranchSelectedIds([]);
      setBulkDeleteOpen(false);
      void refetch();
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setBulkBusy(false);
    }
  };

  const columns: Column<BranchRow>[] = [
    { key: "name", header: "نام", render: (r) => r.name ?? "—" },
    {
      key: "code",
      header: "کد",
      render: (r) => (
        <span dir="ltr" className="font-mono text-xs">
          {r.code}
        </span>
      ),
    },
    { key: "city", header: "شهر", render: (r) => r.city || "—" },
    {
      key: "phone",
      header: "تلفن",
      render: (r) =>
        r.phone ? (
          <span dir="ltr" className="font-mono text-xs">
            {r.phone}
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "isHeadOffice",
      header: "نوع",
      render: (r) =>
        r.isHeadOffice ? (
          <Badge variant="outline" className={BADGE_TONES.emerald}>دفتر مرکزی</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">شعبه</span>
        ),
    },
    {
      key: "isActive",
      header: "وضعیت",
      render: (r) => <ActiveBadge active={r.isActive ?? true} />,
    },
    {
      key: "actions",
      header: "عملیات",
      sortable: false,
      render: (r) =>
        canEdit || canDelete ? (
          <div className="flex flex-wrap items-center gap-1">
            {canEdit && (
              <Button variant="outline" size="sm" onClick={() => openEdit(r)}>
                ویرایش
              </Button>
            )}
            {canDelete && !r.isHeadOffice && (
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
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <SectionCard title="شعبه‌ها" description="مدیریت شعبه‌ها و دفتر مرکزی شرکت">
      <DataTable
        columns={columns}
        rows={branches}
        searchKeys={["code", "name", "city"]}
        searchPlaceholder="جستجوی شعبه..."
        loading={loading}
        rowKey={(r) => r.id}
        selectable
        getRowId={(r) => r.id}
        selectedIds={branchSelectedIds}
        onSelectionChange={setBranchSelectedIds}
        bulkActions={
          canDelete ? (
            <Button
              variant="outline"
              size="sm"
              className="h-7 border-rose-300 text-xs text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950"
              onClick={() => setBulkDeleteOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              حذف گروهی
            </Button>
          ) : null
        }
        emptyText="شعبه‌ای ثبت نشده است"
        toolbar={
          canCreate ? (
            <Button
              size="sm"
              onClick={openCreate}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              افزودن شعبه
            </Button>
          ) : null
        }
      />
      {!isSuper && (
        <p className="mt-2 text-xs text-muted-foreground">
          ایجاد و ویرایش شعبه‌ها فقط توسط سوپرادمین امکان‌پذیر است
        </p>
      )}

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={form.id ? "ویرایش شعبه" : "افزودن شعبه جدید"}
        onSubmit={() => void submit()}
        submitting={submitting}
      >
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="branch-code">کد شعبه *</Label>
              <Input
                id="branch-code"
                dir="ltr"
                className="font-mono"
                value={form.code}
                disabled={!!form.id}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                placeholder="KBL"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="branch-name">نام شعبه *</Label>
              <Input
                id="branch-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="مثال: شعبه کابل"
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="branch-city">شهر</Label>
              <Input
                id="branch-city"
                value={form.city}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                placeholder="کابل"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="branch-phone">تلفن</Label>
              <Input
                id="branch-phone"
                dir="ltr"
                className="font-mono"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="+93 700 000 000"
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="branch-address">آدرس</Label>
            <Input
              id="branch-address"
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label htmlFor="branch-ho">دفتر مرکزی</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                این شعبه دفتر مرکزی شرکت است
              </p>
            </div>
            <Switch
              id="branch-ho"
              checked={form.isHeadOffice}
              onCheckedChange={(v) => setForm((f) => ({ ...f, isHeadOffice: v }))}
            />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label htmlFor="branch-active">شعبه فعال</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                شعبه غیرفعال در عملیات روزانه قابل انتخاب نیست
              </p>
            </div>
            <Switch
              id="branch-active"
              checked={form.isActive}
              onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
            />
          </div>
          <InlineError msg={formErr} />
        </div>
      </FormDialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="حذف شعبه"
        message={`آیا از حذف شعبه «${deleteTarget?.name ?? ""}» مطمئن هستید؟ اگر شعبه داده داشته باشد، به‌جای حذف غیرفعال می‌شود.`}
        confirmLabel="حذف"
        danger
        onConfirm={() => void doDelete()}
        submitting={submitting}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={(o) => !o && setBulkDeleteOpen(false)}
        title="حذف گروهی شعبه‌ها"
        message={`حذف گروهی ${branchSelectedIds.length.toLocaleString("en-US")} شعبه؟ شعبه‌های دارای سند به‌جای حذف غیرفعال می‌شوند.`}
        confirmLabel="حذف"
        danger
        onConfirm={() => void bulkDeleteBranches()}
        submitting={bulkBusy}
      />
    </SectionCard>
  );
}

// ─── تب گدام‌ها ───

const EMPTY_WAREHOUSE_FORM: WarehouseFormState = {
  id: null,
  name: "",
  branchId: "",
  location: "",
  isMain: false,
  isActive: true,
};

function WarehousesTab() {
  const { user, hasPermission } = useUser();
  const { data: whRaw, loading, error, refetch } = useApiData<unknown>("/api/warehouses");
  const { data: branchesRaw } = useApiData<unknown>("/api/branches");
  const warehouses = useMemo(() => asList<WarehouseRow>(whRaw), [whRaw]);
  const branches = useMemo(() => asList<BranchRow>(branchesRaw), [branchesRaw]);

  const isSuper = user.isSuperAdmin;
  const canCreate = hasPermission("admin.create");
  const canEdit = hasPermission("admin.edit");
  const canDelete = hasPermission("admin.delete");

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<WarehouseFormState>(EMPTY_WAREHOUSE_FORM);
  const [formErr, setFormErr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WarehouseRow | null>(null);
  const [whSelectedIds, setWhSelectedIds] = useState<string[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const openCreate = () => {
    setForm({ ...EMPTY_WAREHOUSE_FORM, branchId: user.branchId ?? "" });
    setFormErr("");
    setOpen(true);
  };

  const openEdit = (w: WarehouseRow) => {
    setForm({
      id: w.id,
      name: w.name ?? "",
      branchId: w.branchId ?? user.branchId ?? "",
      location: w.location ?? "",
      isMain: w.isMain ?? false,
      isActive: w.isActive ?? true,
    });
    setFormErr("");
    setOpen(true);
  };

  const submit = async () => {
    if (!form.name.trim()) {
      setFormErr("نام گدام الزامی است");
      return;
    }
    if (!form.branchId) {
      setFormErr("انتخاب شعبه الزامی است");
      return;
    }
    setFormErr("");
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        branchId: form.branchId,
        location: form.location.trim() || undefined,
        isMain: form.isMain,
        isActive: form.isActive,
      };
      const res = await apiSend<unknown>(
        form.id ? `/api/warehouses/${form.id}` : "/api/warehouses",
        { method: form.id ? "PUT" : "POST", body: JSON.stringify(body) }
      );
      if (isQueued(res)) {
        toast.info(OFFLINE_MSG);
      } else {
        toast.success(form.id ? "گدام ویرایش شد" : "گدام جدید ایجاد شد");
        setOpen(false);
        void refetch();
      }
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setSubmitting(true);
    try {
      const res = await apiSend<unknown>(`/api/warehouses/${deleteTarget.id}`, { method: "DELETE" });
      if (isQueued(res)) {
        toast.info(OFFLINE_MSG);
      } else {
        toast.success("گدام حذف شد");
        setDeleteTarget(null);
        void refetch();
      }
    } catch (e) {
      toast.error(errMessage(e));
      setDeleteTarget(null);
    } finally {
      setSubmitting(false);
    }
  };

  const bulkDeleteWarehouses = async () => {
    setBulkBusy(true);
    try {
      const result = await runBulkOperation(whSelectedIds, (id) =>
        apiSend<unknown>(`/api/warehouses/${id}`, { method: "DELETE" })
      );
      const msg = bulkResultMessage("حذف گروهی گدام‌ها", result);
      if (msg.tone === "success") toast.success(msg.message);
      else if (msg.tone === "warning") toast.warning(msg.message);
      else toast.error(msg.message);
      setWhSelectedIds([]);
      setBulkDeleteOpen(false);
      void refetch();
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setBulkBusy(false);
    }
  };

  const columns: Column<WarehouseRow>[] = [
    { key: "name", header: "نام", render: (r) => r.name ?? "—" },
    { key: "branch", header: "شعبه", render: (r) => r.branchName ?? r.branch?.name ?? "—" },
    { key: "location", header: "موقعیت", render: (r) => r.location || "—" },
    {
      key: "isMain",
      header: "نوع",
      render: (r) =>
        r.isMain ? (
          <Badge variant="outline" className={BADGE_TONES.emerald}>گدام اصلی</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">عادی</span>
        ),
    },
    {
      key: "isActive",
      header: "وضعیت",
      render: (r) => <ActiveBadge active={r.isActive ?? true} />,
    },
    {
      key: "actions",
      header: "عملیات",
      sortable: false,
      render: (r) =>
        canEdit || canDelete ? (
          <div className="flex flex-wrap items-center gap-1">
            {canEdit && (
              <Button variant="outline" size="sm" onClick={() => openEdit(r)}>
                ویرایش
              </Button>
            )}
            {canDelete && !r.isMain && (
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
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <SectionCard title="گدام‌ها" description="مدیریت گدام‌های هر شعبه">
      <DataTable
        columns={columns}
        rows={warehouses}
        searchKeys={["name", "location"]}
        searchPlaceholder="جستجوی گدام..."
        loading={loading}
        rowKey={(r) => r.id}
        selectable
        getRowId={(r) => r.id}
        selectedIds={whSelectedIds}
        onSelectionChange={setWhSelectedIds}
        bulkActions={
          canDelete ? (
            <Button
              variant="outline"
              size="sm"
              className="h-7 border-rose-300 text-xs text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950"
              onClick={() => setBulkDeleteOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              حذف گروهی
            </Button>
          ) : null
        }
        emptyText="گدامی ثبت نشده است"
        toolbar={
          canCreate ? (
            <Button
              size="sm"
              onClick={openCreate}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              افزودن گدام
            </Button>
          ) : null
        }
      />

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={form.id ? "ویرایش گدام" : "افزودن گدام جدید"}
        onSubmit={() => void submit()}
        submitting={submitting}
      >
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="wh-name">نام گدام *</Label>
            <Input
              id="wh-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="مثال: گدام مرکزی"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="wh-branch">شعبه *</Label>
            {isSuper ? (
              <Select
                value={form.branchId}
                onValueChange={(v) => setForm((f) => ({ ...f, branchId: v }))}
              >
                <SelectTrigger id="wh-branch" className="w-full">
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
              <>
                <Select value={user.branchId ?? ""} disabled>
                  <SelectTrigger id="wh-branch" className="w-full">
                    <SelectValue placeholder={user.branchName ?? "شعبه شما"} />
                  </SelectTrigger>
                </Select>
                <p className="text-xs text-muted-foreground">
                  گدام فقط در شعبه خود شما ایجاد می‌شود
                </p>
              </>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="wh-location">موقعیت</Label>
            <Input
              id="wh-location"
              value={form.location}
              onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
              placeholder="مثال: طبقه دوم، بلوک الف"
            />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label htmlFor="wh-main">گدام اصلی</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                گدام پیش‌فرض شعبه برای خرید و فروش
              </p>
            </div>
            <Switch
              id="wh-main"
              checked={form.isMain}
              onCheckedChange={(v) => setForm((f) => ({ ...f, isMain: v }))}
            />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label htmlFor="wh-active">گدام فعال</Label>
            </div>
            <Switch
              id="wh-active"
              checked={form.isActive}
              onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
            />
          </div>
          <InlineError msg={formErr} />
        </div>
      </FormDialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="حذف گدام"
        message={`آیا از حذف گدام «${deleteTarget?.name ?? ""}» مطمئن هستید؟ گدام دارای موجودی قابل حذف نیست.`}
        confirmLabel="حذف"
        danger
        onConfirm={() => void doDelete()}
        submitting={submitting}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={(o) => !o && setBulkDeleteOpen(false)}
        title="حذف گروهی گدام‌ها"
        message={`حذف گروهی ${whSelectedIds.length.toLocaleString("en-US")} گدام؟ گدام‌های دارای موجودی یا اسناد به‌جای حذف غیرفعال می‌شوند.`}
        confirmLabel="حذف"
        danger
        onConfirm={() => void bulkDeleteWarehouses()}
        submitting={bulkBusy}
      />
    </SectionCard>
  );
}
