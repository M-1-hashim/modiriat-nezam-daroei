"use client";

/**
 * چاپ اسناد: فاکتور خرید/فروش (دو تمپلیت) و رسید پرداخت
 * استفاده: setPrintDoc(doc) سپس modal باز و دکمه چاپ window.print را صدا می‌زند.
 */

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Printer, X } from "lucide-react";
import { formatMoney, formatHijriDate, currencyLabel } from "@/lib/format";
import { PURCHASE_TYPES, SALE_TYPES, PAYMENT_METHODS, labelOf } from "@/lib/terminology";

export type PrintLine = {
  productName: string;
  batchNumber?: string;
  expiryDate?: string | null;
  quantity: number;
  freeQuantity?: number;
  unitPrice: number;
  discountPct?: number;
  discountAmount?: number;
  netUnitPrice?: number;
  promotionNote?: string | null;
  lineTotal: number;
};

export type PrintDoc =
  | {
      kind: "SALE" | "PURCHASE";
      template: "SIMPLE" | "DETAILED";
      number: string;
      date: string | Date;
      companyName: string;
      branchName: string;
      branchPhone?: string | null;
      branchAddress?: string | null;
      partyName: string;
      partyPhone?: string | null;
      partyAddress?: string | null;
      docTypeLabel: string;
      currency: string;
      exchangeRate: number;
      lines: PrintLine[];
      subtotalAfn: number;
      discountTotalAfn: number;
      totalAfn: number;
      paidAmountAfn: number;
      returnedAfn?: number;
      notes?: string | null;
      footerNote?: string;
      userName?: string;
    }
  | {
      kind: "RECEIPT";
      number: string;
      date: string | Date;
      companyName: string;
      branchName: string;
      partyName: string;
      directionLabel: string;
      amountAfn: number;
      currency: string;
      methodLabel: string;
      reference?: string | null;
      notes?: string | null;
      relatedInvoice?: string | null;
      footerNote?: string;
      userName?: string;
    };

