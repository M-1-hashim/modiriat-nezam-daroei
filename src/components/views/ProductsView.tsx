"use client";

/** ویوی ادویه و اجناس — فهرست، ایجاد، ویرایش، غیرفعال‌سازی و حذف محصولات */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Power, Trash2 } from "lucide-react";
import { PermissionGate, useUser } from "@/components/shared/use-user";
import { BADGE_TONES, PageHeader } from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { ConfirmDialog, FormDialog } from "@/components/shared/form-dialog";
import { apiSend, useApiData } from "@/lib/client-api";
import { runBulkOperation, bulkResultMessage } from "@/lib/bulk";
import { formatMoney, formatNumber } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

type Ref = { id: string; name: string };

type ProductItem = {
  id: string;
  name: string;
  genericName?: string | null;
  categoryId?: string | null;
  category?: Ref | null;
  manufacturerId?: string | null;
  manufacturer?: Ref | null;
  country?: string | null;
  dosageForm?: string | null;
  strength?: string | null;
  unit?: string | null;
  packaging?: string | null;
  barcode?: string | null;
  storeCondition?: string | null;
  purchasePrice?: number | null;
  salePrice?: number | null;
  minStock?: number | null;
  maxStock?: number | null;
  isActive?: boolean | null;
  stockTotal?: number | null;
};

type ProductForm = {
  name: string;
  genericName: string;
  categoryId: string;
  manufacturerId: string;
  country: string;
  dosageForm: string;
  strength: string;
  unit: string;
  packaging: string;
  barcode: string;
  storeCondition: string;
  purchasePrice: string;
  salePrice: string;
  minStock: string;
  maxStock: string;
};

const DOSAGE_FORMS = [
  "تبلت",
  "کپسول",
  "شربت",
  "سرم",
  "انجکشن",
  "کریم",
  "قطره",
  "پماد",
  "سایر",
];

const EMPTY_FORM: ProductForm = {
  name: "",
  genericName: "",
  categoryId: "",
  manufacturerId: "",
  country: "",
  dosageForm: "",
  strength: "",
  unit: "عدد",
  packaging: "",
  barcode: "",
  storeCondition: "",
  purchasePrice: "",
  salePrice: "",
  minStock: "",
  maxStock: "",
};

