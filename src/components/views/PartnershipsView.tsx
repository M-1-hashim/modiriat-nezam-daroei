"use client";

/** ویو شراکت‌ها — شراکت‌ها، شرکا، توزیع منفعت */

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Handshake,
  Users,
  Percent,
  Calculator,
  Lightbulb,
  CheckCircle2,
  Ban,
  Trash2,
} from "lucide-react";
import { useUser, PermissionGate } from "@/components/shared/use-user";
import {
  PageHeader,
  StatCard,
  StatusBadge,
  BADGE_TONES,
} from "@/components/shared/page-header";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FormDialog, ConfirmDialog } from "@/components/shared/form-dialog";
import { useApiData, apiSend, uuid, type QueuedResult } from "@/lib/client-api";
import { runBulkOperation, bulkResultMessage } from "@/lib/bulk";
import {
  formatMoney,
  formatNumber,
  formatPct,
  formatHijriShort,
} from "@/lib/format";
import { dateToHijriInput, hijriInputToDate, hijriInputToDayEnd, hijriInputToDayStart } from "@/lib/hijri";
import {
  PARTNERSHIP_TYPES,
  PARTNERSHIP_ROLES,
  DISTRIBUTION_BASES,
  labelOf,
} from "@/lib/terminology";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// ─────────────────────────── انواع ───────────────────────────

type Partner = {
  id: string;
  name: string;
  phone?: string | null;
  note?: string | null;
};

type Partnership = {
  id: string;
  branchId: string;
  branch?: { id: string; name: string } | null;
  partnerId: string;
  partner?: { id: string; name: string } | null;
  type: string;
  role?: string | null;
  capital: number;
  profitSharePct: number;
  lossSharePct: number;
  profitMethod?: string | null;
  startDate: string;
  endDate?: string | null;
  terms?: string | null;
  status: string;
};

type Distribution = {
  id: string;
  partnershipId: string;
  partnership?: {
    id: string;
    type?: string;
    partner?: { id: string; name: string } | null;
  } | null;
  periodFrom: string;
  periodTo: string;
  revenueAfn: number;
  cogsAfn: number;
  grossProfitAfn: number;
  expensesAfn: number;
  netProfitAfn: number;
  distributionBase: string;
  baseAmountAfn: number;
  sharePct: number;
  partnerShareAfn: number;
  status: string;
};

type CalcSummary = {
  revenueAfn: number;
  cogsAfn: number;
  grossProfitAfn: number;
  expensesAfn: number;
  netProfitAfn: number;
  distributionBase?: string;
  baseAmountAfn?: number;
};

type Branch = { id: string; name: string };

type PartnershipForm = {
  id?: string;
  branchId: string;
  partnerId: string;
  type: string;
  role: string;
  capital: string;
  profitSharePct: string;
  lossSharePct: string;
  profitMethod: string;
  startDate: string;
  endDate: string;
  terms: string;
};

type PartnerForm = { id?: string; name: string; phone: string; note: string };

// ─────────────────────────── کمکی ───────────────────────────

const PARTNERSHIP_STATUS: Record<string, { label: string; tone: string }> = {
  ACTIVE: { label: "فعال", tone: "emerald" },
  ENDED: { label: "خاتمه یافته", tone: "slate" },
  SUSPENDED: { label: "معلق", tone: "amber" },
};

const PROFIT_METHOD_DEFAULT = "طریقه محاسبه منفعت طبق قرارداد";

const todayInput = () => dateToHijriInput(new Date());
const monthAgoInput = () => dateToHijriInput(new Date(Date.now() - 30 * 864e5));

function listOf<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    const items = (data as { items?: unknown }).items;
    if (Array.isArray(items)) return items as T[];
  }
  return [];
}

function qs(
  params: Record<string, string | number | undefined | null>,
): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v).trim() !== "")
      sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

function hijriToIso(s: string): string | undefined {
  if (!s.trim()) return undefined;
  const d = hijriInputToDate(s);
  return d ? d.toISOString() : undefined;
}

/** فیلتر/دوره «از تاریخ» — شروع روز شمسی (۰۰:۰۰ کابل) */
function hijriRangeFrom(s: string): string | undefined {
  if (!s.trim()) return undefined;
  const d = hijriInputToDayStart(s);
  return d ? d.toISOString() : undefined;
}

/** فیلتر/دوره «تا تاریخ» — ختم روز شمسی (۲۳:۵۹:۵۹ کابل) */
function hijriRangeTo(s: string): string | undefined {
  if (!s.trim()) return undefined;
  const d = hijriInputToDayEnd(s);
  return d ? d.toISOString() : undefined;
}

function isQueued(res: unknown): res is QueuedResult {
  return !!res && typeof res === "object" && "queued" in res;
}

function num(v: unknown, def = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function PartnershipStatusBadge({ status }: { status?: string | null }) {
  const s = (status && PARTNERSHIP_STATUS[status]) || {
    label: status ?? "—",
    tone: "slate",
  };
  return (
    <Badge
      variant="outline"
      className={BADGE_TONES[s.tone] ?? BADGE_TONES.slate}
    >
      {s.label}
    </Badge>
  );
}

function parseCalcResult(data: unknown): {
  summary: CalcSummary | null;
  rows: Distribution[];
} {
  if (Array.isArray(data))
    return { summary: null, rows: data as Distribution[] };
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    const rawRows = Array.isArray(o.items)
      ? o.items
      : Array.isArray(o.distributions)
        ? o.distributions
        : [];
    const rows = rawRows as Distribution[];
    const rawSummary = (
      o.summary && typeof o.summary === "object" ? o.summary : o
    ) as Record<string, unknown>;
    if (
      typeof rawSummary.revenueAfn === "number" ||
      typeof rawSummary.netProfitAfn === "number"
    ) {
      return {
        summary: {
          revenueAfn: num(rawSummary.revenueAfn),
          cogsAfn: num(rawSummary.cogsAfn),
          grossProfitAfn: num(rawSummary.grossProfitAfn),
          expensesAfn: num(rawSummary.expensesAfn),
          netProfitAfn: num(rawSummary.netProfitAfn),
          distributionBase:
            typeof rawSummary.distributionBase === "string"
              ? rawSummary.distributionBase
              : undefined,
          baseAmountAfn:
            rawSummary.baseAmountAfn === undefined
              ? undefined
              : num(rawSummary.baseAmountAfn),
        },
        rows,
      };
    }
    return { summary: null, rows };
  }
  return { summary: null, rows: [] };
}