export function PrintDialog({
  doc,
  onOpenChange,
}: {
  doc: PrintDoc | null;
  onOpenChange: (open: boolean) => void;
}) {
  useEffect(() => {
    if (!doc) return;
    // اطمینان از فونت مناسب هنگام چاپ
    document.documentElement.setAttribute("data-printing", "true");
    return () => document.documentElement.removeAttribute("data-printing");
  }, [doc]);

  if (!doc) return null;

  return (
    <Dialog open={!!doc} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader className="print:hidden">
          <DialogTitle>پیش‌نمایش چاپ</DialogTitle>
        </DialogHeader>
        <PrintableDoc doc={doc} />
        <DialogFooter className="print:hidden">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="ml-1 h-4 w-4" /> بستن
          </Button>
          <Button onClick={() => window.print()}>
            <Printer className="ml-1 h-4 w-4" /> چاپ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PrintableDoc({ doc }: { doc: PrintDoc }) {
  const title =
    doc.kind === "RECEIPT"
      ? "رسید پرداخت"
      : doc.kind === "SALE"
        ? `فاکتور فروش — ${labelOf(SALE_TYPES, (doc as { docTypeLabel?: string }).docTypeLabel ?? "")}`
        : `فاکتور خرید — ${(doc as { docTypeLabel?: string }).docTypeLabel ?? ""}`;

  return (
    <div id="print-root" dir="rtl" className="print-doc bg-white p-4 text-slate-900">
      <div className="border-b-2 border-slate-800 pb-3 text-center">
        <h1 className="text-xl font-black">{doc.companyName}</h1>
        {doc.kind !== "RECEIPT" ? (
          <p className="mt-1 text-xs">
            {doc.branchName}
            {doc.branchPhone ? ` — تلفن: ${doc.branchPhone}` : ""}
            {doc.branchAddress ? ` — ${doc.branchAddress}` : ""}
          </p>
        ) : (
          <p className="mt-1 text-xs">{doc.branchName}</p>
        )}
        <p className="mt-2 text-base font-bold">{title}</p>
      </div>

      <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs">
        <div>
          <p><b>شماره سند:</b> {doc.number}</p>
          <p><b>تاریخ:</b> {formatHijriDate(doc.date)}</p>
        </div>
        <div className="text-left">
          <p>
            <b>{doc.kind === "PURCHASE" ? "تأمین‌کننده:" : doc.kind === "SALE" ? "مشتری:" : "طرف حساب:"}</b>{" "}
            {doc.partyName}
          </p>
          {doc.kind !== "RECEIPT" && (
            <>
              {(doc as { partyPhone?: string }).partyPhone && (
                <p><b>تلفن:</b> {(doc as { partyPhone?: string }).partyPhone}</p>
              )}
              {(doc as { partyAddress?: string }).partyAddress && (
                <p><b>آدرس:</b> {(doc as { partyAddress?: string }).partyAddress}</p>
              )}
            </>
          )}
          {doc.kind === "RECEIPT" && (
            <p><b>نوع:</b> {(doc as { directionLabel: string }).directionLabel}</p>
          )}
        </div>
      </div>

      {doc.kind === "RECEIPT" ? (
        <div className="mt-4 space-y-2">
          <div className="rounded-md border border-slate-300 p-4 text-center">
            <p className="text-sm">مبلغ</p>
            <p className="text-2xl font-black">
              {formatMoney((doc as { amountAfn: number }).amountAfn, undefined, { decimals: true })}
            </p>
            <p className="mt-1 text-xs">{currencyLabel((doc as { currency: string }).currency)}</p>
          </div>
          <p className="text-xs"><b>روش پرداخت:</b> {(doc as { methodLabel: string }).methodLabel}</p>
          {(doc as { reference?: string }).reference && (
            <p className="text-xs"><b>مرجع:</b> {(doc as { reference?: string }).reference}</p>
          )}
          {(doc as { relatedInvoice?: string }).relatedInvoice && (
            <p className="text-xs"><b>فاکتور مربوطه:</b> {(doc as { relatedInvoice?: string }).relatedInvoice}</p>
          )}
          {(doc as { notes?: string }).notes && (
            <p className="text-xs"><b>تفصیلات:</b> {(doc as { notes?: string }).notes}</p>
          )}
        </div>
      ) : (
        (() => {
          const d = doc as Extract<PrintDoc, { kind: "SALE" | "PURCHASE" }>;
          const detailed = d.template === "DETAILED";
          return (
            <>
              <table className="mt-3 w-full border-collapse text-xs">
                <thead>
                  <tr className="border border-slate-400 bg-slate-100 text-center">
                    <th className="border border-slate-300 p-1.5">#</th>
                    <th className="border border-slate-300 p-1.5">نام محصول</th>
                    {detailed && <th className="border border-slate-300 p-1.5">بچ</th>}
                    {detailed && <th className="border border-slate-300 p-1.5">انقضا</th>}
                    <th className="border border-slate-300 p-1.5">تعداد</th>
                    {detailed && <th className="border border-slate-300 p-1.5">مجانی</th>}
                    <th className="border border-slate-300 p-1.5">قیمت واحد</th>
                    {detailed && <th className="border border-slate-300 p-1.5">تخفیف</th>}
                    <th className="border border-slate-300 p-1.5">مجموع</th>
                    {detailed && d.lines.some((l) => l.promotionNote) && (
                      <th className="border border-slate-300 p-1.5">پروموشن</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {d.lines.map((l, i) => (
                    <tr key={i} className="text-center">
                      <td className="border border-slate-300 p-1.5">{i + 1}</td>
                      <td className="border border-slate-300 p-1.5 text-right font-medium">{l.productName}</td>
                      {detailed && <td className="border border-slate-300 p-1.5">{l.batchNumber ?? "—"}</td>}
                      {detailed && (
                        <td className="border border-slate-300 p-1.5">
                          {l.expiryDate ? formatHijriDate(l.expiryDate) : "—"}
                        </td>
                      )}
                      <td className="border border-slate-300 p-1.5">{l.quantity}</td>
                      {detailed && <td className="border border-slate-300 p-1.5">{l.freeQuantity ?? 0}</td>}
                      <td className="border border-slate-300 p-1.5">{formatMoney(l.unitPrice, undefined, { decimals: true })}</td>
                      {detailed && (
                        <td className="border border-slate-300 p-1.5">
                          {l.discountPct ? `${l.discountPct}٪` : l.discountAmount ? formatMoney(l.discountAmount, undefined, { withCurrency: false }) : "—"}
                        </td>
                      )}
                      <td className="border border-slate-300 p-1.5 font-semibold">{formatMoney(l.lineTotal, undefined, { decimals: true })}</td>
                      {detailed && d.lines.some((x) => x.promotionNote) && (
                        <td className="border border-slate-300 p-1.5">{l.promotionNote ?? "—"}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-3 flex justify-center">
                <table className="w-full max-w-xs border-collapse text-xs">
                  <tbody>
                    <tr>
                      <td className="border border-slate-300 bg-slate-50 p-1.5 font-medium">مجموع جزء</td>
                      <td className="border border-slate-300 p-1.5 text-left">{formatMoney(d.subtotalAfn, undefined, { decimals: true })}</td>
                    </tr>
                    {d.discountTotalAfn > 0 && (
                      <tr>
                        <td className="border border-slate-300 bg-slate-50 p-1.5 font-medium">تخفیف</td>
                        <td className="border border-slate-300 p-1.5 text-left">{formatMoney(d.discountTotalAfn, undefined, { decimals: true })}</td>
                      </tr>
                    )}
                    <tr>
                      <td className="border border-slate-300 bg-slate-50 p-1.5 font-bold">مجموع کل</td>
                      <td className="border border-slate-300 p-1.5 text-left font-bold">
                        {formatMoney(d.totalAfn, undefined, { decimals: true })} {currencyLabel(d.currency)}
                      </td>
                    </tr>
                    {d.currency !== "AFN" && (
                      <tr>
                        <td className="border border-slate-300 bg-slate-50 p-1.5 font-medium">نرخ تبدیل</td>
                        <td className="border border-slate-300 p-1.5 text-left">1 {d.currency} = {d.exchangeRate} افغانی</td>
                      </tr>
                    )}
                    <tr>
                      <td className="border border-slate-300 bg-slate-50 p-1.5 font-medium">پرداخت شده</td>
                      <td className="border border-slate-300 p-1.5 text-left">{formatMoney(d.paidAmountAfn, undefined, { decimals: true })}</td>
                    </tr>
                    <tr>
                      <td className="border border-slate-300 bg-slate-50 p-1.5 font-bold">باقی‌مانده</td>
                      <td className="border border-slate-300 p-1.5 text-left font-bold">
                        {formatMoney(d.totalAfn - d.paidAmountAfn, undefined, { decimals: true })}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {d.notes && <p className="mt-2 text-xs"><b>یادداشت:</b> {d.notes}</p>}
            </>
          );
        })()
      )}

      <div className="mt-5 flex justify-between border-t border-dashed border-slate-400 pt-3 text-[10px] text-slate-600">
        <span>{doc.userName ? `کاربر: ${doc.userName}` : ""}</span>
        <span>{doc.footerNote ?? ""}</span>
        <span>امضاء: ....................</span>
      </div>
    </div>
  );
}

/** helper برای ساخت PrintDoc از رکورد فروش/خرید API */
export function saleToPrintDoc(
  sale: Record<string, unknown>,
  ctx: { companyName: string; footerNote?: string }
): PrintDoc {
  const items = (sale.items as Record<string, unknown>[]) ?? [];
  return {
    kind: "SALE",
    template: (sale.invoiceTemplate as "SIMPLE" | "DETAILED") ?? "DETAILED",
    number: String(sale.number ?? ""),
    date: String(sale.date ?? ""),
    companyName: ctx.companyName,
    branchName: String((sale.branch as Record<string, unknown>)?.name ?? sale.branchName ?? ""),
    branchPhone: ((sale.branch as Record<string, unknown>)?.phone as string) ?? null,
    branchAddress: ((sale.branch as Record<string, unknown>)?.address as string) ?? null,
    partyName: String((sale.customer as Record<string, unknown>)?.name ?? ""),
    partyPhone: ((sale.customer as Record<string, unknown>)?.phone as string) ?? null,
    partyAddress: ((sale.customer as Record<string, unknown>)?.address as string) ?? null,
    docTypeLabel: labelOf(SALE_TYPES, String(sale.type ?? "")),
    currency: String(sale.currency ?? "AFN"),
    exchangeRate: Number(sale.exchangeRate ?? 1),
    lines: items.map((it) => {
      const p = (it.product as Record<string, unknown>) ?? {};
      const b = (it.batch as Record<string, unknown>) ?? {};
      return {
        productName: String(p.name ?? ""),
        batchNumber: String(b.batchNumber ?? ""),
        expiryDate: (b.expiryDate as string) ?? null,
        quantity: Number(it.quantity ?? 0),
        freeQuantity: Number(it.freeQuantity ?? 0),
        unitPrice: Number(it.unitPrice ?? 0),
        discountPct: Number(it.discountPct ?? 0),
        discountAmount: Number(it.discountAmount ?? 0),
        netUnitPrice: Number(it.netUnitPrice ?? 0),
        promotionNote: (it.promotionNote as string) ?? null,
        lineTotal: Number(it.lineTotal ?? 0),
      };
    }),
    subtotalAfn: Number(sale.subtotal ?? 0) * Number(sale.exchangeRate ?? 1),
    discountTotalAfn: Number(sale.discountTotal ?? 0) * Number(sale.exchangeRate ?? 1),
    totalAfn: Number(sale.totalAfn ?? 0),
    paidAmountAfn: Number(sale.paidAmount ?? 0),
    returnedAfn: Number(sale.returnedAfn ?? 0),
    notes: (sale.notes as string) ?? null,
    footerNote: ctx.footerNote,
    userName: String(sale.createdByName ?? ""),
  };
}

export function purchaseToPrintDoc(
  purchase: Record<string, unknown>,
  ctx: { companyName: string; footerNote?: string }
): PrintDoc {
  const items = (purchase.items as Record<string, unknown>[]) ?? [];
  return {
    kind: "PURCHASE",
    template: "DETAILED",
    number: String(purchase.number ?? ""),
    date: String(purchase.date ?? ""),
    companyName: ctx.companyName,
    branchName: String((purchase.branch as Record<string, unknown>)?.name ?? purchase.branchName ?? ""),
    branchPhone: ((purchase.branch as Record<string, unknown>)?.phone as string) ?? null,
    branchAddress: ((purchase.branch as Record<string, unknown>)?.address as string) ?? null,
    partyName: String((purchase.supplier as Record<string, unknown>)?.name ?? ""),
    partyPhone: ((purchase.supplier as Record<string, unknown>)?.phone as string) ?? null,
    partyAddress: ((purchase.supplier as Record<string, unknown>)?.address as string) ?? null,
    docTypeLabel: labelOf(PURCHASE_TYPES, String(purchase.type ?? "")),
    currency: String(purchase.currency ?? "AFN"),
    exchangeRate: Number(purchase.exchangeRate ?? 1),
    lines: items.map((it) => {
      const p = (it.product as Record<string, unknown>) ?? {};
      return {
        productName: String(p.name ?? ""),
        batchNumber: String(it.batchNumber ?? ""),
        expiryDate: (it.expiryDate as string) ?? null,
        quantity: Number(it.quantity ?? 0),
        freeQuantity: Number(it.freeQuantity ?? 0),
        unitPrice: Number(it.unitPrice ?? 0),
        discountPct: Number(it.discountPct ?? 0),
        discountAmount: Number(it.discountAmount ?? 0),
        netUnitPrice: Number(it.netUnitPrice ?? 0),
        promotionNote: (it.promotionNote as string) ?? null,
        lineTotal: Number(it.lineTotal ?? 0),
      };
    }),
    subtotalAfn: Number(purchase.subtotal ?? 0) * Number(purchase.exchangeRate ?? 1),
    discountTotalAfn: Number(purchase.discountTotal ?? 0) * Number(purchase.exchangeRate ?? 1),
    totalAfn: Number(purchase.totalAfn ?? 0),
    paidAmountAfn: Number(purchase.paidAmount ?? 0),
    returnedAfn: Number(purchase.returnedAfn ?? 0),
    notes: (purchase.notes as string) ?? null,
    footerNote: ctx.footerNote,
    userName: String(purchase.createdByName ?? ""),
  };
}

export function paymentToPrintDoc(
  payment: Record<string, unknown>,
  ctx: { companyName: string; footerNote?: string }
): PrintDoc {
  const party =
    (payment.customer as Record<string, unknown>)?.name ??
    (payment.supplier as Record<string, unknown>)?.name ??
    "";
  return {
    kind: "RECEIPT",
    number: String(payment.number ?? ""),
    date: String(payment.date ?? ""),
    companyName: ctx.companyName,
    branchName: String((payment.branch as Record<string, unknown>)?.name ?? payment.branchName ?? ""),
    partyName: String(party),
    directionLabel:
      payment.type === "CUSTOMER" ? "رسید دریافت از مشتری" : "رسید پرداخت به تأمین‌کننده",
    amountAfn: Number(payment.amount ?? 0),
    currency: String(payment.currency ?? "AFN"),
    methodLabel: labelOf(PAYMENT_METHODS, String(payment.method ?? "")),
    reference: (payment.reference as string) ?? null,
    notes: (payment.notes as string) ?? null,
    relatedInvoice:
      ((payment.sale as Record<string, unknown>)?.number as string) ??
      ((payment.purchase as Record<string, unknown>)?.number as string) ??
      null,
    footerNote: ctx.footerNote,
    userName: String(payment.createdByName ?? ""),
  };
}
