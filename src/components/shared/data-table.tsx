"use client";

/**
 * جدول داده عمومی: جستجو، سورت، صفحه‌بندی، اسکرول، حالت بارگذاری و خالی
 * + انتخاب گروهی (Checkbox): انتخاب همه، شمارش انتخاب‌شده‌ها، نوار عملیات گروهی
 *
 * ترتیب استاندارد RTL: [چک‌باکس] → نام/اطلاعات اصلی → سایر اطلاعات → عملیات
 * (در RTL ستون اول آرایه در سمت راست‌ترین و ستون عملیات باید آخرین باشد)
 */

import { useEffect, useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown, ChevronUp, ChevronRight, ChevronLeft, Search, Inbox, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type Column<T> = {
  key: string;
  header: string;
  render?: (row: T, index: number) => React.ReactNode;
  sortable?: boolean;
  className?: string;
  headerClassName?: string;
};

type DataTableProps<T> = {
  columns: Column<T>[];
  rows: T[];
  searchKeys?: string[];
  searchPlaceholder?: string;
  loading?: boolean;
  emptyText?: string;
  pageSize?: number;
  rowKey?: (row: T, index: number) => string;
  toolbar?: React.ReactNode;
  maxHeightClass?: string;
  onRowClick?: (row: T) => void;
  footer?: React.ReactNode;
  /** فعال‌سازی انتخاب گروهی (ستون چک‌باکس در سمت راست جدول) */
  selectable?: boolean;
  /** شناسهٔ یکتای هر ردیف برای مدیریت انتخاب‌ها */
  getRowId?: (row: T) => string;
  /** شناسه‌های انتخاب‌شده (controlled) */
  selectedIds?: string[];
  /** تغییر انتخاب‌ها */
  onSelectionChange?: (ids: string[]) => void;
  /** دکمه‌های عملیات گروهی — در نوار بالای جدول هنگام انتخاب نمایش داده می‌شود */
  bulkActions?: React.ReactNode;
};

export function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  searchKeys,
  searchPlaceholder = "جستجو...",
  loading,
  emptyText = "موردی برای نمایش وجود ندارد",
  pageSize = 10,
  rowKey,
  toolbar,
  maxHeightClass = "max-h-96",
  onRowClick,
  footer,
  selectable = false,
  getRowId,
  selectedIds,
  onSelectionChange,
  bulkActions,
}: DataTableProps<T>) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    let out = rows;
    if (search.trim() && searchKeys && searchKeys.length > 0) {
      const q = search.trim().toLowerCase();
      out = out.filter((row) =>
        searchKeys.some((k) => {
          const v = getVal(row, k);
          return v != null && String(v).toLowerCase().includes(q);
        })
      );
    }
    if (sortKey) {
      out = [...out].sort((a, b) => {
        const va = getVal(a, sortKey);
        const vb = getVal(b, sortKey);
        const na = Number(va);
        const nb = Number(vb);
        let cmp: number;
        if (!Number.isNaN(na) && !Number.isNaN(nb) && va !== "" && vb !== "") {
          cmp = na - nb;
        } else {
          cmp = String(va ?? "").localeCompare(String(vb ?? ""), "fa");
        }
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return out;
  }, [rows, search, searchKeys, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  // ─── انتخاب گروهی ───
  const selectedSet = useMemo(
    () => new Set(selectedIds ?? []),
    [selectedIds],
  );
  const pageIds = useMemo(
    () =>
      pageRows.map((row, idx) =>
        getRowId ? getRowId(row) : String(rowKey?.(row, idx) ?? idx),
      ),
    [pageRows, getRowId, rowKey],
  );
  const selectedPageCount = pageIds.filter((id) => selectedSet.has(id)).length;
  const allPageSelected = pageIds.length > 0 && selectedPageCount === pageIds.length;
  const somePageSelected = selectedPageCount > 0 && !allPageSelected;

  const setSelection = (next: string[]) => onSelectionChange?.(next);

  const toggleRow = (id: string) => {
    if (!id) return;
    const next = selectedSet.has(id)
      ? (selectedIds ?? []).filter((x) => x !== id)
      : [...(selectedIds ?? []), id];
    setSelection(next);
  };

  const togglePageAll = () => {
    if (allPageSelected) {
      // لغو انتخاب ردیف‌های صفحهٔ فعلی
      setSelection((selectedIds ?? []).filter((id) => !pageIds.includes(id)));
    } else {
      // افزودن ردیف‌های صفحهٔ فعلی به انتخاب‌ها
      const merged = new Set(selectedIds ?? []);
      for (const id of pageIds) merged.add(id);
      setSelection([...merged]);
    }
  };

  const selectAllFiltered = () => {
    const merged = new Set(selectedIds ?? []);
    for (const row of filtered) {
      merged.add(getRowId ? getRowId(row) : String(rowKey?.(row, 0) ?? ""));
    }
    setSelection([...merged].filter(Boolean));
  };

  const clearSelection = () => setSelection([]);

  const selectionCount = selectedIds?.length ?? 0;
  const showBulkBar = selectable && selectionCount > 0;

  return (
    <div className="space-y-3">
      {(searchKeys?.length || toolbar || selectable) && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {searchKeys?.length ? (
            <div className="relative w-full sm:max-w-xs">
              <Search className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder={searchPlaceholder}
                className="pr-8"
              />
            </div>
          ) : (
            <div />
          )}
          {toolbar && <div className="flex flex-wrap items-center gap-2">{toolbar}</div>}
        </div>
      )}

      {/* نوار عملیات گروهی — فقط وقتی موردی انتخاب شده باشد */}
      {showBulkBar && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950"
          role="region"
          aria-label="عملیات گروهی"
        >
          <span className="text-sm font-bold text-amber-900 dark:text-amber-200">
            {selectionCount.toLocaleString("en-US")} مورد انتخاب شده
          </span>
          {filtered.length > selectionCount && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={selectAllFiltered}
            >
              انتخاب همهٔ {filtered.length.toLocaleString("en-US")} نتیجه
            </Button>
          )}
          <div className="flex flex-wrap items-center gap-2">{bulkActions}</div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={clearSelection}
            aria-label="لغو انتخاب همه"
          >
            <X className="h-3.5 w-3.5" />
            لغو انتخاب
          </Button>
        </div>
      )}

      <div className={cn("overflow-y-auto rounded-md border", maxHeightClass)}>
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-muted">
            <TableRow>
              {selectable && (
                <TableHead className="w-10 text-center">
                  {/* Radix Checkbox خودش button است — نباید داخل button دیگر باشد */}
                  <Checkbox
                    checked={allPageSelected ? true : somePageSelected ? "indeterminate" : false}
                    onCheckedChange={togglePageAll}
                    aria-label={allPageSelected ? "لغو انتخاب همه" : "انتخاب همه"}
                    className="align-middle"
                  />
                </TableHead>
              )}
              {columns.map((c) => (
                <TableHead
                  key={c.key}
                  className={cn("font-semibold", c.headerClassName)}
                >
                  {c.sortable === false ? (
                    c.header
                  ) : (
                    <button
                      type="button"
                      className="flex items-center gap-1 hover:text-foreground"
                      onClick={() => toggleSort(c.key)}
                    >
                      {c.header}
                      {sortKey === c.key ? (
                        sortDir === "asc" ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )
                      ) : null}
                    </button>
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {selectable && (
                    <TableCell className="text-center">
                      <Skeleton className="mx-auto h-4 w-4" />
                    </TableCell>
                  )}
                  {columns.map((c) => (
                    <TableCell key={c.key}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : pageRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length + (selectable ? 1 : 0)}
                  className="h-32 text-center text-muted-foreground"
                >
                  <div className="flex flex-col items-center gap-2">
                    <Inbox className="h-8 w-8 opacity-40" />
                    <span>{emptyText}</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((row, idx) => {
                const id = getRowId ? getRowId(row) : String(rowKey?.(row, idx) ?? idx);
                const isSelected = selectedSet.has(id);
                return (
                  <TableRow
                    key={id || idx}
                    data-selected={isSelected || undefined}
                    className={cn(
                      onRowClick && "cursor-pointer hover:bg-muted/60",
                      isSelected && "bg-amber-50/60 dark:bg-amber-950/30",
                    )}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {selectable && (
                      <TableCell
                        className="text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleRow(id)}
                          aria-label={`انتخاب ردیف ${idx + 1}`}
                          className="align-middle"
                        />
                      </TableCell>
                    )}
                    {columns.map((c) => (
                      <TableCell key={c.key} className={c.className}>
                        {c.render
                          ? c.render(row, (safePage - 1) * pageSize + idx)
                          : String(getVal(row, c.key) ?? "—")}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-muted-foreground">
          مجموع: {filtered.length.toLocaleString("en-US")} مورد
          {selectable && selectionCount > 0 && (
            <span className="mr-3 font-semibold text-amber-700 dark:text-amber-300">
              ({selectionCount.toLocaleString("en-US")} انتخاب شده)
            </span>
          )}
          {footer ? <span className="mr-3">{footer}</span> : null}
        </div>
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label="صفحه قبلی"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className="px-2 text-xs">
              صفحه {safePage} از {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              aria-label="صفحه بعدی"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function getVal<T extends Record<string, unknown>>(row: T, key: string): unknown {
  if (key.includes(".")) {
    return key.split(".").reduce<unknown>((acc, k) => {
      if (acc && typeof acc === "object") {
        return (acc as Record<string, unknown>)[k];
      }
      return undefined;
    }, row);
  }
  return row[key];
}