/** سلکت شعبه (فقط برای سوپرادمین نمایش داده می‌شود) */
function BranchSelect({
  branches,
  value,
  onChange,
  allowAll,
  disabled,
}: {
  branches: Branch[];
  value: string;
  onChange: (v: string) => void;
  allowAll?: boolean;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value || undefined}
      onValueChange={onChange}
      disabled={disabled}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder="انتخاب شعبه..." />
      </SelectTrigger>
      <SelectContent>
        {allowAll && <SelectItem value="ALL">همه شعب</SelectItem>}
        {branches.map((b) => (
          <SelectItem key={b.id} value={b.id}>
            {b.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ─────────────────────────── ویو ───────────────────────────

export default function PartnershipsView() {
  const { user, hasPermission } = useUser();
  const canCreate = hasPermission("partnerships.create");
  const canEdit = hasPermission("partnerships.edit");
  const canApprove = hasPermission("partnerships.approve");
  const canDeletePartner = hasPermission("partnerships.delete");

  const [tab, setTab] = useState("partnerships");

  // ── انتخاب گروهی ──
  const [selectedPIds, setSelectedPIds] = useState<string[]>([]);
  const [selectedPartnerIds, setSelectedPartnerIds] = useState<string[]>([]);
  const [selectedDIds, setSelectedDIds] = useState<string[]>([]);
  const [bulkEndOpen, setBulkEndOpen] = useState(false);
  const [bulkPartnerDeleteOpen, setBulkPartnerDeleteOpen] = useState(false);
  const [bulkApproveOpen, setBulkApproveOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  // شعب
  const { data: branchesData } = useApiData<unknown>(
    user.isSuperAdmin ? "/api/branches" : null,
  );
  const branches = useMemo(() => listOf<Branch>(branchesData), [branchesData]);

  // ── شراکت‌ها ──
  const [pStatus, setPStatus] = useState("ALL");
  const [pBranch, setPBranch] = useState("ALL");
  const pQuery = useMemo(
    () =>
      qs({
        status: pStatus !== "ALL" ? pStatus : undefined,
        branchId: pBranch !== "ALL" ? pBranch : undefined,
      }),
    [pStatus, pBranch],
  );
  const {
    data: partnershipsData,
    loading: pLoading,
    refetch: refetchPartnerships,
  } = useApiData<unknown>(`/api/partnerships${pQuery}`, [pQuery]);
  const partnerships = useMemo(
    () => listOf<Partnership>(partnershipsData),
    [partnershipsData],
  );

  // ── شرکا ──
  const { data: partnersData, refetch: refetchPartners } =
    useApiData<unknown>("/api/partners");
  const partners = useMemo(() => listOf<Partner>(partnersData), [partnersData]);

  // ── توزیع منفعت ──
  const [dBranch, setDBranch] = useState("ALL");
  const [dFrom, setDFrom] = useState(monthAgoInput);
  const [dTo, setDTo] = useState(todayInput);
  const dQuery = useMemo(
    () =>
      qs({
        branchId: dBranch !== "ALL" ? dBranch : undefined,
        from: hijriRangeFrom(dFrom),
        to: hijriRangeTo(dTo),
      }),
    [dBranch, dFrom, dTo],
  );
  const {
    data: distData,
    loading: dLoading,
    refetch: refetchDistributions,
  } = useApiData<unknown>(
    tab === "distributions" ? `/api/partnerships/distributions${dQuery}` : null,
    [tab, dQuery],
  );
  const distributions = useMemo(
    () => listOf<Distribution>(distData),
    [distData],
  );

  const [calcSummary, setCalcSummary] = useState<CalcSummary | null>(null);
  const [calcRows, setCalcRows] = useState<Distribution[]>([]);
  const [calculating, setCalculating] = useState(false);

  // دیالوگ شراکت
  const [pDialogOpen, setPDialogOpen] = useState(false);
  const [savingP, setSavingP] = useState(false);
  const [form, setForm] = useState<PartnershipForm>(() => ({
    branchId: user.branchId ?? "",
    partnerId: "",
    type: "EQUITY",
    role: "CAPITAL_PROVIDER",
    capital: "",
    profitSharePct: "",
    lossSharePct: "",
    profitMethod: "",
    startDate: todayInput(),
    endDate: "",
    terms: "",
  }));
  const [quickPartnerOpen, setQuickPartnerOpen] = useState(false);
  const [quickPartner, setQuickPartner] = useState({ name: "", phone: "" });
  const [quickSaving, setQuickSaving] = useState(false);

  // خاتمه شراکت
  const [endTarget, setEndTarget] = useState<Partnership | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // دیالوگ شریک
  const [partnerDialogOpen, setPartnerDialogOpen] = useState(false);
  const [partnerForm, setPartnerForm] = useState<PartnerForm>({
    name: "",
    phone: "",
    note: "",
  });
  const [savingPartner, setSavingPartner] = useState(false);

  // تأیید توزیع
  const [approveTarget, setApproveTarget] = useState<Distribution | null>(null);

  // مجموع سهم شراکت‌های سهامی فعال همان شعبه (بدون رکورد در حال ویرایش)
  const activeEquitySum = useMemo(() => {
    const bid = form.branchId || user.branchId || "";
    return partnerships
      .filter(
        (p) =>
          p.type === "EQUITY" &&
          p.status === "ACTIVE" &&
          (!form.id || p.id !== form.id) &&
          (!bid || p.branchId === bid),
      )
      .reduce((s, p) => s + (Number(p.profitSharePct) || 0), 0);
  }, [partnerships, form.branchId, form.id, user.branchId]);

  const formShareTotal = activeEquitySum + (Number(form.profitSharePct) || 0);

  const openCreatePartnership = () => {
    setForm({
      branchId: user.branchId ?? "",
      partnerId: "",
      type: "EQUITY",
      role: "CAPITAL_PROVIDER",
      capital: "",
      profitSharePct: "",
      lossSharePct: "",
      profitMethod: "",
      startDate: todayInput(),
      endDate: "",
      terms: "",
    });
    setQuickPartnerOpen(false);
    setPDialogOpen(true);
  };

  const openEditPartnership = (p: Partnership) => {
    setForm({
      id: p.id,
      branchId: p.branchId,
      partnerId: p.partnerId,
      type: p.type,
      role: p.role || "CAPITAL_PROVIDER",
      capital: String(p.capital ?? ""),
      profitSharePct: String(p.profitSharePct ?? ""),
      lossSharePct: String(p.lossSharePct ?? ""),
      profitMethod: p.profitMethod ?? "",
      startDate: dateToHijriInput(p.startDate) || todayInput(),
      endDate: p.endDate ? dateToHijriInput(p.endDate) : "",
      terms: p.terms ?? "",
    });
    setQuickPartnerOpen(false);
    setPDialogOpen(true);
  };

  const quickAddPartner = async () => {
    const name = quickPartner.name.trim();
    if (!name) {
      toast.error("نام شریک را وارد کنید");
      return;
    }
    setQuickSaving(true);
    try {
      const created = await apiSend<{ id?: string }>("/api/partners", {
        body: { name, phone: quickPartner.phone.trim() || undefined },
      });
      if (!isQueued(created)) {
        toast.success("شریک جدید ثبت شد");
        await refetchPartners();
        if (created && typeof created === "object" && "id" in created) {
          const id = (created as { id?: string }).id;
          if (id) setForm((f) => ({ ...f, partnerId: id }));
        }
      }
      setQuickPartnerOpen(false);
      setQuickPartner({ name: "", phone: "" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ثبت شریک ناموفق بود");
    } finally {
      setQuickSaving(false);
    }
  };

  const submitPartnership = async () => {
    if (!form.partnerId) {
      toast.error("شریک را انتخاب کنید");
      return;
    }
    if (!form.branchId) {
      toast.error("شعبه را انتخاب کنید");
      return;
    }
    const capital = Number(form.capital);
    if (!capital || capital <= 0) {
      toast.error("سرمایه را درست وارد کنید");
      return;
    }
    const startIso = hijriRangeFrom(form.startDate);
    if (!startIso) {
      toast.error("تاریخ شروع نامعتبر است — مثال: ۱۴۰۴/۰۱/۰۱");
      return;
    }
    const endIso = hijriRangeTo(form.endDate);
    const body: Record<string, unknown> = {
      branchId: form.branchId,
      partnerId: form.partnerId,
      type: form.type,
      capital,
      startDate: startIso,
      endDate: endIso,
      terms: form.terms.trim() || undefined,
    };
    if (form.type === "MUDARABAH") {
      body.role = form.role;
      body.profitMethod = form.profitMethod.trim() || PROFIT_METHOD_DEFAULT;
      body.profitSharePct = 0;
      body.lossSharePct = 0;
    } else {
      const profitPct = Number(form.profitSharePct);
      const lossPct = Number(form.lossSharePct);
      if (!Number.isFinite(profitPct) || profitPct < 0 || profitPct > 100) {
        toast.error("سهم منفعت باید بین ۰ تا ۱۰۰ باشد");
        return;
      }
      if (!Number.isFinite(lossPct) || lossPct < 0 || lossPct > 100) {
        toast.error("سهم خساره باید بین ۰ تا ۱۰۰ باشد");
        return;
      }
      if (formShareTotal > 100.001) {
        toast.error("مجموع سهم شراکت‌های فعال این شعبه از ۱۰۰٪ بیشتر می‌شود");
        return;
      }
      body.profitSharePct = profitPct;
      body.lossSharePct = lossPct;
    }
    setSavingP(true);
    try {
      let res: unknown;
      if (form.id) {
        res = await apiSend(`/api/partnerships/${form.id}`, {
          method: "PUT",
          body,
        });
      } else {
        body.localId = uuid();
        res = await apiSend("/api/partnerships", { body });
      }
      if (isQueued(res)) {
        toast.info("به‌صورت آفلاین ذخیره شد؛ پس از اتصال همگام می‌شود");
      } else {
        toast.success(form.id ? "شراکت ویرایش شد" : "شراکت ثبت شد");
        refetchPartnerships();
      }
      setPDialogOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ثبت شراکت ناموفق بود");
    } finally {
      setSavingP(false);
    }
  };

  const endPartnership = async () => {
    if (!endTarget) return;
    setBusyId(endTarget.id);
    try {
      const res = await apiSend(`/api/partnerships/${endTarget.id}/end`, {
        method: "POST",
        body: {},
      });
      if (isQueued(res)) {
        toast.info("به‌صورت آفلاین ذخیره شد؛ پس از اتصال همگام می‌شود");
      } else {
        toast.success("شراکت خاتمه یافت");
        refetchPartnerships();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خاتمه شراکت ناموفق بود");
    } finally {
      setBusyId(null);
      setEndTarget(null);
    }
  };

  // ── شرکا ──
  const openCreatePartner = () => {
    setPartnerForm({ name: "", phone: "", note: "" });
    setPartnerDialogOpen(true);
  };
  const openEditPartner = (p: Partner) => {
    setPartnerForm({
      id: p.id,
      name: p.name,
      phone: p.phone ?? "",
      note: p.note ?? "",
    });
    setPartnerDialogOpen(true);
  };
  const submitPartner = async () => {
    const name = partnerForm.name.trim();
    if (!name) {
      toast.error("نام شریک را وارد کنید");
      return;
    }
    setSavingPartner(true);
    try {
      const body: Record<string, unknown> = {
        name,
        phone: partnerForm.phone.trim() || undefined,
        note: partnerForm.note.trim() || undefined,
      };
      let res: unknown;
      if (partnerForm.id) {
        res = await apiSend(`/api/partners/${partnerForm.id}`, {
          method: "PUT",
          body,
        });
      } else {
        res = await apiSend("/api/partners", { body });
      }
      if (isQueued(res)) {
        toast.info("به‌صورت آفلاین ذخیره شد؛ پس از اتصال همگام می‌شود");
      } else {
        toast.success(partnerForm.id ? "شریک ویرایش شد" : "شریک ثبت شد");
        refetchPartners();
      }
      setPartnerDialogOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ثبت شریک ناموفق بود");
    } finally {
      setSavingPartner(false);
    }
  };

  // ── توزیع منفعت ──
  const calculateDistributions = async () => {
    const branchId = user.isSuperAdmin
      ? dBranch !== "ALL"
        ? dBranch
        : ""
      : (user.branchId ?? "");
    if (!branchId) {
      toast.error("شعبه را انتخاب کنید");
      return;
    }
    const dateFrom = hijriRangeFrom(dFrom);
    const dateTo = hijriRangeTo(dTo);
    if (!dateFrom || !dateTo) {
      toast.error("دوره را با تاریخ هجری معتبر تعیین کنید — مثال: ۱۴۰۴/۰۱/۰۱");
      return;
    }
    setCalculating(true);
    try {
      const res = await apiSend("/api/partnerships/distributions/calculate", {
        body: { branchId, dateFrom, dateTo },
      });
      if (isQueued(res)) {
        toast.info("به‌صورت آفلاین ذخیره شد؛ پس از اتصال همگام می‌شود");
        return;
      }
      const parsed = parseCalcResult(res);
      setCalcSummary(parsed.summary);
      setCalcRows(parsed.rows);
      toast.success("توزیع منفعت محاسبه شد");
      refetchDistributions();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "محاسبه توزیع ناموفق بود");
    } finally {
      setCalculating(false);
    }
  };

  const approveDistribution = async () => {
    if (!approveTarget) return;
    setBusyId(approveTarget.id);
    try {
      const res = await apiSend(
        `/api/partnerships/distributions/${approveTarget.id}/approve`,
        { method: "POST", body: {} },
      );
      if (isQueued(res)) {
        toast.info("به‌صورت آفلاین ذخیره شد؛ پس از اتصال همگام می‌شود");
      } else {
        toast.success("توزیع منفعت تأیید شد");
        refetchDistributions();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تأیید توزیع ناموفق بود");
    } finally {
      setBusyId(null);
      setApproveTarget(null);
    }
  };

  // ── عملیات گروهی ──
  const bulkToast = (action: string, result: { okIds: string[]; failures: { id: string; message: string }[] }) => {
    const msg = bulkResultMessage(action, result);
    if (msg.tone === "success") toast.success(msg.message);
    else if (msg.tone === "warning") toast.warning(msg.message);
    else toast.error(msg.message);
  };

  /** خاتمه گروهی شراکت‌های فعال — فقط ACTIVEها قابل خاتمه هستند */
  const bulkEndTargets = selectedPIds.filter((id) =>
    partnerships.some((p) => p.id === id && p.status === "ACTIVE"),
  );

  const doBulkEnd = async () => {
    setBulkBusy(true);
    try {
      const result = await runBulkOperation(bulkEndTargets, (id) =>
        apiSend(`/api/partnerships/${id}/end`, { method: "POST", body: {} }),
      );
      bulkToast("خاتمه گروهی شراکت‌ها", result);
      setSelectedPIds([]);
      refetchPartnerships();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خاتمه گروهی ناموفق بود");
    } finally {
      setBulkBusy(false);
      setBulkEndOpen(false);
    }
  };

  const doBulkDeletePartners = async () => {
    setBulkBusy(true);
    try {
      const result = await runBulkOperation(selectedPartnerIds, (id) =>
        apiSend(`/api/partners/${id}`, { method: "DELETE" }),
      );
      bulkToast("حذف گروهی شرکا", result);
      setSelectedPartnerIds([]);
      refetchPartners();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "حذف گروهی شرکا ناموفق بود");
    } finally {
      setBulkBusy(false);
      setBulkPartnerDeleteOpen(false);
    }
  };

  /** تأیید گروهی توزیع‌های محاسبه‌شده — فقط CALCULATED قابل تأیید است */
  const bulkApproveTargets = selectedDIds.filter((id) =>
    distributions.some((d) => d.id === id && d.status === "CALCULATED"),
  );

  const doBulkApproveDistributions = async () => {
    setBulkBusy(true);
    try {
      const result = await runBulkOperation(bulkApproveTargets, (id) =>
        apiSend(`/api/partnerships/distributions/${id}/approve`, {
          method: "POST",
          body: {},
        }),
      );
      bulkToast("تأیید گروهی توزیع منفعت", result);
      setSelectedDIds([]);
      refetchDistributions();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تأیید گروهی توزیع ناموفق بود");
    } finally {
      setBulkBusy(false);
      setBulkApproveOpen(false);
    }
  };

  // ── ستون‌های جدول شراکت‌ها ──
  const partnershipColumns: Column<Partnership>[] = useMemo(
    () => [
      {
        key: "partner.name",
        header: "شریک",
        render: (r) => (
          <span className="font-semibold">{r.partner?.name ?? "—"}</span>
        ),
      },
      {
        key: "type",
        header: "نوع",
        render: (r) => (
          <div className="flex flex-col">
            <span>{labelOf(PARTNERSHIP_TYPES, r.type)}</span>
            {r.type === "MUDARABAH" && r.role && (
              <span className="text-xs text-muted-foreground">
                {labelOf(PARTNERSHIP_ROLES, r.role)}
              </span>
            )}
          </div>
        ),
      },
      {
        key: "branch.name",
        header: "شعبه",
        render: (r) => r.branch?.name ?? "—",
      },
      {
        key: "capital",
        header: "سرمایه",
        render: (r) => formatMoney(r.capital),
      },
      {
        key: "profitSharePct",
        header: "سهم منفعت",
        render: (r) =>
          r.type === "MUDARABAH" ? "طبق قرارداد" : formatPct(r.profitSharePct),
      },
      {
        key: "startDate",
        header: "از تاریخ",
        render: (r) => (
          <span className="whitespace-nowrap">
            {formatHijriShort(r.startDate)}
          </span>
        ),
      },
      {
        key: "endDate",
        header: "تا تاریخ",
        render: (r) => (
          <span className="whitespace-nowrap">
            {formatHijriShort(r.endDate)}
          </span>
        ),
      },
      {
        key: "status",
        header: "وضعیت",
        render: (r) => <PartnershipStatusBadge status={r.status} />,
      },
      {
        key: "actions",
        header: "عملیات",
        sortable: false,
        render: (r) => {
          const busy = busyId === r.id;
          if (!canEdit) return <span className="text-muted-foreground">—</span>;
          return (
            <div className="flex flex-wrap items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => openEditPartnership(r)}
              >
                <Pencil className="h-3.5 w-3.5" />
                ویرایش
              </Button>
              {r.status === "ACTIVE" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-rose-600 hover:text-rose-700"
                  disabled={busy}
                  onClick={() => setEndTarget(r)}
                >
                  خاتمه
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    [busyId, canEdit],
  );

  // ── ستون‌های جدول شرکا ──
  const partnerColumns: Column<Partner>[] = useMemo(
    () => [
      {
        key: "name",
        header: "نام",
        render: (r) => <span className="font-semibold">{r.name}</span>,
      },
      { key: "phone", header: "تلفن", render: (r) => r.phone || "—" },
      { key: "note", header: "یادداشت", render: (r) => r.note || "—" },
      {
        key: "actions",
        header: "عملیات",
        sortable: false,
        render: (r) =>
          canEdit ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => openEditPartner(r)}
            >
              <Pencil className="h-3.5 w-3.5" />
              ویرایش
            </Button>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
    ],
    [canEdit],
  );

  // ── ستون‌های جدول توزیع ──
  const distributionColumns: Column<Distribution>[] = useMemo(
    () => [
      {
        key: "partner",
        header: "شریک",
        render: (r) => (
          <span className="font-semibold">
            {r.partnership?.partner?.name ?? "—"}
          </span>
        ),
      },
      {
        key: "type",
        header: "نوع",
        render: (r) => labelOf(PARTNERSHIP_TYPES, r.partnership?.type),
      },
      {
        key: "period",
        header: "دوره",
        render: (r) => (
          <span className="whitespace-nowrap">
            {formatHijriShort(r.periodFrom)} — {formatHijriShort(r.periodTo)}
          </span>
        ),
      },
      {
        key: "base",
        header: "پایه توزیع",
        render: (r) => labelOf(DISTRIBUTION_BASES, r.distributionBase),
      },
      {
        key: "baseAmountAfn",
        header: "مبلغ پایه",
        render: (r) => formatMoney(r.baseAmountAfn),
      },
      { key: "sharePct", header: "سهم", render: (r) => formatPct(r.sharePct) },
      {
        key: "partnerShareAfn",
        header: "سهم شریک",
        render: (r) => (
          <span className="font-bold">{formatMoney(r.partnerShareAfn)}</span>
        ),
      },
      {
        key: "status",
        header: "وضعیت",
        render: (r) => <StatusBadge status={r.status} />,
      },
      {
        key: "actions",
        header: "عملیات",
        sortable: false,
        render: (r) => {
          if (!(r.status === "CALCULATED" && canApprove)) {
            return <span className="text-muted-foreground">—</span>;
          }
          return (
            <Button
              variant="outline"
              size="sm"
              className="border-brand/40 text-brand-soft-foreground hover:bg-brand-soft"
              disabled={busyId === r.id}
              onClick={() => setApproveTarget(r)}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              تأیید
            </Button>
          );
        },
      },
    ],
    [busyId, canApprove],
  );

  const activeCount = partnerships.filter((p) => p.status === "ACTIVE").length;
  const totalCapital = partnerships
    .filter((p) => p.status === "ACTIVE")
    .reduce((s, p) => s + (Number(p.capital) || 0), 0);

  return (
    <PermissionGate permission="partnerships.view">
      <div className="space-y-4">
        <PageHeader
          title="شراکت‌ها و توزیع منفعت"
          description={`مدیریت شرکا، شراکت‌ها و تقسیم منفعت${user.branchName ? ` — شعبه ${user.branchName}` : ""}`}
          actions={
            tab === "partnerships" && canCreate ? (
              <Button
                onClick={openCreatePartnership}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" />
                شراکت جدید
              </Button>
            ) : tab === "partners" && canCreate ? (
              <Button
                onClick={openCreatePartner}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" />
                شریک جدید
              </Button>
            ) : null
          }
        />

        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3 sm:w-fit">
            <TabsTrigger value="partnerships">
              <Handshake className="h-4 w-4" />
              شراکت‌ها
            </TabsTrigger>
            <TabsTrigger value="partners">
              <Users className="h-4 w-4" />
              شرکا
            </TabsTrigger>
            <TabsTrigger value="distributions">
              <Percent className="h-4 w-4" />
              توزیع منفعت
            </TabsTrigger>
          </TabsList>

          {/* ───── شراکت‌ها ───── */}
          <TabsContent value="partnerships" className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatCard
                label="شراکت‌های فعال"
                value={formatNumber(activeCount)}
                icon={Handshake}
              />
              <StatCard
                label="مجموع سرمایه فعال"
                value={formatMoney(totalCapital)}
                icon={Calculator}
                tone="slate"
              />
              <StatCard
                label="تعداد شرکا"
                value={formatNumber(partners.length)}
                icon={Users}
                tone="amber"
              />
            </div>

            <Card>
              <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
                {user.isSuperAdmin && (
                  <div className="space-y-1.5">
                    <Label>شعبه</Label>
                    <BranchSelect
                      branches={branches}
                      value={pBranch}
                      onChange={setPBranch}
                      allowAll
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>وضعیت</Label>
                  <Select value={pStatus} onValueChange={setPStatus}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">همه وضعیت‌ها</SelectItem>
                      <SelectItem value="ACTIVE">فعال</SelectItem>
                      <SelectItem value="SUSPENDED">معلق</SelectItem>
                      <SelectItem value="ENDED">خاتمه یافته</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <DataTable<Partnership>
                  columns={partnershipColumns}
                  rows={partnerships}
                  searchKeys={["partner.name", "branch.name"]}
                  searchPlaceholder="جستجو در شراکت‌ها..."
                  loading={pLoading}
                  emptyText="شراکتی برای نمایش وجود ندارد"
                  rowKey={(r) => r.id}
                  selectable={canEdit}
                  getRowId={(r) => r.id}
                  selectedIds={selectedPIds}
                  onSelectionChange={setSelectedPIds}
                  bulkActions={
                    canEdit && bulkEndTargets.length > 0 ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950"
                        disabled={bulkBusy}
                        onClick={() => setBulkEndOpen(true)}
                      >
                        <Ban className="h-3.5 w-3.5" />
                        خاتمه گروهی
                      </Button>
                    ) : null
                  }
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* ───── شرکا ───── */}
          <TabsContent value="partners" className="space-y-4">
            <Card>
              <CardContent className="p-4">
                <DataTable<Partner>
                  columns={partnerColumns}
                  rows={partners}
                  searchKeys={["name", "phone", "note"]}
                  searchPlaceholder="جستجو در شرکا..."
                  emptyText="شریکی ثبت نشده است"
                  rowKey={(r) => r.id}
                  selectable={canDeletePartner}
                  getRowId={(r) => r.id}
                  selectedIds={selectedPartnerIds}
                  onSelectionChange={setSelectedPartnerIds}
                  bulkActions={
                    canDeletePartner && selectedPartnerIds.length > 0 ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950"
                        disabled={bulkBusy}
                        onClick={() => setBulkPartnerDeleteOpen(true)}
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

          {/* ───── توزیع منفعت ───── */}
          <TabsContent value="distributions" className="space-y-4">
            {/* جعبه آموزشی زنجیره محاسبه */}
            <div className="rounded-lg border border-brand/40 bg-brand-soft p-4 text-sm dark:border-brand/40 dark:bg-brand-soft">
              <div className="flex items-start gap-2">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-brand-soft-foreground dark:text-brand-soft-foreground" />
                <div className="space-y-1 text-brand-soft-foreground dark:text-brand-soft-foreground">
                  <p className="font-bold">زنجیره محاسبه منفعت</p>
                  <p>
                    عواید ← بهای تمام‌شده ← منفعت ناخالص ← مصارف ← منفعت خالص ←
                    توزیع
                  </p>
                  <p className="text-xs leading-relaxed text-brand-soft-foreground dark:text-brand-soft-foreground">
                    منفعت ناخالص = عواید خالص − بهای تمام‌شده؛ منفعت خالص =
                    منفعت ناخالص − مصارف تأییدشده. مصارف فقط یک‌بار کسر می‌شوند
                    (در مرحله منفعت خالص) و سهم هر شریک بر اساس پایه توزیع
                    تعیین‌شده در تنظیمات محاسبه می‌گردد.
                  </p>
                </div>
              </div>
            </div>

            <Card>
              <CardContent className="grid grid-cols-1 items-end gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
                {user.isSuperAdmin && (
                  <div className="space-y-1.5">
                    <Label>شعبه *</Label>
                    <BranchSelect
                      branches={branches}
                      value={dBranch}
                      onChange={setDBranch}
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>دوره از (هجری) *</Label>
                  <Input
                    dir="ltr"
                    value={dFrom}
                    onChange={(e) => setDFrom(e.target.value)}
                    placeholder="۱۴۰۴/۰۱/۰۱"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>دوره تا (هجری) *</Label>
                  <Input
                    dir="ltr"
                    value={dTo}
                    onChange={(e) => setDTo(e.target.value)}
                    placeholder="۱۴۰۴/۰۱/۰۱"
                  />
                </div>
                {canCreate && (
                  <Button
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                    disabled={calculating}
                    onClick={() => void calculateDistributions()}
                  >
                    <Calculator className="h-4 w-4" />
                    {calculating ? "در حال محاسبه..." : "محاسبه توزیع"}
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* کارت نتیجه محاسبه */}
            {calcSummary && (
              <Card className="border-brand/40 dark:border-brand/40">
                <CardContent className="space-y-3 p-4">
                  <p className="text-sm font-bold">نتیجه محاسبه دوره</p>
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                    <StatCard
                      label="عواید"
                      value={formatMoney(calcSummary.revenueAfn)}
                      tone="slate"
                    />
                    <StatCard
                      label="بهای تمام‌شده"
                      value={formatMoney(calcSummary.cogsAfn)}
                      tone="amber"
                    />
                    <StatCard
                      label="منفعت ناخالص"
                      value={formatMoney(calcSummary.grossProfitAfn)}
                      tone="emerald"
                    />
                    <StatCard
                      label="مصارف"
                      value={formatMoney(calcSummary.expensesAfn)}
                      tone="rose"
                    />
                    <StatCard
                      label="منفعت خالص"
                      value={formatMoney(calcSummary.netProfitAfn)}
                      tone={calcSummary.netProfitAfn >= 0 ? "emerald" : "rose"}
                    />
                  </div>
                  <p className="text-sm">
                    پایه توزیع:{" "}
                    <span className="font-bold">
                      {labelOf(
                        DISTRIBUTION_BASES,
                        calcSummary.distributionBase,
                      )}
                    </span>
                    {calcSummary.baseAmountAfn !== undefined && (
                      <span className="mr-2 text-muted-foreground">
                        (مبلغ پایه: {formatMoney(calcSummary.baseAmountAfn)})
                      </span>
                    )}
                  </p>
                  {calcRows.length > 0 && (
                    <div className="overflow-x-auto rounded-md border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted text-xs">
                          <tr>
                            <th className="px-3 py-2 text-right">شریک</th>
                            <th className="px-3 py-2 text-right">نوع</th>
                            <th className="px-3 py-2 text-right">سهم</th>
                            <th className="px-3 py-2 text-right">سهم شریک</th>
                          </tr>
                        </thead>
                        <tbody>
                          {calcRows.map((row) => (
                            <tr key={row.id} className="border-t">
                              <td className="px-3 py-2 font-semibold">
                                {row.partnership?.partner?.name ?? "—"}
                              </td>
                              <td className="px-3 py-2">
                                {labelOf(
                                  PARTNERSHIP_TYPES,
                                  row.partnership?.type,
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {formatPct(row.sharePct)}
                              </td>
                              <td className="px-3 py-2 font-bold">
                                {formatMoney(row.partnerShareAfn)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent className="p-4">
                <DataTable<Distribution>
                  columns={distributionColumns}
                  rows={distributions}
                  searchKeys={["partnership.partner.name", "distributionBase"]}
                  searchPlaceholder="جستجو در توزیع‌ها..."
                  loading={dLoading}
                  emptyText="توزیعی برای نمایش وجود ندارد — ابتدا محاسبه توزیع را اجرا کنید"
                  rowKey={(r) => r.id}
                  selectable={canApprove}
                  getRowId={(r) => r.id}
                  selectedIds={selectedDIds}
                  onSelectionChange={setSelectedDIds}
                  bulkActions={
                    canApprove && bulkApproveTargets.length > 0 ? (
                      <Button
                        size="sm"
                        className="h-7 bg-primary text-primary-foreground hover:bg-primary/90"
                        disabled={bulkBusy}
                        onClick={() => setBulkApproveOpen(true)}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        تأیید گروهی
                      </Button>
                    ) : null
                  }
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* ───── دیالوگ شراکت ───── */}
        <FormDialog
          open={pDialogOpen}
          onOpenChange={setPDialogOpen}
          title={form.id ? "ویرایش شراکت" : "ثبت شراکت جدید"}
          description="مضاربه (سرمایه‌گذار و شریک کارگر) از شراکت سهامی جدا است"
          onSubmit={() => void submitPartnership()}
          submitting={savingP}
          submitLabel={form.id ? "ذخیره تغییرات" : "ثبت شراکت"}
          wide
        >
          <div className="space-y-4">
            {/* شریک */}
            <div className="space-y-1.5">
              <Label>شریک *</Label>
              <Select
                value={form.partnerId || undefined}
                onValueChange={(v) => setForm((f) => ({ ...f, partnerId: v }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="انتخاب شریک..." />
                </SelectTrigger>
                <SelectContent>
                  {partners.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {quickPartnerOpen ? (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={quickPartner.name}
                    onChange={(e) =>
                      setQuickPartner((q) => ({ ...q, name: e.target.value }))
                    }
                    placeholder="نام شریک"
                    autoFocus
                  />
                  <Input
                    dir="ltr"
                    value={quickPartner.phone}
                    onChange={(e) =>
                      setQuickPartner((q) => ({ ...q, phone: e.target.value }))
                    }
                    placeholder="تلفن"
                    className="sm:w-40"
                  />
                  <Button
                    size="sm"
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                    disabled={quickSaving}
                    onClick={() => void quickAddPartner()}
                  >
                    ذخیره
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setQuickPartnerOpen(false)}
                  >
                    انصراف
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  onClick={() => setQuickPartnerOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  شریک جدید
                </Button>
              )}
            </div>

            {/* شعبه */}
            {user.isSuperAdmin && (
              <div className="space-y-1.5">
                <Label>شعبه *</Label>
                <BranchSelect
                  branches={branches}
                  value={form.branchId}
                  onChange={(v) => setForm((f) => ({ ...f, branchId: v }))}
                  disabled={!!form.id}
                />
              </div>
            )}

            {/* نوع شراکت */}
            <div className="space-y-1.5">
              <Label>نوع شراکت *</Label>
              <RadioGroup
                value={form.type}
                onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}
                className="flex flex-row gap-6"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="EQUITY" id="ptype-equity" />
                  <Label htmlFor="ptype-equity" className="font-normal">
                    {labelOf(PARTNERSHIP_TYPES, "EQUITY")}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="MUDARABAH" id="ptype-mudarabah" />
                  <Label htmlFor="ptype-mudarabah" className="font-normal">
                    {labelOf(PARTNERSHIP_TYPES, "MUDARABAH")}
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {form.type === "MUDARABAH" ? (
              <>
                <div className="space-y-1.5">
                  <Label>نقش در مضاربه *</Label>
                  <Select
                    value={form.role}
                    onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CAPITAL_PROVIDER">
                        {labelOf(PARTNERSHIP_ROLES, "CAPITAL_PROVIDER")}
                      </SelectItem>
                      <SelectItem value="WORKING_PARTNER">
                        {labelOf(PARTNERSHIP_ROLES, "WORKING_PARTNER")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>سرمایه (افغانی) *</Label>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={form.capital}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, capital: e.target.value }))
                    }
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>طریقه محاسبه منفعت</Label>
                  <Input
                    value={form.profitMethod}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, profitMethod: e.target.value }))
                    }
                    placeholder={PROFIT_METHOD_DEFAULT}
                  />
                  <p className="text-xs text-muted-foreground">
                    در مضاربه سهم منفعت طبق قرارداد تعیین می‌شود؛ در صورت بروز
                    خساره، سرمایه‌گذار متحمل می‌گردد مگر تقصیر از شریک کارگر
                    باشد.
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label>سرمایه (افغانی) *</Label>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={form.capital}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, capital: e.target.value }))
                    }
                    placeholder="0"
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>سهم منفعت (٪) *</Label>
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="any"
                      value={form.profitSharePct}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          profitSharePct: e.target.value,
                        }))
                      }
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>سهم خساره (٪) *</Label>
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="any"
                      value={form.lossSharePct}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, lossSharePct: e.target.value }))
                      }
                      placeholder="0"
                    />
                  </div>
                </div>
                <div
                  className={cn(
                    "rounded-md border p-3 text-xs",
                    formShareTotal > 100
                      ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
                      : "border-brand/40 bg-brand-soft text-brand-soft-foreground dark:border-brand/40 dark:bg-brand-soft dark:text-brand-soft-foreground",
                  )}
                >
                  مجموع سهم منفعتِ شراکت‌های سهامی فعال این شعبه:{" "}
                  {formatPct(activeEquitySum)} — باقیمانده:{" "}
                  {formatPct(Math.max(0, 100 - activeEquitySum))}
                  {formShareTotal > 100 &&
                    " — هشدار: با این سهم، مجموع از ۱۰۰٪ بیشتر می‌شود!"}
                </div>
              </>
            )}

            {/* تاریخ‌ها */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>از تاریخ (هجری) *</Label>
                <Input
                  dir="ltr"
                  value={form.startDate}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, startDate: e.target.value }))
                  }
                  placeholder="۱۴۰۴/۰۱/۰۱"
                />
              </div>
              <div className="space-y-1.5">
                <Label>تا تاریخ (هجری — اختیاری)</Label>
                <Input
                  dir="ltr"
                  value={form.endDate}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, endDate: e.target.value }))
                  }
                  placeholder="۱۴۰۴/۰۱/۰۱"
                />
              </div>
            </div>

            {/* شرایط */}
            <div className="space-y-1.5">
              <Label>شرایط قرارداد</Label>
              <Textarea
                value={form.terms}
                onChange={(e) =>
                  setForm((f) => ({ ...f, terms: e.target.value }))
                }
                placeholder="شرایط و تفاهمات شراکت (اختیاری)"
                rows={3}
              />
            </div>
          </div>
        </FormDialog>

        {/* ───── دیالوگ شریک ───── */}
        <FormDialog
          open={partnerDialogOpen}
          onOpenChange={setPartnerDialogOpen}
          title={partnerForm.id ? "ویرایش شریک" : "ثبت شریک جدید"}
          onSubmit={() => void submitPartner()}
          submitting={savingPartner}
          submitLabel={partnerForm.id ? "ذخیره تغییرات" : "ثبت شریک"}
        >
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>نام *</Label>
              <Input
                value={partnerForm.name}
                onChange={(e) =>
                  setPartnerForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="نام کامل شریک"
              />
            </div>
            <div className="space-y-1.5">
              <Label>تلفن</Label>
              <Input
                dir="ltr"
                value={partnerForm.phone}
                onChange={(e) =>
                  setPartnerForm((f) => ({ ...f, phone: e.target.value }))
                }
                placeholder="07xxxxxxxx"
              />
            </div>
            <div className="space-y-1.5">
              <Label>یادداشت</Label>
              <Textarea
                value={partnerForm.note}
                onChange={(e) =>
                  setPartnerForm((f) => ({ ...f, note: e.target.value }))
                }
                placeholder="یادداشت (اختیاری)"
                rows={2}
              />
            </div>
          </div>
        </FormDialog>

        {/* ───── تأیید خاتمه شراکت ───── */}
        <ConfirmDialog
          open={!!endTarget}
          onOpenChange={(o) => !o && setEndTarget(null)}
          title="خاتمه شراکت"
          message={`آیا از خاتمه شراکت با «${endTarget?.partner?.name ?? "—"}» مطمئن هستید؟ پس از خاتمه، سهم این شریک در محاسبات توزیع جدید لحاظ نمی‌شود.`}
          confirmLabel="خاتمه شراکت"
          danger
          onConfirm={() => void endPartnership()}
          submitting={!!busyId}
        />

        {/* ───── تأیید توزیع ───── */}
        <ConfirmDialog
          open={!!approveTarget}
          onOpenChange={(o) => !o && setApproveTarget(null)}
          title="تأیید توزیع منفعت"
          message={`سهم شریک «${approveTarget?.partnership?.partner?.name ?? "—"}» به مبلغ ${formatMoney(approveTarget?.partnerShareAfn)} تأیید شود؟`}
          confirmLabel="تأیید توزیع"
          onConfirm={() => void approveDistribution()}
          submitting={!!busyId}
        />

        {/* ───── تأیید خاتمه گروهی شراکت‌ها ───── */}
        <ConfirmDialog
          open={bulkEndOpen}
          onOpenChange={(o) => !o && setBulkEndOpen(false)}
          title={`خاتمه گروهی ${bulkEndTargets.length.toLocaleString("en-US")} شراکت`}
          message={`آیا از خاتمه گروهی ${bulkEndTargets.length.toLocaleString("en-US")} شراکت فعال مطمئن هستید؟ پس از خاتمه، سهم این شرکا در محاسبات توزیع جدید لحاظ نمی‌شود.`}
          confirmLabel="خاتمه گروهی"
          danger
          onConfirm={() => void doBulkEnd()}
          submitting={bulkBusy}
        />

        {/* ───── تأیید حذف گروهی شرکا ───── */}
        <ConfirmDialog
          open={bulkPartnerDeleteOpen}
          onOpenChange={(o) => !o && setBulkPartnerDeleteOpen(false)}
          title={`حذف گروهی ${selectedPartnerIds.length.toLocaleString("en-US")} شریک`}
          message={`آیا از حذف گروهی ${selectedPartnerIds.length.toLocaleString("en-US")} شریک انتخاب‌شده مطمئن هستید؟ شرکایی که شراکت ثبت‌شده دارند قابل حذف نیستند و خطای مربوطه نمایش داده می‌شود.`}
          confirmLabel="حذف گروهی"
          danger
          onConfirm={() => void doBulkDeletePartners()}
          submitting={bulkBusy}
        />

        {/* ───── تأیید تأیید گروهی توزیع‌ها ───── */}
        <ConfirmDialog
          open={bulkApproveOpen}
          onOpenChange={(o) => !o && setBulkApproveOpen(false)}
          title={`تأیید گروهی ${bulkApproveTargets.length.toLocaleString("en-US")} توزیع منفعت`}
          message={`تأیید گروهی ${bulkApproveTargets.length.toLocaleString("en-US")} توزیع محاسبه‌شده انجام شود؟ سهم شرکا قطعی و در گزارشات مالی ثبت می‌گردد.`}
          confirmLabel="تأیید گروهی"
          onConfirm={() => void doBulkApproveDistributions()}
          submitting={bulkBusy}
        />
      </div>
    </PermissionGate>
  );
}
