"use client";

/** هدر صفحه + کارت آمار + بج وضعیت */

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { DOC_STATUS, BATCH_STATUS, MOVEMENT_TYPES, SEVERITY } from "@/lib/terminology";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-bold sm:text-2xl">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const TONES: Record<string, string> = {
  emerald: "bg-brand-soft text-brand-soft-foreground border-brand/40 dark:bg-brand-soft dark:text-brand-soft-foreground dark:border-brand/40",
  amber: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900",
  rose: "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-900",
  slate: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
};

export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "emerald",
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon?: LucideIcon;
  tone?: "emerald" | "amber" | "rose" | "slate";
}) {
  return (
    <Card className="border shadow-sm">
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 truncate text-lg font-bold sm:text-xl">{value}</p>
          {sub && <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p>}
        </div>
        {Icon && (
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border",
              TONES[tone]
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function mapTone(map: Record<string, { label: string; tone: string }>, status?: string | null) {
  if (!status) return { label: "—", tone: "slate" };
  return map[status] ?? { label: status, tone: "slate" };
}

export function StatusBadge({ status }: { status?: string | null }) {
  const { label, tone } = mapTone(DOC_STATUS, status);
  return <Badge variant="outline" className={TONES[tone] ?? TONES.slate}>{label}</Badge>;
}

export function BatchStatusBadge({ status }: { status?: string | null }) {
  const { label, tone } = mapTone(BATCH_STATUS, status);
  return <Badge variant="outline" className={TONES[tone] ?? TONES.slate}>{label}</Badge>;
}

export function MovementBadge({ type }: { type?: string | null }) {
  const { label, tone } = mapTone(MOVEMENT_TYPES, type);
  return <Badge variant="outline" className={TONES[tone] ?? TONES.slate}>{label}</Badge>;
}

export function SeverityBadge({ severity }: { severity?: string | null }) {
  const { label, tone } = mapTone(SEVERITY, severity);
  return <Badge variant="outline" className={TONES[tone] ?? TONES.slate}>{label}</Badge>;
}

export { TONES as BADGE_TONES };