function listOf<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)) {
    return (data as { items: T[] }).items;
  }
  return [];
}

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    sp.set(k, v === true ? "1" : String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

function isQueued(res: unknown): res is { queued: true; localId: string } {
  return typeof res === "object" && res !== null && "queued" in res;
}

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
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

export default function ProductsView() {
  const { hasPermission } = useUser();

  // فیلترها
  const [catFilter, setCatFilter] = useState("all");
  const [manFilter, setManFilter] = useState("all");
  const [includeInactive, setIncludeInactive] = useState(false);

  const productsPath = `/api/products${qs({
    categoryId: catFilter !== "all" ? catFilter : "",
    manufacturerId: manFilter !== "all" ? manFilter : "",
    includeInactive: includeInactive,
  })}`;
  const { data: productsData, loading, error, refetch } = useApiData<unknown>(productsPath);
  const products = listOf<ProductItem>(productsData);

  const { data: catData, refetch: refetchCats } = useApiData<unknown>("/api/categories");
  const categories = listOf<Ref>(catData);
  const { data: manData, refetch: refetchMans } = useApiData<unknown>("/api/manufacturers");
  const manufacturers = listOf<Ref>(manData);

  // فرم ایجاد/ویرایش
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProductItem | null>(null);
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // حذف
  const [deleting, setDeleting] = useState<ProductItem | null>(null);
  const [busy, setBusy] = useState(false);

  // انتخاب گروهی
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState<null | "delete" | "activate" | "deactivate">(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  // پاک‌سازی انتخاب‌ها اگر ردیف‌ها حذف/فیلتر شده باشند
  useEffect(() => {
    if (selectedIds.length === 0) return;
    const existing = new Set(products.map((p) => p.id));
    const next = selectedIds.filter((id) => existing.has(id));
    if (next.length !== selectedIds.length) setSelectedIds(next);
  }, [products, selectedIds]);

  // افزودن سریع کتگوری/سازنده
  const [quickAdd, setQuickAdd] = useState<null | "category" | "manufacturer">(null);
  const [quickName, setQuickName] = useState("");
  const [quickCountry, setQuickCountry] = useState("");
  const [quickSaving, setQuickSaving] = useState(false);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  }

  function openEdit(p: ProductItem) {
    setEditing(p);
    setForm({
      name: p.name ?? "",
      genericName: p.genericName ?? "",
      categoryId: p.category?.id ?? p.categoryId ?? "",
      manufacturerId: p.manufacturer?.id ?? p.manufacturerId ?? "",
      country: p.country ?? "",
      dosageForm: p.dosageForm ?? "",
      strength: p.strength ?? "",
      unit: p.unit ?? "عدد",
      packaging: p.packaging ?? "",
      barcode: p.barcode ?? "",
      storeCondition: p.storeCondition ?? "",
      purchasePrice: p.purchasePrice != null ? String(p.purchasePrice) : "",
      salePrice: p.salePrice != null ? String(p.salePrice) : "",
      minStock: p.minStock != null ? String(p.minStock) : "",
      maxStock: p.maxStock != null ? String(p.maxStock) : "",
    });
    setFormOpen(true);
  }

  async function submitForm() {
    if (!form.name.trim()) {
      toast.error("نام محصول الزامی است");
      return;
    }
    setSaving(true);
    const body = {
      name: form.name.trim(),
      genericName: form.genericName.trim() || null,
      categoryId: form.categoryId || null,
      manufacturerId: form.manufacturerId || null,
      country: form.country.trim() || null,
      dosageForm: form.dosageForm || null,
      strength: form.strength.trim() || null,
      unit: form.unit.trim() || "عدد",
      packaging: form.packaging.trim() || null,
      barcode: form.barcode.trim() || null,
      storeCondition: form.storeCondition.trim() || null,
      purchasePrice: num(form.purchasePrice),
      salePrice: num(form.salePrice),
      minStock: num(form.minStock),
      maxStock: num(form.maxStock),
    };
    try {
      const res = await apiSend<unknown>(
        editing ? `/api/products/${editing.id}` : "/api/products",
        { method: editing ? "PUT" : "POST", body }
      );
      if (isQueued(res)) {
        toast.info("به‌صورت آفلاین ذخیره شد؛ پس از اتصال همگام می‌شود");
        setFormOpen(false);
      } else {
        toast.success(editing ? "محصول ویرایش شد" : "محصول جدید ثبت شد");
        setFormOpen(false);
        refetch();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ذخیره ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row: ProductItem) {
    try {
      const res = await apiSend<unknown>(`/api/products/${row.id}`, {
        method: "PUT",
        body: { isActive: row.isActive === false },
      });
      if (isQueued(res)) {
        toast.info("به‌صورت آفلاین ذخیره شد؛ پس از اتصال همگام می‌شود");
      } else {
        toast.success(row.isActive === false ? "محصول فعال شد" : "محصول غیرفعال شد");
        refetch();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "عملیات ناموفق بود");
    }
  }

  async function submitDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      const res = await apiSend<unknown>(`/api/products/${deleting.id}`, { method: "DELETE" });
      if (isQueued(res)) {
        toast.info("به‌صورت آفلاین ذخیره شد؛ پس از اتصال همگام می‌شود");
      } else {
        toast.success("محصول حذف شد (در صورت داشتن سوابق، غیرفعال گردید)");
      }
      setDeleting(null);
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "حذف ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  /** عملیات گروهی روی محصولات انتخاب‌شده — بازاستفاده از endpointهای تک‌رکورد */
  async function runBulk(kind: "delete" | "activate" | "deactivate") {
    if (selectedIds.length === 0) return;
    setBulkBusy(true);
    try {
      const result = await runBulkOperation(selectedIds, (id) =>
        kind === "delete"
          ? apiSend(`/api/products/${id}`, { method: "DELETE" })
          : apiSend(`/api/products/${id}`, {
              method: "PUT",
              body: { isActive: kind === "activate" },
            }),
      );
      const msg = bulkResultMessage(
        kind === "delete"
          ? "حذف گروهی"
          : kind === "activate"
            ? "فعال‌سازی گروهی"
            : "غیرفعال‌سازی گروهی",
        result,
      );
      if (msg.tone === "success") toast.success(msg.message);
      else if (msg.tone === "warning") toast.warning(msg.message);
      else toast.error(msg.message);
      setSelectedIds([]);
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "عملیات گروهی ناموفق بود");
    } finally {
      setBulkBusy(false);
      setBulkAction(null);
    }
  }

  async function submitQuickAdd() {
    if (!quickAdd) return;
    const name = quickName.trim();
    if (!name) {
      toast.error("نام را وارد کنید");
      return;
    }
    setQuickSaving(true);
    const path = quickAdd === "category" ? "/api/categories" : "/api/manufacturers";
    const body: Record<string, string | null> = { name };
    if (quickAdd === "manufacturer" && quickCountry.trim()) body.country = quickCountry.trim();
    try {
      const res = await apiSend<Ref>(path, { method: "POST", body });
      if (isQueued(res)) {
        toast.info("به‌صورت آفلاین ذخیره شد؛ پس از اتصال همگام می‌شود");
      } else {
        toast.success(quickAdd === "category" ? "کتگوری جدید ثبت شد" : "سازنده جدید ثبت شد");
        if (quickAdd === "category") {
          void refetchCats();
          setForm((f) => ({ ...f, categoryId: res.id }));
        } else {
          void refetchMans();
          setForm((f) => ({ ...f, manufacturerId: res.id }));
        }
      }
      setQuickAdd(null);
      setQuickName("");
      setQuickCountry("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ثبت ناموفق بود");
    } finally {
      setQuickSaving(false);
    }
  }

  const columns: Column<ProductItem>[] = [
    {
      key: "name",
      header: "نام محصول",
      render: (row) => (
        <div className="min-w-36">
          <span className="font-semibold">{row.name}</span>
          {row.genericName && (
            <span className="block text-xs text-muted-foreground">{row.genericName}</span>
          )}
        </div>
      ),
    },
    { key: "category", header: "کتگوری", render: (row) => row.category?.name ?? "—" },
    {
      key: "manufacturer",
      header: "سازنده",
      render: (row) => row.manufacturer?.name ?? "—",
    },
    {
      key: "dosage",
      header: "شکل/مقدار",
      render: (row) =>
        [row.dosageForm, row.strength].filter(Boolean).join(" ") || "—",
    },
    { key: "unit", header: "واحد", render: (row) => row.unit ?? "—" },
    {
      key: "purchasePrice",
      header: "قیمت خرید",
      render: (row) => (
        <span className="whitespace-nowrap">{formatMoney(row.purchasePrice)}</span>
      ),
    },
    {
      key: "salePrice",
      header: "قیمت فروش",
      render: (row) => (
        <span className="whitespace-nowrap font-semibold">{formatMoney(row.salePrice)}</span>
      ),
    },
    {
      key: "stockTotal",
      header: "موجودی کل",
      render: (row) => {
        const stock = Number(row.stockTotal ?? 0);
        const min = Number(row.minStock ?? 0);
        const low = min > 0 && stock <= min;
        return (
          <span className={low ? "font-bold text-rose-600" : ""}>{formatNumber(stock)}</span>
        );
      },
    },
    {
      key: "isActive",
      header: "وضعیت",
      render: (row) =>
        row.isActive === false ? (
          <Badge variant="outline" className={BADGE_TONES.slate}>
            غیرفعال
          </Badge>
        ) : (
          <Badge variant="outline" className={BADGE_TONES.emerald}>
            فعال
          </Badge>
        ),
    },
    {
      key: "actions",
      header: "عملیات",
      sortable: false,
      render: (row) => (
        <div className="flex items-center gap-1">
          {hasPermission("products.edit") && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="ویرایش"
              onClick={() => openEdit(row)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {hasPermission("products.edit") && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title={row.isActive === false ? "فعال‌سازی" : "غیرفعال‌سازی"}
              onClick={() => void toggleActive(row)}
            >
              <Power className="h-4 w-4" />
            </Button>
          )}
          {hasPermission("products.delete") && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-rose-600 hover:text-rose-700"
              title="حذف"
              onClick={() => setDeleting(row)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <PermissionGate permission="products.view">
      <div className="space-y-4">
        <PageHeader
          title="ادویه و اجناس"
          description="فهرست کامل ادویه، قیمت‌ها، حد نصاب موجودی و وضعیت فعال بودن"
        />

        {error && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={refetch}>
              تلاش مجدد
            </Button>
          </div>
        )}

        <Card className="border shadow-sm">
          <CardContent className="flex flex-col gap-3 p-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="فیلتر کتگوری">
                <Select value={catFilter} onValueChange={setCatFilter}>
                  <SelectTrigger className="w-full bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">همه کتگوری‌ها</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="فیلتر سازنده">
                <Select value={manFilter} onValueChange={setManFilter}>
                  <SelectTrigger className="w-full bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">همه سازندگان</SelectItem>
                    {manufacturers.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <div className="flex items-center gap-2 pb-1">
                <Switch
                  id="prod-include-inactive"
                  checked={includeInactive}
                  onCheckedChange={setIncludeInactive}
                />
                <Label htmlFor="prod-include-inactive" className="text-sm font-normal">
                  شامل غیرفعال‌ها
                </Label>
              </div>
            </div>
            {hasPermission("products.create") && (
              <Button
                className="bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={openCreate}
              >
                <Plus className="h-4 w-4" /> محصول جدید
              </Button>
            )}
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardContent className="p-4">
            <DataTable
              columns={columns}
              rows={products}
              loading={loading}
              searchKeys={["name", "genericName", "barcode", "dosageForm"]}
              searchPlaceholder="جستجوی نام، جنریک یا بارکد..."
              emptyText="محصولی ثبت نشده است"
              rowKey={(row) => row.id}
              selectable
              getRowId={(row) => String(row.id)}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              bulkActions={
                <>
                  {hasPermission("products.edit") && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 border-brand/40 text-brand-soft-foreground hover:bg-brand-soft"
                      disabled={bulkBusy}
                      onClick={() => void runBulk("activate")}
                    >
                      فعال‌سازی گروهی
                    </Button>
                  )}
                  {hasPermission("products.edit") && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 border-amber-300 text-amber-800 hover:bg-amber-50"
                      disabled={bulkBusy}
                      onClick={() => setBulkAction("deactivate")}
                    >
                      غیرفعال‌سازی گروهی
                    </Button>
                  )}
                  {hasPermission("products.delete") && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 border-rose-300 text-rose-700 hover:bg-rose-50"
                      disabled={bulkBusy}
                      onClick={() => setBulkAction("delete")}
                    >
                      حذف گروهی
                    </Button>
                  )}
                </>
              }
            />
          </CardContent>
        </Card>

        {/* فرم ایجاد/ویرایش محصول */}
        <FormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          title={editing ? "ویرایش محصول" : "محصول جدید"}
          description="معلومات اصلی، قیمت‌ها و حد نصاب موجودی محصول"
          wide
          onSubmit={submitForm}
          submitting={saving}
          submitLabel={editing ? "ذخیره تغییرات" : "ثبت محصول"}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="نام محصول" required>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="مثلاً پاراسیتامول"
                autoFocus
              />
            </Field>
            <Field label="نام جنریک">
              <Input
                value={form.genericName}
                onChange={(e) => setForm((f) => ({ ...f, genericName: e.target.value }))}
                placeholder="مثلاً Paracetamol"
              />
            </Field>

            <Field label="کتگوری">
              <div className="flex gap-2">
                <Select
                  value={form.categoryId || "none"}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, categoryId: v === "none" ? "" : v }))
                  }
                >
                  <SelectTrigger className="w-full bg-background">
                    <SelectValue placeholder="انتخاب کتگوری" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— بدون کتگوری —</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  title="کتگوری جدید"
                  aria-label="کتگوری جدید"
                  onClick={() => {
                    setQuickName("");
                    setQuickCountry("");
                    setQuickAdd("category");
                  }}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </Field>

            <Field label="سازنده">
              <div className="flex gap-2">
                <Select
                  value={form.manufacturerId || "none"}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, manufacturerId: v === "none" ? "" : v }))
                  }
                >
                  <SelectTrigger className="w-full bg-background">
                    <SelectValue placeholder="انتخاب سازنده" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— بدون سازنده —</SelectItem>
                    {manufacturers.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  title="سازنده جدید"
                  aria-label="سازنده جدید"
                  onClick={() => {
                    setQuickName("");
                    setQuickCountry("");
                    setQuickAdd("manufacturer");
                  }}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </Field>

            <Field label="کشور ساخت">
              <Input
                value={form.country}
                onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
                placeholder="مثلاً ایران"
              />
            </Field>
            <Field label="شکل دارویی">
              <Select
                value={form.dosageForm || "none"}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, dosageForm: v === "none" ? "" : v }))
                }
              >
                <SelectTrigger className="w-full bg-background">
                  <SelectValue placeholder="انتخاب شکل دارویی" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— بدون شکل —</SelectItem>
                  {DOSAGE_FORMS.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="مقدار (دوز)">
              <Input
                value={form.strength}
                onChange={(e) => setForm((f) => ({ ...f, strength: e.target.value }))}
                placeholder="مثلاً 500mg"
              />
            </Field>
            <Field label="واحد">
              <Input
                value={form.unit}
                onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                placeholder="عدد"
              />
            </Field>
            <Field label="بسته‌بندی">
              <Input
                value={form.packaging}
                onChange={(e) => setForm((f) => ({ ...f, packaging: e.target.value }))}
                placeholder="مثلاً جعبه ۱۰۰ عددی"
              />
            </Field>
            <Field label="بارکد">
              <Input
                dir="ltr"
                value={form.barcode}
                onChange={(e) => setForm((f) => ({ ...f, barcode: e.target.value }))}
                placeholder="Barcode"
              />
            </Field>
            <Field label="شرایط نگهداری">
              <Input
                value={form.storeCondition}
                onChange={(e) => setForm((f) => ({ ...f, storeCondition: e.target.value }))}
                placeholder="مثلاً درو حرارت ۲۵ درجه"
              />
            </Field>
            <Field label="قیمت خرید" required>
              <Input
                dir="ltr"
                type="number"
                min="0"
                step="any"
                value={form.purchasePrice}
                onChange={(e) => setForm((f) => ({ ...f, purchasePrice: e.target.value }))}
              />
            </Field>
            <Field label="قیمت فروش" required>
              <Input
                dir="ltr"
                type="number"
                min="0"
                step="any"
                value={form.salePrice}
                onChange={(e) => setForm((f) => ({ ...f, salePrice: e.target.value }))}
              />
            </Field>
            <Field label="حد نصاب موجودی">
              <Input
                dir="ltr"
                type="number"
                min="0"
                step="any"
                value={form.minStock}
                onChange={(e) => setForm((f) => ({ ...f, minStock: e.target.value }))}
              />
            </Field>
            <Field label="حداکثر موجودی">
              <Input
                dir="ltr"
                type="number"
                min="0"
                step="any"
                value={form.maxStock}
                onChange={(e) => setForm((f) => ({ ...f, maxStock: e.target.value }))}
              />
            </Field>
          </div>
        </FormDialog>

        {/* افزودن سریع کتگوری / سازنده */}
        <FormDialog
          open={quickAdd !== null}
          onOpenChange={(o) => {
            if (!o) setQuickAdd(null);
          }}
          title={quickAdd === "category" ? "کتگوری جدید" : "سازنده جدید"}
          description={
            quickAdd === "category"
              ? "نام کتگوری را وارد و ثبت کنید"
              : "نام و کشور سازنده را وارد کنید"
          }
          onSubmit={submitQuickAdd}
          submitting={quickSaving}
          submitLabel="ثبت"
        >
          <div className="space-y-3">
            <Field label="نام" required>
              <Input
                value={quickName}
                onChange={(e) => setQuickName(e.target.value)}
                placeholder={quickAdd === "category" ? "مثلاً آنتی‌بیوتیک" : "مثلاً حکیم فارما"}
                autoFocus
              />
            </Field>
            {quickAdd === "manufacturer" && (
              <Field label="کشور">
                <Input
                  value={quickCountry}
                  onChange={(e) => setQuickCountry(e.target.value)}
                  placeholder="اختیاری — مثلاً پاکستان"
                />
              </Field>
            )}
          </div>
        </FormDialog>

        {/* تأیید حذف */}
        <ConfirmDialog
          open={deleting !== null}
          onOpenChange={(o) => {
            if (!o) setDeleting(null);
          }}
          title="حذف محصول"
          message={
            deleting
              ? `آیا از حذف «${deleting.name}» مطمئن هستید؟ در صورت داشتن بچ یا سابقه فروش، محصول به‌جای حذف غیرفعال می‌شود.`
              : ""
          }
          confirmLabel="حذف"
          danger
          onConfirm={submitDelete}
          submitting={busy}
        />

        {/* تأیید حذف گروهی */}
        <ConfirmDialog
          open={bulkAction === "delete"}
          onOpenChange={(o) => {
            if (!o) setBulkAction(null);
          }}
          title="حذف گروهی محصولات"
          message={`حذف گروهی ${selectedIds.length.toLocaleString("en-US")} مورد؟ این عمل قابل بازگشت نیست. محصولات دارای بچ یا سابقه، به‌جای حذف غیرفعال می‌شوند.`}
          confirmLabel="حذف"
          danger
          onConfirm={() => void runBulk("delete")}
          submitting={bulkBusy}
        />

        {/* تأیید غیرفعال‌سازی گروهی */}
        <ConfirmDialog
          open={bulkAction === "deactivate"}
          onOpenChange={(o) => {
            if (!o) setBulkAction(null);
          }}
          title="غیرفعال‌سازی گروهی محصولات"
          message={`غیرفعال‌سازی ${selectedIds.length.toLocaleString("en-US")} محصول انتخاب‌شده؟ محصولات غیرفعال در فروش و فاکتور جدید نمایش داده نمی‌شوند و می‌توانید بعداً دوباره فعالشان کنید.`}
          confirmLabel="غیرفعال‌سازی"
          danger
          onConfirm={() => void runBulk("deactivate")}
          submitting={bulkBusy}
        />
      </div>
    </PermissionGate>
  );
}
